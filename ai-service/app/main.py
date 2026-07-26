"""
AI Service — task delay prediction API (FastAPI).

PRED-1  /predict, /predict/batch — probability, label, risk level, estimated delay days
PRED-2  /health                  — model availability + version
PRED-3  /explain                 — SHAP top-k signed contributions in domain language
PRED-4  model registry           — loads newest ai-service/model/registry/<vN>/
PRED-5  graceful degradation     — 503 with actionable message when no model exists

Run:  uvicorn app.main:app --reload --port 8001
"""
from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

BASE = Path(__file__).resolve().parents[1]
REGISTRY = Path(os.environ.get("MODEL_REGISTRY", BASE / "model" / "registry"))
LEGACY_MODEL = BASE / "model" / "model_rf_classifier.joblib"

app = FastAPI(title="Construction Delay Prediction Service", version="0.2.0")

# ---------------------------------------------------------------- registry

class Registry:
    """PRED-4: loads the newest registry version (classifier + regressor + meta)."""

    def __init__(self):
        self.version = None
        self.meta = {}
        self.clf = None
        self.reg = None
        self._load()

    def _load(self):
        if REGISTRY.exists():
            versions = sorted((p for p in REGISTRY.glob("v*") if p.name[1:].isdigit()),
                              key=lambda p: int(p.name[1:]))
            if versions:
                vdir = versions[-1]
                self.clf = joblib.load(vdir / "classifier.joblib")
                reg_path = vdir / "regressor.joblib"
                self.reg = joblib.load(reg_path) if reg_path.exists() else None
                meta_path = vdir / "meta.json"
                self.meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
                self.version = self.meta.get("version", vdir.name)
                return
        if LEGACY_MODEL.exists():  # backwards compatibility with the pre-registry artifact
            self.clf = joblib.load(LEGACY_MODEL)
            self.version = "legacy"

    @property
    def ready(self) -> bool:
        return self.clf is not None


_registry: Registry | None = None


def get_registry() -> Registry:
    global _registry
    if _registry is None:
        _registry = Registry()
    if not _registry.ready:
        raise HTTPException(503, detail=(
            "No model available: the registry is empty and no legacy artifact exists. "
            "Run data-pipeline/src/train_compare.py to train and register a model."))
    return _registry


# ---------------------------------------------------------------- schemas

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
    risk_level: str                              # low / medium / high — Twin coloring
    estimated_delay_days: float | None = None    # champion regressor (None if unavailable)
    model_version: str


class Contribution(BaseModel):
    feature: str
    label_en: str
    label_he: str
    value: float | str | None
    contribution: float                          # signed SHAP value


class Explanation(BaseModel):
    prediction: Prediction
    top_contributions: list[Contribution]
    note: str


# ------------------------------------------- domain language (PRED-3 / NFR-USE-1)

DOMAIN_LABELS = {
    "planned_duration_days": ("Planned duration (days)", "משך מתוכנן (ימים)"),
    "total_float_hr": ("Total float (hours)", "מרווח כולל (שעות)"),
    "free_float_hr": ("Free float (hours)", "מרווח חופשי (שעות)"),
    "rel_position": ("Position within project timeline", "מיקום בציר הזמן של הפרויקט"),
    "proj_n_tasks": ("Project size (number of tasks)", "גודל הפרויקט (מספר משימות)"),
    "proj_span_days": ("Project span (days)", "משך הפרויקט (ימים)"),
    "n_pred": ("Direct predecessors", "משימות קדם ישירות"),
    "n_succ": ("Direct successors", "משימות תלויות ישירות"),
    "upstream_cnt": ("Tasks upstream in the chain", "משימות במעלה השרשרת"),
    "downstream_cnt": ("Tasks depending on this one downstream", "משימות במורד השרשרת"),
    "task_type": ("Task type", "סוג המשימה"),
}


