"""
Test the mismatch flags on held-out records.

1. Clean test records: how often do we flag a record that is correct?
   (false alarm rate - lower is better)
2. Planted errors: copy each test record, shift its date by 300 years or
   swap its region for a different one, and see how many we catch.
   (detection rate - higher is better)

Also writes demo/examples.json with a few real and planted cases.
Writes reports/flagging_metrics.json
"""
import json
import random
from pathlib import Path

import numpy as np

from labels import load
from predictor import Predictor

SHIFT = 300


def main(model="deep"):
    random.seed(0)
    p = Predictor(model)
    d = load()
    te = d[(d.split == "test") & (d.date_ok | d.region_label.notna())].copy()
    te = te[te.region_label != "Other"]
    regions = [r for r in p.regions if r != "Other"]

    clean_date = clean_region = 0
    n_date = n_region = 0
    caught_date = caught_region = 0
    examples = []
    per_corpus = {}
    names = {'isicily': 'I.Sicily', 'iip': 'IIP', 'usep': 'US Epigraphy', 'edh': 'EDH', 'lire': 'EDCS'}
    te['corpus_name'] = te.corpus.map(names)
    for _, r in te.iterrows():
        nb = int(r.not_before) if r.date_ok else None
        na = int(r.not_after) if r.date_ok else None
        reg = r.region_label if isinstance(r.region_label, str) else None
        out = p.check(r.text, nb, na, reg)
        if nb is not None:
            n_date += 1
            clean_date += any(f["field"] == "date" for f in out["flags"])
        if reg:
            n_region += 1
            clean_region += any(f["field"] == "region" for f in out["flags"])

        # planted errors
        if nb is not None:
            s = SHIFT if (nb + na) / 2 < 200 else -SHIFT
            o = p.check(r.text, nb + s, na + s, None)
            caught_date += any(f["field"] == "date" for f in o["flags"])
        if reg:
            wrong = random.choice([x for x in regions if x != reg])
            o2 = p.check(r.text, None, None, wrong)
            caught_region += any(f["field"] == "region" for f in o2["flags"])
            # demo examples: a record the model gets right as listed, paired
            # with a copy that has a planted error. Both are checked with the
            # exact inputs the demo page sends, and the pair is kept only if
            # the real one is clean and the planted one is flagged.
            if (nb is not None and 30 < len(r.text) < 220 and not out["flagged"]
                    and out["region"] == reg and per_corpus.get(r.corpus, 0) < 2
                    and len(examples) < 16 and random.random() < 0.15):
                name = f"{r.corpus_name} {r.id.split(':')[1]}"
                real = {"label": f"{name}: as listed", "text": r.text,
                        "not_before": nb, "not_after": na, "region": reg}
                if per_corpus.get(r.corpus, 0) == 0:
                    planted = dict(real, label=f"{name}: wrong region planted", region=wrong)
                else:
                    s2 = SHIFT if (nb + na) / 2 < 200 else -SHIFT
                    planted = dict(real, label=f"{name}: date moved {SHIFT} years",
                                   not_before=nb + s2, not_after=na + s2)
                ok_real = not p.check(real["text"], real["not_before"], real["not_after"], real["region"])["flagged"]
                ok_planted = p.check(planted["text"], planted["not_before"], planted["not_after"], planted["region"])["flagged"]
                if ok_real and ok_planted:
                    per_corpus[r.corpus] = per_corpus.get(r.corpus, 0) + 1
                    examples += [real, planted]

    m = {
        "model": p.model_name,
        "clean_records": {
            "date_checked": n_date,
            "date_false_alarm_rate": round(clean_date / max(1, n_date), 4),
            "region_checked": n_region,
            "region_false_alarm_rate": round(clean_region / max(1, n_region), 4),
        },
        "planted_errors": {
            "date_shift_years": SHIFT,
            "date_detection_rate": round(caught_date / max(1, n_date), 4),
            "region_swap_detection_rate": round(caught_region / max(1, n_region), 4),
        },
    }
    Path("reports").mkdir(exist_ok=True)
    Path(f"reports/flagging_metrics{'' if model == 'deep' else '_' + model}.json").write_text(json.dumps(m, indent=2), encoding="utf-8")
    if model == "deep":
        Path("demo").mkdir(exist_ok=True)
        Path("demo/examples.json").write_text(json.dumps(examples, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(m, indent=2))


if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else "deep")
