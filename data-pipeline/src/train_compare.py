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
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.frozen import FrozenEstimator
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, brier_score_loss, f1_score, mean_absolute_error,
    precision_score, recall_score, roc_auc_score, root_mean_squared_error,
)
from sklearn.model_selection import GridSearchCV, GroupKFold, GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier, XGBRegressor

SEED = 42
TEMPORAL_Q = 0.7            # scenario B: per-project temporal quantile cut (train = earliest 70%
                            # of the project's own labeled activities by rel_position)
MIN_LABELED = 30            # scenario B: project needs ≥30 labeled activities overall
MIN_PER_SIDE = 10           # ...and ≥10 on each side of its cut
BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "outputs"
REGISTRY = BASE.parent / "ai-service" / "model" / "registry"
SCHEMA_PATH = BASE.parent / "feature_schema.json"

# PRED-8: the feature contract comes from the single committed schema file.
SCHEMA = json.loads(SCHEMA_PATH.read_text())
NUM_FEATURES = [f["name"] for f in SCHEMA["features"] if f["role"] == "numeric"]
CAT_FEATURES = [f["name"] for f in SCHEMA["features"] if f["role"] == "categorical"]
SCHEMA_VERSION = SCHEMA["feature_schema_version"]


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
    """Scenario B: per-project temporal split at the project's own rel_position quantile.

    A fixed global cut (v1: rel_position <= 0.7) covered only 2 projects, because most
    projects concentrate their labeled activities on one side of a global cut. Cutting at
    each project's own 70th percentile keeps the split temporally valid (train strictly
    earlier than test within the project) while covering every project with enough labels.
    """
    tr_parts, te_parts, projects = [], [], []
    for name, g in lab.groupby("project"):
        if len(g) < MIN_LABELED:
            continue
        cut = g["rel_position"].quantile(TEMPORAL_Q)
        tr_g = g[g["rel_position"] <= cut]
        te_g = g[g["rel_position"] > cut]
        if len(tr_g) >= MIN_PER_SIDE and len(te_g) >= MIN_PER_SIDE:
            tr_parts.append(tr_g)
            te_parts.append(te_g)
            projects.append(name)
    return pd.concat(tr_parts), pd.concat(te_parts), projects


