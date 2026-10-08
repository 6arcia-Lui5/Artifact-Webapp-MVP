"""
Deep learning model: character-level CNN + BiGRU, trained on two tasks at once.
  - Region head: softmax over regions
  - Date head:   softmax over 25-year bins from 800 BCE to 1000 CE.
                 The target spreads evenly over every bin the listed date
                 range covers, so wide ranges teach "somewhere in here".

Characters are used (not words) because inscriptions are full of
abbreviations, broken words and gaps, as in Ithaca/Aeneas.

Writes models/deep.pt and reports/deep_metrics.json
"""
import json
import math
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

from labels import load, SEED

MAX_LEN = 256
YEAR_MIN, YEAR_MAX, BIN = -800, 1000, 25
N_BINS = (YEAR_MAX - YEAR_MIN) // BIN
BIN_CENTERS = np.array([YEAR_MIN + BIN * (i + 0.5) for i in range(N_BINS)])
COVER = 0.8   # target coverage for the predicted date interval


class InscriptionNet(nn.Module):
    def __init__(self, n_chars, n_regions, emb=64, hid=128):
        super().__init__()
        self.emb = nn.Embedding(n_chars, emb, padding_idx=0)
        self.convs = nn.ModuleList([nn.Conv1d(emb, hid, k, padding=k // 2) for k in (3, 5, 7)])
        self.gru = nn.GRU(3 * hid, hid, batch_first=True, bidirectional=True)
        self.drop = nn.Dropout(0.3)
        self.region_head = nn.Linear(4 * hid, n_regions)
        self.date_head = nn.Linear(4 * hid, N_BINS)

    def forward(self, x):
        mask = (x != 0).float().unsqueeze(-1)
        h = self.emb(x).transpose(1, 2)
        h = torch.cat([F.relu(c(h))[:, :, :x.size(1)] for c in self.convs], 1).transpose(1, 2)
        h, _ = self.gru(self.drop(h))
        mean = (h * mask).sum(1) / mask.sum(1).clamp(min=1)
        mx = (h - 1e4 * (1 - mask)).max(1).values
        z = self.drop(torch.cat([mean, mx], 1))
        return self.region_head(z), self.date_head(z)


def encode(texts, vocab):
    out = np.zeros((len(texts), MAX_LEN), dtype=np.int64)
    for i, t in enumerate(texts):
        ids = [vocab.get(c, 1) for c in t[:MAX_LEN]]
        out[i, :len(ids)] = ids
    return out


def date_target(nb, na):
    t = np.zeros(N_BINS, dtype=np.float32)
    lo = int(np.clip((nb - YEAR_MIN) // BIN, 0, N_BINS - 1))
    hi = int(np.clip((na - YEAR_MIN) // BIN, 0, N_BINS - 1))
    t[lo:hi + 1] = 1.0
    return t / t.sum()


def date_summary(p, cover=COVER):
    """Expected year and central interval holding `cover` of the probability."""
    cdf = np.cumsum(p)
    lo_q, hi_q = (1 - cover) / 2, 1 - (1 - cover) / 2
    lo = BIN_CENTERS[np.searchsorted(cdf, lo_q)] - BIN / 2
    hi = BIN_CENTERS[min(np.searchsorted(cdf, hi_q), N_BINS - 1)] + BIN / 2
    return float((p * BIN_CENTERS).sum()), float(lo), float(hi)


def trim(xb):
    """Cut a padded batch down to its longest row (most texts are short)."""
    n = int((xb != 0).sum(1).max().clamp(min=1))
    return xb[:, :n]


def pick_device(name="auto"):
    """GPU if available (NVIDIA CUDA or AMD ROCm both show up as 'cuda'), else CPU."""
    if name == "auto":
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(name)


def predict(model, X, bs=256):
    model.eval()
    dev = next(model.parameters()).device
    rp, dp = [], []
    with torch.no_grad():
        for i in range(0, len(X), bs):
            r, dd = model(trim(torch.from_numpy(X[i:i + bs])).to(dev))
            rp.append(F.softmax(r, -1).cpu().numpy())
            dp.append(F.softmax(dd, -1).cpu().numpy())
    return np.concatenate(rp), np.concatenate(dp)


def main(epochs=24, device="auto", batch_size=64, miopen=False):
    dev = pick_device(device)
    print(f"training on {dev}" + (f" ({torch.cuda.get_device_name(0)})" if dev.type == "cuda" else ""), flush=True)
    if dev.type == "cuda" and torch.version.hip and not miopen:
        # On AMD GPUs, MIOpen compiles some kernels on the fly, and on Windows
        # that can fail (e.g. clashing with Visual Studio headers). PyTorch's
        # own GPU kernels avoid that and are fast enough for this model.
        torch.backends.cudnn.enabled = False
        print("AMD GPU: using PyTorch's own kernels instead of MIOpen (add --miopen to use it)", flush=True)
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    torch.set_num_threads(max(1, torch.get_num_threads()))
    d = load()
    Path("models").mkdir(exist_ok=True)
    Path("reports").mkdir(exist_ok=True)

    train = d[d.split == "train"]
    counts = Counter("".join(train.text))
    chars = [c for c, n in counts.most_common() if n >= 3]
    vocab = {c: i + 2 for i, c in enumerate(chars)}   # 0 = pad, 1 = unknown
    regions = sorted(d.region_label.dropna().unique())
    rid = {r: i for i, r in enumerate(regions)}

    X = encode(d.text.tolist(), vocab)
    lengths = (X != 0).sum(1)
    yr = np.array([rid.get(r, -100) if isinstance(r, str) else -100 for r in d.region_label])
    yd = np.zeros((len(d), N_BINS), dtype=np.float32)
    has_d = d.date_ok.values
    for i in np.where(has_d)[0]:
        yd[i] = date_target(d.not_before.iat[i], d.not_after.iat[i])

    # class weights so small regions are not ignored
    rc = Counter(yr[(d.split == "train").values & (yr >= 0)])
    w = torch.tensor([len(train) / (len(regions) * rc.get(i, 1)) for i in range(len(regions))],
                     dtype=torch.float32).sqrt()

    tr_idx = np.where(d.split == "train")[0]
    va_idx = np.where(d.split == "val")[0]
    te_idx = np.where(d.split == "test")[0]

    model = InscriptionNet(len(vocab) + 2, len(regions)).to(dev)
    w = w.to(dev)
    opt = torch.optim.AdamW(model.parameters(), lr=2e-3, weight_decay=1e-4)
    steps = epochs * math.ceil(len(tr_idx) / batch_size)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=2e-3, total_steps=steps)

    best, best_state = -1e9, None
    for ep in range(epochs):
        model.train()
        t0 = time.time()
        np.random.shuffle(tr_idx)
        tot = 0.0
        # group similar lengths into the same batch, then shuffle batches
        batches = []
        for c in range(0, len(tr_idx), batch_size * 32):
            chunk = tr_idx[c:c + batch_size * 32]
            chunk = chunk[np.argsort(lengths[chunk])]
            batches += [chunk[i:i + batch_size] for i in range(0, len(chunk), batch_size)]
        np.random.shuffle(batches)
        for b in batches:
            xb = trim(torch.from_numpy(X[b]))
            # light augmentation: randomly mask characters as if damaged
            m = (torch.rand(xb.shape) < 0.05) & (xb > 1)
            xb = xb.masked_fill(m, vocab.get("#", 1)).to(dev)
            r_out, d_out = model(xb)
            yrb = torch.from_numpy(yr[b]).to(dev)
            loss_r = F.cross_entropy(r_out, yrb, weight=w, ignore_index=-100) if (yrb >= 0).any() else 0.0
            hb = torch.from_numpy(has_d[b]).to(dev)
            loss_d = 0.0
            if hb.any():
                logp = F.log_softmax(d_out[hb], -1)
                loss_d = -(torch.from_numpy(yd[b]).to(dev)[hb] * logp).sum(-1).mean()
            loss = loss_r + loss_d
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            sched.step()
            tot += float(loss.detach()) * len(b)
        # validation score: region accuracy minus scaled date error
        rp, dp = predict(model, X[va_idx])
        vr = yr[va_idx] >= 0
        acc = float((rp[vr].argmax(1) == yr[va_idx][vr]).mean())
        vd = has_d[va_idx]
        exp_year = (dp[vd] * BIN_CENTERS).sum(1)
        mae = float(np.abs(exp_year - d.mid_year.values[va_idx][vd]).mean())
        score = acc - mae / 500
        print(f"epoch {ep + 1:2d}  loss {tot / len(tr_idx):.3f}  val region acc {acc:.3f}  "
              f"val date MAE {mae:.1f}y  ({time.time() - t0:.0f}s)", flush=True)
        if score > best:
            best, best_state = score, {k: v.clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)

    # calibrate interval width on validation so ~80% of true ranges overlap it
    rp, dp = predict(model, X[va_idx])
    vd = has_d[va_idx]
    nb_v, na_v = d.not_before.values[va_idx][vd], d.not_after.values[va_idx][vd]
    cover = COVER
    for c in np.arange(0.5, 0.99, 0.02):
        s = [date_summary(p, c) for p in dp[vd]]
        cov = np.mean([(na >= lo) and (nb <= hi) for (m, lo, hi), nb, na in zip(s, nb_v, na_v)])
        if cov >= COVER:
            cover = float(c)
            break

    # ---- test metrics
    rp, dp = predict(model, X[te_idx])
    tr_ = yr[te_idx] >= 0
    pred_r = rp[tr_].argmax(1)
    true_r = yr[te_idx][tr_]
    top3 = np.mean([t in np.argsort(-p)[:3] for p, t in zip(rp[tr_], true_r)])
    f1s = []
    for k in range(len(regions)):
        tp = np.sum((pred_r == k) & (true_r == k))
        fp = np.sum((pred_r == k) & (true_r != k))
        fn = np.sum((pred_r != k) & (true_r == k))
        if tp + fp + fn:
            f1s.append(2 * tp / max(1, 2 * tp + fp + fn))
    td = has_d[te_idx]
    summ = [date_summary(p, cover) for p in dp[td]]
    exp_year = np.array([s[0] for s in summ])
    true_mid = d.mid_year.values[te_idx][td]
    err = np.abs(exp_year - true_mid)
    nb_t, na_t = d.not_before.values[te_idx][td], d.not_after.values[te_idx][td]
    coverage = np.mean([(na >= lo) and (nb <= hi) for (m, lo, hi), nb, na in zip(summ, nb_t, na_t)])

    metrics = {
        "model": "char CNN + BiGRU, multi-task (region + date bins)",
        "region": {
            "n_test": int(tr_.sum()),
            "accuracy": round(float((pred_r == true_r).mean()), 4),
            "top3_accuracy": round(float(top3), 4),
            "macro_f1": round(float(np.mean(f1s)), 4),
        },
        "date": {
            "n_test": int(td.sum()),
            "mae_years": round(float(err.mean()), 1),
            "median_ae_years": round(float(np.median(err)), 1),
            "within_50_years": round(float(np.mean(err <= 50)), 4),
            "interval_mass": round(cover, 2),
            "interval_coverage_test": round(float(coverage), 4),
        },
    }
    model = model.cpu()
    torch.save({"state": model.state_dict(), "vocab": vocab, "regions": regions,
                "cover": cover}, "models/deep.pt")
    Path("reports/deep_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2), encoding="utf-8")


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=24)
    ap.add_argument("--device", default="auto", help="auto, cuda or cpu")
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--miopen", action="store_true", help="AMD only: use MIOpen kernels")
    a = ap.parse_args()
    main(a.epochs, a.device, a.batch_size, a.miopen)
