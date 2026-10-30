"""Evaluate photo transcription without providing references to the recognizer.

Example: --manifest cases.json --command-json '["node", "scripts/transcribe-photo.cjs"]'
         --out results.json --timeout-seconds 180

Paths in cases are relative to the manifest, unless absolute. Each case has id,
imagePath, language, optional referencePath and scoring.mode. Supported modes:
scored, development_normalized_cer, negative_no_text, unscored. With no mode,
a referencePath implies scored; otherwise the case is unscored.

Strict text is NFC, CRLF/CR normalized to LF, and outer whitespace stripped on
both sides. Internal whitespace, line breaks, punctuation and case remain.
Normalized CER additionally uppercases Unicode and removes Unicode whitespace;
ordinary uppercase maps sigma/final-sigma to Sigma, but no extra glyph/spelling
correction maps lunate sigma, Latin C, U or V. Rough letters/numerals-only CER
additionally excludes everything outside Unicode letter/number categories.
WER uses strict text split on whitespace. These metrics do not assess meaning.

Exit 0: report completed without operational errors (wrong text/refusals can
still occur). Exit 1: report saved with case execution/reference errors.
Exit 2: invalid arguments/manifest/output, with no report written.
"""
import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import unicodedata

MAX_STDOUT_BYTES = 2 * 1024 * 1024
MODES = {"scored", "development_normalized_cer", "negative_no_text", "unscored"}


def strict_text(text):
    return unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n")).strip()


def normalized_text(text):
    return "".join(char for char in strict_text(text).upper() if not char.isspace())


def rough_text(text):
    return "".join(char for char in normalized_text(text) if unicodedata.category(char)[0] in "LN")


def edit_distance(reference, actual):
    # Equal prefixes/suffixes avoid quadratic work on mostly correct long text.
    start = 0
    while start < min(len(reference), len(actual)) and reference[start] == actual[start]:
        start += 1
    reference, actual = reference[start:], actual[start:]
    end = 0
    while end < min(len(reference), len(actual)) and reference[-end - 1] == actual[-end - 1]:
        end += 1
    if end:
        reference, actual = reference[:-end], actual[:-end]
    if len(reference) > len(actual):
        reference, actual = actual, reference
    previous = list(range(len(reference) + 1))
    for row, char in enumerate(actual, 1):
        current = [row]
        for column, other in enumerate(reference, 1):
            current.append(min(current[-1] + 1, previous[column] + 1, previous[column - 1] + (char != other)))
        previous = current
    return previous[-1]


def rate(numerator, denominator):
    return numerator / denominator if denominator else None


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as source:
        while block := source.read(1024 * 1024):
            value.update(block)
    return value.hexdigest()


def resolve_path(value, base):
    if not isinstance(value, str) or not value:
        return None
    try:
        path = Path(value)
        return (path if path.is_absolute() else base / path).resolve()
    except (OSError, ValueError):
        return None


