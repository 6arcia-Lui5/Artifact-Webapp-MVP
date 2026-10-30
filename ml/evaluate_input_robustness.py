"""Compare an unchanged checkpoint through two input paths on a pinned subset.

Use an original predictor source exported with git show as --reference-source.
Outputs go to --out; this never trains or replaces a model or historical report.
The input CSV must carry the reconstructed original hash split and labels.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import time

import numpy as np
import pandas as pd
import torch

from predictor import Predictor, clean

HERE = Path(__file__).resolve().parent


def annotate(text):
    # A readable erased word is still visible, unlike a restored [word].
    return re.sub(r"\b[^\W\d_]{3,}\b", lambda m: "[[" + m[0] + "]]", text, count=1)


def damaged(text):
    # Controlled missing-letter stress, not a simulation of actual OCR errors.
    letters = 0
    out = []
    for char in text:
        if char.isalpha():
            letters += 1
            if letters % 20 == 0:
                char = "#"
        out.append(char)
    return "".join(out)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def input_overlap(data, vocab, encode):
    """Check exact padded/unknown-mapped neural inputs within this subset."""
    encoded = encode(data.text.map(clean).tolist(), vocab)
    keys = [hashlib.sha256(row.tobytes()).hexdigest() for row in encoded]
    sets = {split: {key for key, group in zip(keys, data.split) if group == split} for split in ["train", "val", "test"]}
    return {a + "_" + b: len(sets[a] & sets[b]) for a, b in [("train", "val"), ("train", "test"), ("val", "test")]}


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--data", type=Path, required=True)
    ap.add_argument("--reference-source", type=Path, required=True)
    ap.add_argument("--split", choices=["val", "test"], required=True)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    if args.out.resolve() in {args.data.resolve(), args.reference_source.resolve()} or args.out.exists():
        ap.error("Choose a new output path, separate from input files.")
    if args.limit is not None and args.limit < 1:
        ap.error("limit must be positive")
    torch.set_num_threads(2)
    spec = importlib.util.spec_from_file_location("reference_predictor", args.reference_source)
    reference = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reference)
    reference.HERE = HERE
    old, new = reference.Predictor("deep"), Predictor("deep")
    if old.deep is None or new.deep is None:
        ap.error("Both paths require the shipped neural checkpoint; baseline fallback is not this experiment.")
    data = pd.read_csv(args.data).fillna({"text": ""})
    overlap = input_overlap(data, new.deep[1]["vocab"], new.deep[2])
    data = data[data.split == args.split].sort_values("id").drop_duplicates("text")
    eligible = len(data)
    if args.limit:
        data = data.head(args.limit)
    if data.empty:
        ap.error("No rows in requested split")
    cases = {name: [] for name in ["reference_canonical", "candidate_canonical", "reference_erasure", "candidate_erasure", "candidate_missing_letters"]}
    changed_notation = 0
    started = time.perf_counter()
    for index, row in enumerate(data.itertuples(), 1):
        text, notation = str(row.text), annotate(str(row.text))
        changed_notation += notation != text
        predictions = {}
        for name, model, value in [
            ("reference_canonical", old, text), ("candidate_canonical", new, text),
            ("reference_erasure", old, notation), ("candidate_erasure", new, notation),
            ("candidate_missing_letters", new, damaged(text)),
        ]:
            begin = time.perf_counter()
            try:
                pred = model.predict(value)
            except ValueError:
                pred = None
            predictions[name] = pred
            cases[name].append({
                "id": row.id, "rejected": pred is None,
                "region_correct": None if pd.isna(row.region_label) or pred is None else pred["region"] == row.region_label,
                "region_top3_correct": None if pd.isna(row.region_label) or pred is None else row.region_label in list(pred["region_probs"])[:3],
                "date_error_years": None if not row.date_ok or pred is None else abs(pred["date"]["year"] - row.mid_year),
                "same_as_canonical": pred == predictions["reference_canonical"],
                "preserves_canonical_input": (reference.clean(value) if model is old else clean(value)) == reference.clean(text),
                "elapsed_ms": (time.perf_counter() - begin) * 1000,
            })
        if index % 100 == 0:
            print(f"Compared {index}/{len(data)} rows ({time.perf_counter() - started:.1f}s)", flush=True)
    summaries = {}
    for name, rows in cases.items():
        regions = [r["region_correct"] for r in rows if r["region_correct"] is not None]
        top3 = [r["region_top3_correct"] for r in rows if r["region_top3_correct"] is not None]
        dates = [r["date_error_years"] for r in rows if r["date_error_years"] is not None]
        summaries[name] = {
            "n": len(rows), "rejected": sum(r["rejected"] for r in rows),
            "n_region_scored": len(regions), "region_top1": float(np.mean(regions)) if regions else None,
            "region_top3": float(np.mean(top3)) if top3 else None,
            "n_date_scored": len(dates), "date_mae_years": float(np.mean(dates)) if dates else None,
            "same_as_canonical_count": sum(r["same_as_canonical"] for r in rows),
            "preserves_canonical_input_count": sum(r["preserves_canonical_input"] for r in rows),
            "median_ms": float(np.median([r["elapsed_ms"] for r in rows])),
        }
    result = {
        "scope": "Reconstructed fixed EDH subset; conditional hash split, not full historical reproduction or client-domain validation.",
        "split": args.split, "eligible_unique_rows": eligible, "evaluated_rows": len(data),
        "notation_changed_rows": changed_notation,
        "exact_encoded_input_overlap_within_subset": overlap,
        "protocol": "First alphabetic word of at least3 letters receives readable [[erasure]] notation. Missing-letter stress replaces every20th alphabetic character with#. Neither perturbation is real photo accuracy.",
        "sources": {"data_sha256": digest(args.data), "reference_predictor_sha256": digest(args.reference_source), "candidate_predictor_sha256": digest(HERE / "predictor.py"), "model_sha256": {p.name: digest(p) for p in (HERE / "models").iterdir() if p.is_file()}},
        "date_metric": "Absolute error against catalog interval midpoint, not an independently known exact date.",
        "elapsed_seconds": time.perf_counter() - started,
        "summary": summaries, "cases": cases,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({"out": str(args.out), "split": args.split, "summary": summaries}, indent=2))


if __name__ == "__main__":
    main()
