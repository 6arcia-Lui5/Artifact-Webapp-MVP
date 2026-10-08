"""
Build a training dataset from public EpiDoc corpora.

Sources (all public on GitHub):
  - I.Sicily      https://github.com/ISicily/ISicily
  - IIP           https://github.com/Brown-University-Library/iip-texts
  - US Epigraphy  https://github.com/Brown-University-Library/usep-data
  - EDH (optional) https://zenodo.org/records/3575155  (unzip all parts into data/EDH)
  - LIRE (optional) https://zenodo.org/records/8431452  (put the .parquet in data/LIRE)
    Only LIRE's EDCS-only records are used, since its EDH records are
    already covered above. Needs: pip install pyarrow

Each inscription becomes one row with:
  id, corpus, language, text, not_before, not_after, region, place,
  material, object_type

Usage:
  python build_dataset.py --data-dir ../data --out data/inscriptions.csv
"""
import argparse
import csv
import re
import unicodedata
from pathlib import Path

from lxml import etree

TEI = "http://www.tei-c.org/ns/1.0"
XML_LANG = "{http://www.w3.org/XML/1998/namespace}lang"
NS = {"t": TEI}

# Tags whose content is NOT on the stone (editor's additions).
DROP_TAGS = {"ex", "note", "supplied", "del", "corr", "reg", "orig_alt", "head"}
# Tags that stand for lost or unreadable text.
GAP_TAGS = {"gap"}
LINE_TAGS = {"lb"}

# Normalize language codes across corpora.
LANG_MAP = {
    "la": "lat", "lat": "lat", "la-Latn": "lat",
    "grc": "grc", "el": "grc", "gr": "grc", "grc-Latn": "grc",
    "heb": "heb", "he": "heb", "arc": "arc", "syc": "arc", "x-unknown": "und",
}


def local(tag):
    return tag.split("}")[-1] if isinstance(tag, str) else ""


def stone_text(elem):
    """Return the text as written on the object.

    Editorial expansions and restorations are removed, gaps become '#'
    and line breaks become spaces.
    """
    out = []

    def walk(e):
        name = local(e.tag)
        if name in DROP_TAGS:
            pass
        elif name in GAP_TAGS:
            out.append(" # ")
        elif name in LINE_TAGS:
            out.append(" ")
        elif name == "choice":
            # keep the original reading, not the editor's correction
            sic = e.find("t:sic", NS)
            orig = e.find("t:orig", NS)
            keep = sic if sic is not None else orig
            if keep is not None:
                walk_inner(keep)
        else:
            walk_inner(e)
        if e.tail:
            out.append(e.tail)

    def walk_inner(e):
        if e.text:
            out.append(e.text)
        for child in e:
            if isinstance(child.tag, str):
                walk(child)
            elif child.tail:
                out.append(child.tail)

    walk_inner(elem)
    return normalize("".join(out))


def normalize(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")  # drop accents
    s = s.lower()
    s = re.sub(r"\([^)]*\)", " ", s)          # editor remarks like (magic characters)
    s = re.sub(r"[\[\]{}<>⟦⟧〚〛|/\\]", " ", s)  # stray Leiden brackets
    s = re.sub(r"[.,;:·⁝⁞'\"]", " ", s)       # punctuation and word dividers
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"(# ?)+", "# ", s).strip()
    return s


def year(v):
    if not v:
        return None
    m = re.match(r"^(-?)0*(\d{1,4})", v.strip())
    if not m:
        return None
    y = int(m.group(2))
    return -y if m.group(1) else y


def first_text(root, xpath):
    r = root.xpath(xpath, namespaces=NS)
    for x in r:
        t = x if isinstance(x, str) else "".join(x.itertext())
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            return t
    return ""


def pick_edition(root):
    eds = root.xpath("//t:div[@type='edition']", namespaces=NS)
    if not eds:
        return None
    # prefer the main edition (not lemmatized / diplomatic duplicates)
    for pref in ("transcription", "primary", None):
        for e in eds:
            sub = e.get("subtype")
            if (pref is None and sub not in ("simple-lemmatized", "diplomatic")) or sub == pref:
                return e
    return eds[0]


