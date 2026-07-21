"""
AI Service — task delay prediction API (FastAPI).

Loads the trained classifier pipeline and serves predictions to the backend.
Run:  uvicorn app.main:app --reload --port 8001
"""
from __future__ import annotations

from pathlib import Path

import joblib
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODEL_PATH = Path(__file__).resolve().parents[1] / "model" / "model_rf_classifier.joblib"

app = FastAPI(title="Construction Delay Prediction Service", version="0.1.0")
_model = None


def get_model():
    global _model
    if _model is None:
        if not MODEL_PATH.exists():
            raise HTTPException(503, detail=f"Model file not found at {MODEL_PATH}. Run the data-pipeline first.")
        _model = joblib.load(MODEL_PATH)
    return _model


class TaskFeatures(BaseModel):
    """Plan-time features of a single task (must match training features)."""
    planned_duration_days: float | None = None
    total_float_hr: float | None = None
    free_float_hr: float | None = None
    rel_position: float | None = Field(None, description="0..1 position of task start within project span")
    proj_n_tasks: int | None = None
    proj_span_days: float | None = None
    n_pred: int = 0
    n_succ: int = 0
    upstream_cnt: int = 0
    downstream_cnt: int = 0
    task_type: str | None = None


class Prediction(BaseModel):
    late_probability: float
    is_late: bool
    risk_level: str  # low / medium / high — used by the Digital Twin coloring


def risk_level(p: float) -> str:
    return "high" if p >= 0.66 else "medium" if p >= 0.33 else "low"


@app.get("/health")
def health():
    return {"status": "ok", "model_loaded": MODEL_PATH.exists()}


@app.post("/predict", response_model=Prediction)
def predict(task: TaskFeatures):
    model = get_model()
    X = pd.DataFrame([task.model_dump()])
    proba = float(model.predict_proba(X)[0, 1])
    return Prediction(late_probability=round(proba, 4), is_late=proba >= 0.5, risk_level=risk_level(proba))


@app.post("/predict/batch", response_model=list[Prediction])
def predict_batch(tasks: list[TaskFeatures]):
    model = get_model()
    X = pd.DataFrame([t.model_dump() for t in tasks])
    probas = model.predict_proba(X)[:, 1]
    return [
        Prediction(late_probability=round(float(p), 4), is_late=p >= 0.5, risk_level=risk_level(float(p)))
        for p in probas
    ]