def base_feature(transformed_name: str) -> str:
    """Map a transformed name (num__x / cat__task_type_TT_Task) to its base feature."""
    name = transformed_name.split("__", 1)[-1]
    for base in DOMAIN_LABELS:
        if name == base or name.startswith(base + "_"):
            return base
    return name


def risk_level(p: float) -> str:
    return "high" if p >= 0.66 else "medium" if p >= 0.33 else "low"


def _predict_core(reg: Registry, X: pd.DataFrame) -> list[Prediction]:
    probas = reg.clf.predict_proba(X)[:, 1]
    delays = reg.reg.predict(X) if reg.reg is not None else [None] * len(X)
    return [
        Prediction(
            late_probability=round(float(p), 4),
            is_late=bool(p >= 0.5),
            risk_level=risk_level(float(p)),
            estimated_delay_days=(round(float(d), 1) if d is not None else None),
            model_version=reg.version,
        )
        for p, d in zip(probas, delays)
    ]


@lru_cache(maxsize=1)
def _explainer():
    """SHAP explainer over the champion classifier's final estimator."""
    import shap
    reg = get_registry()
    prep = reg.clf.named_steps["prep"]
    model = reg.clf.named_steps["model"]
    names = list(prep.get_feature_names_out())
    if model.__class__.__name__ in {"RandomForestClassifier", "XGBClassifier",
                                    "GradientBoostingClassifier"}:
        return shap.TreeExplainer(model), prep, names
    raise HTTPException(501, detail=(
        f"SHAP explanation not supported for champion type {model.__class__.__name__}; "
        "retrain with a tree-based champion or extend the explainer."))


# ---------------------------------------------------------------- endpoints

@app.get("/health")
def health():
    global _registry
    if _registry is None:
        _registry = Registry()
    return {"status": "ok", "model_loaded": _registry.ready,
            "model_version": _registry.version,
            "champion": _registry.meta.get("champion_classifier")}


@app.post("/predict", response_model=Prediction)
def predict(task: TaskFeatures):
    reg = get_registry()
    return _predict_core(reg, pd.DataFrame([task.model_dump()]))[0]


@app.post("/predict/batch", response_model=list[Prediction])
def predict_batch(tasks: list[TaskFeatures]):
    reg = get_registry()
    return _predict_core(reg, pd.DataFrame([t.model_dump() for t in tasks]))


@app.post("/explain", response_model=Explanation)
def explain(task: TaskFeatures, top_k: int = 5):
    """PRED-3: prediction + top-k signed SHAP contributions, aggregated per base feature."""
    reg = get_registry()
    X = pd.DataFrame([task.model_dump()])
    prediction = _predict_core(reg, X)[0]

    explainer, prep, names = _explainer()
    Xt = prep.transform(X)
    Xt = Xt.toarray() if hasattr(Xt, "toarray") else np.asarray(Xt)
    sv = explainer.shap_values(Xt)
    # normalize shap output shape: list per class / (n, f, c) / (n, f)
    if isinstance(sv, list):
        sv = sv[1] if len(sv) > 1 else sv[0]
    sv = np.asarray(sv)
    if sv.ndim == 3:
        sv = sv[:, :, 1]
    row = sv[0]

    agg: dict[str, float] = {}
    for name, val in zip(names, row):
        b = base_feature(name)
        agg[b] = agg.get(b, 0.0) + float(val)

    raw = task.model_dump()
    top = sorted(agg.items(), key=lambda kv: abs(kv[1]), reverse=True)[:top_k]
    contributions = [
        Contribution(
            feature=f,
            label_en=DOMAIN_LABELS.get(f, (f, f))[0],
            label_he=DOMAIN_LABELS.get(f, (f, f))[1],
            value=raw.get(f),
            contribution=round(c, 4),
        ) for f, c in top
    ]
    return Explanation(
        prediction=prediction,
        top_contributions=contributions,
        note="Positive contribution pushes toward delay; negative pushes toward on-time.",
    )
