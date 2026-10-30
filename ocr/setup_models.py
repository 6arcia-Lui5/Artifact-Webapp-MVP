"""Explicit model installation; no model downloads occur in HTTP handlers."""
import argparse
import hashlib
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.10.0/onnx/PP-OCRv5/"
MODELS = {
    "ch_PP-OCRv5_det_mobile.onnx": ("det", "4d97c44a20d30a81aad087d6a396b08f786c4635742afc391f6621f5c6ae78ae"),
    "latin_PP-OCRv5_rec_mobile.onnx": ("rec", "b20bd37c168a570f583afbc8cd7925603890efbcdc000a59e22c269d160b5f5a"),
    "el_PP-OCRv5_rec_mobile.onnx": ("rec", "b4368bccd557123c702b7549fee6cd1e94b581337d1c9b65310f109131542b7f"),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=ROOT / ".local/ocr/models")
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    for name, (kind, expected) in MODELS.items():
        target = args.directory / name
        if target.exists():
            if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
                raise RuntimeError(f"Existing {name} has a different checksum. Choose another model directory.")
            print(f"Verified {name}")
            continue
        temporary = target.with_suffix(".download")
        if temporary.exists():
            raise RuntimeError(f"An interrupted download exists at {temporary}. Remove it or choose another directory.")
        try:
            with urllib.request.urlopen(BASE + kind + "/" + name, timeout=45) as response, temporary.open("xb") as output:
                digest, count = hashlib.sha256(), 0
                while chunk := response.read(1024 * 1024):
                    count += len(chunk)
                    if count > 16 * 1024 * 1024:
                        raise RuntimeError("The model exceeds its 16 MiB download budget.")
                    digest.update(chunk)
                    output.write(chunk)
            if digest.hexdigest() != expected:
                raise RuntimeError(f"Checksum mismatch for {name}")
            temporary.replace(target)
            print(f"Installed and verified {name}")
        except Exception:
            temporary.unlink(missing_ok=True)
            raise


if __name__ == "__main__":
    main()
