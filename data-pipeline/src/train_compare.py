"""
Model comparison for task-risk prediction (RR-3, RR-4, RR-5, PRED-4, PRED-6).

Registry v6 (RR-21c, 20.10.2026): the SERVED model is trained on corpus v3 — building projects
only (own 9 + DSLIB authentic-tracking 57, src/build_corpus_v3.py) — with target `grew`
(the activity takes longer than planned). Rationale and experiments: RR-21 / RR-21b / RR-21c.
Until v5 the target was is_late on all 15 own projects; that comparison is archived in
outputs/model_comparison_v5_is_late.json and the RR-11/12/13 scripts still reproduce it.

Classification (grew): dummy, Logistic Regression, Random Forest, XGBoost, MLP
Regression (delay_days): not trained for v6 — DSLIB has no comparable delay-days target and
the regressor was never served (PRED-11 gate failed in v3–v5).

Two leakage-aware evaluation scenarios (RR-4):
  A) cross-project GroupShuffleSplit — "new, unseen project"
  B) within-project temporal split by rel_position (train on the earlier
     TEMPORAL_CUT share of each project's timeline, test on the rest) —
     "live project mid-execution"; this is the primary deployment claim.

Hyperparameter tuning (RR-5, protocol fixed 7.9.26 — RR-19): GridSearchCV with
GroupKFold on EACH scenario's OWN training set. Until 7.9.26 the grid was searched once
on the scenario-A train set and the params reused in B; because 80% of the B test rows
(2,481/3,108) sit inside A train, the four hyperparameters had "seen" B's test rows —
a protocol-level leakage (weights never saw them). Measured effect: none in the
optimistic direction — the A-chosen params (depth 3, lr 0.05) were the WORST of the
four grid points on B test (0.7505 vs 0.757–0.762). Tuning on B train alone picks
depth 6 / lr 0.05. Each scenario now sees only its own train rows at every stage.

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
    accuracy_score, brier_score_loss, f1_score,
    precision_score, recall_score, roc_auc_score,
)
from sklearn.model_selection import GridSearchCV, GroupKFold, GroupShuffleSplit
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier, XGBRegressor

sys.path.insert(0, str(Path(__file__).resolve().parent))
from leakage import assert_as_of, plan_time  # PRED-14

SEED = 42
N_REPEATED_A = 20           # scenario A: repeated GroupShuffleSplits for the gate (RR-19)
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

# DATA-2 hardening — containment dedup (src/dedup_containment.py), two rounds:
# Round 1 (26.7.26): Enppi ⊂ MERGE PROJECTS (100%) and Enppi ⊂ hela-2l (86%) — one
#   schedule family present three times. Keep hela-2l (largest labeled superset,
#   660 labels incl. 177 unique); drop the two copies. Without this, the same task
#   could sit in scenario-B train via one copy and in test via another (leakage).
# Round 2 (16.8.26, code+name fingerprints): six more duplicate families found —
#   ALL effectively unlabeled (schedule of Medor 0 labels vs its contained copy's 16;
#   HHI/Ma'aden ⊂ Petrofac; PJ ⊂ MERGE; two baseline-vs-update pairs). No label
#   leakage was possible, so model metrics are unchanged; corpus statistics were
#   inflated and are corrected by these exclusions (scan recommendations followed).
EXCLUDE_PROJECTS = {
    "MERGE PROJECTS", "Enppi",                       # round 1 (labeled family)
    "schedule of Medor", "HHI", "Ma'aden",           # round 2 (unlabeled copies)
    "el ezz warehouse", "Baseline 15-11-2010",
    "Beyti plant baseline -b(fm-baseline)",
}


# Registry v6 target and corpus (RR-21c). load_labeled() below is the is_late-era corpus,
# kept for the research scripts that reproduce registry v5.
TARGET = "grew"
CORPUS_V3 = OUT / "corpus_v3_buildings.csv"
RISK_BAND_QUANTILES = (None, 0.90)   # PRED-12: t1 = F1-optimal threshold; high = top 10% of the calibration slice


def load_corpus() -> pd.DataFrame:
    """Corpus v3 — building projects only, target `grew` (build with src/build_corpus_v3.py)."""
    if not CORPUS_V3.exists():
        raise SystemExit(f"{CORPUS_V3} missing — run etl.py, rr17_dslib_etl.py, then build_corpus_v3.py")
    df = pd.read_csv(CORPUS_V3, low_memory=False)
    df[TARGET] = df[TARGET].astype(int)
    return df


def load_labeled() -> pd.DataFrame:
    """Labeled corpus with duplicate projects removed — single entry point for all experiments."""
    df = pd.read_csv(OUT / "labeled_tasks.csv")
    df = df[~df["project"].isin(EXCLUDE_PROJECTS)]
    lab = df[df["is_late"].notna()].copy()
    lab["is_late"] = lab["is_late"].astype(int)
    return lab


def make_preprocessor():
    return ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), NUM_FEATURES),
        ("cat", Pipeline([
            ("imp", SimpleImputer(strategy="constant", fill_value="NA")),
            ("oh", OneHotEncoder(handle_unknown="ignore")),
        ]), CAT_FEATURES),
    ])


N_BOOT = 2000   # bootstrap resamples for the within-project uncertainty (seeded)


def summarise_aucs(x: pd.Series, ci_lower: pd.Series | None = None) -> dict:
    """Per-project AUCs (one value per UNIQUE project) -> median with a 95% bootstrap CI over projects,
    share above 0.5 (a point estimate above 0.5 — NOT a demonstrated advantage), and, when per-project
    CIs exist, the share whose 95% CI lies entirely above 0.5."""
    x = pd.Series(x, dtype=float).reset_index(drop=True)
    out = {"n_projects": int(len(x)), "median_auc": None, "median_ci95": None, "share_point_estimate_above_0.5": None}
    if len(x):
        rng = np.random.default_rng(SEED)
        meds = np.median(rng.choice(x.values, size=(N_BOOT, len(x)), replace=True), axis=1)
        out.update(median_auc=round(float(x.median()), 4),
                   median_ci95=[round(float(q), 4) for q in np.quantile(meds, [0.025, 0.975])],
                   **{"share_point_estimate_above_0.5": round(float((x > 0.5).mean()), 3)})
        if ci_lower is not None:
            out["share_ci95_entirely_above_0.5"] = round(float((pd.Series(ci_lower).reset_index(drop=True) > 0.5).mean()), 3)
    return out


def eligibility(g: pd.DataFrame) -> str | None:
    """Why a project cannot get a within-project AUC (None = eligible). A stable AUC needs enough
    activities and both outcomes; the reasons are reported so readers know whom the number describes."""
    if len(g) < MIN_LABELED:
        return f"fewer than {MIN_LABELED} test activities"
    if min(g[TARGET].sum(), len(g) - g[TARGET].sum()) < 5:
        return "fewer than 5 activities in one outcome class"
    return None


def within_project_aucs(df: pd.DataFrame, proba) -> tuple[pd.DataFrame, dict]:
    """AUC inside every eligible project, with a per-project 95% bootstrap CI (activities resampled
    within the project). The product's main use is ranking the activities of ONE project.
    Returns (rows, exclusion report)."""
    rows, excluded = [], {}
    rng = np.random.default_rng(SEED)
    for proj, g in df.assign(_p=proba).groupby("project"):
        why = eligibility(g)
        if why:
            excluded[why] = excluded.get(why, 0) + 1
            continue
        y, pp = g[TARGET].to_numpy(), g["_p"].to_numpy()
        boots = []
        for _ in range(500):
            i = rng.integers(0, len(y), len(y))
            if y[i].min() != y[i].max():
                boots.append(roc_auc_score(y[i], pp[i]))
        lo, hi = np.quantile(boots, [0.025, 0.975])
        rows.append((proj, g["source"].iloc[0], roc_auc_score(y, pp), lo, hi))
    report = {"projects_in_test": int(df["project"].nunique()), "eligible": len(rows), "excluded": excluded}
    return pd.DataFrame(rows, columns=["project", "source", "auc", "ci_lo", "ci_hi"]), report


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


def temporal_split(lab: pd.DataFrame, ineligible_to_train: bool = False):
    """Scenario B: per-project temporal split at the project's own rel_position quantile.

    A fixed global cut (v1: rel_position <= 0.7) covered only 2 projects, because most
    projects concentrate their labeled activities on one side of a global cut. Cutting at
    each project's own 70th percentile keeps the split temporally valid (train strictly
    earlier than test within the project) while covering every project with enough labels.

    With ineligible_to_train=True (corpus v3), a project too small to be cut contributes ALL its
    rows to train: it is another project, so it cannot leak into any test project's future.
    """
    tr_parts, te_parts, projects = [], [], []
    for name, g in lab.groupby("project"):
        if len(g) < MIN_LABELED:
            if ineligible_to_train:
                tr_parts.append(g[g["rel_position"].notna()])
            continue
        cut = g["rel_position"].quantile(TEMPORAL_Q)
        tr_g = g[g["rel_position"] <= cut]
        te_g = g[g["rel_position"] > cut]
        if len(tr_g) >= MIN_PER_SIDE and len(te_g) >= MIN_PER_SIDE:
            tr_parts.append(tr_g)
            te_parts.append(te_g)
            projects.append(name)
        elif ineligible_to_train:
            tr_parts.append(g[g["rel_position"].notna()])
    tr_all, te_all = pd.concat(tr_parts), pd.concat(te_parts)
    n_nan = int(lab[lab["project"].isin(projects)]["rel_position"].isna().sum())
    if n_nan:
        print(f"[temporal_split] WARNING: {n_nan} rows with NaN rel_position dropped from both sides")
    return tr_all, te_all, projects


def main():
    lab = load_corpus()
    print(f"corpus v3 (buildings, target={TARGET}): {len(lab)} activities, {lab['project'].nunique()} projects "
          f"({lab.groupby('source')['project'].nunique().to_dict()})")

    # ---------- scenario A: cross-project ----------
    gss = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=SEED)
    a_tr_idx, a_te_idx = next(gss.split(lab, groups=lab["project"]))
    A_tr, A_te = lab.iloc[a_tr_idx], lab.iloc[a_te_idx]

    # ---------- scenario B: within-project temporal ----------
    B_tr, B_te, B_projects = temporal_split(lab, ineligible_to_train=True)
    assert_as_of(B_tr, B_te)   # PRED-14 rule 3: train strictly earlier than test in every project

    results = {
        "config": {
            "seed": SEED,
            "generated_by": "data-pipeline/src/train_compare.py",
            "feature_schema_version": SCHEMA_VERSION,
            "target": TARGET,
            "corpus": "corpus_v3_buildings (src/build_corpus_v3.py): own buildings + DSLIB buildings with authentic tracking",
            "corpus_by_source": {s_: {"projects": int(g_["project"].nunique()), "activities": int(len(g_)),
                                      "target_rate": round(float(g_[TARGET].mean()), 3)}
                                 for s_, g_ in lab.groupby("source")},
            "scenario_A": {"split": "GroupShuffleSplit by project, test_size=0.25",
                           "n_train": len(A_tr), "n_test": len(A_te)},
            "scenario_B": {"split": f"per-project temporal quantile cut q={TEMPORAL_Q} on rel_position",
                           "min_labeled": MIN_LABELED, "min_per_side": MIN_PER_SIDE,
                           "n_train": len(B_tr), "n_test": len(B_te),
                           "n_projects": len(B_projects), "projects": B_projects,
                           "ineligible_projects": "all rows to train (other projects — no temporal leakage into test projects)"},
            "features_num": NUM_FEATURES, "features_cat": CAT_FEATURES,
            "tuning": "GridSearchCV, GroupKFold(3) by project INSIDE each scenario's own train set (RR-19, 7.9.26; before: tuned on A train and reused in B — 80% of B test rows were in A train)",
            "calibration": ("sigmoid (Platt) via CalibratedClassifierCV(FrozenEstimator): per-project temporal "
                            "sub-split of B train at q=0.75 — champion fitted on earlier part, calibrator on the "
                            "latest slice; evaluated on scenario B only (A test overlaps B train — see note); "
                            "never fitted on test"),
        },
        "classification": {"A_cross_project": {}, "B_temporal": {}},
        "regression": {"A_cross_project": {}, "B_temporal": {}},
        "best_params": {},
    }

    # RR-19 (7.9.26): tune INSIDE each scenario's own train set. GroupKFold by project keeps
    # whole projects together in every fold; the scenario's test rows are never touched
    # before the final scoring. results["best_params"] holds the B (deployment) choice,
    # results["best_params_A"] the A choice — they may legitimately differ.
    tuned = {}
    results["best_params_A"] = {}
    for scen, (tr, te) in {"A_cross_project": (A_tr, A_te), "B_temporal": (B_tr, B_te)}.items():
        gkf = GroupKFold(n_splits=3)
        for name, (est, grid) in classifier_zoo().items():
            pipe = Pipeline([("prep", make_preprocessor()), ("model", est)])
            if grid:
                gs = GridSearchCV(pipe, grid, scoring="roc_auc", n_jobs=-1,
                                  cv=gkf.split(tr, tr[TARGET], groups=tr["project"]))
                gs.fit(plan_time(tr), tr[TARGET])
                model = gs.best_estimator_
                params = {k: (v if isinstance(v, (int, float, str)) else str(v)) for k, v in gs.best_params_.items()}
                (results["best_params"] if scen == "B_temporal" else results["best_params_A"])[name] = params
                print(f"[tune {scen}] {name}: {gs.best_params_} (cv auc={gs.best_score_:.4f})")
            else:
                pipe.fit(plan_time(tr), tr[TARGET])
                model = pipe
            pred = model.predict(plan_time(te))
            proba = model.predict_proba(plan_time(te))[:, 1] if hasattr(model, "predict_proba") else None
            results["classification"][scen][name] = clf_metrics(te[TARGET], pred, proba)
            print(f"[clf {scen}] {name}: {results['classification'][scen][name]}")
            if scen == "B_temporal":
                tuned[name] = model

    # ---------- scenario A, repeated — NESTED (RR-13 follow-up; the gate reads the champion's row) ----------
    # 20 GroupShuffleSplits by project. Since v6 the hyperparameters are tuned INSIDE each split's own
    # train set (GridSearchCV, GroupKFold(3) by project): the B-tuned params used until v5 had seen rows
    # of projects that later sit in an A test set (external review, 20.10.26; measured effect on the v6
    # champion's median: 0.734 -> 0.728). Reported per family:
    #   pooled AUC per split (median, IQR, min/max, share above chance) — mixes between- and within-project
    #   ranking; within-project AUC — every test project with >=30 labels and >=5 per class, averaged per
    #   UNIQUE project over the splits it appears in, then summarised across projects (each project counts
    #   once), overall and per source; project-level diagnostic — Spearman of each project's mean predicted
    #   risk vs its observed rate across unique test projects (what the pooled-vs-within gap could reflect).
    results["classification"]["A_repeated"] = {}
    for name, (est, grid) in classifier_zoo().items():
        if name == "dummy_majority":
            continue
        aucs, within, proj_level, not_eligible = [], {}, {}, {}
        for seed in range(N_REPEATED_A):
            tr_i, te_i = next(GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=seed).split(lab, groups=lab["project"]))
            a_tr, a_te = lab.iloc[tr_i], lab.iloc[te_i]
            if a_te[TARGET].nunique() < 2:
                continue
            pipe = Pipeline([("prep", make_preprocessor()), ("model", clone(est))])
            if grid:
                gs = GridSearchCV(pipe, grid, scoring="roc_auc", n_jobs=-1,
                                  cv=GroupKFold(n_splits=3).split(a_tr, a_tr[TARGET], groups=a_tr["project"]))
                gs.fit(plan_time(a_tr), a_tr[TARGET])
                m = gs.best_estimator_
            else:
                m = pipe.fit(plan_time(a_tr), a_tr[TARGET])
            p = m.predict_proba(plan_time(a_te))[:, 1]
            aucs.append(roc_auc_score(a_te[TARGET], p))
            for proj, g in a_te.assign(_p=p).groupby("project"):
                proj_level.setdefault(proj, []).append((g["source"].iloc[0], float(g["_p"].mean()), float(g[TARGET].mean())))
                if eligibility(g) is None:
                    within.setdefault(proj, []).append((g["source"].iloc[0], roc_auc_score(g[TARGET], g["_p"])))
                else:
                    not_eligible.setdefault(proj, eligibility(g))
        arr = np.array(aucs)
        w = pd.DataFrame([(src, float(np.mean([a for _, a in v]))) for v in within.values() for src in [v[0][0]]],
                         columns=["source", "auc"])
        pl = pd.DataFrame([(v[0][0], float(np.mean([x[1] for x in v])), float(np.mean([x[2] for x in v])))
                           for v in proj_level.values()], columns=["source", "mean_pred", "observed"])
        results["classification"]["A_repeated"][name] = {
            "tuning": "nested — GridSearchCV inside each split's train set",
            "n_splits": int(len(arr)), "median_auc": round(float(np.median(arr)), 4),
            "q25": round(float(np.percentile(arr, 25)), 4), "q75": round(float(np.percentile(arr, 75)), 4),
            "min": round(float(arr.min()), 4), "max": round(float(arr.max()), 4),
            "share_above_chance": round(float((arr > 0.5).mean()), 3),
            "within_project": {"all": summarise_aucs(w["auc"]),
                               **{s_: summarise_aucs(g_["auc"]) for s_, g_ in w.groupby("source")},
                               "coverage": {"unique_projects_tested": len(proj_level),
                                            "eligible_in_at_least_one_split": len(within),
                                            "never_eligible": {why: sum(1 for p_, r_ in not_eligible.items()
                                                                        if r_ == why and p_ not in within)
                                                               for why in set(not_eligible.values())},
                                            "note": "a project is averaged over the splits where it was eligible; "
                                                    "the summary describes eligible projects only"}},
            "project_level_spearman": {s_: {"n_projects": int(len(g_)),
                                            "rho": round(float(g_["mean_pred"].corr(g_["observed"], method="spearman")), 3)}
                                       for s_, g_ in pl.groupby("source") if len(g_) >= 5},
        }
        print(f"[clf A_repeated nested] {name}: {results['classification']['A_repeated'][name]}")

    # ---------- regression: not trained for v6 ----------
    # PRED-11: the delay-days regressor failed its gate in v3–v5 (never served), and the v6 corpus
    # has no common delay-days target (DSLIB delays are against a frozen baseline). Classification only.
    results["regression"] = {"skipped": "registry v6 is classification-only (target grew); see PRED-11 in model_comparison_v5_is_late.json"}

    # ---------- champion selection — NESTED, on the inner slice of B train (RR-19b, 7.9.26) ----------
    # Until 7.9.26 the family (RF vs XGB vs ...) was chosen by roc_auc on B_test and then reported on the
    # same B_test — a model-selection bias (external review, 7.9.26). Selection now happens on the inner
    # temporal slice of B TRAIN (each project's rel_position > q0.75 — the same slice the calibrator uses):
    # every tuned family is refitted on the earlier 75% and scored on that slice; the best one is the
    # champion. B_test is touched once, for reporting. The old B_test ranking is kept for transparency.
    b_clf = results["classification"]["B_temporal"]
    fit_parts, cal_parts = [], []
    for _, g in B_tr.groupby("project"):
        c = g["rel_position"].quantile(0.75)
        fit_parts.append(g[g["rel_position"] <= c])
        cal_parts.append(g[g["rel_position"] > c])
    B_fit, B_cal = pd.concat(fit_parts), pd.concat(cal_parts)
    inner = {}
    for name, est in tuned.items():
        if name == "dummy_majority":
            continue
        m = clone(est)
        m.fit(plan_time(B_fit), B_fit[TARGET])
        inner[name] = round(float(roc_auc_score(B_cal[TARGET], m.predict_proba(plan_time(B_cal))[:, 1])), 4)
        print(f"[select inner] {name}: roc_auc on B_cal = {inner[name]}")
    results["classification"]["B_inner_selection"] = inner
    ranked = sorted(inner, key=lambda n: inner[n], reverse=True)
    champion, runner_up = ranked[0], (ranked[1] if len(ranked) > 1 else None)
    champion_reg = None
    test_ranked = sorted((n for n in b_clf if n != "dummy_majority"), key=lambda n: b_clf[n].get("roc_auc", 0), reverse=True)
    results["champion"] = {
        "classifier": champion, "regressor": champion_reg,
        "selected_by": "roc_auc on the inner temporal slice of B TRAIN (q0.75) — nested selection, B_test untouched (RR-19b)",
        "inner_selection_auc": inner,
        "runner_up_classifier": runner_up,
        "delta_auc_vs_runner_up": (round(b_clf[champion]["roc_auc"] - b_clf[runner_up]["roc_auc"], 4)
                                   if runner_up else None),
        "b_test_ranking_for_transparency": test_ranked,
        "same_champion_as_b_test_ranking": bool(test_ranked[0] == champion),
        "note": "see outputs/bootstrap_ci.json for the CI of the champion-vs-runner-up AUC delta (task- and project-level)",
    }
    print(f"\n[champion] clf={champion}  reg={champion_reg}  "
          f"(runner-up {runner_up}, ΔAUC {results['champion']['delta_auc_vs_runner_up']})")

    # ---------- PRED-13: probability calibration on B train (never on test) ----------
    # Protocol (documented, selected on train-side data only): the late-activity base
    # rate drifts across a project's life (train 0.46 → test 0.29 in this corpus), so a
    # calibrator fitted on the WHOLE train span learns stale frequencies. We therefore
    # sub-split the train per project at its own q=0.75 rel_position quantile: the
    # champion is fitted on the earlier part, and a sigmoid (Platt) calibrator is fitted
    # on the latest slice — the distribution closest to deployment time. Sigmoid chosen
    # over isotonic for robustness on the modest calibration slice (isotonic evaluated,
    # comparable). Test data is never touched.
    # (B_fit / B_cal computed above — the same slice selected the champion)
    champ_fit = clone(tuned[champion])
    champ_fit.fit(plan_time(B_fit), B_fit[TARGET])
    calibrated = CalibratedClassifierCV(FrozenEstimator(champ_fit), method="sigmoid")
    calibrated.fit(plan_time(B_cal), B_cal[TARGET])

    def brier(model, te):
        return round(float(brier_score_loss(te[TARGET], model.predict_proba(plan_time(te))[:, 1])), 4)

    # Calibration is evaluated on scenario B ONLY. The A test set overlaps the B train
    # side (the two splits cut the same corpus differently), so evaluating the calibrated
    # model on A_te would score it partly on its own training rows — leakage. (Found in
    # the 16.8 internal audit; A-side calibration Brier from earlier runs is void.)
    cal_metrics = {
        "B_temporal": {
            "brier_uncalibrated_same_base": brier(champ_fit, B_te),  # fair comparison: same fitted model
            "brier_calibrated": brier(calibrated, B_te),
        }
    }
    pred_cal = calibrated.predict(plan_time(B_te))
    proba_cal = calibrated.predict_proba(plan_time(B_te))[:, 1]
    cal_metrics["B_temporal"]["classification_calibrated"] = clf_metrics(
        B_te[TARGET], pred_cal, proba_cal)
    # per source: the product claim is about OWN-style building projects; DSLIB is reported beside it
    by_source = {}
    for src, g in B_te.assign(_p=proba_cal).groupby("source"):
        if g[TARGET].nunique() == 2:
            by_source[src] = {"n_test": int(len(g)), "target_rate": round(float(g[TARGET].mean()), 3),
                              "roc_auc": round(float(roc_auc_score(g[TARGET], g["_p"])), 4),
                              "brier": round(float(brier_score_loss(g[TARGET], g["_p"])), 4)}
    cal_metrics["B_temporal"]["by_source"] = by_source
    wp, wp_cov = within_project_aucs(B_te, proba_cal)
    within_B = {"all": summarise_aucs(wp["auc"], wp["ci_lo"]),
                **{s_: summarise_aucs(g_["auc"], g_["ci_lo"]) for s_, g_ in wp.groupby("source")},
                "coverage": {**wp_cov, "note": "test projects of scenario B; the summary describes eligible projects only"},
                "per_project": {r.project: {"auc": round(float(r.auc), 4), "ci95": [round(float(r.ci_lo), 3), round(float(r.ci_hi), 3)]}
                                for r in wp.itertuples()}}
    cal_metrics["B_temporal"]["within_project"] = within_B

    # ---------- PRED-12: risk bands + decision threshold by a documented protocol ----------
    # Selected on TRAIN-side data only (the calibration slice B_cal), never on test:
    #   decision_threshold — the calibrated probability that maximises F1 on B_cal; it is the binary
    #                        label of /predict AND the low|medium boundary (t1), so "flagged" and
    #                        "medium or high" can never disagree in the UI;
    #   t2 (high)          — the 90th percentile of the calibrated probability on B_cal: "high" is the
    #                        top 10% (the quantile idea of bias_and_alerts.py, which avoided the 21.5%
    #                        "red" flood of fixed 0.33/0.66). If the quantile falls below t1, t2 = t1.
    p_cal = calibrated.predict_proba(plan_time(B_cal))[:, 1]
    grid = np.round(np.arange(0.05, 0.951, 0.01), 2)
    f1s = [f1_score(B_cal[TARGET], (p_cal >= t).astype(int), zero_division=0) for t in grid]
    decision = float(grid[int(np.argmax(f1s))])
    t1 = decision
    t2 = round(max(float(np.quantile(p_cal, RISK_BAND_QUANTILES[1])), t1), 4)
    risk_bands = {"t1": t1, "t2": t2, "decision_threshold": decision,
                  "protocol": ("t1 = decision_threshold = argmax F1 of the calibrated probability on the train-side "
                               f"calibration slice B_cal (grid 0.05..0.95); t2 = its {RISK_BAND_QUANTILES[1]:.0%} quantile on "
                               "B_cal (high = top 10%), floored at t1; test never used"),
                  "selected_on": f"B_cal ({len(B_cal)} activities)"}
    pred_thr = (proba_cal >= decision).astype(int)
    cal_metrics["B_temporal"]["classification_at_decision_threshold"] = clf_metrics(B_te[TARGET], pred_thr, proba_cal)
    te_band = np.where(proba_cal >= t2, "high", np.where(proba_cal >= t1, "medium", "low"))
    risk_bands["test_band_shares"] = {b_: round(float((te_band == b_).mean()), 3) for b_ in ("low", "medium", "high")}
    risk_bands["test_target_rate_by_band"] = {b_: round(float(B_te[TARGET][te_band == b_].mean()), 3)
                                              for b_ in ("low", "medium", "high") if (te_band == b_).any()}
    cal_tab = pd.DataFrame({"band": te_band, "p": proba_cal, "y": B_te[TARGET].values, "src": B_te["source"].values})
    risk_bands["test_calibration_by_band"] = {
        b_: {"n": int(len(g_)), "mean_predicted": round(float(g_["p"].mean()), 3), "observed": round(float(g_["y"].mean()), 3)}
        for b_, g_ in cal_tab.groupby("band")}
    risk_bands["test_calibration_by_source_band"] = {
        f"{s_}/{b_}": {"n": int(len(g_)), "mean_predicted": round(float(g_["p"].mean()), 3), "observed": round(float(g_["y"].mean()), 3)}
        for (s_, b_), g_ in cal_tab.groupby(["src", "band"])}
    gaps = [v["mean_predicted"] - v["observed"] for v in risk_bands["test_calibration_by_band"].values()]
    risk_bands["display_rule"] = (
        "show the BAND, not the percentage: the bands are ordered correctly, but in the upper bands the "
        f"calibrated probability over-states the observed rate by up to {max(gaps):.2f} on test")
    results["risk_bands"] = risk_bands
    print(f"[PRED-12] {json.dumps(risk_bands)}")

    results["calibration"] = {
        "method": "sigmoid (Platt)",
        "protocol": "per-project temporal sub-split of B train at q=0.75: champion fitted on earlier part, calibrator on latest slice (distribution closest to deployment); selected on train-side data only",
        "evaluated_on": "B_temporal only (A test overlaps B train — evaluating there would be leakage)",
        "n_fit": len(B_fit), "n_cal": len(B_cal),
        **cal_metrics}
    print(f"[calibration] {json.dumps(cal_metrics)}")

    # ---------- what is actually SERVED (the artifact written below) ----------
    # The championship table above scores a model fitted on the FULL B train; the served
    # artifact is the calibrated pipeline whose base model saw only B_fit. Both metric
    # sets are reported; the served one is what the product exposes and what the gate
    # must hold to. Book headline = served metrics; selection metrics answer "why XGB".
    results["served_model"] = {
        "artifact": "calibrated pipeline (champion fitted on B_fit + sigmoid calibrator on B_cal)",
        "target": TARGET,
        "metrics_B_test": cal_metrics["B_temporal"]["classification_calibrated"],
        "metrics_B_test_at_decision_threshold": cal_metrics["B_temporal"]["classification_at_decision_threshold"],
        "by_source_B_test": by_source,
        "within_project_B_test": within_B,
        "brier_B_test": cal_metrics["B_temporal"]["brier_calibrated"],
        "selection_metrics_note": ("champion selection used the full-B_tr fit "
                                   f"(roc_auc {b_clf[champion]['roc_auc']}); that fit is NOT the served artifact"),
    }
    print(f"[served] {json.dumps(results['served_model']['metrics_B_test'])}")

    # reliability curve figure (project book, RR-6/PRED-13)
    fig_dir = OUT / "figures"
    fig_dir.mkdir(exist_ok=True)
    frac_u, mean_u = calibration_curve(B_te[TARGET], champ_fit.predict_proba(plan_time(B_te))[:, 1], n_bins=10)
    frac_c, mean_c = calibration_curve(B_te[TARGET], proba_cal, n_bins=10)
    plt.figure(figsize=(6.4, 5.2), dpi=150)
    plt.plot([0, 1], [0, 1], ls="--", lw=1, color="#9a9a9a", zorder=1)
    plt.plot(mean_u, frac_u, marker="o", ms=6, lw=2, color="#eb6834", zorder=2)
    plt.plot(mean_c, frac_c, marker="o", ms=6, lw=2, color="#2a78d6", zorder=3)
    # direct labels instead of a floating legend (accessibility relief)
    plt.annotate("Uncalibrated", xy=(mean_u[-1], frac_u[-1]), xytext=(6, -12),
                 textcoords="offset points", color="#3a3a3a", fontsize=10)
    plt.annotate("Calibrated (sigmoid)", xy=(mean_c[-1], frac_c[-1]), xytext=(6, 8),
                 textcoords="offset points", color="#3a3a3a", fontsize=10)
    plt.xlabel("Predicted probability of duration overrun")
    plt.ylabel("Observed fraction overrun")
    plt.title("Reliability curve — scenario B test (champion classifier)")
    plt.grid(alpha=0.25, lw=0.5)
    plt.tight_layout()
    plt.savefig(fig_dir / "reliability_curve_B.png")
    plt.close()

    # ---------- gate BEFORE publish (PRED-6): a failing candidate never reaches the registry ----------
    (OUT / "model_comparison.json").write_text(json.dumps(results, indent=2))
    from quality_gate import check as gate_check
    gate_failures = gate_check(results)
    if gate_failures:
        print("QUALITY GATE: FAILED — registry NOT written")
        for f in gate_failures:
            print("  -", f)
        print(f"Saved {OUT / 'model_comparison.json'} (for diagnosis)")
        return 1

    # ---------- registry write (PRED-4 + PRED-8 + PRED-13) ----------
    REGISTRY.mkdir(parents=True, exist_ok=True)
    existing = sorted(int(p.name[1:]) for p in REGISTRY.glob("v*") if p.name[1:].isdigit())
    version = f"v{(existing[-1] + 1) if existing else 1}"
    vdir = REGISTRY / version
    vdir.mkdir()
    joblib.dump(calibrated, vdir / "classifier.joblib", compress=3)   # served = calibrated
    reg_gate_passed = False   # PRED-11: v6 is classification-only (see regression note above)
    shutil.copy(SCHEMA_PATH, vdir / "feature_schema.json")        # self-contained artifact
    meta = {
        "version": version,
        "created_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "feature_schema_version": SCHEMA_VERSION,
        "target": TARGET,
        "target_definition": "grew = the activity takes longer than planned (actual duration > planned duration)",
        "corpus": results["config"]["corpus"],
        "corpus_by_source": results["config"]["corpus_by_source"],
        "champion_classifier": champion,
        "champion_regressor": champion_reg,
        "risk_bands": risk_bands,
        "calibration": results["calibration"],
        "best_params": results["best_params"].get(champion, {}),
        "served_metrics_B_temporal": cal_metrics["B_temporal"]["classification_calibrated"],
        "served_brier_B_temporal": cal_metrics["B_temporal"]["brier_calibrated"],
        "served_by_source_B_temporal": by_source,
        "served_within_project_B_temporal": within_B,
        "metrics_B_temporal": {
            "classification_uncalibrated_full_train_fit_NOT_SERVED": b_clf[champion],
            "classification_calibrated": cal_metrics["B_temporal"]["classification_calibrated"],
            "classification_at_decision_threshold": cal_metrics["B_temporal"]["classification_at_decision_threshold"],
        },
        "metrics_A_cross_project": {"classification": results["classification"]["A_cross_project"][champion],
                                    "note": "single seed-42 split, reported for continuity only; the gate reads A_repeated (RR-19)"},
        "metrics_A_repeated": results["classification"]["A_repeated"].get(champion),
        "claims": {
            "supported": ("historical evaluation ordered by PLANNED position (scenario B): ranks activities of running "
                          "building projects, pooled and within project (within-project on few eligible projects — see coverage)"),
            "weak": ("NEW project: pooled AUC is well above the within-project AUC; the source of that gap "
                     "(project-level risk vs corpus differences) is not established — see A_repeated.within_project "
                     "and project_level_spearman"),
            "not_supported": "exact probabilities in the medium/high bands (see risk_bands.display_rule)",
            "time_limitation": ("scenario B orders activities by planned position (rel_position), not by when their "
                                "outcome became known, and uses the exported plan, not the plan as of prediction time (risk R19); "
                                "RR-14 is a direction to address it, not a demonstrated fix"),
        },
        "protocol_note": ("RR-19 (7.9.26): hyperparameters tuned INSIDE each scenario's own train set (GroupKFold by project); "
                          "until then they were tuned on A train, which overlaps 80% of B test — measured non-optimistic. "
                          "Gate rule for A moved from a single split to 20 repeated splits. RR-19b: model family selected on the inner "
                          "slice of B train, not on B test (nested selection)."),
        "features_num": NUM_FEATURES, "features_cat": CAT_FEATURES,
        "seed": SEED,
        "trained_on": "B_temporal train split (deployment scenario)",
        "regression_deployed": reg_gate_passed,
        "excluded_duplicate_projects": sorted(EXCLUDE_PROJECTS),
        "rr21_note": ("RR-21c (20.10.26): building projects only; removing the 5 non-building own projects raised the "
                      "leave-one-project-out median AUC on grew from 0.551 to 0.623; adding DSLIB authentic buildings 0.630"),
    }
    (vdir / "meta.json").write_text(json.dumps(meta, indent=2))
    print(f"Registry: {vdir}\nSaved {OUT / 'model_comparison.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
