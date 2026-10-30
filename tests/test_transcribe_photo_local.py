import base64
from contextlib import redirect_stderr, redirect_stdout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('local_photo_helper', ROOT / 'scripts/transcribe-photo-local.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV2kAAAAASUVORK5CYII=')


class Handler(BaseHTTPRequestHandler):
    response = None
    status = 200
    requests = []

    def log_message(self, *args):
        pass

    def do_POST(self):
        Handler.requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
        self.send_response(Handler.status)
        if Handler.status == 302:
            self.send_header('Location', 'http://example.com/should-not-receive-photo')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(Handler.response)


class HelperTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.photo = Path(self.temp.name) / 'photo.png'
        self.photo.write_bytes(PNG)
        self.output = Path(self.temp.name) / 'draft.txt'
        Handler.status = 200
        Handler.requests = []
        self.reply('D M\nΑΒΓ', ['Compare damaged strokes.'])

    def reply(self, text, notes=None, **extra):
        Handler.response = json.dumps({'done': True, 'message': {'content': json.dumps({'text': text, 'notes': notes or []})}, **extra}).encode('utf-8')

    def run_helper(self, *args):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = helper.main([str(self.photo), '--model', 'qwen3-vl:2b', '--url', self.url, *map(str, args)])
        return status, out.getvalue(), err.getvalue()

    def test_preserves_original_unicode_and_line_breaks(self):
        status, out, err = self.run_helper()
        self.assertEqual(status, 0)
        self.assertEqual(out, 'D M\nΑΒΓ\n')
        self.assertIn('Draft only', err)
        payload = Handler.requests[0]
        self.assertFalse(payload['stream'])
        self.assertEqual(base64.b64decode(payload['messages'][0]['images'][0]), PNG)
        self.assertIn('Do not translate', payload['messages'][0]['content'])

    def test_rejects_nonlocal_urls_and_redirect_destinations(self):
        for url in ['https://127.0.0.1:11434', 'http://example.com', 'http://user:password@localhost', 'http://localhost/?x=1', 'http://localhost:0']:
            with self.assertRaises(helper.TranscriptionError):
                helper.local_chat_url(url)

    def test_rejects_cloud_model_tag(self):
        with self.assertRaises(helper.TranscriptionError):
            helper.request_payload(PNG, 'qwen3-vl:235b-cloud', 'original')

    def test_rejects_unsupported_and_oversized_files(self):
        self.photo.write_text('<svg/>')
        status, _, _ = self.run_helper()
        self.assertEqual(status, 2)
        self.photo.write_bytes(PNG + b'0' * helper.MAX_IMAGE_BYTES)
        status, _, _ = self.run_helper()
        self.assertEqual(status, 2)
        self.assertEqual(Handler.requests, [])

    def test_does_not_overwrite_existing_output(self):
        self.output.write_text('Keep this')
        status, _, _ = self.run_helper('--output', self.output)
        self.assertEqual(status, 2)
        self.assertEqual(self.output.read_text(), 'Keep this')
        self.assertEqual(Handler.requests, [])

    def test_force_cannot_replace_photo(self):
        status, _, _ = self.run_helper('--output', self.photo, '--force')
        self.assertEqual(status, 2)
        self.assertEqual(self.photo.read_bytes(), PNG)
        self.assertEqual(Handler.requests, [])

    def test_force_can_replace_explicit_text_output(self):
        self.output.write_text('Replace me')
        status, _, _ = self.run_helper('--output', self.output, '--force')
        self.assertEqual(status, 0)
        self.assertEqual(self.output.read_text(encoding='utf-8'), 'D M\nΑΒΓ\n')

    def test_empty_result_does_not_create_output(self):
        self.reply('')
        status, _, _ = self.run_helper('--output', self.output)
        self.assertEqual(status, 3)
        self.assertFalse(self.output.exists())

    def test_truncated_or_invalid_result_does_not_save(self):
        for response in [b'not JSON', json.dumps({'done': True, 'message': {'content': '{}'}}).encode(), json.dumps({'done': True, 'done_reason': 'length'}).encode()]:
            Handler.response = response
            status, _, _ = self.run_helper('--output', self.output)
            self.assertEqual(status, 2)
            self.assertFalse(self.output.exists())

    def test_redirect_not_followed(self):
        Handler.status = 302
        status, _, err = self.run_helper()
        self.assertEqual(status, 2)
        self.assertIn('No redirect was followed', err)

    def test_upstream_error_keeps_output_untouched(self):
        Handler.status = 503
        status, _, err = self.run_helper('--output', self.output)
        self.assertEqual(status, 2)
        self.assertIn('HTTP 503', err)
        self.assertFalse(self.output.exists())


if __name__ == '__main__':
    unittest.main()
