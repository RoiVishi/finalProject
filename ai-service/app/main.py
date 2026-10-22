"""
AI Service — task delay prediction API (FastAPI).

PRED-1  /predict, /predict/batch — probability, label, risk level, estimated delay days
PRED-2  /health                  — model availability + version
PRED-3  /explain, /explain/batch — SHAP top-k signed contributions in domain language,
                                   in calibrated-probability units (KAN-130)
        /explain/project         — the same from raw platform entities, for the backend (KAN-40)
PRED-4  model registry           — loads newest ai-service/model/registry/<vN>/
PRED-5  graceful degradation     — 503 with actionable message when no model exists
NFR-SEC-5 service token          — every endpoint except /health requires X-Internal-Token

Run:  uvicorn app.main:app --reload --port 8001
"""
from __future__ import annotations

import hmac
import json
import os
from functools import lru_cache
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .adapter import ProjectGraphPayload, compute_features

BASE = Path(__file__).resolve().parents[1]
REGISTRY = Path(os.environ.get("MODEL_REGISTRY", BASE / "model" / "registry"))
LEGACY_MODEL = BASE / "model" / "model_rf_classifier.joblib"
SCHEMA_PATH = Path(os.environ.get("FEATURE_SCHEMA", BASE.parent / "feature_schema.json"))


def load_running_schema() -> dict | None:
    """PRED-8: the feature schema this service instance runs with."""
    if SCHEMA_PATH.exists():
        return json.loads(SCHEMA_PATH.read_text())
    return None


def schema_mismatch(meta: dict, schema: dict | None) -> str | None:
    """Return a refusal reason if the artifact's schema version differs from the running schema."""
    if schema is None:
        return None  # no running schema file — nothing to enforce against (dev fallback)
    artifact_v = meta.get("feature_schema_version")
    running_v = schema.get("feature_schema_version")
    if artifact_v is not None and artifact_v != running_v:
        return (f"artifact feature schema {artifact_v} != running schema {running_v}; "
                "retrain (data-pipeline/src/train_compare.py) or update feature_schema.json")
    return None

# KAN-103: numeric sanity ranges from the running schema (empty dict → checks disabled)
_schema_for_ranges = load_running_schema() or {}
SCHEMA_RANGES: dict[str, tuple[float, float]] = {
    f["name"]: (f["range"][0], f["range"][1])
    for f in _schema_for_ranges.get("features", [])
    if f.get("role") == "numeric" and isinstance(f.get("range"), list) and len(f["range"]) == 2
}

app = FastAPI(title="Construction Delay Prediction Service", version="0.3.1")

# ---------------------------------------------------------------- NFR-SEC-5

# The AI service answers the backend only. The backend sends a shared secret in
# this header; anything else gets 401. /health stays open because the Docker
# healthcheck (PRED-2) calls it from inside the container without a token, and
# it exposes no prediction data.
AUTH_HEADER = "X-Internal-Token"
OPEN_PATHS = frozenset({"/health"})
MIN_TOKEN_LEN = 32


def service_token() -> str:
    """Read the shared secret; refuse to start without a real one (no default)."""
    token = os.environ.get("AI_SERVICE_TOKEN", "")
    if len(token) < MIN_TOKEN_LEN:
        raise RuntimeError(
            "AI_SERVICE_TOKEN must be a random value of at least 32 characters "
            "(openssl rand -hex 32), shared with the backend. NFR-SEC-5."
        )
    return token


SERVICE_TOKEN = service_token()


@app.middleware("http")
async def require_service_token(request: Request, call_next):
    if request.url.path not in OPEN_PATHS:
        sent = request.headers.get(AUTH_HEADER, "")
        # constant-time comparison, so the token cannot be guessed byte by byte
        if not hmac.compare_digest(sent.encode(), SERVICE_TOKEN.encode()):
            return JSONResponse(status_code=401, content={"detail": "missing or invalid service token"})
    return await call_next(request)

# ---------------------------------------------------------------- registry

