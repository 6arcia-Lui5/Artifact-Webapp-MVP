# Compared photo transcription

This local implementation reads a selected photograph and returns original-script text, alternative machine readings and character disagreements. It does not translate, infer dates/regions, certify readings or save records. All results remain editable drafts.

## Run locally

Install the backend/frontend dependencies using the existing project setup. Install the separate CPU reader as described in [ocr/README.md](../ocr/README.md). Run a local Ollama service with an explicitly downloaded `qwen3-vl:4b-instruct` model, then set these backend environment variables before starting the backend:

```powershell
$env:LOCAL_VISION_URL="http://127.0.0.1:11434"
$env:OCR_SERVICE_URL="http://127.0.0.1:8010"
$env:TRANSCRIPTION_VISION_MODEL="qwen3-vl:4b-instruct"
# Optional experimental second reader, downloaded separately:
$env:TRANSCRIPTION_SECONDARY_MODEL="qwen3-vl:2b-instruct"
# Set LOCAL_VISION_TOKEN / OCR_SERVICE_TOKEN when the corresponding service requires them.
```

`TRANSCRIPTION_SECONDARY_MODEL` is experimental and optional. With a distinct second model, the pipeline compares the full-photo readings and CPU OCR. It changes a primary character only when both other readers propose the same aligned edit. This can produce a composed reading that no individual reader returned; all original candidates and adopted edits remain in the evidence. Correlated readers can agree on a wrong letter. With no distinct second model, detected lines are reread as individual glyphs and retained as alternatives. Neither path enables automatic acceptance.

