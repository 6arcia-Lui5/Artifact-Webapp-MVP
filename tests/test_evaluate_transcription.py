"""Exercise the evaluator through a real child CLI and temporary manifests."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
EVALUATOR = ROOT / "scripts/evaluate-transcription.py"

HELPER = r'''
import argparse,json,sys,time
from pathlib import Path
ap=argparse.ArgumentParser();ap.add_argument('--input');ap.add_argument('--language');args=ap.parse_args()
case=json.loads(Path(args.input).read_text(encoding='utf-8'))
Path(__file__).with_name('observed-args.json').write_text(json.dumps(sys.argv[1:]),encoding='utf-8')
if case.get('write_reference'):
 Path(__file__).with_name('reference.txt').write_text(case['text'],encoding='utf-8')
sys.stderr.write('SECRET_SENTINEL_NEVER_SAVE')
if case.get('sleep'):time.sleep(case['sleep'])
if case.get('exit'):
 sys.stdout.write('SECRET_STDOUT_ON_FAILURE');sys.exit(case['exit'])
if case.get('invalid'):
 sys.stdout.write('SECRET_INVALID_STDOUT');sys.exit(0)
if case.get('bad_schema'):
 sys.stdout.write('[]');sys.exit(0)
if case.get('nonfinite'):
 sys.stdout.write('{"text":"ABCDE","confidence":NaN}');sys.exit(0)
output={'text':case.get('text','')}
for key in ['review','refused']:
 if key in case:output[key]=case[key]
sys.stdout.buffer.write(json.dumps(output,ensure_ascii=False).encode('utf-8'))
'''


class EvaluatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="artifact-transcription-eval-")
        self.base = Path(self.temp.name)
        self.helper = self.base / "recognizer.py"
        self.helper.write_text(HELPER, encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def case(self, name, output, reference, mode="scored", language="lat"):
        image = self.base / (name + ".image")
        image.write_text(json.dumps(output, ensure_ascii=False), encoding="utf-8")
        ref = self.base / (name + ".txt")
        if reference is not None:
            ref.write_text(reference, encoding="utf-8")
        return {"id": name, "imagePath": image.name, "referencePath": ref.name,
                "language": language, "scoring": {"mode": mode}}

    def run_eval(self, cases, timeout=5, out=None):
        manifest = self.base / "manifest.json"
        manifest.write_text(json.dumps({"scope": "Synthetic protocol tests, not OCR accuracy", "cases": cases}), encoding="utf-8")
        report = out or self.base / "report.json"
        result = subprocess.run([sys.executable, str(EVALUATOR), "--manifest", str(manifest),
                                 "--command-json", json.dumps([sys.executable, str(self.helper)]),
                                 "--out", str(report), "--timeout-seconds", str(timeout)],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        return result, json.loads(report.read_text(encoding="utf-8")) if report.is_file() and report.name == "report.json" else None

    def test_utf8_greek_and_transport_newlines_are_exact_without_losing_internal_layout(self):
        greek = "\u039a\u03a5\u03a1\u0399\u0395\n\u0392\u039f\u0397\u0398\u0399"
        case = self.case("greek", {"text": " " + greek.replace("\n", "\r\n") + "\n"}, greek + "\n", language="grc")
        result, report = self.run_eval([case])
        self.assertEqual(result.returncode, 0)
        self.assertTrue(report["cases"][0]["metrics"]["exactMatch"])
        self.assertEqual(report["summary"]["positive"]["strictCER"]["rate"], 0)
        observed = json.loads((self.base / "observed-args.json").read_text())
        self.assertEqual(observed, ["--input", str((self.base / "greek.image").resolve()), "--language", "grc"])
        self.assertNotIn("reference", json.dumps(observed))

    def test_rough_metrics_do_not_turn_formatting_or_spelling_changes_into_exact_matches(self):
        cases = [self.case("layout", {"text": "dis manibvs"}, "DIS\nMANIBVS"),
                 self.case("spelling", {"text": "MANIBUS"}, "MANIBVS"),
                 self.case("glyph", {"text": "\u03a3"}, "C"),
                 self.case("punctuation", {"text": "D M"}, "D.M."),
                 self.case("lunate-sigma", {"text": "\u03a3"}, "\u03f9"),
                 self.case("diacritics", {"text": "A"}, "\u00c1")]
        result, report = self.run_eval(cases)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["summary"]["positive"]["exactMatches"], 0)
        self.assertEqual(report["cases"][0]["metrics"]["normalizedCER"]["rate"], 0)
        self.assertEqual(report["cases"][0]["metrics"]["WER"]["rate"], 1)
        self.assertGreater(report["cases"][1]["metrics"]["normalizedCER"]["rate"], 0)
        self.assertEqual(report["cases"][2]["metrics"]["normalizedCER"]["rate"], 1)
        self.assertGreater(report["cases"][3]["metrics"]["normalizedCER"]["rate"], 0)
        self.assertEqual(report["cases"][3]["metrics"]["roughLettersNumeralsCER"]["rate"], 0)
        self.assertEqual(report["cases"][4]["metrics"]["normalizedCER"]["rate"], 1)
        self.assertEqual(report["cases"][5]["metrics"]["normalizedCER"]["rate"], 1)

    def test_missing_reference_is_counted_after_recognition_and_missing_image_is_not_dropped(self):
        labelled = self.case("missing-ref", {"text": "ABCDE"}, None)
        missing_image = self.case("missing-image", {"text": "ABCDE"}, "ABCDE")
        (self.base / "missing-image.image").unlink()
        result, report = self.run_eval([labelled, missing_image])
        self.assertEqual(result.returncode, 1)
        self.assertTrue((self.base / "observed-args.json").is_file())
        self.assertEqual(len(report["cases"]), 2)
        self.assertEqual(report["summary"]["counts"]["operationalErrorCases"], 2)
        self.assertEqual(report["summary"]["positive"]["exactMatchRateAllPositiveCases"], 0)
        self.assertEqual(report["summary"]["positive"]["strictCER"]["rate"], 1)
        self.assertIn("missing_or_invalid_reference", report["cases"][0]["errors"])

    def test_reference_is_loaded_only_after_recognition(self):
        case = self.case("late-reference", {"text": "AFTER", "write_reference": True}, None)
        case["referencePath"] = "reference.txt"
        result, report = self.run_eval([case])
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["summary"]["positive"]["exactMatches"], 1)

    def test_negatives_unscored_and_refusals_remain_separate_from_positive_accuracy(self):
        cases = [self.case("invented", {"text": "ROMA"}, "", "negative_no_text"),
                 self.case("blank", {"text": ""}, "", "negative_no_text"),
                 self.case("refused", {"text": "", "refused": True}, "ABCDE"),
                 self.case("unknown", {"text": "UNVERIFIED"}, None, "unscored"),
                 {"id": "reference-only", "imagePath": None, "scoring": {"mode": "unscored"}}]
        result, report = self.run_eval(cases)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(report["summary"]["counts"]["totalCases"], 5)
        self.assertEqual(report["summary"]["counts"]["unscoredCases"], 2)
        self.assertEqual(report["summary"]["counts"]["refusals"], 1)
        self.assertEqual(report["summary"]["negative"]["falsePositiveRateOnCompletedCases"], 0.5)
        self.assertEqual(report["summary"]["positive"]["exactMatchRateAllPositiveCases"], 0)
        self.assertEqual(report["summary"]["positive"]["strictCER"]["rate"], 1)

    def test_timeout_failed_exit_and_bad_json_are_generic_errors_and_remain_in_denominators(self):
        cases = [self.case("timeout", {"text": "ABCDE", "sleep": 4}, "ABCDE"),
                 self.case("exit", {"exit": 7}, "ABCDE"),
                 self.case("json", {"invalid": True}, "ABCDE"),
                 self.case("schema", {"bad_schema": True}, "ABCDE")]
        begin = time.monotonic()
        result, report = self.run_eval(cases, timeout=0.25)
        self.assertLess(time.monotonic() - begin, 8)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["summary"]["counts"]["totalCases"], 4)
        self.assertEqual(report["summary"]["positive"]["labelledCases"], 4)
        self.assertEqual(report["summary"]["positive"]["strictCER"]["rate"], 1)
        self.assertEqual({c["recognitionStatus"] for c in report["cases"]}, {"timeout", "process_exit", "invalid_json", "invalid_output_schema"})
        self.assertNotIn("SECRET", json.dumps(report))

    def test_automatic_acceptance_is_never_inferred_from_success_or_missing_gate(self):
        cases = [self.case("no-gate", {"text": "ABCDE"}, "ABCDE"),
                 self.case("accepted", {"text": "ABCDE", "review": {"automaticAcceptance": True}}, "ABCDE"),
                 self.case("wrong-accepted", {"text": "WRONG", "review": {"automaticAcceptance": True}}, "ABCDE"),
                 self.case("not-accepted", {"text": "ABCDE", "review": {"automaticAcceptance": False}}, "ABCDE")]
        result, report = self.run_eval(cases)
        self.assertEqual(result.returncode, 0)
        gate = report["summary"]["automaticAcceptance"]
        self.assertEqual(gate["declaredAcceptedCases"], 2)
        self.assertEqual(gate["coverageAllCases"], 0.5)
        self.assertEqual(gate["exactAccuracyLabelledAcceptedCases"], 0.5)

    def test_nonfinite_json_is_a_counted_failure_not_a_partial_report(self):
        case = self.case("nonfinite", {"nonfinite": True}, "ABCDE")
        result, report = self.run_eval([case])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["cases"][0]["recognitionStatus"], "invalid_json")
        self.assertEqual(report["summary"]["positive"]["strictCER"]["rate"], 1)

    def test_invalid_case_does_not_silently_disappear(self):
        case = self.case("invalid-mode", {"text": "ABCDE"}, "ABCDE")
        case["scoring"] = {"mode": ["scored"]}
        result, report = self.run_eval([case, None])
        self.assertEqual(result.returncode, 1)
        self.assertEqual(report["summary"]["counts"]["totalCases"], 2)
        self.assertEqual(report["summary"]["counts"]["operationalErrorCases"], 2)
        self.assertFalse((self.base / "observed-args.json").exists())

    def test_existing_output_and_input_reference_targets_are_never_overwritten(self):
        case = self.case("protected", {"text": "ABCDE"}, "ABCDE")
        absent_reference_case = {**case, "referencePath": "future-reference.txt"}
        absent_reference = self.base / "future-reference.txt"
        result, _ = self.run_eval([absent_reference_case], out=absent_reference)
        self.assertEqual(result.returncode, 2)
        self.assertFalse(absent_reference.exists())
        self.assertFalse((self.base / "observed-args.json").exists())
        protected = self.base / "protected.txt"
        before = protected.read_bytes()
        result, _ = self.run_eval([case], out=protected)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(protected.read_bytes(), before)
        self.assertFalse((self.base / "observed-args.json").exists())
        result, _ = self.run_eval([case])
        self.assertEqual(result.returncode, 0)
        saved = (self.base / "report.json").read_bytes()
        result, _ = self.run_eval([case])
        self.assertEqual(result.returncode, 2)
        self.assertEqual((self.base / "report.json").read_bytes(), saved)


if __name__ == "__main__":
    unittest.main()
