# Development handoff

## Current outcome

The photo transcription implementation is an editable-draft workflow. It has not met the requirement for reliable unattended transcription. Automatic acceptance is disabled. No artifact-specific OCR model was trained, and the hidden researcher image corpus has not been accessed or scored.

Two scoreable development photographs improved from 6/92 to 3/92 letter/number errors; errors including punctuation fell from 6/92 to 4/92. Exact transcription remained 0/2. The plaque had correct letters but wrong punctuation/layout; the worn fragment retained 3/14 letter errors. A corroded Greek diagnostic produced unrelated text. Do not report these results as general artifact accuracy. Two no-text controls improved from one invented-text result to none.

## Where to continue

- [Transcription implementation, setup, metrics and measured results](transcription-pipeline.md): backend comparison service, CPU OCR, UI evidence export, batch evaluator and reproducible commands.
- [CPU OCR service setup](../ocr/README.md): explicit model installation, language support, HTTP contract and limits.
- [Metadata input fixes and evaluation](ml-input-evaluation.md): readable erasures and minimum input validation. These are separate from photo recognition.
- [Research and experimental alternatives](ml-improvement-plan.md): date/region retrieval experiments and specialist models. These are not deployed OCR improvements.
- [Hosting options and researcher fallback](photo-transcription-hosting.md): historical research, not an existing public transcription deployment.

The comparison implementation is `backend/src/services/transcriptionPipeline.ts`; its approved-account route is in `backend/src/routes/transcriptionRoutes.ts`. The UI is `frontend/src/components/photoTranscription/PhotoTranscription.jsx`. `scripts/transcribe-photo.cjs` runs the compiled backend locally, and `scripts/evaluate-transcription.py` scores batches without passing reference contents to recognition.

Local evidence and model downloads remain ignored in `.local/`. The final batch report is `.local/transcription-benchmark/pipeline-results-v3.json`, with source/model/configuration fingerprints in `pipeline-v3-freeze.json` and readback in `pipeline-v3-readback.json`. Restricted source photographs are retained locally, not committed or cleared for training. A fresh checkout needs the documented dependency/model setup; local credentials and datasets are not included.

## Verification and remaining work

Completed verification: backend build and 70 backend tests, 10 OCR HTTP/process tests, 10 evaluator tests, 9 metadata regression tests, 22 frontend unit tests, frontend lint/build, 22 existing browser checks and the final new comparison browser check. These prove software behavior, not recognition accuracy. The final browser flow took 27.5 seconds; seven-image batch inference totaled 112.3 seconds on local hardware. See the detailed report for timing limits and prior failures.

The temporary application/model servers were stopped, and the disposable database schema was removed with independent readback. Public artifact counts remained 7 before and after cleanup. No GitHub push, Vercel deployment or paid service was performed for this work.

Next accuracy work needs independently checked literal photo transcriptions, a frozen holdout kept out of development, and a separate training/development corpus with appropriate image rights. Score exact text, character errors, negative hallucinations, failures and latency on all applicable inputs. Curved/damaged Greek, symbols and monograms remain unvalidated. Do not enable automatic acceptance from reader agreement or internal OCR scores.
