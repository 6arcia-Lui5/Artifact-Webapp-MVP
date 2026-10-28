# Photo transcription evaluation

Development check on October 28, 2026. This is a small, selected set of workflow experiments, not client validation or a general accuracy claim.

The set included generated Latin, Greek and English text controls, a blank surface, a Roman funerary plaque ([Met object 256771](https://www.metmuseum.org/art/collection/search/256771)), and two curved Greek signet-ring photographs ([466087](https://www.metmuseum.org/art/collection/search/466087), [465925](https://www.metmuseum.org/art/collection/search/465925)). The museum photographs are public domain. Generated controls are not artifact photographs.

## What was measured

Tesseract.js 7.0.0 was compared with a local quantized `qwen3-vl:2b-instruct` through Ollama 0.40.12 on an RTX 5060 with 8 GB VRAM. Qwen used temperature 0, an 8192-token context and bounded JSON output. The photograph/reference text was not included in the prompt. Reference transcription for the plaque was a manual visual reading, not an independently checked scholarly edition.

Character error rate is Levenshtein edit distance divided by reference length after Unicode NFC normalization, uppercasing, and removal of spaces and punctuation. This ignores line layout and punctuation errors. The manually read plaque reference has 78 normalized letters/numerals. No quantitative accuracy was calculated for the rings because verified image-visible references were unavailable.

| Input | Basic OCR result | Local vision result |
| --- | --- | --- |
| Latin printed control | Exact normalized text | Exact normalized text |
| English printed control | Exact normalized text | Exact normalized text |
| Greek printed control | 12.2% normalized character error | Exact normalized letters; line layout was not preserved |
| Blank surface | Empty text | Empty text |
| Roman plaque, whole photograph | Unusable noise with single-block segmentation; automatic layout returned empty | 2 added characters out of 78 (2.6% error), about 3.8 seconds warm |
| Roman plaque, selected inscription area | Unusable without further cleanup | 1 added character out of 78 (1.3% error), about 2.3 seconds warm |
| Curved Greek ring, Leontios | Noisy output | More readable Greek-like text, with unverified errors; not scored |
| Curved Greek ring, Michael Zorianos | Noisy output | Repetitive output hit the generation limit; the application rejects incomplete results |

Smoothing/downscaling/threshold experiments improved Tesseract on this one plaque but still left about 42% normalized character error in the best tried variant. That was tuning on the same image, not a held-out result. Engine confidence was not a reliable quality indicator: one empty automatic-layout result reported 95. The application does not display that number as accuracy.

A separate CPU-only experiment limited the local i7-4770K to two inference threads, resized the plaque crop to 1600 pixels wide and used the same Instruct model. It took 132.8 seconds, mostly image/prompt processing. This is older local hardware, not a measurement of any cloud host, but it exceeded the application's 115-second service budget. A cheap CPU plan is therefore only a candidate until its actual latency and input-resolution tradeoffs are measured; the GPU result cannot establish CPU hosting performance.

## Consequences for the product

- Keep every result as an editable draft. The vision model expanded or added letters despite instructions not to; readable text is not proof of a literal transcription.
- Preserve original scripts and researcher corrections. Do not translate, expand abbreviations, restore damage or automatically update dates/places.
- Do not claim reliable ancient Greek recognition from a generated control or an unscored ring example. Verify curved/damaged Greek and other client material with a qualified reader.
- Empty or invalid/truncated model results must not be applied. Cancellation, service errors and failed downloads must preserve the artifact form.
- Test multiple photographs per object, crops, lighting, low-resolution inputs and text-free surfaces. Keep visible-letter ground truth separate from editorial restorations and record false insertions as well as missed letters.

The browser tests separately exercise real model inference, researcher correction, append/save/reload, preservation of an existing inscription ID, on-device OCR, cancellation, blank results and service-error recovery. Backend tests use stub upstream responses to verify authentication, limits and network contracts; those are not recognition accuracy tests.

`scripts/prepare-photo-fixtures.cjs` recreates the public input set for workflow checks. Fonts, model downloads and image revisions can change outputs. The development JSON outputs and model files stay in ignored `.local`; no client corpus or credentials are committed. A representative client-labelled evaluation remains required before setting an accuracy target.