class Registry:
    """PRED-4: loads the newest registry version (classifier + regressor + meta)."""

    def __init__(self):
        self.version = None
        self.meta = {}
        self.clf = None
        self.reg = None
        self.refusal = None      # PRED-8: set when an artifact was refused on schema mismatch
        self.dir = None          # registry directory of the served version (global_shap.json lives there)
        self._load()

    def _load(self):
        # PRED-5: ANY load failure (missing/corrupt artifact, bad JSON) must flow into
        # the refusal path (503 with a reason), never a raw 500 — including on /health.
        try:
            self._load_inner()
        except Exception as e:  # noqa: BLE001 — deliberate catch-all into graceful degradation
            self.clf = None
            self.refusal = (f"registry load failed: {type(e).__name__}: {e} — "
                            "re-run the training pipeline or remove the broken version dir")

    def _load_inner(self):
        schema = load_running_schema()
        if REGISTRY.exists():
            versions = sorted((p for p in REGISTRY.glob("v*") if p.name[1:].isdigit()),
                              key=lambda p: int(p.name[1:]))
            if versions:
                vdir = versions[-1]
                meta_path = vdir / "meta.json"
                meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
                reason = schema_mismatch(meta, schema)
                if reason:  # PRED-8: refuse at load time, not per request
                    self.refusal = f"registry {vdir.name} refused: {reason}"
                    return
                self.meta = meta
                self.clf = joblib.load(vdir / "classifier.joblib")
                reg_path = vdir / "regressor.joblib"
                self.reg = joblib.load(reg_path) if reg_path.exists() else None
                self.version = self.meta.get("version", vdir.name)
                self.dir = vdir
                return
        if LEGACY_MODEL.exists():  # backwards compatibility with the pre-registry artifact
            self.clf = joblib.load(LEGACY_MODEL)
            self.version = "legacy"

    @property
    def schema_version(self) -> str | None:
        return self.meta.get("feature_schema_version")

    @property
    def ready(self) -> bool:
        return self.clf is not None


_registry: Registry | None = None


def get_registry() -> Registry:
    global _registry
    if _registry is None:
        _registry = Registry()
    if not _registry.ready:
        detail = _registry.refusal or (
            "No model available: the registry is empty and no legacy artifact exists. "
            "Run data-pipeline/src/train_compare.py to train and register a model.")
        raise HTTPException(503, detail=detail)
    return _registry


# ---------------------------------------------------------------- schemas

class TaskFeatures(BaseModel):
    """Plan-time features of a single task (must match training features).

    extra="forbid": a misspelled field (planned_duration vs planned_duration_days)
    must be a loud 422, not a silently-imputed None → confident wrong prediction.
    """
    model_config = ConfigDict(extra="forbid")

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

    @model_validator(mode="after")
    def _sanity_ranges(self):
        """KAN-103 (PRED-8 extension): schema-derived sanity bounds per numeric feature.

        Catches gross semantic errors that pass name/type checks — wrong units,
        negative durations, rel_position outside [0,1]. Bounds live in
        feature_schema.json ('range'); a feature without a range is unchecked.
        Nulls remain legal (nullable semantics — the pipeline imputes them).
        """
        for name, (lo, hi) in SCHEMA_RANGES.items():
            v = getattr(self, name, None)
            if v is not None and not (lo <= v <= hi):
                raise ValueError(
                    f"{name}={v} outside sane range [{lo}, {hi}] "
                    f"(schema sanity check — wrong units or corrupted input?)")
        return self


class Prediction(BaseModel):
    late_probability: float                      # calibrated (PRED-13)
    is_late: bool
    risk_level: str                              # low / medium / high — Twin coloring
    estimated_delay_days: float | None = None    # champion regressor (None if unavailable)
    model_version: str
    feature_schema_version: str | None = None    # PRED-8


class Contribution(BaseModel):
    feature: str
    label_en: str
    label_he: str
    value: float | str | None
    contribution: float                          # signed SHAP value


class Explanation(BaseModel):
    prediction: Prediction
    top_contributions: list[Contribution]
    # KAN-130: contributions are in the SAME units as prediction.late_probability.
    # base_probability + (sum of ALL contributions) == late_probability (up to rounding);
    # top_contributions holds the top_k of them.
    base_probability: float | None = None
    contribution_space: str = "calibrated_probability"
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


