"""
Accuracy, precision, recall and F1 for the models, on the held-out test set.

1. Area (region) prediction: a multi-class task. Reports accuracy and
   precision / recall / F1 per area, plus the macro average (every area
   counts the same) and the weighted average (big areas count more).
2. Date prediction, scored as a century: the predicted year and the true
   midpoint are both turned into a century, so the same measures apply.
3. Flags, as a yes/no detector: every test record is checked twice, once
   as listed (should NOT be flagged) and once with a planted error (date
   moved 300 years, or a wrong area; should be flagged).
   precision = of the records flagged, how many really had an error
   recall    = of the records with an error, how many were flagged

Usage:  python evaluate_metrics.py            (deep model, as the service uses it)
        python evaluate_metrics.py baseline
Writes reports/metrics_<model>.json and prints a summary.
"""
import json
import random
import sys
from pathlib import Path

import numpy as np
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, classification_report

from labels import load
from predictor import Predictor

SHIFT = 300


def scores(y_true, y_pred, labels=None):
    out = {"n": int(len(y_true)), "accuracy": round(float(accuracy_score(y_true, y_pred)), 4)}
    for avg in ("macro", "weighted"):
        p, r, f, _ = precision_recall_fscore_support(y_true, y_pred, labels=labels,
                                                     average=avg, zero_division=0)
        out[avg] = {"precision": round(float(p), 4), "recall": round(float(r), 4), "f1": round(float(f), 4)}
    return out


def binary(y_true, y_pred):
    p, r, f, _ = precision_recall_fscore_support(y_true, y_pred, average="binary", zero_division=0)
    tp = int(sum(t and q for t, q in zip(y_true, y_pred)))
    fp = int(sum((not t) and q for t, q in zip(y_true, y_pred)))
    fn = int(sum(t and not q for t, q in zip(y_true, y_pred)))
    tn = int(len(y_true) - tp - fp - fn)
    return {"n": len(y_true), "accuracy": round(float(accuracy_score(y_true, y_pred)), 4),
            "precision": round(float(p), 4), "recall": round(float(r), 4), "f1": round(float(f), 4),
            "true_pos": tp, "false_pos": fp, "false_neg": fn, "true_neg": tn}


def century(y):
    y = int(round(y))
    return f"{(-y - 1) // 100 + 1}c BCE" if y < 0 else f"{(y - 1) // 100 + 1 if y > 0 else 1}c CE"


def main(model="deep"):
    random.seed(0)
    p = Predictor(model)
    d = load()
    te = d[d.split == "test"]
    preds = {}
    print(f"predicting {len(te)} test records...", flush=True)
    for i, (idx, r) in enumerate(te.iterrows()):
        preds[idx] = p.predict(r.text)
        if (i + 1) % 2000 == 0:
            print(f"  {i + 1}", flush=True)

    # 1. area
    rg = te[te.region_label.notna()]
    y_true = list(rg.region_label)
    y_pred = [preds[i]["region"] for i in rg.index]
    areas = sorted(set(y_true))
    area = scores(y_true, y_pred, labels=areas)
    rep = classification_report(y_true, y_pred, labels=areas, output_dict=True, zero_division=0)
    area["per_area"] = {a: {"precision": round(rep[a]["precision"], 4), "recall": round(rep[a]["recall"], 4),
                            "f1": round(rep[a]["f1-score"], 4), "n": int(rep[a]["support"])} for a in areas}

    # 2. date as century
    dt = te[te.date_ok]
    c_true = [century(m) for m in dt.mid_year]
    c_pred = [century(preds[i]["date"]["year"]) for i in dt.index]
    date_c = scores(c_true, c_pred)

    # 3. flags as a detector
    regions = [x for x in p.regions if x != "Other"]
    dy, dp, ry, rp = [], [], [], []
    for i, r in te.iterrows():
        pr = preds[i]
        if r.date_ok:
            nb, na = int(r.not_before), int(r.not_after)
            s = SHIFT if (nb + na) / 2 < 200 else -SHIFT
            dy += [0, 1]
            dp += [any(f["field"] == "date" for f in p.check_prediction(pr, nb, na)["flags"]),
                   any(f["field"] == "date" for f in p.check_prediction(pr, nb + s, na + s)["flags"])]
        if isinstance(r.region_label, str) and r.region_label != "Other":
            wrong = random.choice([x for x in regions if x != r.region_label])
            ry += [0, 1]
            rp += [any(f["field"] == "region" for f in p.check_prediction(pr, region=r.region_label)["flags"]),
                   any(f["field"] == "region" for f in p.check_prediction(pr, region=wrong)["flags"])]

    out = {
        "model": p.model_name,
        "area_prediction": area,
        "date_prediction_as_century": date_c,
        "date_flags": binary(dy, dp),
        "area_flags": binary(ry, rp),
        "notes": "Flags: each test record checked as listed (label 0) and with a planted error "
                 f"(label 1): date moved {SHIFT} years, or a different area.",
    }
    Path("reports").mkdir(exist_ok=True)
    name = "deep" if model == "deep" else model
    Path(f"reports/metrics_{name}.json").write_text(json.dumps(out, indent=2), encoding="utf-8")

    def row(label, m):
        if "macro" in m:
            print(f"{label:<28} acc {m['accuracy']:.3f}   macro P {m['macro']['precision']:.3f}  "
                  f"R {m['macro']['recall']:.3f}  F1 {m['macro']['f1']:.3f}   "
                  f"weighted P {m['weighted']['precision']:.3f}  R {m['weighted']['recall']:.3f}  "
                  f"F1 {m['weighted']['f1']:.3f}")
        else:
            print(f"{label:<28} acc {m['accuracy']:.3f}   P {m['precision']:.3f}  R {m['recall']:.3f}  F1 {m['f1']:.3f}")
    print(f"\n{p.model_name}")
    row("Area prediction", area)
    row("Date, as century", date_c)
    row("Date flags (planted errors)", out["date_flags"])
    row("Area flags (planted errors)", out["area_flags"])
    print(f"\nsaved reports/metrics_{name}.json (includes per-area scores)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "deep")
