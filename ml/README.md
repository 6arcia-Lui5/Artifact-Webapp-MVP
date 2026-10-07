# Handheld Words: ML models

Two models read an inscription's text and predict **when** and **where** it was
made. The prediction is compared with the date and region a database lists for
the record. When they disagree, the record is flagged for review.

This supports the project goal of finding inconsistencies across epigraphic
databases: a flag means "the text and the metadata don't agree, a scholar
should look."

## What is in this folder

| File | Purpose |
|---|---|
| `build_dataset.py` | Parses EpiDoc XML into `data/inscriptions.csv` |
| `labels.py` | Shared label rules and the fixed 80/10/10 split |
| `train_baseline.py` | Baseline: TF-IDF character n-grams + linear models |
| `train_deep.py` | Deep model: character CNN + BiGRU, trained on date and region together |
| `evaluate_flags.py` | Tests the flags on clean records and planted errors |
| `predictor.py` | Loads models, makes predictions, decides flags |
| `service.py` | FastAPI service (`/predict`, `/check`, `/check/batch`, demo page) |
| `demo/index.html` | Demo page served at `/` |
| `reports/*.json` | Test-set metrics |

## Data

Public EpiDoc corpora on GitHub (about 10,500 inscriptions):

- I.Sicily (https://github.com/ISicily/ISicily): Sicily, Latin and Greek
- Inscriptions of Israel/Palestine (https://github.com/Brown-University-Library/iip-texts): Greek, Hebrew, Aramaic, Latin
- U.S. Epigraphy (https://github.com/Brown-University-Library/usep-data): Latin and Greek objects in U.S. collections, mostly from Italy, Greece and Egypt

The text used is what is on the object: editor expansions and restorations are
removed, and lost text becomes `#`. This matches what a new record will look like.

Labels:
- **Date**: the listed not-before / not-after range. Only ranges of 300 years or
  less, between 800 BCE and 1000 CE, are used for training.
- **Region**: Sicily, regions of Israel/Palestine (Judaea, Negev, Galilee, ...),
  and broad regions for U.S. Epigraphy objects (Italy, Greece, Egypt, ...).

## How it works

- **Baseline.** Character 1–4-grams with TF-IDF. Logistic regression for region,
  ridge regression for the midpoint year.
- **Deep model.** Characters go through an embedding, three convolutions
  (widths 3, 5, 7) and a bidirectional GRU. Two heads: one picks the region, one
  gives a probability for each 25-year period from 800 BCE to 1000 CE. Characters
  are used instead of words because inscriptions are full of abbreviations and
  broken words (the same choice as DeepMind's Ithaca and Aeneas). During training,
  5% of characters are randomly hidden to mimic damage.
- **Date interval.** The deep model's interval is the central part of its date
  distribution. Its width is tuned on validation data so that about 80% of true
  ranges overlap it.

### Flag rules

- **Date flag**: the listed range misses the predicted interval by more than 50
  years. (Smaller misses are normal and not flagged.)
- **Region flag**: the model gives the listed region under 3% probability and it
  is not among the model's top three regions.
- **Region prediction**: the service averages the deep model and the baseline
  50/50 for region, because the two make different mistakes. The deep model alone
  is used for date.

## Results

Held-out test set (10% of records, never used in training). Exact numbers are in
`reports/comparison.json` and `reports/flagging_metrics*.json`.

| | Simple guess | Baseline | Deep model |
|---|---|---|---|
| Region correct | 38% (always "Sicily") | 65% | **67%** |
| Region in top 3 | | 89% | **90%** |
| Date error, median | | 86 years | **49 years** |
| Date error, mean | 243 years (always the average) | 126 years | **104 years** |
| Date within 50 years | | 34% | **51%** |
| 80% date interval, median width | | 427 years | **125 years** |

Flags, tested by planting errors into held-out records:

| | Baseline | Deep model |
|---|---|---|
| Dates moved 300 years that get flagged | 27% | **72%** |
| Wrong regions that get flagged | 71% | **78%** |
| Correct records wrongly flagged (date) | 9% | 12% |
| Correct records wrongly flagged (region) | 4% | 5% |

The deep model's date intervals are about three times narrower at the same
coverage, which is why it catches far more date errors.

## Run it

```bash
pip install -r requirements.txt

# 1. get the data (about 300 MB)
mkdir -p ../data && cd ../data
git clone --depth 1 https://github.com/ISicily/ISicily
git clone --depth 1 https://github.com/Brown-University-Library/iip-texts
git clone --depth 1 https://github.com/Brown-University-Library/usep-data
cd ../ml

# 2. build data and train (about 10 minutes on a laptop CPU)
python build_dataset.py --data-dir ../data
python train_baseline.py
python train_deep.py
python evaluate_flags.py deep
python evaluate_flags.py baseline

# 3. start the service and open http://localhost:8001
uvicorn service:app --port 8001
```

Trained model files are in `models/` so step 2 can be skipped for the demo.

## Connecting to the web app

The Express backend has a new route file, `backend/src/routes/mlRoutes.ts`:

- `POST /api/ml/check` forwards `{ text, not_before, not_after, region }` to the ML service.
- `GET /api/ml/records/:id/check` loads a stored record, joins its inscription
  text, reads a year range out of "Date/ Culture/ Time Period" (for example
  "2nd-3rd century CE"), and returns the prediction and any flags.

Set `ML_SERVICE_URL` in `backend/.env` if the service is not on `http://localhost:8001`.

## Limits

- The place model only knows the regions in the training data. Records from
  other places (for example Gaul or Britain) get a note instead of a flag.
- Region is partly tied to language and corpus (Hebrew text is almost always
  from Israel/Palestine). Within a corpus, for example between cities in Sicily
  or regions of Israel/Palestine, it is a harder and more honest test.
- Flags are hints. A flag can also mean the text is too short to judge.
- Next steps: add EDH (81,000 Latin inscriptions from the SDAM dataset) for wider
  coverage, compare with Aeneas, and add object type and material as extra inputs.