# PRED-12: risk-band boundaries and the decision threshold are explicit configuration,
# never constants. Source of truth (since registry v6): the served model's meta.json —
# train_compare.py selects them by a documented protocol on train-side data and writes
# them next to the model, so a new model always ships with its own bands. An env
# override (RISK_BAND_T1 / RISK_BAND_T2 / DECISION_THRESHOLD) wins for demos
# (NFR-DEMO-1 style); the fallback 0.33 / 0.66 / 0.5 applies only to legacy artifacts
# without bands. Echoed in /health so Twin colouring, DASH-4 escalation and the DASH-5
# index all consume one source.
DEFAULT_BANDS = {"t1": 0.33, "t2": 0.66, "decision_threshold": 0.5}


def _env_float(name: str) -> float | None:
    v = os.environ.get(name)
    return float(v) if v not in (None, "") else None


def active_bands(reg: "Registry | None" = None) -> dict:
    """t1, t2, decision_threshold and where they came from (env > registry > default)."""
    meta_bands = ((reg.meta if reg is not None else {}) or {}).get("risk_bands") or {}
    out, source = {}, {}
    for key, env in (("t1", "RISK_BAND_T1"), ("t2", "RISK_BAND_T2"), ("decision_threshold", "DECISION_THRESHOLD")):
        env_v = _env_float(env)
        if env_v is not None:
            out[key], source[key] = env_v, "env"
        elif meta_bands.get(key) is not None:
            out[key], source[key] = float(meta_bands[key]), "registry"
        else:
            out[key], source[key] = DEFAULT_BANDS[key], "default"
    if not 0.0 <= out["t1"] <= out["t2"] <= 1.0 or not 0.0 <= out["decision_threshold"] <= 1.0:
        raise RuntimeError(f"invalid risk bands {out} (need 0<=t1<=t2<=1 and 0<=threshold<=1)")
    return {**out, "source": source}


def risk_level(p: float, bands: dict | None = None) -> str:
    b = bands or active_bands()
    return "high" if p >= b["t2"] else "medium" if p >= b["t1"] else "low"


def _known_categories(reg: Registry) -> dict[str, set]:
    """Categories each categorical feature was fitted with (from the fitted OneHotEncoder)."""
    cached = getattr(reg, "_known_cats", None)
    if cached is not None:
        return cached
    known: dict[str, set] = {}
    stack, seen = [reg.clf], 0
    while stack and seen < 50:
        seen += 1
        m = stack.pop()
        if type(m).__name__ == "ColumnTransformer":
            for _, trans, cols in m.transformers_:
                steps = dict(getattr(trans, "steps", []) or [])
                enc = next((st for st in steps.values() if type(st).__name__ == "OneHotEncoder"), None)
                if enc is None and type(trans).__name__ == "OneHotEncoder":
                    enc = trans
                if enc is not None:
                    for col, cats in zip(cols, enc.categories_):
                        known[col] = {c for c in cats if isinstance(c, str)}
            break
        stack.extend(getattr(m, "calibrated_classifiers_", []) or [])
        for attr in ("estimator", "base_estimator"):
            if getattr(m, attr, None) is not None:
                stack.append(getattr(m, attr))
        stack.extend(step for _, step in (getattr(m, "steps", []) or []))
    reg._known_cats = known
    return known


def _unseen_as_missing(reg: Registry, X: pd.DataFrame) -> pd.DataFrame:
    """PRED-10: an unseen categorical value is treated as missing (imputed like a null),
    not as an all-zeros one-hot row the model never saw during training."""
    known = _known_categories(reg)
    if not known:
        return X
    X = X.copy()
    for col, cats in known.items():
        if col in X:
            unseen = X[col].notna() & ~X[col].isin(cats)
            if unseen.any():
                X[col] = X[col].astype(object).where(~unseen, None)
    return X


def _predict_core(reg: Registry, X: pd.DataFrame) -> list[Prediction]:
    X = _unseen_as_missing(reg, X)
    bands = active_bands(reg)
    probas = reg.clf.predict_proba(X)[:, 1]
    delays = reg.reg.predict(X) if reg.reg is not None else [None] * len(X)
    return [
        Prediction(
            late_probability=round(float(p), 4),
            is_late=bool(p >= bands["decision_threshold"]),   # v6: "flagged" = medium or high
            risk_level=risk_level(float(p), bands),
            estimated_delay_days=(round(float(d), 1) if d is not None else None),
            model_version=reg.version,
            feature_schema_version=reg.schema_version,
        )
        for p, d in zip(probas, delays)
    ]