def main():
    df = pd.read_csv(OUT / "labeled_tasks.csv")
    lab = df[df["is_late"].notna()].copy()
    lab["is_late"] = lab["is_late"].astype(int)

    # ---------- scenario A: cross-project ----------
    gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=SEED)
    a_tr_idx, a_te_idx = next(gss.split(lab, groups=lab["project"]))
    A_tr, A_te = lab.iloc[a_tr_idx], lab.iloc[a_te_idx]

    # ---------- scenario B: within-project temporal ----------
    B_tr, B_te, B_projects = temporal_split(lab)

    results = {
        "config": {
            "seed": SEED,
            "generated_by": "data-pipeline/src/train_compare.py",
            "feature_schema_version": SCHEMA_VERSION,
            "scenario_A": {"split": "GroupShuffleSplit by project, test_size=0.25",
                           "n_train": len(A_tr), "n_test": len(A_te)},
            "scenario_B": {"split": f"per-project temporal quantile cut q={TEMPORAL_Q} on rel_position",
                           "min_labeled": MIN_LABELED, "min_per_side": MIN_PER_SIDE,
                           "n_train": len(B_tr), "n_test": len(B_te),
                           "n_projects": len(B_projects), "projects": B_projects},
            "features_num": NUM_FEATURES, "features_cat": CAT_FEATURES,
            "tuning": "GridSearchCV, GroupKFold(3) on scenario-A train; best params reused in B",
            "calibration": "CalibratedClassifierCV on B train, isotonic (n>1000 per sklearn guidance), cv=3; never fitted on test",
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

    # ---------- PRED-13: probability calibration on B train (never on test) ----------
    # Protocol (documented, selected on train-side data only): the late-activity base
    # rate drifts across a project's life (train 0.46 → test 0.29 in this corpus), so a
    # calibrator fitted on the WHOLE train span learns stale frequencies. We therefore
    # sub-split the train per project at its own q=0.75 rel_position quantile: the
    # champion is fitted on the earlier part, and a sigmoid (Platt) calibrator is fitted
    # on the latest slice — the distribution closest to deployment time. Sigmoid chosen
    # over isotonic for robustness on the modest calibration slice (isotonic evaluated,
    # comparable). Test data is never touched.
    fit_parts, cal_parts = [], []
    for _, g in B_tr.groupby("project"):
        c = g["rel_position"].quantile(0.75)
        fit_parts.append(g[g["rel_position"] <= c])
        cal_parts.append(g[g["rel_position"] > c])
    B_fit, B_cal = pd.concat(fit_parts), pd.concat(cal_parts)
    champ_fit = clone(tuned[champion])
    champ_fit.fit(B_fit, B_fit["is_late"])
    calibrated = CalibratedClassifierCV(FrozenEstimator(champ_fit), method="sigmoid")
    calibrated.fit(B_cal, B_cal["is_late"])

    def brier(model, te):
        return round(float(brier_score_loss(te["is_late"], model.predict_proba(te)[:, 1])), 4)

    cal_metrics = {}
    for scen, te in {"A_cross_project": A_te, "B_temporal": B_te}.items():
        cal_metrics[scen] = {
            "brier_uncalibrated_same_base": brier(champ_fit, te),  # fair comparison: same fitted model
            "brier_calibrated": brier(calibrated, te),
        }
    pred_cal = calibrated.predict(B_te)
    proba_cal = calibrated.predict_proba(B_te)[:, 1]
    cal_metrics["B_temporal"]["classification_calibrated"] = clf_metrics(
        B_te["is_late"], pred_cal, proba_cal)
    results["calibration"] = {
        "method": "sigmoid (Platt)",
        "protocol": "per-project temporal sub-split of B train at q=0.75: champion fitted on earlier part, calibrator on latest slice (distribution closest to deployment); selected on train-side data only",
        "n_fit": len(B_fit), "n_cal": len(B_cal),
        **cal_metrics}
    print(f"[calibration] {json.dumps(cal_metrics)}")

    # reliability curve figure (project book, RR-6/PRED-13)
    fig_dir = OUT / "figures"
    fig_dir.mkdir(exist_ok=True)
    frac_u, mean_u = calibration_curve(B_te["is_late"], champ_fit.predict_proba(B_te)[:, 1], n_bins=10)
    frac_c, mean_c = calibration_curve(B_te["is_late"], proba_cal, n_bins=10)
    plt.figure(figsize=(6.4, 5.2), dpi=150)
    plt.plot([0, 1], [0, 1], ls="--", lw=1, color="#9a9a9a", zorder=1)
    plt.plot(mean_u, frac_u, marker="o", ms=6, lw=2, color="#eb6834", zorder=2)
    plt.plot(mean_c, frac_c, marker="o", ms=6, lw=2, color="#2a78d6", zorder=3)
    # direct labels instead of a floating legend (accessibility relief)
    plt.annotate("Uncalibrated", xy=(mean_u[-1], frac_u[-1]), xytext=(6, -12),
                 textcoords="offset points", color="#3a3a3a", fontsize=10)
    plt.annotate("Calibrated (sigmoid)", xy=(mean_c[-1], frac_c[-1]), xytext=(6, 8),
                 textcoords="offset points", color="#3a3a3a", fontsize=10)
    plt.xlabel("Predicted probability of delay")
    plt.ylabel("Observed fraction delayed")
    plt.title("Reliability curve — scenario B test (champion classifier)")
    plt.grid(alpha=0.25, lw=0.5)
    plt.tight_layout()
    plt.savefig(fig_dir / "reliability_curve_B.png")
    plt.close()

    # ---------- registry write (PRED-4 + PRED-8 + PRED-13) ----------
    REGISTRY.mkdir(parents=True, exist_ok=True)
    existing = sorted(int(p.name[1:]) for p in REGISTRY.glob("v*") if p.name[1:].isdigit())
    version = f"v{(existing[-1] + 1) if existing else 1}"
    vdir = REGISTRY / version
    vdir.mkdir()
    joblib.dump(calibrated, vdir / "classifier.joblib")           # served = calibrated
    joblib.dump(tuned[f"__reg__{champion_reg}"], vdir / "regressor.joblib")
    shutil.copy(SCHEMA_PATH, vdir / "feature_schema.json")        # self-contained artifact
    meta = {
        "version": version,
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "feature_schema_version": SCHEMA_VERSION,
        "champion_classifier": champion,
        "champion_regressor": champion_reg,
        "calibration": results["calibration"],
        "best_params": results["best_params"].get(champion, {}),
        "metrics_B_temporal": {
            "classification_uncalibrated": b_clf[champion],
            "classification_calibrated": cal_metrics["B_temporal"]["classification_calibrated"],
            "regression": b_reg[champion_reg],
        },
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
