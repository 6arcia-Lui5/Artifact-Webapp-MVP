"""Bounded CPU OCR worker. Import heavy inference libraries only in the child."""
from pathlib import Path
import math

DETECTOR = "ch_PP-OCRv5_det_mobile.onnx"
RECOGNIZERS = {"lat": "latin_PP-OCRv5_rec_mobile.onnx", "eng": "latin_PP-OCRv5_rec_mobile.onnx", "grc": "el_PP-OCRv5_rec_mobile.onnx"}
LANGUAGES = {"lat": "latin", "eng": "latin", "grc": "el"}
MAX_LINES = 256
MAX_TEXT = 10000


def group_lines(items):
    """Estimate horizontal reading order; keep disconnected letters together."""
    groups = []
    for item in sorted(items, key=lambda value: (value["cy"], value["left"])):
        matches = [group for group in groups if abs(sum(x["cy"] for x in group) / len(group) - item["cy"]) <=
                   0.35 * min(sum(x["height"] for x in group) / len(group), item["height"])]
        if matches:
            matches[-1].append(item)
        else:
            groups.append([item])
    return [sorted(group, key=lambda value: value["left"]) for group in groups]


def recognize(photo_bytes, language, model_dir):
    import io
    import importlib.metadata
    import numpy as np
    from PIL import Image
    from rapidocr import RapidOCR, OCRVersion, ModelType, EngineType

    directory = Path(model_dir)
    paths = [directory / DETECTOR, directory / RECOGNIZERS[language]]
    if not all(path.is_file() for path in paths):
        raise RuntimeError("Required OCR model files are missing. Run the model setup command.")
    engine = RapidOCR(params={
        "Global.model_root_dir": str(directory), "Global.use_cls": False, "Global.log_level": "critical",
        "EngineConfig.onnxruntime.intra_op_num_threads": 2, "EngineConfig.onnxruntime.inter_op_num_threads": 1,
        "Det.engine_type": EngineType.ONNXRUNTIME, "Det.model_type": ModelType.MOBILE,
        "Det.ocr_version": OCRVersion.PPOCRV5, "Det.model_path": str(paths[0]),
        "Rec.engine_type": EngineType.ONNXRUNTIME, "Rec.lang_type": LANGUAGES[language],
        "Rec.model_type": ModelType.MOBILE, "Rec.ocr_version": OCRVersion.PPOCRV5,
        "Rec.model_path": str(paths[1]),
    })
    image = Image.open(io.BytesIO(photo_bytes)).convert("RGB")
    detected = engine(np.asarray(image))
    texts, boxes, scores = detected.txts or [], detected.boxes, detected.scores or []
    if len(texts) > MAX_LINES:
        raise ValueError("Too many text regions. Choose a smaller inscription crop.")
    items = []
    for text, box, score in zip(texts, [] if boxes is None else boxes, scores):
        if not str(text).strip():
            continue
        points = [[float(x), float(y)] for x, y in box]
        if len(points) != 4 or not all(math.isfinite(v) for point in points for v in point):
            continue
        xs, ys = zip(*points)
        confidence = float(score) if math.isfinite(float(score)) else 0.0
        items.append({"text": str(text), "score": confidence, "left": min(xs), "right": max(xs),
                      "top": min(ys), "bottom": max(ys), "cy": sum(ys) / len(ys),
                      "height": max(1, max(ys) - min(ys))})
    groups = group_lines(items)
    centers = [sum(x["cy"] for x in group) / len(group) for group in groups]
    lines = []
    for index, group in enumerate(groups):
        height = sum(x["height"] for x in group) / len(group)
        y0 = max(0, round((centers[index - 1] + centers[index]) / 2 if index else centers[index] - height / 2))
        y1 = min(image.height, round((centers[index] + centers[index + 1]) / 2 if index + 1 < len(groups) else centers[index] + height / 2))
        x0 = max(0, math.floor(min(x["left"] for x in group) - 20))
        x1 = min(image.width, math.ceil(max(x["right"] for x in group) + 20))
        direct = " ".join(x["text"] for x in group)
        direct_score = sum(x["score"] for x in group) / len(group)
        reread, score = direct, direct_score
        if x1 > x0 and y1 > y0:
            result = engine(np.asarray(image.crop((x0, y0, x1, y1))), use_det=False, use_cls=False)
            if result.txts and any(str(text).strip() for text in result.txts):
                reread = " ".join(str(text) for text in result.txts)
                score = sum(float(value) if math.isfinite(float(value)) else 0.0 for value in result.scores) / len(result.scores)
        alternatives = [direct] if direct != reread else []
        lines.append({"text": reread, "box": [[x0, y0], [x1, y0], [x1, y1], [x0, y1]],
                      "score": round(max(0.0, min(1.0, score)), 5), "alternatives": alternatives})
    text = "\n".join(line["text"] for line in lines)
    alternate_length = sum(len(alternative) for line in lines for alternative in line["alternatives"])
    if len(text) > MAX_TEXT or len(text) + alternate_length > 2 * MAX_TEXT:
        raise ValueError("Too much text was detected. Choose a smaller inscription crop.")
    return {"text": text, "status": "draft" if text.strip() else "no_text", "lines": lines,
            "image": {"width": image.width, "height": image.height},
            "engine": {"name": "PP-OCRv5 mobile", "implementation": "RapidOCR ONNX CPU",
                       "version": importlib.metadata.version("rapidocr")},
            "notes": ["Recognition scores are internal model scores, not transcription accuracy.",
                      "Reading order is estimated from image geometry; curved or damaged lettering needs review."]}


def recognize_worker(connection, photo_bytes, language, model_dir):
    try:
        connection.send({"result": recognize(photo_bytes, language, model_dir)})
    except ValueError as error:
        connection.send({"error": str(error), "status": 422})
    except Exception:
        connection.send({"error": "OCR processing failed. Try a clearer or smaller inscription crop.", "status": 502})
    finally:
        connection.close()