def _unwrap_pipeline(clf):
    """Return the underlying (prep, model) pipeline, looking through a calibration wrapper.

    SHAP is computed on the underlying tree model, whose output is the RAW (uncalibrated)
    probability. That is NOT what the service serves (PRED-13 calibrates it), so the raw
    contributions are mapped into calibrated-probability units by _to_calibrated_space()
    before they leave the service (KAN-130).
    """
    pipeline = clf
    if clf.__class__.__name__ == "CalibratedClassifierCV":
        pipeline = clf.calibrated_classifiers_[0].estimator
    return pipeline


@lru_cache(maxsize=1)
def _explainer():
    """SHAP explainer over the champion classifier's final estimator."""
    import shap
    reg = get_registry()
    pipeline = _unwrap_pipeline(reg.clf)
    prep = pipeline.named_steps["prep"]
    model = pipeline.named_steps["model"]
    names = list(prep.get_feature_names_out())
    if model.__class__.__name__ in {"RandomForestClassifier", "XGBClassifier",
                                    "GradientBoostingClassifier"}:
        return shap.TreeExplainer(model), prep, names
    raise HTTPException(501, detail=(
        f"SHAP explanation not supported for champion type {model.__class__.__name__}; "
        "retrain with a tree-based champion or extend the explainer."))


def _calibrators(clf):
    """Calibration maps raw -> served probability, or [] when the champion is not calibrated."""
    if clf.__class__.__name__ != "CalibratedClassifierCV":
        return []
    return [cc.calibrators[0] for cc in clf.calibrated_classifiers_]


def _calibrated(cals, x: float) -> float:
    """Served probability for a raw model output x (mean over the calibrated folds)."""
    return float(np.mean([c.predict(np.array([x]))[0] for c in cals]))


def _identity(x: float) -> float:
    return x


def _sigmoid(x: float) -> float:
    return float(1.0 / (1.0 + np.exp(-x)))


def _shap_link(model):
    """TreeSHAP's raw output space -> the probability the calibrator was fitted on.

    RandomForest: TreeSHAP explains predict_proba directly (identity).
    XGBoost: TreeSHAP explains the margin (log-odds); the calibrator was fitted on
    predict_proba = sigmoid(margin). Without this link the v6 XGBoost champion's
    contributions came out in mixed units (found 20.10.26: mean |contribution| 0.80).
    """
    return _sigmoid if model.__class__.__name__ in {"XGBClassifier", "GradientBoostingClassifier"} else _identity


def _to_calibrated_space(raw_sv: np.ndarray, base_raw: float, p_served: np.ndarray, cals,
                         link=_identity):
    """KAN-130: map raw-probability SHAP values into calibrated-probability units.

    The calibrator is monotonic, so each feature keeps its direction and rank; the
    contributions are rescaled by one factor per row so that
        base_cal + sum(contributions) == p_served   exactly,
    where base_cal is the calibrated value of the model's expected (base) output.
    When the raw output equals the base (factor 0/0) the local slope of the
    calibrator at the base is used instead.

    `link` maps the explainer's raw space to the calibrator's input (identity for a
    forest, sigmoid for a margin-space booster); the per-row factor then runs from raw
    units straight to served probability, so the identity above holds in both cases.
    """
    if not cals and link is _identity:             # legacy / uncalibrated forest
        return raw_sv, base_raw
    cal = (lambda x: _calibrated(cals, link(x))) if cals else link
    base_cal = cal(base_raw)
    p_raw = base_raw + raw_sv.sum(axis=1)
    out = np.empty_like(raw_sv)
    h = 1e-4
    slope = (cal(base_raw + h) - cal(base_raw - h)) / (2 * h)
    for i in range(raw_sv.shape[0]):
        delta_raw = p_raw[i] - base_raw
        k = (p_served[i] - base_cal) / delta_raw if abs(delta_raw) > 1e-9 else slope
        out[i] = raw_sv[i] * k
    return out, base_cal


