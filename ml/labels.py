"""Shared label rules and data split, used by every model."""
import numpy as np
import pandas as pd

SEED = 42
MAX_SPAN = 300          # only train dates on ranges of 300 years or less
MIN_REGION_COUNT = 60   # smaller regions are grouped as "Other"

# Regions use Roman province names, as EDH does. Modern names (from USEP
# or typed by users) are mapped onto them. The regions of Israel/Palestine
# from IIP (Judaea, Galilee, Negev, ...) are kept as they are.
USEP_REGION = {
    "italy": "Italia", "rome": "Italia", "roma": "Italia",
    "sicily": "Sicilia", "sicilia": "Sicilia",
    "egypt": "Aegyptus",
    "greece": "Achaia", "attica": "Achaia",
    "turkey": "Asia", "asia minor": "Asia",
    "cyprus": "Cyprus",
    "tunisia": "Africa Proconsularis", "libya": "Africa Proconsularis",
    "algeria": "Numidia",
    "syria": "Syria", "lebanon": "Syria",
    "israel": "Judaea", "palestine": "Judaea",
    "spain": "Hispania citerior", "portugal": "Lusitania",
    "france": "Narbonensis", "britain": "Britannia", "england": "Britannia",
}


def edh_region(province):
    """EDH province -> label. Italy's regiones and Rome become 'Italia'."""
    if not isinstance(province, str) or not province:
        return None
    if province == "Roma" or "(Regio" in province:
        return "Italia"
    if province.startswith("Sicilia"):
        return "Sicilia"
    return province


def region_of(row):
    if row["corpus"] == "isicily":
        return "Sicilia"
    if row["corpus"] == "edh":
        return edh_region(row["region"])
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

    # fixed 80/10/10 split, decided by a hash of the text, so the same
    # inscription found in two corpora (e.g. EDH and I.Sicily) always lands
    # in the same split and can't leak from training into the test set
    key = d["text"].str.replace(r"[#\s]", "", regex=True)
    h = pd.util.hash_pandas_object(key, index=False).values % 1000 / 1000
    d["split"] = np.where(h < 0.8, "train", np.where(h < 0.9, "val", "test"))
    return d


def interval_overlap(a_lo, a_hi, b_lo, b_hi):
    return max(0.0, min(a_hi, b_hi) - max(a_lo, b_lo))