def parse_file(path, corpus):
    try:
        root = etree.parse(str(path)).getroot()
    except etree.XMLSyntaxError:
        return None
    ed = pick_edition(root)
    if ed is None:
        return None
    text = stone_text(ed)
    letters = re.sub(r"[#\s]", "", text)
    if len(letters) < 5:
        return None

    lang = ed.get(XML_LANG) or first_text(root, "//t:textLang/@mainLang")
    lang = LANG_MAP.get(lang, LANG_MAP.get(lang.split("-")[0], lang or "und"))

    if corpus == "isicily":
        d = root.xpath("//t:origDate", namespaces=NS)
        nb = na = None
        if d:
            nb = year(d[0].get("notBefore") or d[0].get("notBefore-custom"))
            na = year(d[0].get("notAfter") or d[0].get("notAfter-custom"))
        region = "Sicily"
        place = first_text(root, "//t:origPlace//t:placeName[@type='ancient']") or \
            first_text(root, "//t:origPlace//t:placeName")
    elif corpus == "iip":
        d = root.xpath("//t:origin/t:date", namespaces=NS)
        nb = year(d[0].get("notBefore")) if d else None
        na = year(d[0].get("notAfter")) if d else None
        region = first_text(root, "//t:origin//t:region")
        place = first_text(root, "//t:origin//t:settlement")
    elif corpus == "edh":
        d = root.xpath("//t:origDate", namespaces=NS)
        nb = na = None
        if d:
            nb = year(d[0].get("notBefore") or d[0].get("notBefore-custom"))
            na = year(d[0].get("notAfter") or d[0].get("notAfter-custom"))
        region = first_text(root, "//t:origPlace/t:placeName[@type='provinceItalicRegion']").rstrip("?").strip()
        place = first_text(root, "//t:origPlace/t:placeName[not(@type)]")
    else:  # usep
        d = root.xpath("//t:origin/t:date", namespaces=NS)
        nb = year(d[0].get("notBefore")) if d else None
        na = year(d[0].get("notAfter")) if d else None
        place = first_text(root, "//t:origin/t:placeName")
        place = place.rstrip("?").strip()
        region = ""
    if nb is not None and na is None:
        na = nb
    if na is not None and nb is None:
        nb = na
    if nb is not None and na is not None and nb > na:
        nb, na = na, nb

    return {
        "id": f"{corpus}:{path.stem}",
        "corpus": corpus,
        "language": lang,
        "text": text,
        "not_before": nb,
        "not_after": na,
        "region": region,
        "place": place,
        "material": first_text(root, "//t:support//t:material | //t:supportDesc/@ana"),
        "object_type": first_text(root, "//t:support//t:objectType"),
    }


def leiden_to_stone(text):
    """EDCS text in Leiden style -> text as on the stone (same rules as EpiDoc)."""
    if not isinstance(text, str):
        return ""
    t = re.sub(r"\([^)]*\)", "", text)            # (expansions)
    t = re.sub(r"\[\[([^\]]*)\]\]", r"\1", t)     # [[erased but legible]]
    t = re.sub(r"\[[^\]]*\]", " # ", t)            # [restored] -> gap
    t = t.replace("/", " ")
    return normalize(t)


def load_lire(folder, max_per_area, seed=42):
    """EDCS-only records from the LIRE dataset (Parquet)."""
    import pandas as pd
    from labels import edh_region, to_area
    files = sorted(folder.glob("*.parquet"))
    if not files:
        print(f"lire: no .parquet file in {folder}, skipped")
        return []
    cols = ["EDCS-ID", "EDH-ID", "inscription", "province", "place",
            "not_before", "not_after", "language_EDCS", "material_clean",
            "type_of_monument_clean"]
    d = pd.read_parquet(files[-1], columns=cols)
    d = d[d["EDH-ID"].isna() & d["inscription"].notna()].copy()
    d["text"] = d["inscription"].map(leiden_to_stone)
    d = d[d["text"].str.replace(r"[#\s]", "", regex=True).str.len() >= 5]
    d["area"] = d["province"].map(edh_region).map(to_area)
    # Rome alone is about half of EDCS; cap each area so it doesn't swamp the rest
    d = (d.sample(frac=1, random_state=seed)
          .groupby(d["area"].fillna("?"), group_keys=False)
          .head(max_per_area))
    rows = []
    for _, r in d.iterrows():
        nb = None if pd.isna(r["not_before"]) else int(r["not_before"])
        na = None if pd.isna(r["not_after"]) else int(r["not_after"])
        lang = r["language_EDCS"] if isinstance(r["language_EDCS"], str) else ""
        rows.append({
            "id": f"lire:{r['EDCS-ID']}", "corpus": "lire",
            "language": "grc" if "greek" in lang.lower() or re.search("[\u0370-\u03ff]", r["text"]) else "lat",
            "text": r["text"], "not_before": nb, "not_after": na,
            "region": r["province"] if isinstance(r["province"], str) else "",
            "place": r["place"] if isinstance(r["place"], str) else "",
            "material": r["material_clean"] if isinstance(r["material_clean"], str) else "",
            "object_type": r["type_of_monument_clean"] if isinstance(r["type_of_monument_clean"], str) else "",
        })
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="../data")
    ap.add_argument("--out", default="data/inscriptions.csv")
    ap.add_argument("--lire-max-per-area", type=int, default=15000,
                    help="cap on LIRE records per area (Rome is about half of EDCS)")
    a = ap.parse_args()
    base = Path(a.data_dir)
    sources = [
        ("isicily", base / "ISicily" / "inscriptions"),
        ("iip", base / "iip-texts" / "epidoc-files"),
        ("usep", base / "usep-data" / "xml_inscriptions"),
        ("edh", base / "EDH"),   # skipped if the folder is missing
    ]
    rows = []
    for corpus, folder in sources:
        if not folder.exists():
            print(f"{corpus}: folder not found, skipped ({folder})")
            continue
        n = 0
        for p in sorted(folder.rglob("*.xml")):
            if p.name.lower().startswith(("aatest", "template")):
                continue
            r = parse_file(p, corpus)
            if r:
                rows.append(r)
                n += 1
        print(f"{corpus}: {n} inscriptions")
    lire_dir = base / "LIRE"
    if lire_dir.exists():
        lire = load_lire(lire_dir, a.lire_max_per_area)
        rows += lire
        print(f"lire (EDCS-only): {len(lire)} inscriptions")
    else:
        print(f"lire: folder not found, skipped ({lire_dir})")
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {len(rows)} rows to {a.out}")


if __name__ == "__main__":
    main()
