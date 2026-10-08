"""
Load trained models and turn predictions into record flags.

A record is flagged when its listed date or region disagrees with what
the text suggests:
  - Date:   the listed range misses the model's 80% interval by more
            than 50 years (a small miss is normal, so it is not flagged).
  - Region: the model gives the listed region under 3% probability and
            it is not among the model's top three regions.
Flags are review hints for scholars, not corrections.
"""
from pathlib import Path

import joblib
import numpy as np

from build_dataset import normalize
from labels import USEP_REGION

HERE = Path(__file__).parent
REGION_LOW = 0.03
DATE_MARGIN = 50


def clean(text):
    """Accept Leiden-style input from users: drop expansions/restorations."""
    import re
    t = re.sub(r"\([^)]*\)", "", text)        # (expansions)
    t = re.sub(r"\[[^\]]*\]", " # ", t)       # [restorations] -> gap
    return normalize(t)


def norm_region(r):
    if not r:
        return None
    r = r.strip()
    return USEP_REGION.get(r.lower(), r)


class Predictor:
    def __init__(self, model="deep"):
        self.base = joblib.load(HERE / "models" / "baseline.joblib")
        #Older scikit-learn versions expect this setting was having issues on my version of python
        # Figured I'd add handling for multiple versions rather than just forcing full updates
        if not hasattr(self.base["region_clf"], "multi_class"):
            self.base["region_clf"].multi_class = "auto"

        self.deep = None
        if model == "deep" and (HERE / "models" / "deep.pt").exists():
            import torch
            from train_deep import InscriptionNet, encode, date_summary
            ck = torch.load(HERE / "models" / "deep.pt", weights_only=False, map_location="cpu")
            net = InscriptionNet(len(ck["vocab"]) + 2, len(ck["regions"]))
            net.load_state_dict(ck["state"])
            net.eval()
            self.deep = (net, ck, encode, date_summary)
        self.model_name = "deep (region averaged with baseline)" if self.deep else "baseline"

    @property
    def regions(self):
        if self.deep:
            return list(self.deep[1]["regions"])
        return list(self.base["region_clf"].classes_)

    def predict(self, text):
        t = clean(text)
        if self.deep:
            import torch
            import torch.nn.functional as F
            net, ck, encode, date_summary = self.deep
            x = torch.from_numpy(encode([t], ck["vocab"]))
            with torch.no_grad():
                r, d = net(x)
            rp = F.softmax(r, -1).numpy()[0]
            dp = F.softmax(d, -1).numpy()[0]
            year, lo, hi = date_summary(dp, ck["cover"])
            regions = ck["regions"]
            # region: average the deep and baseline models (fixed 50/50, not tuned
            # on test data); the two make different mistakes
            bclf = self.base["region_clf"]
            if list(bclf.classes_) == list(regions):
                bp = bclf.predict_proba(self.base["vec"].transform([t]))[0]
                rp = 0.5 * rp + 0.5 * bp
        else:
            X = self.base["vec"].transform([t])
            rp = self.base["region_clf"].predict_proba(X)[0]
            regions = list(self.base["region_clf"].classes_)
            year = float(self.base["date_reg"].predict(X)[0])
            hw = self.base["date_half_width"]
            lo, hi = year - hw, year + hw
        order = np.argsort(-rp)
        return {
            "clean_text": t,
            "model": self.model_name,
            "date": {"year": round(year), "low": round(lo), "high": round(hi)},
            "region_probs": {regions[i]: round(float(rp[i]), 4) for i in order},
            "region": regions[order[0]],
        }

    def check(self, text, not_before=None, not_after=None, region=None):
        p = self.predict(text)
        flags = []
        if not_before is not None or not_after is not None:
            nb = not_before if not_before is not None else not_after
            na = not_after if not_after is not None else not_before
            lo, hi = p["date"]["low"], p["date"]["high"]
            gap = lo - na if na < lo else (nb - hi if nb > hi else 0)
            if gap > DATE_MARGIN:
                flags.append({
                    "field": "date",
                    "listed": fmt(nb) if nb == na else f"{fmt(nb)} to {fmt(na)}",
                    "predicted": f"{fmt(lo)} to {fmt(hi)} (best guess {fmt(p['date']['year'])})",
                    "gap_years": int(gap),
                    "message": f"Listed date is {int(gap)} years outside the range the text suggests.",
                })
        r = norm_region(region)
        if r:
            probs = p["region_probs"]
            listed_p = probs.get(r)
            top = p["region"]
            if listed_p is None:
                p["region_note"] = f"'{region}' is not a region the model knows."
            elif listed_p < REGION_LOW and r not in list(probs)[:3]:
                flags.append({
                    "field": "region",
                    "listed": r,
                    "predicted": f"{top} ({probs[top]:.0%})",
                    "listed_probability": listed_p,
                    "message": "Listed region is unlikely given the text.",
                })
        p["flags"] = flags
        p["flagged"] = bool(flags)
        return p


def fmt(y):
    y = int(round(y))
    return f"{-y} BCE" if y < 0 else f"{y} CE"