def _explain_rows(reg: Registry, X: pd.DataFrame, top_k: int) -> list[Explanation]:
    """Exact TreeSHAP for every row in ONE explainer call (no per-request overhead)."""
    X = _unseen_as_missing(reg, X)
    predictions = _predict_core(reg, X)
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
    ev = np.atleast_1d(np.asarray(explainer.expected_value, dtype=float))
    base_raw = float(ev[1] if ev.size > 1 else ev[0])
    p_served = reg.clf.predict_proba(X)[:, 1]
    link = _shap_link(_unwrap_pipeline(reg.clf).named_steps["model"])
    sv, base = _to_calibrated_space(sv, base_raw, p_served, _calibrators(reg.clf), link)

    rows = X.to_dict(orient="records")
    out = []
    for i, prediction in enumerate(predictions):
        agg: dict[str, float] = {}
        for name, val in zip(names, sv[i]):
            b = base_feature(name)
            agg[b] = agg.get(b, 0.0) + float(val)
        top = sorted(agg.items(), key=lambda kv: abs(kv[1]), reverse=True)[:top_k]
        out.append(Explanation(
            prediction=prediction,
            top_contributions=[
                Contribution(
                    feature=f,
                    label_en=DOMAIN_LABELS.get(f, (f, f))[0],
                    label_he=DOMAIN_LABELS.get(f, (f, f))[1],
                    value=rows[i].get(f),
                    contribution=round(c, 4),
                ) for f, c in top
            ],
            base_probability=round(base, 4),
            note=("Contributions are in probability units: base_probability plus all "
                  "contributions equals late_probability. Positive pushes toward delay; "
                  "negative pushes toward on-time."),
        ))
    return out


# Exact TreeSHAP on the v5 forest (300 deep trees) costs ~65 ms per activity; the batch
# endpoint removes the per-request overhead but stays linear, so it is bounded. Explanations
# are meant on demand (an activity or a zone panel), not for a whole project at once —
# predictions for a whole project come from /predict/batch and /predict/project.
MAX_EXPLAIN_BATCH = int(os.environ.get("MAX_EXPLAIN_BATCH", "200"))


# ---------------------------------------------------------------- endpoints

@app.get("/health")
def health():
    global _registry
    if _registry is None:
        _registry = Registry()
    return {"status": "ok" if _registry.ready else "degraded", "model_loaded": _registry.ready,
            "model_version": _registry.version,
            "feature_schema_version": _registry.schema_version,
            "champion": _registry.meta.get("champion_classifier"),
            "target": (_registry.meta or {}).get("target", "is_late"),
            "target_definition": (_registry.meta or {}).get("target_definition"),
            "risk_bands": active_bands(_registry),
            "cold_start": {"policy": COLD_START_POLICY, "min_history": COLD_START_MIN_HISTORY},
            "abstention": {"required_features": list(REQUIRED_FEATURES),
                           "reasons": [*REQUIRED_FEATURES.values(), ABSTAIN_LOW_HISTORY]},
            "refusal": _registry.refusal}


@app.post("/predict", response_model=Prediction)
def predict(task: TaskFeatures):
    reg = get_registry()
    return _predict_core(reg, pd.DataFrame([task.model_dump()]))[0]


@app.post("/predict/batch", response_model=list[Prediction])
def predict_batch(tasks: list[TaskFeatures]):
    if not tasks:                     # empty project — a valid question, an empty answer
        return []
    reg = get_registry()
    return _predict_core(reg, pd.DataFrame([t.model_dump() for t in tasks]))


# ---- Cold-start policy (PRED-10 extension, 17.8 external-audit finding) ----
# Our own research says transfer to a history-less project is unreliable
# (scenario A ~0.57 and unstable across 20 splits; LOPO range 0.0-0.92 — RR-13),
# and RR-11 puts within-project usability at ~40% completed history. Serving a
# confident calibrated number in that regime would contradict the project's own
# findings. Policy per prediction, driven by project.completed_share:
#   >= threshold        -> reliability "ok"
#   below / unknown     -> "low_transfer_prior": under COLD_START_POLICY=flag
#                          (default) the prediction is still returned but marked;
#                          under =abstain it is withheld (prediction=null).
COLD_START_MIN_HISTORY = float(os.environ.get("COLD_START_MIN_HISTORY", "0.4"))  # RR-11
COLD_START_POLICY = os.environ.get("COLD_START_POLICY", "flag")                  # flag | abstain
if COLD_START_POLICY not in ("flag", "abstain"):
    raise RuntimeError(f"COLD_START_POLICY must be flag|abstain, got {COLD_START_POLICY}")

