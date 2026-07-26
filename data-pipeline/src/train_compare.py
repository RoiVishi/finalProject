"""
Model comparison for task-delay prediction (RR-3, RR-4, RR-5, PRED-4, PRED-6).

Classification (is_late): dummy, Logistic Regression, Random Forest, XGBoost, MLP
Regression (delay_days):  dummy, Random Forest, XGBoost

Two leakage-aware evaluation scenarios (RR-4):
  A) cross-project GroupShuffleSplit — "new, unseen project"
  B) within-project temporal split by rel_position (train on the earlier
     TEMPORAL_CUT share of each project's timeline, test on the rest) —
     "live project mid-execution"; this is the primary deployment claim.

Hyperparameter tuning (RR-5): GridSearchCV with GroupKFold on the scenario-A
training set; the best params are reused in scenario B for comparability.

Registry (PRED-4): the champion pipelines (clf + reg) are written to
  ai-service/model/registry/<version>/ with meta.json holding config,
  params, metrics and feature list. The AI service loads the newest version.

Reproducibility (NFR-REPRO-1): fixed SEED; outputs/model_comparison.json
contains the full config; rerunning reproduces the numbers.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, f1_score, mean_absolute_error, precision_score,
    recall_score, roc_auc_score, root_mean_squared_error,
)
from sklearn.model_selection import GridSearchCV, GroupKFold, GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier, XGBRegressor

SEED = 42
TEMPORAL_CUT = 0.7          # scenario B: train on first 70% of each project's timeline
MIN_PER_SIDE = 20           # scenario B: project must have ≥20 labeled tasks on each side
BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "outputs"
REGISTRY = BASE.parent / "ai-service" / "model" / "registry"

NUM_FEATURES = [
    "planned_duration_days", "total_float_hr", "free_float_hr", "rel_position",
    "proj_n_tasks", "proj_span_days", "n_pred", "n_succ", "upstream_cnt", "downstream_cnt",
]
CAT_FEATURES = ["task_type"]


def make_preprocessor():
    return ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), NUM_FEATURES),
        ("cat", Pipeline([
            ("imp", SimpleImputer(strategy="constant", fill_value="NA")),
            ("oh", OneHotEncoder(handle_unknown="ignore")),
        ]), CAT_FEATURES),
    ])


def clf_metrics(y_true, y_pred, y_proba=None):
    m = {
        "accuracy": accuracy_score(y_true, y_pred),
        "precision": precision_score(y_true, y_pred, zero_division=0),
        "recall": recall_score(y_true, y_pred, zero_division=0),
        "f1": f1_score(y_true, y_pred, zero_division=0),
    }
    if y_proba is not None and len(np.unique(y_true)) > 1:
        m["roc_auc"] = roc_auc_score(y_true, y_proba)
    return {k: round(float(v), 4) for k, v in m.items()}


def classifier_zoo():
    """name -> (estimator, param grid for tuning)."""
    return {
        "dummy_majority": (DummyClassifier(strategy="most_frequent"), None),
        "logistic_regression": (
            LogisticRegression(max_iter=2000, class_weight="balanced"),
            {"model__C": [0.1, 1.0, 10.0]},
        ),
        "random_forest": (
            RandomForestClassifier(class_weight="balanced", random_state=SEED, n_jobs=-1),
            {"model__n_estimators": [300], "model__min_samples_leaf": [2, 5, 20],
             "model__max_features": ["sqrt", 0.5]},
        ),
        "xgboost": (
            XGBClassifier(random_state=SEED, n_jobs=-1, eval_metric="logloss",
                          tree_method="hist"),
            {"model__n_estimators": [300], "model__max_depth": [3, 6],
             "model__learning_rate": [0.05, 0.1], "model__subsample": [0.8]},
        ),
        "mlp": (
            MLPClassifier(random_state=SEED, max_iter=400, early_stopping=True),
            {"model__hidden_layer_sizes": [(64,), (64, 32)], "model__alpha": [1e-4, 1e-3]},
        ),
    }


def regressor_zoo():
    return {
        "dummy_median": DummyRegressor(strategy="median"),
        "random_forest_reg": RandomForestRegressor(
            n_estimators=300, min_samples_leaf=5, random_state=SEED, n_jobs=-1),
        "xgboost_reg": XGBRegressor(
            n_estimators=300, max_depth=6, learning_rate=0.05, subsample=0.8,
            random_state=SEED, n_jobs=-1),
    }


def temporal_split(lab: pd.DataFrame):
    """Scenario B: per-project temporal split by rel_position (plan-time safe)."""
    tr_parts, te_parts = [], []
    for _, g in lab.groupby("project"):
        tr_g = g[g["rel_position"] <= TEMPORAL_CUT]
        te_g = g[g["rel_position"] > TEMPORAL_CUT]
        if len(tr_g) >= MIN_PER_SIDE and len(te_g) >= MIN_PER_SIDE:
            tr_parts.append(tr_g)
            te_parts.append(te_g)
    return pd.concat(tr_parts), pd.concat(te_parts)


def main():
    df = pd.read_csv(OUT / "labeled_tasks.csv")
    lab = df[df["is_late"].notna()].copy()
    lab["is_late"] = lab["is_late"].astype(int)

    # ---------- scenario A: cross-project ----------
    gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=SEED)
    a_tr_idx, a_te_idx = next(gss.split(lab, groups=lab["project"]))
    A_tr, A_te = lab.iloc[a_tr_idx], lab.iloc[a_te_idx]

    # ---------- scenario B: within-project temporal ----------
    B_tr, B_te = temporal_split(lab)

    results = {
        "config": {
            "seed": SEED,
            "generated_by": "data-pipeline/src/train_compare.py",
            "scenario_A": {"split": "GroupShuffleSplit by project, test_size=0.25",
                           "n_train": len(A_tr), "n_test": len(A_te)},
            "scenario_B": {"split": f"within-project temporal by rel_position <= {TEMPORAL_CUT}",
                           "min_labeled_per_side": MIN_PER_SIDE,
                           "n_train": len(B_tr), "n_test": len(B_te),
                           "n_projects": int(B_tr["project"].nunique())},
            "features_num": NUM_FEATURES, "features_cat": CAT_FEATURES,
            "tuning": "GridSearchCV, GroupKFold(3) on scenario-A train; best params reused in B",
        },
        "classification": {"A_cross_project": {}, "B_temporal": {}},
        "regression": {"A_cross_project": {}, "B_temporal": {}},
        "best_params": {},
    }

    tuned = {}
    gkf = GroupKFold(n_splits=3)
    for name, (est, grid) in classifier_zoo().items():
        pipe = Pipeline([("prep", make_preprocessor()), ("model", est)])
        if grid:
            gs = GridSearchCV(pipe, grid, scoring="roc_auc", n_jobs=-1,
                              cv=gkf.split(A_tr, A_tr["is_late"], groups=A_tr["project"]))
            gs.fit(A_tr, A_tr["is_late"])
            tuned[name] = gs.best_estimator_
            results["best_params"][name] = {k: (v if isinstance(v, (int, float, str)) else str(v))
                                            for k, v in gs.best_params_.items()}
            print(f"[tune] {name}: {gs.best_params_} (cv auc={gs.best_score_:.4f})")
        else:
            pipe.fit(A_tr, A_tr["is_late"])
            tuned[name] = pipe

    for scen, (tr, te) in {"A_cross_project": (A_tr, A_te), "B_temporal": (B_tr, B_te)}.items():
        for name, est in tuned.items():
            model = est
            if scen == "B_temporal":
                model = clone(est)
                model.fit(tr, tr["is_late"])
            pred = model.predict(te)
            proba = model.predict_proba(te)[:, 1] if hasattr(model, "predict_proba") else None
            results["classification"][scen][name] = clf_metrics(te["is_late"], pred, proba)
            print(f"[clf {scen}] {name}: {results['classification'][scen][name]}")
            tuned[name] = model if scen == "B_temporal" else tuned[name]

    # ---------- regression ----------
    for scen, (tr, te) in {"A_cross_project": (A_tr, A_te), "B_temporal": (B_tr, B_te)}.items():
        tr_r, te_r = tr[~tr["extreme_delay"].astype(bool)], te[~te["extreme_delay"].astype(bool)]
        for name, est in regressor_zoo().items():
            pipe = Pipeline([("prep", make_preprocessor()), ("model", est)])
            pipe.fit(tr_r, tr_r["delay_days"])
            pred = pipe.predict(te_r)
            results["regression"][scen][name] = {
                "mae_days": round(float(mean_absolute_error(te_r["delay_days"], pred)), 2),
                "rmse_days": round(float(root_mean_squared_error(te_r["delay_days"], pred)), 2),
            }
            print(f"[reg {scen}] {name}: {results['regression'][scen][name]}")
            if scen == "B_temporal":
                tuned[f"__reg__{name}"] = pipe

    # ---------- champion selection (by scenario-B ROC-AUC, the deployment claim) ----------
    b_clf = results["classification"]["B_temporal"]
    champion = max((n for n in b_clf if n != "dummy_majority"), key=lambda n: b_clf[n].get("roc_auc", 0))
    b_reg = results["regression"]["B_temporal"]
    champion_reg = min((n for n in b_reg if n != "dummy_median"), key=lambda n: b_reg[n]["mae_days"])
    results["champion"] = {"classifier": champion, "regressor": champion_reg,
                           "selected_by": "scenario-B roc_auc (clf) / mae (reg)"}
    print(f"\n[champion] clf={champion}  reg={champion_reg}")

    # ---------- registry write (PRED-4) ----------
    REGISTRY.mkdir(parents=True, exist_ok=True)
    existing = sorted(int(p.name[1:]) for p in REGISTRY.glob("v*") if p.name[1:].isdigit())
    version = f"v{(existing[-1] + 1) if existing else 1}"
    vdir = REGISTRY / version
    vdir.mkdir()
    joblib.dump(tuned[champion], vdir / "classifier.joblib")
    joblib.dump(tuned[f"__reg__{champion_reg}"], vdir / "regressor.joblib")
    meta = {
        "version": version,
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "champion_classifier": champion,
        "champion_regressor": champion_reg,
        "best_params": results["best_params"].get(champion, {}),
        "metrics_B_temporal": {"classification": b_clf[champion], "regression": b_reg[champion_reg]},
        "metrics_A_cross_project": {"classification": results["classification"]["A_cross_project"][champion]},
        "features_num": NUM_FEATURES, "features_cat": CAT_FEATURES,
        "seed": SEED,
        "trained_on": "B_temporal train split (deployment scenario)",
    }
    (vdir / "meta.json").write_text(json.dumps(meta, indent=2))
    (OUT / "model_comparison.json").write_text(json.dumps(results, indent=2))
    print(f"Registry: {vdir}\nSaved {OUT / 'model_comparison.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
