"""
FastAPI service for the Handheld Words ML models.

Run:   uvicorn service:app --port 8001
Docs:  http://localhost:8001/docs
Demo:  http://localhost:8001/

Endpoints
  GET  /health           model status and test metrics
  POST /predict          {"text": ...}  -> date and region prediction
  POST /check            {"text", "not_before", "not_after", "region"} -> prediction + flags
  POST /check/batch      {"records": [...]} -> flags for many records

The Express backend can call /check when a record is created or edited
and store the flags for review.
"""
import json
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from predictor import Predictor

HERE = Path(__file__).parent
app = FastAPI(title="Handheld Words ML", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

predictors = {"deep": Predictor("deep"), "baseline": Predictor("baseline")}


class TextIn(BaseModel):
    text: str = Field(..., min_length=1, description="Inscription text (Leiden brackets are fine)")
    model: str = "deep"


class RecordIn(TextIn):
    id: Optional[str] = None
    not_before: Optional[int] = Field(None, description="Listed earliest year; BCE is negative")
    not_after: Optional[int] = Field(None, description="Listed latest year; BCE is negative")
    region: Optional[str] = None


class BatchIn(BaseModel):
    records: List[RecordIn]


def get(model):
    if model not in predictors:
        raise HTTPException(400, f"model must be one of {list(predictors)}")
    return predictors[model]


@app.get("/health")
def health():
    reports = {}
    for name in ("baseline", "deep", "flagging", "comparison"):
        f = HERE / "reports" / (f"{name}.json" if name == "comparison" else f"{name}_metrics.json")
        if f.exists():
            reports[name] = json.loads(f.read_text())
    return {"status": "ok", "active_model": predictors["deep"].model_name,
            "regions": predictors["deep"].regions, "metrics": reports}


@app.post("/predict")
def predict(body: TextIn):
    return get(body.model).predict(body.text)


@app.post("/check")
def check(body: RecordIn):
    out = get(body.model).check(body.text, body.not_before, body.not_after, body.region)
    out["id"] = body.id
    return out


@app.post("/check/batch")
def check_batch(body: BatchIn):
    results = []
    for r in body.records:
        out = get(r.model).check(r.text, r.not_before, r.not_after, r.region)
        results.append({"id": r.id, "flagged": out["flagged"], "flags": out["flags"],
                        "date": out["date"], "region": out["region"]})
    return {"n": len(results), "n_flagged": sum(r["flagged"] for r in results), "results": results}


@app.get("/")
def demo_page():
    return FileResponse(HERE / "demo" / "index.html")


@app.get("/examples")
def examples():
    f = HERE / "demo" / "examples.json"
    return json.loads(f.read_text()) if f.exists() else []
