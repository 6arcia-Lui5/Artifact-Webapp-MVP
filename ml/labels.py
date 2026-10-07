"""Shared label rules and data split, used by every model."""
import numpy as np
import pandas as pd

SEED = 42
MAX_SPAN = 300          # only train dates on ranges of 300 years or less
MIN_REGION_COUNT = 60   # smaller regions are grouped as "Other"

# USEP gives "Country, City, ..." - map country to a broader region.
USEP_REGION = {
    "italy": "Italy", "rome": "Italy",
    "egypt": "Egypt",
    "greece": "Greece", "attica": "Greece",
    "turkey": "Asia Minor", "asia minor": "Asia Minor",
    "cyprus": "Cyprus",
    "tunisia": "North Africa", "libya": "North Africa", "algeria": "North Africa",
    "syria": "Syria", "lebanon": "Syria",
    "israel": "Judaea", "palestine": "Judaea",
}


def region_of(row):
    if row["corpus"] == "isicily":
        return "Sicily"
    if row["corpus"] == "iip":
        r = str(row["region"]) if isinstance(row["region"], str) else ""
        return r if r and r != "Unknown" else None
    place = str(row["place"]).lower() if isinstance(row["place"], str) else ""
    head = place.split(",")[0].strip()
    return USEP_REGION.get(head)


def load(path="data/inscriptions.csv"):
    d = pd.read_csv(path)
    d["text"] = d["text"].fillna("").astype(str)
    d["region_label"] = d.apply(region_of, axis=1)
    counts = d["region_label"].value_counts()
    small = counts[counts < MIN_REGION_COUNT].index
    d.loc[d["region_label"].isin(small), "region_label"] = "Other"

    d["span"] = d["not_after"] - d["not_before"]
    d["mid_year"] = (d["not_after"] + d["not_before"]) / 2
    # ancient material only (drops modern copies and forgeries)
    d["date_ok"] = (d["mid_year"].notna() & (d["span"] <= MAX_SPAN)
                    & d["mid_year"].between(-800, 1000))

    # fixed 80/10/10 split
    rng = np.random.RandomState(SEED)
    r = rng.rand(len(d))
    d["split"] = np.where(r < 0.8, "train", np.where(r < 0.9, "val", "test"))
    return d


def interval_overlap(a_lo, a_hi, b_lo, b_hi):
    return max(0.0, min(a_hi, b_hi) - max(a_lo, b_lo))
