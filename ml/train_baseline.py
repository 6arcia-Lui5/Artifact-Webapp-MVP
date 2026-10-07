"""
Baseline model: TF-IDF character n-grams.
  - Region:  logistic regression (classification)
  - Date:    ridge regression on the midpoint year

Writes models/baseline.joblib and reports/baseline_metrics.json
"""
import json
from pathlib import Path

import joblib
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.metrics import accuracy_score, f1_score

from labels import load


def main():
    d = load()
    Path("models").mkdir(exist_ok=True)
    Path("reports").mkdir(exist_ok=True)

    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(1, 4),
                          min_df=2, sublinear_tf=True, max_features=200_000)
    vec.fit(d.loc[d.split == "train", "text"])

    # ---- region
    r = d[d.region_label.notna()]
    tr, te = r[r.split == "train"], r[r.split == "test"]
    clf = LogisticRegression(max_iter=2000, C=5.0, class_weight="balanced")
    clf.fit(vec.transform(tr.text), tr.region_label)
    pred = clf.predict(vec.transform(te.text))
    proba = clf.predict_proba(vec.transform(te.text))
    top3 = np.argsort(-proba, axis=1)[:, :3]
    classes = clf.classes_
    top3_acc = np.mean([y in classes[t] for y, t in zip(te.region_label, top3)])

    # ---- date
    t = d[d.date_ok]
    trd, vad, ted = t[t.split == "train"], t[t.split == "val"], t[t.split == "test"]
    reg = Ridge(alpha=1.0)
    reg.fit(vec.transform(trd.text), trd.mid_year)
    val_err = np.abs(reg.predict(vec.transform(vad.text)) - vad.mid_year)
    test_pred = reg.predict(vec.transform(ted.text))
    err = np.abs(test_pred - ted.mid_year)
    # 80% interval half-width, set on validation data
    half_width = float(np.quantile(val_err, 0.8))
    lo, hi = test_pred - half_width, test_pred + half_width
    coverage = float(np.mean((ted.not_after >= lo) & (ted.not_before <= hi)))

    metrics = {
        "model": "TF-IDF char n-grams + linear models",
        "region": {
            "n_test": int(len(te)),
            "accuracy": round(float(accuracy_score(te.region_label, pred)), 4),
            "top3_accuracy": round(float(top3_acc), 4),
            "macro_f1": round(float(f1_score(te.region_label, pred, average="macro")), 4),
        },
        "date": {
            "n_test": int(len(ted)),
            "mae_years": round(float(err.mean()), 1),
            "median_ae_years": round(float(np.median(err)), 1),
            "within_50_years": round(float(np.mean(err <= 50)), 4),
            "interval_half_width_80": round(half_width, 1),
            "interval_coverage_test": round(coverage, 4),
            "predict_mean_baseline_mae": round(float(np.abs(trd.mid_year.mean() - ted.mid_year).mean()), 1),
        },
    }
    joblib.dump({"vec": vec, "region_clf": clf, "date_reg": reg,
                 "date_half_width": half_width}, "models/baseline.joblib")
    Path("reports/baseline_metrics.json").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))


if __name__ == "__main__":
    main()
