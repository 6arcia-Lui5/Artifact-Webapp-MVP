# CPU inscription recognition

This is a separate CPU service for photo-to-original-text drafts. It uses PP-OCRv5 mobile detection and Latin/Greek recognition through RapidOCR and ONNX Runtime. It does not predict dates/regions, translate, restore damaged text, write artifact records, or certify a transcription as correct.

From the repository root, use a separate Python 3.12 environment:

```powershell
python -m venv .local/ocr-venv
.local/ocr-venv/Scripts/python.exe -m pip install -r ocr/requirements.txt
.local/ocr-venv/Scripts/python.exe ocr/setup_models.py
.local/ocr-venv/Scripts/python.exe -m uvicorn ocr.service:app --host 127.0.0.1 --port 8010 --workers 1
```

Model installation is explicit. `setup_models.py` downloads three official RapidAI-converted PaddleOCR model files, about 20.6 MB total, verifies their pinned SHA-256 checksums, and refuses to replace unexpected existing files. It defaults to ignored `.local/ocr/models`; use `--directory PATH` and backend environment `OCR_MODEL_DIR=PATH` for another location. HTTP clients cannot select model paths, URLs or executable code, and request handling does not download missing models.

Set `OCR_SERVICE_TOKEN` to require `Authorization: Bearer <token>` on every route when connecting a separate backend. Authentication runs before upload parsing. Keep the development server bound to loopback; use the app backend as the user-facing entry point. The one-job limit is per service process, so the example uses one worker.

## HTTP contract

`GET /health` reports `model_files_present`, the supported language codes and the engine. File presence does not prove model readiness or recognition accuracy.

`POST /transcribe` accepts multipart fields exactly `photo` and `language`:

- `language`: `lat`, `grc` or `eng`. English uses the Latin recognizer; unsupported languages are rejected.
- `photo`: a valid single-frame PNG, JPEG or WebP, up to 4 MiB and 20 megapixels. Actual file contents must match its MIME type.

The service applies EXIF orientation, composites transparency onto white, and bounds the recognition image to 2,400 pixels on either axis and four million pixels. Returned boxes use that processed image's coordinates. The original upload is never stored in the catalog.

The response includes:

```json
{
  "text": "DIS MANIBVS",
  "status": "draft",
  "lines": [
    {"text": "DIS MANIBVS", "box": [[0,0],[100,0],[100,30],[0,30]], "score": 0.98, "alternatives": []}
  ],
  "image": {"width": 100, "height": 30},
  "engine": {"name": "PP-OCRv5 mobile", "implementation": "RapidOCR ONNX CPU", "version": "3.10.0"},
  "notes": ["Recognition scores are internal model scores, not transcription accuracy."]
}
```

`status` is always `draft` or `no_text`, never automatically verified. Detection groups are ordered geometrically and reread as horizontal line bands. A differing direct recognition remains in the line's `alternatives`. This helps identify segmentation disagreements; neither candidate is known to be correct solely because of its model score. Circular, angled, monogrammed or damaged text can have an uncertain reading order.

One isolated worker process handles each recognition job. The service returns 429 when busy, kills a worker after 60 seconds or client disconnection, and closes temporary multipart files and IPC handles. Total upload bytes are capped even without `Content-Length`, with a 30-second upload deadline. Invalid photo/language requests return 400, oversized requests 413, missing models 503, processing timeout 504, and inference failure 502. FastAPI errors use `detail`; upload/auth guard errors use `error`.

## Validation and measured limitations

```powershell
$env:OCR_TEST_MODEL_DIR=(Resolve-Path .local/ocr/models).Path
.local/ocr-venv/Scripts/python.exe -m unittest discover -s ocr/tests -v
```

Real HTTP tests cover generated Greek/Latin controls and a blank, authentication before parsing, worker termination on timeout/disconnect, busy-slot recovery and invalid inputs. Separate image/geometry tests cover orientation, transparency and reading order; an ASGI boundary test verifies actual chunked bytes are limited without relying on platform TCP reset timing. These workflow checks are not a representative artifact accuracy benchmark.

The initial local experiment is in ignored `.local/transcription-engine-trial`. On one manually read Latin plaque, raw recognition had about 6.4% normalized character error on the full photograph and 11.5% on a crop. Geometric ordering reduced the full-photo error to 3.8%; same-image line-band tuning reached 2.6% on the crop. This was tuning on the same photograph, not a held-out improvement. Greek ring outputs remained unreliable, and a worn Greek marker yielded only its modern painted inventory number at a high model score. Generated text controls were read correctly, which does not establish engraved-letter accuracy.

Sources and licenses: [RapidOCR](https://github.com/RapidAI/RapidOCR), [official model registry](https://github.com/RapidAI/RapidOCR/blob/main/python/rapidocr/default_models.yaml), [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR), [Greek recognizer](https://huggingface.co/PaddlePaddle/el_PP-OCRv5_mobile_rec). The setup script pins the model version and checksums. The inference code/model families publish Apache-2.0 licensing; retain applicable notices when packaging them.
