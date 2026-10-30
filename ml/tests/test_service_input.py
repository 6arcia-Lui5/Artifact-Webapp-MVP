"""Real HTTP checks for input validation without a new test dependency."""
import json
from pathlib import Path
import socket
import sys
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import torch
import uvicorn

torch.set_num_threads(2)
import service


class ServiceInputTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.socket = socket.socket()
        cls.socket.bind(("127.0.0.1", 0))
        cls.url = "http://127.0.0.1:" + str(cls.socket.getsockname()[1])
        cls.server = uvicorn.Server(uvicorn.Config(service.app, log_level="error", access_log=False))
        cls.thread = threading.Thread(target=cls.server.run, kwargs={"sockets": [cls.socket]}, daemon=True)
        cls.thread.start()
        deadline = time.monotonic() + 15
        while not cls.server.started and time.monotonic() < deadline:
            time.sleep(0.02)
        if not cls.server.started:
            raise RuntimeError("Test model service did not start")

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=10)
        cls.socket.close()
        if cls.thread.is_alive():
            raise RuntimeError("Test model service did not stop")

    def post(self, path, body):
        request = Request(self.url + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
        try:
            with urlopen(request, timeout=15) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_all_routes_reject_insufficient_input_before_model_inference(self):
        with patch.object(service.predictors["deep"], "predict", side_effect=AssertionError("Invalid input reached inference")):
            for text in ["D M", "...", "[illegible]", "# # #", "D(is) M(anibus)"]:
                for route in ["/predict", "/check", "/check/batch"]:
                    body = {"text": text} if route != "/check/batch" else {"records": [{"text": text}]}
                    with self.subTest(route=route, text=text):
                        status, result = self.post(route, body)
                        self.assertEqual(status, 422)
                        self.assertIn("at least 5", result["detail"][0]["msg"])

    def test_batch_is_validated_before_any_record_is_predicted(self):
        with patch.object(service.predictors["deep"], "predict", side_effect=AssertionError("Partially evaluated invalid batch")):
            status, _ = self.post("/check/batch", {"records": [{"text": "DIS MANIBVS"}, {"text": "D M"}]})
            self.assertEqual(status, 422)

    def test_readable_erasure_and_literal_text_have_identical_real_http_predictions(self):
        for model in ["deep", "baseline"]:
            for route in ["/predict", "/check"]:
                literal_status, literal = self.post(route, {"text": "DIS MANIBVS SACRVM", "model": model})
                erased_status, erased = self.post(route, {"text": "DIS [[MANIBVS]] SACRVM", "model": model})
                self.assertEqual((literal_status, erased_status), (200, 200))
                self.assertEqual(literal, erased)


if __name__ == "__main__":
    unittest.main()
