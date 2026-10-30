# ML input reliability evaluation, October 29, 2026

Two local fixes preserve readable erased letters and refuse inputs shorter than the training corpus admitted. Checkpoints, inference padding, model architecture and historical reports are unchanged. These results measure input handling on a reconstructed public subset, not improved general model accuracy or validated client performance.

## Findings and fixes

The service previously turned `DIS [[MANIBVS]] SACRVM` into `dis # sacrvm`, discarding letters that readable-erasure notation identifies as visible. It now shares `build_dataset.leiden_to_stone` with the corpus pipeline, retaining those letters while still removing editorial expansions and restorations.

Empty, gap-only and very short inputs previously produced predictions despite being outside corpus inclusion rules. For example, an empty input returned a narrow 500–475 BCE interval, and `D M` returned Gallia with 67.9% model probability. Inputs now require at least five characters after normalization and removal of gaps/whitespace, matching the corpus rule. This is an eligibility check, not a confidence or accuracy guarantee. FastAPI validates single and batch inputs before inference; Express returns actionable input guidance rather than a service-outage message.

## Data and comparison protocol

The source is the first archive of the [EDH EpiDoc v1 deposit](https://zenodo.org/records/3575155), published December 13, 2019 by the EDH/Heidelberg Academy team and reusable under CC BY-SA 4.0. The 22,568,610-byte file has official MD5 `7590f5ea8eae459cd6dda02b83a2f9fd`. Downloaded source text and derived records remain in ignored `.local/ml-accuracy`, with source, parser, label and checkpoint fingerprints.

The existing parser produced 9,753 records. The original full-text pandas hash rule assigned 7,775 to train, 955 to validation and 1,023 to test. Area labels were preserved directly rather than reclassifying rare areas based on this partial dataset. Exact normalized text and encoded neural-input keys had no overlap between these reconstructed splits within this subset. Historical training membership cannot be conclusively verified because the checkpoint has no training-source or text manifest.

First, 100 validation records checked the candidate without tuning weights, thresholds or perturbations. The separate test comparison then used all 1,023 unique test records, with region labels on all records and eligible date intervals on 733. The test contains 1,010 Latin and 13 mixed Latin/Greek records, no Greek-only records, and is dominated by Italia (538 records). It is one EDH ID range, not a representative sample of all training sources or client artifacts.

The reference is `ml/predictor.py` from commit `a5e8f389aed82ef1a251b5fd0eaf126ee776dc5a`. Both paths use the same shipped checkpoints. For the notation test, the first alphabetic word of at least three letters, when present, receives `[[readable erasure]]` markup without changing its visible letters. The transform changed 1,022 of 1,023 test records; one had no eligible word and stayed unchanged. This synthetic paired representation test isolates normalization behavior. It is not an OCR test or a measure of how frequently this notation occurs in client data.

## Results

| Test input | Reference region top-one | Updated region top-one | Reference mean date error | Updated mean date error |
| --- | ---: | ---: | ---: | ---: |
| Canonical text | 59.82% | 59.82% | 59.12 years | 59.12 years |
| Same text with readable-erasure notation | 53.86% | 59.82% | 66.99 years | 59.12 years |

All four conditions scored the same 1,023 region-labelled and 733 date-eligible records; no inputs were rejected. Mean date error is absolute distance from the catalog interval midpoint, not an independently known exact year. Top-three region accuracy on the notation test rose from 78.20% to 82.31%.

Updated notation predictions exactly match the reference canonical predictions on all 1,023 records. Canonical predictions themselves are unchanged on all 1,023 records. The fix restores information the input parser previously lost; it does not improve the unchanged model's prediction on ordinary text. Do not compare this subset's 59.82% with the historical full evaluation's 57.43% as an improvement: the populations differ.

A separate missing-letter stress replaced every twentieth alphabetic character with `#`. Updated-model region accuracy fell from 59.82% to 55.23%; date error increased from 59.12 to 60.23 years, with zero rejections. This measures sensitivity to a controlled text perturbation, not actual OCR errors or an old-versus-new improvement. Timing was collected in fixed execution order without warm-up and while other checks ran; it does not establish a speed improvement or hosting capacity.

## Remaining bottlenecks

- Client-domain evidence is missing. The historical model's Greece recall is 26.5%, and this Latin-heavy subset cannot validate Greek artifact performance.
- The date model is bounded to 800 BCE–1000 CE. Some demonstration museum photographs are medieval objects around 1300; their independent mock text examples cannot validate dating those objects.
- Training region targets concern provenance/findspot. The current app prefers production place when requesting a region check. Manufacturing origin is a different claim and needs an aligned target or an explicitly revised comparison workflow.
- Training uses trimmed batches while service inference uses 256 padded positions. An audit found probability and date changes under trimming, but no accuracy benefit was established; that path was deliberately left unchanged. A padding-invariant architecture needs retraining and comparable evaluation.
- Reversed date ranges can pass the existing training eligibility rule and create invalid training targets. This is a code risk, not evidence that the missing original training data contained such rows.

For the MVP, keep predictions as review hints and prioritize client-verified input/labels, suitable domain coverage and hosted availability before choosing a model replacement. A prospective client evaluation should separate visible-letter transcription, findspot/provenance and production origin, exclude known training duplicates, and report per-language/per-period results and abstentions.

## Reproduce locally

From the repository root with the ML environment active:

```powershell
python ml/prepare_edh_evaluation.py
python -c "from pathlib import Path; import subprocess; Path('.local/ml-accuracy/predictor_before.py').write_bytes(subprocess.check_output(['git','show','a5e8f389aed82ef1a251b5fd0eaf126ee776dc5a:ml/predictor.py']))"
python ml/evaluate_input_robustness.py --data .local/ml-accuracy/edh-subset-labelled.csv --reference-source .local/ml-accuracy/predictor_before.py --split val --limit 100 --out .local/ml-accuracy/validation-rerun.json
python ml/evaluate_input_robustness.py --data .local/ml-accuracy/edh-subset-labelled.csv --reference-source .local/ml-accuracy/predictor_before.py --split test --out .local/ml-accuracy/test-rerun.json
python -m unittest discover -s ml/tests -v
```

The evaluator refuses to overwrite an existing result or its input files. Model files, private data and historical reports are never rewritten by these commands. Nine ML input/real-HTTP tests and all 41 backend tests passed; selected demo compatibility tests are not accuracy benchmarks.
