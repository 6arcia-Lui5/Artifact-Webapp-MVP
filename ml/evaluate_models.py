"""
Compare all models on the same held-out test set and write
reports/comparison.json. "deep+avg" is what the service uses:
deep model for date, deep and baseline averaged for region.
"""
import json

import numpy as np

from labels import load
from predictor import Predictor


def score(p, d):
    te = d[d.split == "test"]
    r = te[te.region_label.notna()]
    preds = [p.predict(t) for t in r.text]
    acc = np.mean([q["region"] == y for q, y in zip(preds, r.region_label)])
    top3 = np.mean([y in list(q["region_probs"])[:3] for q, y in zip(preds, r.region_label)])
    t = te[te.date_ok]
    dp = [p.predict(x)["date"] for x in t.text]
    err = np.abs(np.array([q["year"] for q in dp]) - t.mid_year.values)
    cov = np.mean([(na >= q["low"]) and (nb <= q["high"]) for q, nb, na in zip(dp, t.not_before, t.not_after)])
    width = np.median([q["high"] - q["low"] for q in dp])
    return {"region_accuracy": round(float(acc), 4), "region_top3": round(float(top3), 4),
            "date_mae_years": round(float(err.mean()), 1), "date_median_error_years": round(float(np.median(err)), 1),
            "date_within_50_years": round(float(np.mean(err <= 50)), 4),
            "interval_coverage": round(float(cov), 4), "interval_median_width_years": round(float(width), 0)}


if __name__ == "__main__":
    d = load()
    m = d[d.split == "train"]
    te = d[(d.split == "test") & d.date_ok]
    out = {
        "n_train": int(len(m)),
        "n_test_region": int(((d.split == "test") & d.region_label.notna()).sum()),
        "n_test_date": int(len(te)),
        "guess_most_common_region": round(float((d[(d.split == "test")].region_label == m.region_label.mode()[0]).sum()
                                                / ((d.split == "test") & d.region_label.notna()).sum()), 4),
        "guess_average_date_mae": round(float(np.abs(m[m.date_ok].mid_year.mean() - te.mid_year).mean()), 1),
        "baseline": score(Predictor("baseline"), d),
        "deep+avg": score(Predictor("deep"), d),
    }
    open("reports/comparison.json", "w").write(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
