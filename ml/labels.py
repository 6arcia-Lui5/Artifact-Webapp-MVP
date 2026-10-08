"""Shared label rules and data split, used by every model."""
import numpy as np
import pandas as pd

SEED = 42
MAX_SPAN = 300          # only train dates on ranges of 300 years or less
MIN_REGION_COUNT = 60   # smaller regions are grouped as "Other"

# Places are first read as Roman provinces, as EDH records them. Modern
# names (from USEP or typed by users) are mapped onto provinces here.
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


# Provinces are grouped into larger areas. Neighbouring provinces share
# the same formulas, so the text can't tell Baetica from Lusitania, but
# it can often tell Hispania from the Danube or North Africa. A mismatch
# at this level is also the kind worth flagging.
AREAS = {
    "Italia": ["Italia", "Roma", "Tuscia et Umbria", "Sardinia", "Corsica"],
    "Sicilia": ["Sicilia"],
    "Hispania": ["Hispania citerior", "Baetica", "Lusitania"],
    "Gallia": ["Narbonensis", "Gallia Narbonensis", "Lugdunensis", "Lugudunensis",
               "Aquitania", "Aquitanica", "Aquitani(c)a", "Belgica",
               "Alpes Maritimae", "Alpes Cottiae", "Alpes Graiae", "Alpes Poeninae"],
    "Germania and Raetia": ["Germania inferior", "Germania superior", "Raetia"],
    "Britannia": ["Britannia"],
    "Danube and Balkans": ["Noricum", "Pannonia superior", "Pannonia inferior", "Dalmatia",
                           "Moesia superior", "Moesia inferior", "Dacia", "Thracia"],
    "Africa": ["Africa Proconsularis", "Numidia", "Mauretania Caesariensis",
               "Mauretania Tingitana", "Cyrenaica", "Cyrene", "Creta et Cyrenaica"],
    "Greece": ["Achaia", "Macedonia", "Epirus", "Creta"],
    "Asia Minor and Cyprus": ["Asia", "Bithynia et Pontus", "Pontus et Bithynia", "Galatia", "Lycia et Pamphylia",
                              "Cilicia", "Cappadocia", "Pontus", "Cyprus"],
    "Aegyptus": ["Aegyptus"],
    "Levant": ["Syria", "Judaea", "Iudaea", "Syria Palaestina", "Palaestina", "Arabia", "Mesopotamia",
               # IIP's regions of Israel/Palestine
               "Negev", "Coastal Plain", "Galilee", "Samaria", "Golan", "Sinai",
               "Jordan Valley", "Jordan"],
}
_AREA_OF = {p.lower(): a for a, ps in AREAS.items() for p in ps}
_AREA_OF.update({a.lower(): a for a in AREAS})


def to_area(name):
    """Province, IIP region or area name -> area (None if unknown)."""
    if not isinstance(name, str) or not name.strip():
        return None
    n = name.strip().rstrip("?").strip().lower()
    if n in _AREA_OF:
        return _AREA_OF[n]
    for key, area in _AREA_OF.items():   # e.g. "Alpes Maritimae ..." variants
        if n.startswith(key):
            return area
    return None


def edh_region(province):
    """EDH province -> label. Italy's regiones and Rome become 'Italia'."""
    if not isinstance(province, str) or not province or province.startswith("unbekannt"):
        return None   # "unbekannt" = unknown
    if province == "Roma" or "Regio" in province:   # EDH "(Regio I)", EDCS "/ Regio I"
        return "Italia"
    if province.startswith("Sicilia"):
        return "Sicilia"
    return province


def region_of(row):
    if row["corpus"] == "isicily":
        return "Sicilia"
    if row["corpus"] in ("edh", "lire"):
        p = edh_region(row["region"])
        return to_area(p) or ("Other" if p else None)
    if row["corpus"] == "iip":
        return to_area(row["region"])
    place = str(row["place"]).lower() if isinstance(row["place"], str) else ""
    head = place.split(",")[0].strip()
    return to_area(USEP_REGION.get(head))


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
