# Low-cost inscription assistance: research and implementation plan

Research checked October 29, 2026. The recommendation is a measured combination of source lookup, specialist attribution, cited parallels and selective review. Photo transcription and date/geography attribution are different tasks. The current 59.8% region result is not an OCR accuracy score.

No application model was replaced, production database written, paid account created or deployment performed for this investigation. The previous local input fixes remain separate from these experiments.

## What was collected and tested

The local research catalog at `.local/research-plan/artifact-evaluation.sqlite` contains 13 source-backed artifacts, 13 image assets (12 primary views and one alternate), and two model probes. Its companion `artifact-inventory.md` records the trusted and missing labels. Source metadata comes from the Met, Cleveland and a cited Kenyon collection page. Downloaded images are public-domain/Open Access or CC0; the Kenyon image remains link-only because its reuse license was not established. The catalog is separate from the application/shared PostgreSQL.

The photographs include Latin plaques, Greek curved markers, rings, monograms, fragmentary reliefs and medieval Byzantine objects. One bronze-stamp photo shows the back/handle with no inscription visible. Another Greek marker includes a modern painted inventory number. These are useful negative/distractor cases. Museum translations and summaries must not become literal OCR ground truth. Only one collected record supplies published original-script text; independent photograph-level references still need review. [Met API](https://metmuseum.github.io/), [Cleveland Open Access](https://www.clevelandart.org/open-access), [Kenyon ring](https://digital.kenyon.edu/arthistorystudycollection/677/)

For known museum objects, importing cited catalog facts is cheaper and more defensible than predicting them. Preserve source date ranges and qualifiers, and distinguish ancient findspot, manufacturing origin and modern collection location. Met's documentation now uses paginated `/v1.1/search`; its older search endpoint retired October 1, while the object endpoint used by the existing app still works.

## Cheap retrieval layer: measured improvement

An exploratory index contains 7,743 unique region-labelled training texts from the reconstructed fixed EDH subset. It uses the existing character TF-IDF vectorizer, cosine similarity and similarity-weighted neighbor votes. Only training records enter the index. Neighbor count and blend weight were selected on 948 deduplicated labelled validation records, then frozen for the 1,023-record test. The selected combination uses ten neighbors and an equal blend with the current model.

| Region prediction on the same test records | Correct first choice | Correct region in top three |
| --- | ---: | ---: |
| Current model | 612/1,023, 59.82% | 82.31% |
| Retrieval alone | 630/1,023, 61.58% | 82.60% |
| Model plus retrieval | 682/1,023, 66.67% | 88.76% |

This is 70 additional correct first-choice regions, with unchanged model weights. The sparse index occupies 13,809,340 bytes, about 13.2 MiB; that is index memory, not total process RAM. The experiment improves region classification only, not dating or OCR.

A gate selected on validation to achieve at least 90% accepted-case accuracy produced 404 correct predictions among 443 accepted test records: 91.20% accuracy at 43.30% coverage. There were still 39 wrong accepted suggestions and 580 records outside the gate. The corresponding current-model gate accepted 301 records, with 275 correct. This demonstrates a review-prioritization tradeoff, not safe automatic acceptance of 91% of the collection.

The subset is Latin-heavy and dominated by Italia. Original checkpoint training membership cannot be conclusively reconstructed, and formulaic/near-duplicate texts can exaggerate generalization. Exact cleaned-text train/query overlap was zero; three test queries had nearest similarity at least 0.95, none at least 0.99. Agreement between retrieval and a model trained on related texts is not independent historical corroboration. Results and scripts are in `.local/research-plan/retrieval-probe-results.json` and `retrieval-probe.py`; the cache now fingerprints input data, predictor source, checkpoints and class order. An independent agent rebuilt the votes and checked selection logic.

## Specialist model replacement: CPU feasibility established

[Aeneas and the updated Ithaca models](https://github.com/google-deepmind/predictingthepast) are the strongest specialist attribution candidates found. The released Latin and Greek models predict dates and geography, with optional textual parallels and restoration. Their inference code also accepts an image alongside a transcription for geographical attribution; that image branch is not OCR. The published research's province accuracy and distance-to-date-range metric are not directly comparable with our broad-area accuracy and midpoint date error.

The Latin checkpoint is 145.7 MB; the Greek checkpoint is 142.5 MB. Attribution alone does not require the larger retrieval corpus. Both updated date heads span 800 BCE to 800 CE, and the attribution helper accepts 25–767 cleaned characters. Very short ring inscriptions and medieval objects therefore remain outside this route's useful coverage. Software is Apache 2.0; checkpoint/data terms include CC-BY and EDH-derived CC-BY-SA obligations and must be retained when packaging.

An isolated Windows CPU experiment used pinned upstream commit `f2d17de7f54f29caaa3845bbd113dd4c5821f7bf`, a separate environment and three public Latin texts plus a repeat:

| CPU path | First request | Subsequent requests | Observed memory |
| --- | ---: | ---: | --- |
| Official attribution helper, including gradient saliency | 18.60 s | 8.04–8.21 s | About 1.85 GB peak working set |
| Lean JIT prediction, without gradient explanations | 2.75 s | 0.62–0.67 s | About 443 MB RSS; 461 MB peak working set |

The lean path matched the official helper's region/date probabilities on the checked example within 3.2e-7. It omits explanations, not predictive layers. This is a runtime/compatibility smoke test, not an accuracy evaluation or hosted load test. The public examples may have appeared in the model's training data. The Greek checkpoint has not been run locally.

A genuine plaque photograph paired with its matching manually read transcription also ran through the official image-plus-text branch. Region probabilities changed substantially while date probabilities stayed identical. The plaque has no independently verified geographic label in our set, so this establishes functionality, not a multimodal accuracy gain. Its cold text-only and warm image-plus-text timings cannot establish a speed comparison.

Evidence, environment versions and reproduction scripts are under `.local/research-plan/aeneas/`, including `fast-smoke-results.json`, `checkpoint-source.json` and `paired-smoke-results.json`. [Inference implementation](https://github.com/google-deepmind/predictingthepast/blob/main/predictingthepast/eval/inference.py), [Greek training configuration](https://github.com/google-deepmind/predictingthepast/blob/main/train/config_greek.py), [paper](https://www.nature.com/articles/s41586-025-09292-5)

## Photo recognition alternatives

| Candidate | Why test it | Remaining evidence gap |
| --- | --- | --- |
| PaddleOCR.js with lightweight PP-OCR models | Browser inference can avoid recognition-server charges. Its official SDK supports ONNX/WASM, workers and custom model assets. | Benchmark this app's artifact photos, browser memory and startup downloads; verify Greek asset integration. |
| PP-OCRv5 Greek recognizer | Official small Greek text-line model; a CPU/browser candidate alongside Latin recognition. | Modern Greek benchmark scores do not establish ancient Greek, carved-letter or monogram accuracy. |
| PaddleOCR-VL-1.6 | Compact document-oriented vision model, a candidate alternative to the current general vision reader. | Strong document benchmarks are not artifact benchmarks; runtime/quality here is untested. |
| Kraken/eScriptorium fine-tuning | Historical/low-resource recognition can learn from corrected line images. | Needs representative line images and literal references; annotation/training effort is the main initial cost. |
| Small metered vision API | May be inexpensive at intermittent volume and avoid an idle GPU server. | Must test actual ancient-script quality, token use, availability and data-use terms. No API key or paid calls were used. |

The 2026 PP-OCRv6 and PaddleOCR-VL-1.6 papers are relevant efficiency research, but their published benchmark scores cannot substitute for our tests. The existing local Qwen reader remains a useful baseline. A larger general model or an additional LLM judge is not automatically more accurate. [Browser SDK](https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js), [Greek model](https://huggingface.co/PaddlePaddle/el_PP-OCRv5_mobile_rec), [PP-OCRv6 paper](https://arxiv.org/abs/2606.13108), [PaddleOCR-VL-1.6 paper](https://arxiv.org/abs/2606.03264), [Kraken training](https://kraken.re/6.0.0/tutorials/training.html)

The August 2026 [Stoicheia work](https://arxiv.org/abs/2608.07249) is a later Greek restoration candidate, not a date/geography or photo-recognition replacement. Proposed restored letters must stay separate from observed letters.

## Proposed cost envelope

Lookup, cached retrieval and browser OCR have no model-provider per-request fee. A CPU service for specialist attribution is a credible low-cost target after the local smoke test. Hugging Face currently lists a $9/month personal PRO plan; its CPU Basic Space has no hourly compute charge, but creating normal Gradio/Docker compute Spaces requires a paid plan. This is a hosting candidate, not a measured deployment cost for our app. Organization ownership follows different plans. [Account pricing](https://huggingface.co/pricing), [Space requirements](https://huggingface.co/docs/hub/spaces-overview)

For scale illustration only, Gemini 2.5 Flash-Lite currently lists $0.10 per million input tokens and $0.40 per million output tokens. At an assumed 2,000 input tokens and 500 output tokens per photo, 1,000 drafts would cost about $0.40 in model tokens. Actual image token counts, model choice, retries and output length must be measured. The free tier has limits and permits product-improvement use of content; paid-tier policy differs. This is not a quality recommendation or a guaranteed quote. [Official pricing](https://ai.google.dev/gemini-api/docs/pricing)

Free ZeroGPU remains a demonstration option with quotas and queues, not unlimited production inference. The CPU JAX path does not require it. Keep a researcher-run local/manual fallback. No recurring cost has been enabled by this research. [ZeroGPU limits](https://huggingface.co/docs/hub/spaces-zerogpu)

## Implementation sequence and decision gates

1. **Source import and honest field semantics.** Add a source-backed import preview using URL/accession identifiers. Record source, uncertainty and provenance for each field. Separate findspot/provenance from manufacturing origin before measuring geography checks. Carry the 13 research artifacts into a disposable application demo only after mapping these fields; do not invent missing text.
2. **Freeze the evaluation set.** Verify literal image-visible references for 30–50 diverse artifacts first, including negatives and modern markings, then expand before production reliability claims. Keep all views/crops of an artifact in the same split; separate existing controls and possible training overlaps from genuinely new tests. Measure OCR character/exact-text error, date midpoint error and distance-to-range, region top-one/macro-F1 and acceptance coverage by script, period and object type.
3. **Add a provider adapter and evidence layer.** Keep the current model as a baseline; add feature-flagged Aeneas Latin/updated Ithaca Greek attribution with original distributions and provenance labels. Use the lean CPU path, cached outputs, startup warm-up and bounded concurrency. Benchmark text-only first; measure image context separately on genuinely paired labelled records. Add cited parallel retrieval only with query/test/near-duplicate exclusions. The official contextualization helper defaults to including test records and is not evaluation-safe unchanged.
4. **Benchmark two photo paths.** Compare a lightweight local/browser recognizer with the existing vision reader on the same verified crops; optionally add a low-cost API trial if configured later. Preserve literal text, alternatives and uncertainty; never silently restore damage or translate into the original-text field. Choose by artifact error and actual cost, not document leaderboard scores.
5. **Validate selective assistance and launch.** Fit thresholds only on validation data and report accuracy plus coverage and uncertainty on untouched tests. A proposed automation target is at least 95% accepted-case accuracy with useful coverage, not 95% on a cherry-picked subset. Until independently demonstrated, label suggestions as review aids. If the specialist models do not improve the intended client domain, retain the cheaper measured route and collect corrections for targeted fine-tuning.

The first implementation should focus on source-backed import, a benchmark/provider adapter and cited parallels. Broad retraining or a chain of general LLM calls should wait for measured residual errors. A generic short prayer or monogram can lack enough historical information for unique dating or provenance; better code cannot supply missing evidence.