def stop_process(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        try:
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        except (OSError, subprocess.TimeoutExpired):
            process.kill()
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def recognize(command, image, language, timeout):
    # No reference, manifest, expected text or reference-derived hints are sent.
    args = command + ["--input", str(image), "--language", language]
    options = {"stdout": subprocess.PIPE, "stderr": subprocess.DEVNULL, "stdin": subprocess.DEVNULL}
    if os.name == "nt":
        options["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    else:
        options["start_new_session"] = True
    begin = time.perf_counter()
    process = None
    try:
        process = subprocess.Popen(args, **options)
        try:
            stdout, _ = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            stop_process(process)
            return {"status": "timeout", "returnCode": None, "rawOutput": None, "elapsedSeconds": time.perf_counter() - begin}
        if process.returncode != 0:
            status, output = "process_exit", None
        elif len(stdout) > MAX_STDOUT_BYTES:
            status, output = "output_too_large", None
        else:
            try:
                def reject_nonfinite(_value):
                    raise ValueError("Nonfinite JSON number")
                output = json.loads(stdout.decode("utf-8-sig"), parse_constant=reject_nonfinite)
                if not isinstance(output, dict) or not isinstance(output.get("text"), str):
                    status, output = "invalid_output_schema", None
                else:
                    status = "ok"
            except (UnicodeError, ValueError, RecursionError):
                status, output = "invalid_json", None
        return {"status": status, "returnCode": process.returncode, "rawOutput": output,
                "elapsedSeconds": time.perf_counter() - begin}
    except (OSError, ValueError):
        return {"status": "spawn_error", "returnCode": None, "rawOutput": None,
                "elapsedSeconds": time.perf_counter() - begin}
    except BaseException:
        if process is not None:
            stop_process(process)
        raise
    finally:
        if process is not None:
            if process.stdout is not None:
                process.stdout.close()


def text_metrics(reference, actual):
    ref, got = strict_text(reference), strict_text(actual)
    result = {"exactMatch": ref == got, "referenceEmpty": not ref, "nonemptyOutput": bool(got)}
    for name, left, right in [
        ("strictCER", ref, got),
        ("normalizedCER", normalized_text(ref), normalized_text(got)),
        ("roughLettersNumeralsCER", rough_text(ref), rough_text(got)),
        ("WER", ref.split(), got.split()),
    ]:
        edits = edit_distance(left, right)
        result[name] = {"edits": edits, "referenceUnits": len(left), "rate": rate(edits, len(left))}
    return result


def evaluate_case(case, index, base, command, timeout):
    result = {"caseIndex": index, "id": case.get("id", str(index)) if isinstance(case, dict) else str(index),
              "errors": [], "metrics": None, "automaticAcceptanceDeclared": False, "refused": False}
    if not isinstance(case, dict):
        result.update({"recognitionStatus": "invalid_case", "evaluationStatus": "invalid_case", "errors": ["invalid_case"]})
        return result
    scoring = case.get("scoring")
    mode = scoring.get("mode") if isinstance(scoring, dict) else case.get("scoringMode")
    if mode is None:
        mode = "scored" if case.get("referencePath") else "unscored"
    result.update({"mode": mode, "sourceUrl": case.get("sourceUrl"), "language": case.get("language", "lat")})
    image = resolve_path(case.get("imagePath"), base)
    reference_path = resolve_path(case.get("referencePath"), base)
    result.update({"imagePath": str(image) if image else None, "referencePath": str(reference_path) if reference_path else None,
                   "imageSha256": None, "referenceSha256": None, "rawOutput": None, "elapsedSeconds": 0.0})
    if not isinstance(mode, str) or mode not in MODES or not isinstance(result["language"], str) or not result["language"]:
        result.update({"recognitionStatus": "invalid_case", "evaluationStatus": "invalid_case", "errors": ["invalid_case"]})
        return result
    if image is None and mode == "unscored":
        result["recognitionStatus"] = "not_run_no_image"
    elif image is None or not image.is_file():
        result["recognitionStatus"] = "missing_image"
        result["errors"].append("missing_image")
    else:
        try:
            result["imageSha256"] = digest(image)
            observed = recognize(command, image, result["language"], timeout)
            result.update({"recognitionStatus": observed.pop("status"), **observed})
            if result["recognitionStatus"] != "ok":
                result["errors"].append(result["recognitionStatus"])
        except OSError:
            result["recognitionStatus"] = "image_read_error"
            result["errors"].append("image_read_error")
    output = result["rawOutput"] or {}
    review = output.get("review") if isinstance(output.get("review"), dict) else {}
    result["automaticAcceptanceDeclared"] = review.get("automaticAcceptance") is True
    result["refused"] = output.get("refused") is True or output.get("status") == "refused" or review.get("status") == "refused"

    # Reference access deliberately happens only AFTER recognition/its failure.
    reference = None
    if reference_path is not None:
        try:
            raw = reference_path.read_bytes()
            reference = raw.decode("utf-8-sig")
            result["referenceSha256"] = hashlib.sha256(raw).hexdigest()
        except (OSError, UnicodeError):
            if mode != "unscored":
                result["errors"].append("missing_or_invalid_reference")
    elif mode == "negative_no_text":
        reference = ""
    elif mode != "unscored":
        result["errors"].append("missing_or_invalid_reference")
    if mode == "unscored":
        result["evaluationStatus"] = "unscored"
    elif reference is None:
        result["evaluationStatus"] = "missing_reference"
    elif mode == "negative_no_text" and strict_text(reference):
        result["evaluationStatus"] = "invalid_negative_reference"
        result["errors"].append("invalid_negative_reference")
    else:
        result["evaluationStatus"] = "negative" if not strict_text(reference) else "scored"
        # Failures remain in positive denominators, scored as omitted text.
        result["metrics"] = text_metrics(reference, output.get("text", ""))
        if result["recognitionStatus"] != "ok":
            result["metrics"]["exactMatch"] = False
    return result


def summarize(results):
    positive = [r for r in results if r["metrics"] is not None and not r["metrics"]["referenceEmpty"]]
    negative = [r for r in results if r["metrics"] is not None and r["metrics"]["referenceEmpty"]]
    accepted = [r for r in results if r["automaticAcceptanceDeclared"]]
    accepted_labelled = [r for r in accepted if r["metrics"] is not None]
    completed_negative = [r for r in negative if r["recognitionStatus"] == "ok"]
    false_positives = sum(r["metrics"]["nonemptyOutput"] for r in completed_negative)
    exact_positive = sum(r["metrics"]["exactMatch"] for r in positive)
    summary = {
        "counts": {"totalCases": len(results), "imageCases": sum(bool(r.get("imagePath")) for r in results),
                   "recognitionSucceeded": sum(r["recognitionStatus"] == "ok" for r in results),
                   "notRunNoImage": sum(r["recognitionStatus"] == "not_run_no_image" for r in results),
                   "operationalErrorCases": sum(bool(r["errors"]) for r in results),
                   "refusals": sum(r["refused"] for r in results),
                   "unscoredCases": sum(r.get("evaluationStatus") == "unscored" for r in results),
                   "emptySuccessfulOutputs": sum(r["recognitionStatus"] == "ok" and not strict_text(r["rawOutput"]["text"]) for r in results)},
        "positive": {"labelledCases": len(positive), "exactMatches": exact_positive,
                     "exactMatchRateAllPositiveCases": rate(exact_positive, len(positive)),
                     "recognitionFailures": sum(r["recognitionStatus"] != "ok" for r in positive)},
        "negative": {"labelledCases": len(negative), "completedCases": len(completed_negative),
                     "falsePositiveTextOutputs": false_positives,
                     "falsePositiveRateOnCompletedCases": rate(false_positives, len(completed_negative)),
                     "correctEmptyOutputs": len(completed_negative) - false_positives,
                     "recognitionFailures": len(negative) - len(completed_negative)},
        "automaticAcceptance": {
            "declaredAcceptedCases": len(accepted), "coverageAllCases": rate(len(accepted), len(results)),
            "coverageImageCases": rate(len(accepted), sum(bool(r.get("imagePath")) for r in results)),
            "labelledAcceptedCases": len(accepted_labelled),
            "unassessableAcceptedCases": len(accepted) - len(accepted_labelled),
            "exactCorrectLabelledAcceptedCases": sum(r["metrics"]["exactMatch"] for r in accepted_labelled),
            "exactAccuracyLabelledAcceptedCases": rate(sum(r["metrics"]["exactMatch"] for r in accepted_labelled), len(accepted_labelled)),
            "interpretation": "Observed exact-text accuracy on this manifest only; missing gates are not automatic acceptance. This is not a reliability guarantee.",
        },
        "errorCounts": dict(Counter(error for r in results for error in r["errors"])),
    }
    for name in ["strictCER", "normalizedCER", "roughLettersNumeralsCER", "WER"]:
        edits = sum(r["metrics"][name]["edits"] for r in positive)
        units = sum(r["metrics"][name]["referenceUnits"] for r in positive)
        summary["positive"][name] = {"edits": edits, "referenceUnits": units, "rate": rate(edits, units)}
    return summary


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--command-json", required=True, help="JSON array: executable and fixed arguments; no shell is used")
    ap.add_argument("--out", "--output", dest="out", type=Path, required=True)
    ap.add_argument("--timeout-seconds", "--timeout", dest="timeout", type=float, default=180)
    args = ap.parse_args(argv)
    if not 0 < args.timeout <= 3600:
        ap.error("timeout must be greater than zero and at most 3600 seconds")
    try:
        command = json.loads(args.command_json)
        if not isinstance(command, list) or not command or any(not isinstance(item, str) or not item for item in command):
            raise ValueError()
    except (json.JSONDecodeError, ValueError):
        ap.error("command-json must be a nonempty JSON array of nonempty strings")
    try:
        manifest_bytes = args.manifest.read_bytes()
        manifest = json.loads(manifest_bytes.decode("utf-8-sig"))
        cases = manifest["cases"]
        if not isinstance(cases, list) or not cases:
            raise ValueError()
    except (OSError, UnicodeError, ValueError, KeyError, TypeError):
        ap.error("manifest must be readable UTF-8 JSON with a nonempty cases list")
    base = args.manifest.resolve().parent
    protected = {args.manifest.resolve()}
    for case in cases:
        if isinstance(case, dict):
            protected.update(path for key in ["imagePath", "referencePath"] if (path := resolve_path(case.get(key), base)) is not None)
    if args.out.exists() or args.out.is_symlink() or args.out.resolve() in protected:
        ap.error("choose a new output file separate from the manifest, images and references")
    results = [evaluate_case(case, index, base, command, args.timeout) for index, case in enumerate(cases, 1)]
    summary = summarize(results)
    report = {
        "schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
        "scope": manifest.get("scope", manifest.get("kind", "Manifest-specific evaluation; no independent-test status asserted.")),
        "manifestPath": str(args.manifest.resolve()), "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
        "evaluatorSha256": digest(Path(__file__)),
        "recognizerCommandSha256": hashlib.sha256(args.command_json.encode("utf-8")).hexdigest(),
        "policy": {"references": "Loaded only after recognition; never passed in child arguments/stdin.",
                   "strictText": "NFC, CRLF/CR to LF, strip outer whitespace; preserve internal whitespace, line breaks, case and punctuation.",
                   "normalizedCER": "Strict text, Unicode uppercase, remove Unicode whitespace; preserve punctuation/diacritics. Uppercase inherently folds sigma/final-sigma; no C/lunate-sigma/Sigma or U/V correction.",
                   "roughLettersNumeralsCER": "Normalized text keeping only Unicode letters/numerals; rough comparison only, not exact or semantic accuracy.",
                   "WER": "Whitespace-separated tokens from strict text; case/punctuation retained.",
                   "failures": "Every case retained. Labelled-positive recognition failures are omitted text, counted as deletions and nonexact. Negative failures are not correct empty outputs.",
                   "errors": "Generic codes only; child stderr and invalid/nonzero-exit stdout are not saved."},
        "summary": summary, "cases": results,
    }
    try:
        serialized = (json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
        args.out.parent.mkdir(parents=True, exist_ok=True)
        with args.out.open("xb") as target:
            target.write(serialized)
    except (OSError, ValueError):
        ap.error("could not create the new output report")
    print(json.dumps({"report": str(args.out.resolve()), "totalCases": len(results),
                      "operationalErrorCases": summary["counts"]["operationalErrorCases"]}))
    return 1 if summary["counts"]["operationalErrorCases"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