LOW_RELIABILITY_NOTE = (
    "Project history below the RR-11 usability threshold "
    f"({COLD_START_MIN_HISTORY:.0%}): this is a cross-project transfer prior, "
    "shown by our scenario-A/RR-13 experiments to be weak and unstable. "
    "Treat as indicative only; reliability improves as the project accumulates history.")


# 7.9.26 (two independent audits): the tag "ok" over-promised. Crossing the RR-11 threshold
# does not change the model — it is still the cross-project model, scored on a project it has
# never seen; RR-11 measured usability of *training* history, not of the served model. The tag
# therefore names what the prediction rests on, never "ok", and `basis` says it explicitly.
RELIABILITY_LOW = "low_transfer_prior"          # project history below the RR-11 threshold
RELIABILITY_HISTORY = "within_project_history"   # threshold crossed; model unchanged
BASIS_NOTE = ("Cross-project model (registry {version}); it is not trained on this project. "
              "The project has completed {share:.0%} of its activities.")


# ---- PRED-10: minimum-input policy -------------------------------------------
# A prediction needs the activity's own planned dates (planned_duration_days) and its
# place on the project timeline (rel_position). Without them the pipeline would impute
# medians and return a confident number about an activity it knows nothing about, so the
# service abstains instead: prediction=null, risk band "unknown", and a machine-readable
# reason. Other features may be missing (they are imputed, e.g. floats per RR-12).
REQUIRED_FEATURES: dict[str, str] = {
    "planned_duration_days": "missing_planned_dates",       # no planned start or finish
    "rel_position": "missing_project_timeline",             # project span unknown
}
ABSTAIN_LOW_HISTORY = "low_project_history"                 # cold start under policy=abstain
ABSTAIN_NOTES = {
    "missing_planned_dates": "No prediction: the activity has no planned start and finish dates.",
    "missing_project_timeline": "No prediction: the project timeline (planned start/finish) is unknown.",
    ABSTAIN_LOW_HISTORY: LOW_RELIABILITY_NOTE,
}


def abstain_reason(features: dict) -> str | None:
    """First unmet minimum-input rule, or None when the activity can be scored."""
    for name, reason in REQUIRED_FEATURES.items():
        if features.get(name) is None:
            return reason
    return None


class ProjectPrediction(BaseModel):
    task_id: str
    reliability: str                             # "within_project_history" | "low_transfer_prior"
    basis: str = "cross_project_model"           # what the number rests on — never "ok"
    prediction: Prediction | None = None         # null when the service abstains (PRED-10)
    risk_level: str | None = None                # mirrors prediction.risk_level; "unknown" when abstained
    abstain_reason: str | None = None            # machine-readable, see REQUIRED_FEATURES / ABSTAIN_LOW_HISTORY
    note: str | None = None


