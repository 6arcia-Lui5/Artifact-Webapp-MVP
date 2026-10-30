"""Run from the repository root: python -m uvicorn ocr.service:app --host 127.0.0.1 --port 8010."""
import asyncio
import hmac
import io
import json
import math
import multiprocessing
import os
from pathlib import Path
import time
import warnings

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

from .recognition import DETECTOR, RECOGNIZERS, recognize_worker

MAX_BYTES = 4 * 1024 * 1024
MAX_PIXELS = 20_000_000
MAX_REQUEST = MAX_BYTES + 64 * 1024
ROOT = Path(__file__).resolve().parents[1]


class RequestGuards:
    """Authenticate before multipart parsing and bound even chunked uploads."""
    def __init__(self, app, token):
        self.app, self.token = app, token

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))

        async def fail(status, message):
            body = json.dumps({"error": message}).encode()
            await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})

        if self.token and not hmac.compare_digest(headers.get(b"authorization", b""), ("Bearer " + self.token).encode()):
            return await fail(401, "OCR service authentication required.")
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            return await fail(400, "Invalid request length.")
        if length < 0 or length > MAX_REQUEST:
            return await fail(413, "The OCR request is too large. Use a smaller crop.")
        if scope["method"] != "POST":
            return await self.app(scope, receive, send)
        chunks, count = [], 0
        deadline = time.monotonic() + 30
        while True:
            try:
                message = await asyncio.wait_for(receive(), timeout=max(0, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                return await fail(408, "Photo upload timed out.")
            if message["type"] == "http.disconnect":
                return
            count += len(message.get("body", b""))
            if count > MAX_REQUEST:
                return await fail(413, "The OCR request is too large. Use a smaller crop.")
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                break
        delivered = False

        async def buffered_receive():
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": b"".join(chunks), "more_body": False}
            return await receive()

        await self.app(scope, buffered_receive, send)


def normalize_photo(payload, content_type):
    formats = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(payload)) as source:
                if source.format not in formats or formats[source.format] != content_type:
                    raise ValueError()
                if source.width * source.height > MAX_PIXELS or getattr(source, "n_frames", 1) != 1:
                    raise ValueError()
                source.load()
                oriented = ImageOps.exif_transpose(source)
                if oriented.mode in ("RGBA", "LA") or "transparency" in oriented.info:
                    rgba = oriented.convert("RGBA")
                    image = Image.new("RGBA", rgba.size, "white")
                    image.alpha_composite(rgba)
                    image = image.convert("RGB")
                else:
                    image = oriented.convert("RGB")
                scale = min(1, 2400 / max(image.size), math.sqrt(4_000_000 / (image.width * image.height)))
                if scale < 1:
                    image = image.resize((max(1, math.floor(image.width * scale)), max(1, math.floor(image.height * scale))), Image.Resampling.LANCZOS)
                target = io.BytesIO()
                image.save(target, format="JPEG", quality=92)
                return target.getvalue()
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise HTTPException(400, "Use a valid single-frame PNG, JPEG or WebP photo of at most 20 megapixels.") from error


def create_app(model_dir=None, token=None, processing_timeout=60, worker_target=recognize_worker):
    app = FastAPI(title="Artifact inscription CPU OCR", version="1.0.0")
    directory = Path(model_dir or os.environ.get("OCR_MODEL_DIR", ROOT / ".local/ocr/models")).resolve()
    service_token = os.environ.get("OCR_SERVICE_TOKEN", "") if token is None else token
    app.add_middleware(RequestGuards, token=service_token)
    slot = asyncio.Lock()

    @app.get("/health")
    async def health():
        return {"status": "ok", "model_files_present": all((directory / name).is_file() for name in {DETECTOR, *RECOGNIZERS.values()}),
                "languages": ["lat", "grc", "eng"], "engine": "PP-OCRv5 mobile / RapidOCR ONNX CPU",
                "note": "Model-file presence is not an accuracy or warm-readiness guarantee."}

    @app.post("/transcribe")
    async def transcribe(request: Request, photo: UploadFile = File(...), language: str = Form(...)):
        fields = await request.form()
        if sorted(key for key, _value in fields.multi_items()) != ["language", "photo"]:
            raise HTTPException(400, "Use one photo file and one language field.")
        if language not in RECOGNIZERS:
            raise HTTPException(400, "Supported recognition languages are lat, grc and eng.")
        if not all((directory / name).is_file() for name in [DETECTOR, RECOGNIZERS[language]]):
            raise HTTPException(503, "OCR model files are missing. Run the model setup command before transcription.")
        if slot.locked():
            raise HTTPException(429, "OCR is busy. Retry in a few seconds.", headers={"Retry-After": "3"})
        await slot.acquire()
        process = connection = child = None
        try:
            payload = await photo.read(MAX_BYTES + 1)
            if not payload or len(payload) > MAX_BYTES:
                raise HTTPException(413, "Choose a nonempty photo of at most 4 MB.")
            prepared = normalize_photo(payload, photo.content_type)
            context = multiprocessing.get_context("spawn")
            connection, child = context.Pipe(duplex=False)
            process = context.Process(target=worker_target, args=(child, prepared, language, str(directory)), daemon=True)
            process.start()
            child.close()
            deadline = time.monotonic() + min(60, processing_timeout)
            while True:
                if await request.is_disconnected():
                    raise HTTPException(499, "OCR request was cancelled.")
                if time.monotonic() >= deadline:
                    raise HTTPException(504, "OCR timed out. Try a smaller inscription crop.")
                if connection.poll():
                    try:
                        result = connection.recv()
                    except EOFError as error:
                        raise HTTPException(502, "OCR processing stopped before returning a result.") from error
                    if "result" in result:
                        return result["result"]
                    raise HTTPException(result.get("status", 502), result.get("error", "OCR processing failed."))
                if not process.is_alive():
                    raise HTTPException(502, "OCR processing stopped before returning a result.")
                await asyncio.sleep(0.05)
        finally:
            await photo.close()
            if connection is not None:
                connection.close()
            if child is not None:
                child.close()
            if process is not None and process.pid is not None:
                if process.is_alive():
                    process.terminate()
                process.join(timeout=1)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=1)
            slot.release()

    return app


app = create_app()
