"""Reconstruct a bounded, pinned EDH subset without extracting the archive."""
import collections
import hashlib
import json
import argparse
from pathlib import Path
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ap = argparse.ArgumentParser(description=__doc__)
ap.add_argument('--output-dir', type=Path, default=ROOT / '.local/ml-accuracy')
OUT = ap.parse_args().output_dir.resolve()
sys.path.insert(0, str(ROOT / 'ml'))
import pandas as pd
from build_dataset import parse_file
from labels import region_of, MAX_SPAN
from predictor import clean

URL = 'https://zenodo.org/records/3575155/files/edhEpidocDump_HD000001-HD010000.zip?download=1'
MD5 = '7590f5ea8eae459cd6dda02b83a2f9fd'
CAP = 60 * 1024 * 1024
archive = OUT / 'edhEpidocDump_HD000001-HD010000.zip'
OUT.mkdir(parents=True, exist_ok=True)
if not archive.exists():
    request = urllib.request.Request(URL, headers={'User-Agent': 'Artifact-Webapp-MVP local evaluation'})
    with urllib.request.urlopen(request, timeout=45) as response, archive.open('wb') as target:
        if int(response.headers.get('Content-Length', '0')) > CAP:
            raise RuntimeError('Advertised archive exceeds bounded download cap')
        total = 0
        while block := response.read(1024 * 1024):
            total += len(block)
            if total > CAP:
                raise RuntimeError('Archive exceeds bounded download cap')
            target.write(block)
payload = archive.read_bytes()
if len(payload) > CAP or hashlib.md5(payload).hexdigest() != MD5:
    raise RuntimeError('Pinned official archive checksum or size mismatch')

rows = []
scratch = OUT / 'scratch-edh.xml'
counts = collections.Counter()
with zipfile.ZipFile(archive) as z:
    for entry in sorted(z.infolist(), key=lambda item: item.filename):
        if not entry.filename.lower().endswith('.xml'):
            continue
        counts['xml_entries'] += 1
        if entry.file_size > 4 * 1024 * 1024:
            raise RuntimeError('Unexpectedly large individual XML file')
        scratch.write_bytes(z.read(entry))
        record = parse_file(scratch, 'edh')
        if record is None:
            counts['skipped_by_existing_parser'] += 1
            continue
        record['id'] = 'edh:' + Path(entry.filename).stem
        rows.append(record)

d = pd.DataFrame(rows)
csv_path = OUT / 'edh-subset.csv'
d.to_csv(csv_path, index=False)
d['region_label'] = d.apply(region_of, axis=1)
d['span'] = d.not_after - d.not_before
d['mid_year'] = (d.not_after + d.not_before) / 2
d['date_ok'] = d.mid_year.notna() & (d.span <= MAX_SPAN) & d.mid_year.between(-800, 1000)
key = d.text.str.replace(r'[#\s]', '', regex=True)
h = pd.util.hash_pandas_object(key, index=False).values % 1000 / 1000
d['split'] = ['train' if value < 0.8 else 'val' if value < 0.9 else 'test' for value in h]
d['split_key_sha256'] = key.map(lambda text: hashlib.sha256(text.encode('utf8')).hexdigest())
prefix = d.text.map(lambda text: clean(text)[:256])
d['prefix_sha256'] = prefix.map(lambda text: hashlib.sha256(text.encode('utf8')).hexdigest())

def overlap(column):
    sets = {name: set(d.loc[d.split == name, column]) for name in ['train', 'val', 'test']}
    output = {}
    for a, b in [('train', 'val'), ('train', 'test'), ('val', 'test')]:
        shared = sets[a] & sets[b]
        output[a + '_' + b] = {'unique_shared_keys': len(shared), a + '_rows': int(((d.split == a) & d[column].isin(shared)).sum()), b + '_rows': int(((d.split == b) & d[column].isin(shared)).sum())}
    return output

split_counts = {}
for name in ['train', 'val', 'test']:
    part = d[d.split == name]
    split_counts[name] = {'rows': len(part), 'unique_full_split_keys': part.split_key_sha256.nunique(), 'unique_clean_texts': part.text.map(clean).nunique(), 'unique_256_prefixes': part.prefix_sha256.nunique(), 'region_labelled': int(part.region_label.notna().sum()), 'date_ok': int(part.date_ok.sum()), 'regions': part.region_label.fillna('Unlabelled').value_counts().to_dict(), 'languages': part.language.fillna('und').value_counts().to_dict()}

d.to_csv(OUT / 'edh-subset-labelled.csv', index=False)
manifest = {
    'kind': 'Reconstructed pinned EDH subset, not full historical held-out reproduction or client-domain validation',
    'source': {'url': URL, 'record': 'https://zenodo.org/records/3575155', 'version': 'v1, 2019-12-13', 'license': 'CC BY-SA 4.0, as stated in deposit description', 'official_md5': MD5, 'sha256': hashlib.sha256(payload).hexdigest(), 'bytes': len(payload)},
    'parser': 'Existing ml/build_dataset.py parse_file, one scratch XML file overwritten; IDs restored from archive filenames',
    'parser_sha256': hashlib.sha256((ROOT / 'ml/build_dataset.py').read_bytes()).hexdigest(),
    'labels_sha256': hashlib.sha256((ROOT / 'ml/labels.py').read_bytes()).hexdigest(),
    'csv_sha256': hashlib.sha256(csv_path.read_bytes()).hexdigest(),
    'counts': {**dict(counts), 'parsed_rows': len(d)},
    'pandas_version': pd.__version__,
    'label_rule': 'region_of(row) retained directly; NO MIN_REGION_COUNT regrouping on this partial sample',
    'split_rule': 'Original pandas full-text hash after removal of # and whitespace; 80/10/10 thresholds',
    'splits': split_counts,
    'full_text_split_key_overlap': overlap('split_key_sha256'),
    'clean_256_prefix_overlap': overlap('prefix_sha256'),
    'limitations': ['Checkpoint lacks source revision/train fingerprint; historical membership cannot be conclusively reconstructed.', 'This is one archive ID range, not a representative sample of all sources or client artifacts.', 'Exact hash grouping does not resolve near duplicates or all shared 256-character neural inputs.'],
}
(OUT / 'edh-subset-manifest.json').write_text(json.dumps(manifest, indent=2), encoding='utf8')
print(json.dumps({'csv': str(csv_path), 'labelled_csv': str(OUT / 'edh-subset-labelled.csv'), 'manifest': str(OUT / 'edh-subset-manifest.json'), 'counts': manifest['counts'], 'splits': {k: {x:v for x,v in values.items() if x not in ['regions','languages']} for k,values in split_counts.items()}, 'prefix_overlap': manifest['clean_256_prefix_overlap']}, indent=2))