For an 8 GB GPU, start a dedicated Ollama process with `$env:OLLAMA_MAX_LOADED_MODELS="1"` and `$env:OLLAMA_NUM_PARALLEL="1"` before `ollama serve`. These are service-process settings, not backend settings. The compared pipeline runs the two vision requests sequentially, requests release after each distinct-model reading, and overlaps CPU OCR with the first reader. Limiting loaded models also handles a switch from the older single-vision option without leaving its model resident. [Ollama concurrency and model residency](https://docs.ollama.com/faq#how-does-ollama-handle-concurrent-requests) describes the settings. Restart a dedicated test service to verify configuration; changing a backend environment variable alone cannot reconfigure an already running Ollama process. This does not guarantee performance on other hardware or under competing workloads.

In the artifact editor, choose **Transcribe a photo**, select **Read and compare**, choose a Latin, Ancient Greek or English photograph, crop/rotate, and run. Compare the original machine readings, edit the draft and add it to the form. Save the artifact explicitly to persist it. **Download reading evidence** exports the prepared image hash, reader configuration, alternatives, edits and current draft; this evidence file is not automatically attached to the catalog record. Manual entry and on-device OCR remain available. Hebrew currently uses the separate single-vision option, not this compared pipeline.

The approved-account route is `POST /api/transcription/pipeline`. It uses the existing upload, cancellation and concurrency limits; the OCR service has its own bounded worker. A client cannot choose model-service URLs. Service availability in `/status` means configured, not a model-readiness or accuracy check. Multiple web processes do not share the application's in-memory concurrency lock; deployment must enforce the upstream compute limit too.

## Reproduce a batch comparison

Build the backend once with `npm.cmd run build` from `backend/`. From the repository root, `scripts/transcribe-photo.cjs` accepts only a photo, language and mode. It uses the same image normalization and compiled pipeline as the app. It never accepts reference answers. Input is a single-frame PNG/JPEG/WebP within 8 MB and 20 megapixels; normalized inference images are bounded to 2,400 pixels per side and four megapixels. Invalid/unsupported inputs become counted failures.

Create a UTF-8 manifest, storing references separately:

```json
{
  "scope": "Unseen researcher-labelled photos; freeze before running",
  "cases": [
    {"id":"object-1-front","imagePath":"inputs/object-1.jpg","language":"lat","referencePath":"references/object-1.txt","scoring":{"mode":"scored"}},
    {"id":"text-free-back","imagePath":"inputs/back.jpg","language":"grc","scoring":{"mode":"negative_no_text"}},
    {"id":"unchecked","imagePath":"inputs/unchecked.jpg","language":"grc","scoring":{"mode":"unscored"}}
  ]
}
```

Each reference must be the checked literal text visible in that particular photograph, not a translation, expanded abbreviation or reconstruction from another view. Mark ambiguity before running; the evaluator does not implement masks. Keep views/crops of one object together when splitting training/development/holdout, and check duplicates against development images. Keep all failures in the report. A missing reference is not a correct answer. Running without labels measures operation and latency, not transcription accuracy.

Example in PowerShell using an installed Python executable (`py -3` can replace `python`). The Python wrapper preserves JSON argument quoting on Windows PowerShell 5 as well as newer shells:

```powershell
@'
import json, subprocess, sys
for mode, filename in [("vision-baseline", "baseline-results.json"), ("pipeline", "pipeline-results.json")]:
    args = [sys.executable, "scripts/evaluate-transcription.py",
            "--manifest", "C:/evaluation/cases.json",
            "--command-json", json.dumps(["node", "scripts/transcribe-photo.cjs", "--mode", mode]),
            "--out", "C:/evaluation/" + filename, "--timeout-seconds", "125"]
    completed = subprocess.run(args)
    if completed.returncode not in (0, 1):
        raise SystemExit(completed.returncode)
'@ | python -
```

The baseline is the prior 2B Instruct reader with fixed generation settings. Reports refuse to overwrite an existing output. Exit 0 means evaluation completed, not correct recognition; exit 1 saves case errors, and exit 2 indicates invalid configuration. Run variants sequentially on the same machine without other inference jobs. Freeze the exact source/build hashes, Ollama model digests (`/api/tags`), OCR checksums/dependencies, configuration and manifest before testing. Retain the raw outputs; do not tune on the hidden answers and then call them held out. Reference contents are loaded after each recognizer invocation and are not supplied through its arguments/stdin, but the child is not filesystem-isolated. For an independently secret evaluation, run recognition on an inputs-only machine and score the returned outputs separately.

## Read the measures

- Exact match preserves internal whitespace, line breaks, punctuation and case after NFC, newline normalization and outer trimming.
- Strict CER is character edit distance on that strict text divided by reference characters.
- Normalized CER uppercases and removes whitespace, retaining punctuation and diacritics. No U/V, C/Greek-sigma or spelling correction is applied beyond ordinary Unicode case conversion.
- Rough CER keeps only letters/numerals. It is not exact accuracy or semantic accuracy.
- WER compares whitespace-separated strict tokens.
- Positive recognition failures remain nonexact and count as omitted characters. Report negative false-positive text together with negative execution failures; a timeout is not a correct blank.
- Acceptance accuracy requires explicit automatic-acceptance flags and its coverage. This pipeline always returns `automaticAcceptance: false`.

CER is character-weighted, so long inscriptions dominate the aggregate. Inspect per-case outcomes and material/language/damage/curvature strata. A tiny reused development sample cannot establish reliability, a safe automatic gate, an improvement over all alternatives or performance on the hidden set. No artifact-specific transcription model has been trained by this change. See [the original development evaluation](photo-transcription-evaluation.md) and [hosting limits](photo-transcription-hosting.md).


## October 29 development result

Seven actual input images ran successfully: two scoreable Latin development photographs, two no-text controls (one real artifact back and one generated blank), and three unscored real-photo diagnostics. One additional source-only entry had no available photograph and was not run. The scoreable references were a prior manual plaque reading and a visually checked published-edition fragment; neither is an independent client-reviewed holdout. Corroded Greek had no defensible visible-text reference and is not included in accuracy. One Greek output was unrelated text; operational success does not mean a usable reading.

| Reader | Exact positive photos | Strict CER | Normalized CER | Rough letters/numerals CER | WER |
| --- | --- | --- | --- | --- | --- |
| Prior 2B baseline | 0/2 | 15/111 (13.5%) | 6/92 (6.5%) | 6/92 (6.5%) | 6/21 (28.6%) |
| 4B primary reading captured inside comparison run | 0/2 | 11/111 (9.9%) | 7/92 (7.6%) | 4/92 (4.3%) | 9/21 (42.9%) |
| Final V3: 4B + 2B + CPU OCR composed draft | 0/2 | 8/111 (7.2%) | 4/92 (4.3%) | 3/92 (3.3%) | 6/21 (28.6%) |

The plaque's composed letters/numerals were correct (0/78 rough errors), but punctuation/layout were not exact. The fragment still had 3/14 normalized letter errors (21.4%). Pooling them hides that weak short-inscription result. The baseline invented text on one of two negatives; comparison returned empty on both. These two negatives cannot establish a general hallucination rate.

Across the seven input images, baseline elapsed time totaled 20.8 seconds (median 1.3); comparison totaled 144.6 seconds (median 16.1; range 5.8 to 42.6 seconds). Measurements include different warm/load/cache states on the local RTX 5060, not matched steady-state timing or hosted performance. Two models compete for 8 GB VRAM, so combining them has a substantial local cost. No paid API or hosted service was used.

Recognition source/build hashes remained unchanged throughout the comparison run. Ignored evidence: `.local/transcription-benchmark/vision-baseline-results-v1.json`, `pipeline-results-v2.json`, `pipeline-v2-freeze.json` and `pipeline-v2-readback.json`. The subsequent duplicate-secondary configuration fix restores line rereading when both configured model names are identical; it does not change this run's distinct-model path. Model digests were `84f7ed8042fa7cdbd902f7dcb7d0370e032095047cc3244179f263b77b5bc318` (4B) and `afc393e3572c07db0bc84aa460d928a16c75f3fbb9ca9e0dccc4fbd2dafb573e` (2B). Restricted photographs remain local and are not licensed training data.

Other measured trials did not justify a universal model replacement: 8B was slower and did not consistently improve the selected plaque/ring cases; GLM-OCR introduced wrong letters/scripts; strict/glyph prompts sometimes dropped or invented letters. These were bounded development probes, not an exhaustive or representative ranking. The composed pipeline shows a small development gain, but the requirement for unattended reliable transcription remains unmet. No automatic-acceptance threshold has been validated. The next meaningful accuracy test is the frozen, unseen researcher-labelled corpus, scored separately from any later training/tuning data.


The final V3 run used sequential model release and a dedicated server with one loaded model/one request at a time. All seven photographs completed again with zero operational errors. Positive aggregate scores, positive text outputs and negative outcomes matched V2. One unscored diagnostic output changed; temperature zero does not establish reproducibility of every reading across hardware/scheduling states. Same labelled input/reference SHA-256 values were verified against the baseline. Final timing totaled 112.3 seconds (median 14.2; range 10.6 to 32.8), including cold model loads. The plaque took 15.7 seconds in the batch. This remains slower than the prior single-reader baseline. Before the scheduling/configuration fix, the corresponding browser workflow had taken about 100 seconds. Source/build hashes stayed unchanged during V3; final evidence is `pipeline-results-v3.json`, `pipeline-v3-freeze.json` and `pipeline-v3-readback.json` in the same ignored folder. The performance change does not establish additional recognition accuracy or hosted throughput.


## Functional verification

The final backend build and 70 backend tests passed, including 29 comparison-pipeline tests. Ten CPU OCR HTTP/process tests passed with actual downloaded Latin/Greek checkpoints, ten evaluator tests passed, nine existing metadata-model regression tests passed and 22 frontend unit tests passed. Frontend lint and production build passed. These are software/contract checks, not extra transcription-accuracy samples.

Headless Edge at `http://localhost:5317` used an isolated Neon test schema. Twenty-two existing browser checks passed, followed by the final compared-reading test passing in 27.5 seconds after the scheduling fix. The flow was login, edit, choose/upload photograph, run, inspect comparisons, export evidence, add draft, and read back the unchanged saved artifact. The existing photo test separately covered explicit save/reload and preservation of the original inscription. The final check observed no uncaught page errors and no horizontal overflow at 1280/390-pixel widths. Desktop/mobile screenshots were visually read back; no blank page or framework overlay was present. Browser console warnings were not comprehensively captured. The Browser skill/plugin was unavailable; the existing Playwright workflow ran headless without foreground control.

Temporary screenshots: `C:/Users/jeffe/AppData/Local/Temp/artifact-compared-reading.png` and `artifact-compared-reading-mobile.png`. No GitHub push, Vercel deployment, paid service or persistent public transcription endpoint was part of this implementation. The hidden researcher corpus has not been accessed or scored.

The temporary app/model servers were stopped after verification. Cleanup removed only the generated `artifact_e2e_1793297319022_d9899d7d` schema, verified its absence, and read public artifact counts of 7 before and 7 after cleanup. Local model files, scripts and evaluation evidence were retained.
