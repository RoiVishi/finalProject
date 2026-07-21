"""
Baseline models for task-delay prediction.

- Classification: will the task finish late? (is_late)
  Models: majority-class dummy, Logistic Regression, Random Forest
- Regression  : how many days late? (delay_days)
  Models: median dummy, Random Forest regressor

Methodology (per the research plan):
- Train/test split is BY PROJECT (GroupShuffleSplit) to prevent leakage
  between tasks of the same project.
- Fixed seed for reproducibility. Every run writes outputs/metrics.json
  with config + metrics so results in the project book are reproducible.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier, DummyRegressor
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, f1_score, mean_absolute_error, precision_score,
    recall_score, roc_auc_score, root_mean_squared_error,
)
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

SEED = 42
BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "outputs"

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


def main():
    df = pd.read_csv(OUT / "labeled_tasks.csv")
    lab = df[df["is_late"].notna()].copy()
    # exclude extreme outliers from the REGRESSION target only (documented choice)
    lab["is_late"] = lab["is_late"].astype(int)

    gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=SEED)
    tr_idx, te_idx = next(gss.split(lab, groups=lab["project"]))
    tr, te = lab.iloc[tr_idx], lab.iloc[te_idx]

    results = {
        "config": {
            "seed": SEED, "split": "GroupShuffleSplit by project, test_size=0.25",
            "n_train": len(tr), "n_test": len(te),
            "train_projects": sorted(tr["project"].unique().tolist()),
            "test_projects": sorted(te["project"].unique().tolist()),
            "features_num": NUM_FEATURES, "features_cat": CAT_FEATURES,
        },
        "classification": {}, "regression": {},
    }

    # ---------- classification ----------
    clf_models = {
        "dummy_majority": DummyClassifier(strategy="most_frequent"),
        "logistic_regression": LogisticRegression(max_iter=2000, class_weight="balanced"),
        "random_forest": RandomForestClassifier(
            n_estimators=300, min_samples_leaf=5, class_weight="balanced",
            random_state=SEED, n_jobs=-1,
        ),
    }
    ytr, yte = tr["is_late"], te["is_late"]
    for name, model in clf_models.items():
        pipe = Pipeline([("prep", make_preprocessor()), ("model", model)])
        pipe.fit(tr, ytr)
        pred = pipe.predict(te)
        m = {
            "accuracy": accuracy_score(yte, pred),
            "precision": precision_score(yte, pred, zero_division=0),
            "recall": recall_score(yte, pred, zero_division=0),
            "f1": f1_score(yte, pred, zero_division=0),
        }
        if hasattr(pipe, "predict_proba") and len(np.unique(yte)) > 1:
            try:
                m["roc_auc"] = roc_auc_score(yte, pipe.predict_proba(te)[:, 1])
            except Exception:
                pass
        results["classification"][name] = {k: round(v, 4) for k, v in m.items()}
        print(f"[clf] {name}: {results['classification'][name]}")
        if name == "random_forest":
            import joblib
            joblib.dump(pipe, OUT / "model_rf_classifier.joblib")

    # ---------- regression (days of delay), excluding >1yr outliers ----------
    reg = lab[~lab["extreme_delay"].astype(bool)]
    tr_r, te_r = reg[reg["project"].isin(tr["project"])], reg[reg["project"].isin(te["project"])]
    reg_models = {
        "dummy_median": DummyRegressor(strategy="median"),
        "random_forest_reg": RandomForestRegressor(
            n_estimators=300, min_samples_leaf=5, random_state=SEED, n_jobs=-1,
        ),
    }
    for name, model in reg_models.items():
        pipe = Pipeline([("prep", make_preprocessor()), ("model", model)])
        pipe.fit(tr_r, tr_r["delay_days"])
        pred = pipe.predict(te_r)
        results["regression"][name] = {
            "mae_days": round(mean_absolute_error(te_r["delay_days"], pred), 2),
            "rmse_days": round(root_mean_squared_error(te_r["delay_days"], pred), 2),
        }
        print(f"[reg] {name}: {results['regression'][name]}")

    (OUT / "metrics.json").write_text(json.dumps(results, indent=2))
    print(f"\nSaved metrics to {OUT / 'metrics.json'}")


if __name__ == "__main__":
    main()