@app.post("/predict/project", response_model=list[ProjectPrediction])
def predict_project(payload: ProjectGraphPayload):
    """PRED-9: predictions straight from RAW platform entities.

    The backend sends tasks + dependencies + dates; the adapter (app/adapter.py)
    derives the 11 schema features here — the platform never computes a feature.
    Float features are sent as None by design (RR-12); the pipeline imputes them.
    Feature dicts still pass TaskFeatures validation (ranges, KAN-103) before the
    model sees them. Cold-start reliability gating per the module note above.
    """
    if not payload.tasks:
        return []
    share = payload.project.completed_share
    reliable = share is not None and share >= COLD_START_MIN_HISTORY
    reliability = RELIABILITY_HISTORY if reliable else RELIABILITY_LOW

    if not reliable and COLD_START_POLICY == "abstain":
        return [ProjectPrediction(task_id=t.id, reliability=reliability, prediction=None,
                                  risk_level="unknown", abstain_reason=ABSTAIN_LOW_HISTORY,
                                  note=ABSTAIN_NOTES[ABSTAIN_LOW_HISTORY])
                for t in payload.tasks]

    reg = get_registry()
    feats = [TaskFeatures(**f) for f in compute_features(payload)]   # range-validated
    reasons = [abstain_reason(f.model_dump()) for f in feats]
    scored = [i for i, r in enumerate(reasons) if r is None]
    preds = (_predict_core(reg, pd.DataFrame([feats[i].model_dump() for i in scored]))
             if scored else [])
    by_index = dict(zip(scored, preds))
    basis_note = BASIS_NOTE.format(version=reg.version, share=(share or 0.0))
    note = basis_note if reliable else LOW_RELIABILITY_NOTE + " " + basis_note
    out = []
    for i, t in enumerate(payload.tasks):
        if reasons[i] is not None:
            out.append(ProjectPrediction(task_id=t.id, reliability=reliability, prediction=None,
                                         risk_level="unknown", abstain_reason=reasons[i],
                                         note=ABSTAIN_NOTES[reasons[i]]))
        else:
            p = by_index[i]
            out.append(ProjectPrediction(task_id=t.id, reliability=reliability, prediction=p,
                                         risk_level=p.risk_level, note=note))
    return out


# ---- PRED-15: global explainability ---------------------------------------------
GLOBAL_SHAP_FILE = "global_shap.json"


def global_ranking(reg: Registry, X: pd.DataFrame, *, sample: int = 2000, seed: int = 42) -> dict:
    """Mean |SHAP| per base feature, in the same calibrated-probability units as the
    local explanations (KAN-130) — so the global ranking and every per-activity panel
    speak the same language. Computed offline (data-pipeline/src/global_shap.py) on the
    deployment-scenario test split and stored next to the model in the registry."""
    rows = X.sample(n=sample, random_state=seed) if len(X) > sample else X
    expl = _explain_rows(reg, rows.reset_index(drop=True), top_k=len(DOMAIN_LABELS))
    totals = dict.fromkeys(DOMAIN_LABELS, 0.0)
    for e in expl:
        for c in e.top_contributions:
            totals[c.feature] += abs(c.contribution)
    n = max(len(expl), 1)
    ranking = sorted(
        ({"feature": f, "label_en": DOMAIN_LABELS[f][0], "label_he": DOMAIN_LABELS[f][1],
          "mean_abs_contribution": round(v / n, 6)} for f, v in totals.items()),
        key=lambda r: r["mean_abs_contribution"], reverse=True)
    for i, r in enumerate(ranking, 1):
        r["rank"] = i
    return {"model_version": reg.version, "feature_schema_version": reg.schema_version,
            "units": "calibrated_probability", "n_rows": len(expl), "seed": seed,
            "ranking": ranking}


@app.get("/explain/global")
def explain_global():
    """PRED-15: the served model's global feature ranking (dashboard + project book).
    Read from the registry; 404 with a reason if the champion has none yet."""
    reg = get_registry()
    path = (reg.dir / GLOBAL_SHAP_FILE) if reg.dir else None
    if path is None or not path.exists():
        raise HTTPException(404, detail=(
            f"no {GLOBAL_SHAP_FILE} for registry {reg.version}: run data-pipeline/src/global_shap.py"))
    data = json.loads(path.read_text())
    if data.get("model_version") != reg.version:
        raise HTTPException(409, detail=(
            f"{GLOBAL_SHAP_FILE} was computed for {data.get('model_version')}, "
            f"but {reg.version} is served — regenerate it"))
    return data


@app.post("/explain", response_model=Explanation)
def explain(task: TaskFeatures, top_k: int = Query(5, ge=1, le=len(DOMAIN_LABELS))):
    """PRED-3: prediction + top-k signed SHAP contributions, aggregated per base feature,
    in calibrated-probability units (KAN-130)."""
    reg = get_registry()
    return _explain_rows(reg, pd.DataFrame([task.model_dump()]), top_k)[0]


