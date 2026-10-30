"""Real HTTP/process tests; set OCR_TEST_MODEL_DIR for optional checkpoint checks."""
import contextlib
import asyncio
import io
import json
import multiprocessing
import os
from pathlib import Path
import socket
import struct
import sys
import tempfile
import threading
import time
import unittest
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zlib

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import uvicorn
from PIL import Image
from ocr.recognition import DETECTOR, RECOGNIZERS, group_lines
from ocr.service import MAX_BYTES, RequestGuards, create_app, normalize_photo


def stalled_worker(connection, _photo, _language, model_dir):
    Path(model_dir, "worker.pid").write_text(str(os.getpid()))
    time.sleep(20)
    connection.close()


def png():
    output = io.BytesIO()
    Image.new("RGB", (100, 40), "white").save(output, "PNG")
    return output.getvalue()


def multipart(photo=None, language="lat", extra=None):
    boundary = "artifact-ocr-service-test"
    payload = photo if photo is not None else png()
    chunks = [f'--{boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\n{language}\r\n'.encode(),
              f'--{boundary}\r\nContent-Disposition: form-data; name="photo"; filename="inscription.png"\r\nContent-Type: image/png\r\n\r\n'.encode(), payload, b"\r\n"]
    if extra:
        chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{extra}"\r\n\r\nvalue\r\n'.encode())
    chunks.append(f'--{boundary}--\r\n'.encode())
    return b"".join(chunks), "multipart/form-data; boundary=" + boundary


@contextlib.contextmanager
def running(app):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    url = "http://127.0.0.1:" + str(sock.getsockname()[1])
    server = uvicorn.Server(uvicorn.Config(app, log_level="critical", access_log=False))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [sock]}, daemon=True)
    thread.start()
    deadline = time.monotonic() + 10
    while not server.started and time.monotonic() < deadline:
        time.sleep(0.02)
    if not server.started:
        raise RuntimeError("Test OCR server did not start")
    try:
        yield url
    finally:
        server.should_exit = True
        thread.join(timeout=5)
        sock.close()
        if thread.is_alive():
            raise RuntimeError("Test OCR server did not stop")


def post(url, body=None, language="lat", token="test-service", extra=None):
    payload, content_type = multipart(body, language, extra)
    request = Request(url + "/transcribe", data=payload, headers={"Content-Type": content_type, **({"Authorization": "Bearer " + token} if token else {})})
    try:
        with urlopen(request, timeout=15) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="artifact-ocr-test-")
        self.models = Path(self.temporary.name)
        for name in {DETECTOR, *RECOGNIZERS.values()}:
            (self.models / name).write_bytes(b"model-presence-fixture")

    def tearDown(self):
        self.temporary.cleanup()

    def test_authentication_happens_before_upload_parsing(self):
        with running(create_app(self.models, token="test-service")) as url:
            status, result = post(url, b"not a photo", token=None)
            self.assertEqual(status, 401)
            self.assertIn("authentication", result["error"])

    def test_invalid_input_is_rejected_before_worker_start(self):
        with running(create_app(self.models, token="test-service")) as url:
            self.assertEqual(post(url, language="heb")[0], 400)
            self.assertEqual(post(url, b"<svg>not a photo</svg>")[0], 400)
            self.assertEqual(post(url, extra="url")[0], 400)
            self.assertEqual(post(url, b"")[0], 413)
            self.assertEqual(post(url, png() + b"a" * MAX_BYTES)[0], 413)

    def test_missing_models_fail_closed_without_downloading(self):
        with tempfile.TemporaryDirectory() as empty, running(create_app(empty, token="test-service")) as url:
            self.assertEqual(post(url)[0], 503)
            self.assertEqual(list(Path(empty).iterdir()), [])

    def test_chunked_request_actual_bytes_are_bounded(self):
        # Feed ASGI chunks without Content-Length. A real TCP peer can receive a
        # reset after early rejection while still sending, so inspect the
        # server boundary directly rather than depending on Windows TCP timing.
        messages, called = [], []

        async def downstream(_scope, _receive, _send):
            called.append(True)

        async def receive():
            return {"type": "http.request", "body": b"x" * (256 * 1024), "more_body": True}

        async def send(message):
            messages.append(message)

        asyncio.run(RequestGuards(downstream, "")({"type": "http", "method": "POST", "headers": []}, receive, send))
        self.assertEqual(messages[0]["status"], 413)
        self.assertFalse(called, "Oversized chunked input reached multipart parsing")

    def test_timeout_kills_worker_and_releases_slot(self):
        with running(create_app(self.models, token="test-service", processing_timeout=0.5, worker_target=stalled_worker)) as url:
            self.assertEqual(post(url)[0], 504)
            self.assertFalse(multiprocessing.active_children())
            self.assertEqual(post(url)[0], 504)

    def test_busy_job_returns_retry_guidance_and_finishes_without_orphan(self):
        with running(create_app(self.models, token="test-service", processing_timeout=2, worker_target=stalled_worker)) as url:
            result = []
            thread = threading.Thread(target=lambda: result.append(post(url)))
            thread.start()
            deadline = time.monotonic() + 2
            while not (self.models / "worker.pid").exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue((self.models / "worker.pid").exists())
            self.assertEqual(post(url)[0], 429)
            thread.join(timeout=5)
            self.assertEqual(result[0][0], 504)
            self.assertFalse(multiprocessing.active_children())

    def test_client_disconnect_kills_active_worker(self):
        with running(create_app(self.models, token="test-service", processing_timeout=10, worker_target=stalled_worker)) as url:
            body, content_type = multipart()
            port = int(url.rsplit(":", 1)[1])
            connection = socket.create_connection(("127.0.0.1", port), timeout=5)
            connection.sendall((f"POST /transcribe HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer test-service\r\nContent-Type: {content_type}\r\nContent-Length: {len(body)}\r\n\r\n").encode() + body)
            deadline = time.monotonic() + 3
            while not (self.models / "worker.pid").exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue((self.models / "worker.pid").exists())
            connection.close()
            deadline = time.monotonic() + 3
            while multiprocessing.active_children() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertFalse(multiprocessing.active_children())

    def test_image_decode_limits_orientation_and_transparency(self):
        header = bytearray(png())
        header[16:24] = struct.pack(">II", 5001, 4000)
        header[29:33] = struct.pack(">I", zlib.crc32(header[12:29]))
        with self.assertRaisesRegex(Exception, "single-frame"):
            normalize_photo(bytes(header), "image/png")
        with self.assertRaisesRegex(Exception, "single-frame"):
            normalize_photo(png(), "image/jpeg")
        source = io.BytesIO()
        Image.new("RGBA", (20, 10), (0, 0, 0, 0)).save(source, "PNG")
        prepared = Image.open(io.BytesIO(normalize_photo(source.getvalue(), "image/png")))
        self.assertEqual(prepared.size, (20, 10))
        self.assertGreater(min(prepared.getpixel((0, 0))), 245)
        source = io.BytesIO()
        image = Image.new("RGB", (50, 20), "white")
        exif = Image.Exif()
        exif[274] = 6
        image.save(source, "JPEG", exif=exif)
        prepared = Image.open(io.BytesIO(normalize_photo(source.getvalue(), "image/jpeg")))
        self.assertEqual(prepared.size, (20, 50))

    def test_spatial_reading_order_places_left_letters_before_right_letters(self):
        groups = group_lines([{"text": "M", "left": 200, "cy": 20, "height": 20},
                              {"text": "D", "left": 20, "cy": 22, "height": 20},
                              {"text": "SECOND", "left": 10, "cy": 60, "height": 20}])
        self.assertEqual([[item["text"] for item in group] for group in groups], [["D", "M"], ["SECOND"]])


@unittest.skipUnless(os.environ.get("OCR_TEST_MODEL_DIR"), "Set OCR_TEST_MODEL_DIR for the actual downloaded checkpoints")
class RealCheckpointTests(unittest.TestCase):
    def test_generated_latin_and_greek_controls_and_blank_through_real_http(self):
        models = Path(os.environ["OCR_TEST_MODEL_DIR"])
        fixtures = ROOT / ".local/ocr-evaluation/fixtures"
        with running(create_app(models, token="test-service")) as url:
            for language, filename, expected in [("lat", "latin-control.png", "DIS MANIBVS"), ("grc", "greek-control.png", "\u0391\u03a7\u0399\u039b\u039b\u0395\u039f\u03a5\u03a3"), ("eng", "blank-control.png", "")]:
                status, result = post(url, (fixtures / filename).read_bytes(), language)
                self.assertEqual(status, 200)
                self.assertEqual(result["engine"]["version"], "3.10.0")
                self.assertEqual(result["status"], "draft" if expected else "no_text")
                if expected:
                    self.assertIn(expected, result["text"])
                    self.assertTrue(all(len(line["box"]) == 4 for line in result["lines"]))
                else:
                    self.assertEqual(result["text"], "")
                self.assertIn("not transcription accuracy", " ".join(result["notes"]))


if __name__ == "__main__":
    unittest.main()