@app.post("/explain/batch", response_model=list[Explanation])
def explain_batch(tasks: list[TaskFeatures],
                  top_k: int = Query(5, ge=1, le=len(DOMAIN_LABELS))):
    """KAN-130: explanations for several activities (e.g. a Twin zone) in one call.
    Order and length preserved 1:1; empty list -> []; more than MAX_EXPLAIN_BATCH -> 413."""
    if not tasks:
        return []
    if len(tasks) > MAX_EXPLAIN_BATCH:
        raise HTTPException(413, detail=(
            f"{len(tasks)} activities requested; /explain/batch accepts at most "
            f"{MAX_EXPLAIN_BATCH} (MAX_EXPLAIN_BATCH). Request explanations per zone or "
            "per activity; use /predict/batch for whole-project probabilities."))
    reg = get_registry()
    return _explain_rows(reg, pd.DataFrame([t.model_dump() for t in tasks]), top_k)


# ---- PRED-3 through the platform (KAN-40, sprint 8 T25) ---------------------------
class ProjectExplainPayload(ProjectGraphPayload):
    """The /predict/project payload plus the activities to explain.

    The whole graph is needed even for one activity: upstream/downstream reach and
    the activity's position in the project timeline come from the other activities.
    """
    task_ids: list[str] = Field(min_length=1)


class ProjectExplanation(BaseModel):
    task_id: str
    reliability: str
    basis: str = "cross_project_model"
    explanation: Explanation | None = None       # null exactly when /predict/project abstains
    risk_level: str | None = None
    abstain_reason: str | None = None
    note: str | None = None


@app.post("/explain/project", response_model=list[ProjectExplanation])
def explain_project(payload: ProjectExplainPayload,
                    top_k: int = Query(5, ge=1, le=len(DOMAIN_LABELS))):
    """PRED-3 from RAW platform entities (the PRED-9 path), for the backend.

    /explain takes ready feature vectors, which the platform never computes (PRED-9).
    This endpoint derives them with the same adapter as /predict/project and applies
    the same reliability gate and abstention rules, so an activity has an explanation
    exactly when it has a prediction, and both carry the same number.
    Order follows task_ids; an unknown id is a 422; more than MAX_EXPLAIN_BATCH -> 413.
    """
    wanted = list(dict.fromkeys(payload.task_ids))
    if len(wanted) > MAX_EXPLAIN_BATCH:
        raise HTTPException(413, detail=(
            f"{len(wanted)} activities requested; /explain/project accepts at most "
            f"{MAX_EXPLAIN_BATCH} (MAX_EXPLAIN_BATCH)."))
    index = {t.id: i for i, t in enumerate(payload.tasks)}
    unknown = [t for t in wanted if t not in index]
    if unknown:
        raise HTTPException(422, detail=f"task_ids not in tasks: {unknown}")

    share = payload.project.completed_share
    reliable = share is not None and share >= COLD_START_MIN_HISTORY
    reliability = RELIABILITY_HISTORY if reliable else RELIABILITY_LOW
    if not reliable and COLD_START_POLICY == "abstain":
        return [ProjectExplanation(task_id=t, reliability=reliability, risk_level="unknown",
                                   abstain_reason=ABSTAIN_LOW_HISTORY,
                                   note=ABSTAIN_NOTES[ABSTAIN_LOW_HISTORY]) for t in wanted]

    reg = get_registry()
    all_feats = compute_features(payload)                  # the full graph, every activity
    feats = {t: TaskFeatures(**all_feats[index[t]]) for t in wanted}
    reasons = {t: abstain_reason(f.model_dump()) for t, f in feats.items()}
    scored = [t for t in wanted if reasons[t] is None]
    expl = (dict(zip(scored, _explain_rows(
        reg, pd.DataFrame([feats[t].model_dump() for t in scored]), top_k)))
        if scored else {})
    basis_note = BASIS_NOTE.format(version=reg.version, share=(share or 0.0))
    note = basis_note if reliable else LOW_RELIABILITY_NOTE + " " + basis_note
    out = []
    for t in wanted:
        if reasons[t] is not None:
            out.append(ProjectExplanation(task_id=t, reliability=reliability, risk_level="unknown",
                                          abstain_reason=reasons[t], note=ABSTAIN_NOTES[reasons[t]]))
        else:
            e = expl[t]
            out.append(ProjectExplanation(task_id=t, reliability=reliability, explanation=e,
                                          risk_level=e.prediction.risk_level, note=note))
    return out
