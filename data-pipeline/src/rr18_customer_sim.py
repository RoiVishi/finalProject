"""
RR-18 — "Customer simulation": train ONLY on one customer's history (DSLIB construction) and predict that
customer's NEW projects. Product question: "a company hands us its historical schedules; we retrain on them alone —
what does the buyer get?" DSLIB is the stand-in customer (117 tracked projects, frozen baselines, tracking snapshots).

PRE-REGISTERED (2.9.2026, written before any DSLIB-only model was fitted). Known from RR-17 and stated as facts, not
hypotheses: frozen-baseline is_late is mostly inherited drift (rel_position alone → per-project AUC 0.647); planned
duration carries no signal here (0.45–0.49); pooled models (v4 / v5 / corpus v3) sit at 0.42–0.53 on DSLIB hold-out
is_late and 0.44–0.58 on grew; the project-level drift rule (median start slip so far) reaches 0.674 at as-of time.
Same 60/40 project split as RR-17 (seed 42, stratified by sector group) so numbers are directly comparable.

  H1  New-project hold-out, is_late: DSLIB-only RF per-project median ≥ 0.62 and pooled ≥ 0.58 — the customer-specific
      convention (frozen baseline → later tasks later) is learnable and beats every pooled model from RR-17.
  H2  New-project hold-out, grew: pooled AUC in [0.55, 0.65] (weak plan-time signal under a frozen baseline); buildings alike.
  H3  Learning curve (train on n ∈ {5,10,20,40,all≈70} projects, 10 draws each, fixed hold-out): the median at n=20 is
      within 0.03 of n=all; at n=5 the IQR across draws is ≥ 0.10 — small, homogeneous projects saturate early but are noisy.
  H4  At as-of time (hold-out snapshots, not-started activities): a logistic combination of [plan-time model score,
      median start slip so far, share finished late so far] beats the drift rule alone (0.674) by ≥ 0.03 on is_late.
  H5  Per-customer Platt calibration (fitted on the customer's own train slice) gives hold-out Brier ≤ 0.22 (< dummy
      0.229) — where every pooled calibrator in RR-17 failed.
  H6  Reverse transfer: the DSLIB-only model scored on OUR labeled corpus gives AUC ≤ 0.45 — the sign inversion holds
      in both directions (confirms the label-construct finding).
Anything outside the bands is a finding. Nothing is tuned on the hold-out.

Run: python rr18_customer_sim.py <dslib_labeled.csv> <asof_instances.csv> <own_labeled.csv> <schema.json> <out_dir>
"""

from __future__ import annotations
import json
import sys
import warnings
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score, brier_score_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

warnings.filterwarnings("ignore")

DSL, INST, OWN, SCHEMA, OUT = map(Path, sys.argv[1:6])
OUT.mkdir(parents=True, exist_ok=True)
SEED, TEMPORAL_Q, MIN_LABELED, MIN_PER_SIDE, HOLDOUT = 42, 0.7, 30, 10, 0.4
schema = json.loads(SCHEMA.read_text())
NUM = [f["name"] for f in schema["features"] if f["role"] == "numeric"]
CAT = [f["name"] for f in schema["features"] if f["role"] == "categorical"]
XGB_PARAMS = dict(learning_rate=0.05, max_depth=3, n_estimators=300, subsample=0.8)
RF_PARAMS = dict(max_features="sqrt", min_samples_leaf=20, n_estimators=300)
EXCLUDE_OWN = {
    "MERGE PROJECTS",
    "Enppi",
    "schedule of Medor",
    "HHI",
    "Ma'aden",
    "el ezz warehouse",
    "Baseline 15-11-2010",
    "Beyti plant baseline -b(fm-baseline)",
}


def auc(y, s):
    y = np.asarray(y)
    return round(float(roc_auc_score(y, s)), 4) if len(np.unique(y)) > 1 else None


def brier(y, p):
    return round(float(brier_score_loss(y, p)), 4)


def dummy_brier(y):
    y = np.asarray(y, float)
    return round(float(((y.mean() - y) ** 2).mean()), 4)


def per_project(d, lbl, score, min_n=30):
    v = []
    for _, g in d.assign(_s=score).groupby("project"):
        if len(g) < min_n or g[lbl].sum() < 5 or (len(g) - g[lbl].sum()) < 5:
            continue
        v.append(roc_auc_score(g[lbl], g["_s"]))
    v = np.array(v, float)
    return (
        dict(
            n_projects=len(v),
            median=round(float(np.median(v)), 4),
            q25=round(float(np.percentile(v, 25)), 4),
            q75=round(float(np.percentile(v, 75)), 4),
            share_above_chance=round(float((v > 0.5).mean()), 3),
        )
        if len(v)
        else None
    )


def prep():
    return ColumnTransformer(
        [
            (
                "num",
                Pipeline(
                    [
                        ("imp", SimpleImputer(strategy="median")),
                        ("sc", StandardScaler()),
                    ]
                ),
                NUM,
            ),
            (
                "cat",
                Pipeline(
                    [
                        ("imp", SimpleImputer(strategy="constant", fill_value="NA")),
                        ("oh", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                CAT,
            ),
        ]
    )


def models():
    return {
        "dummy": DummyClassifier(strategy="prior"),
        "logistic_regression": LogisticRegression(
            max_iter=2000, class_weight="balanced", C=10.0
        ),
        "random_forest": RandomForestClassifier(
            class_weight="balanced", random_state=SEED, n_jobs=-1, **RF_PARAMS
        ),
        "xgboost": XGBClassifier(
            random_state=SEED,
            n_jobs=-1,
            eval_metric="logloss",
            tree_method="hist",
            **XGB_PARAMS,
        ),
    }


def fit(est, X, y):
    p = Pipeline([("prep", prep()), ("model", est)])
    p.fit(X, y)
    return p


# ---------- customer data & the RR-17 split ----------
dsl = pd.read_csv(DSL, dtype={"project": str})
dsl["project"] = "dslib::" + dsl["project"]
dsl["task_type"] = "NA"
lab = dsl[dsl["is_late"].notna()].copy()
for lb in ("is_late", "is_late_7", "grew"):
    lab[lb] = lab[lb].astype(int)
rng = np.random.default_rng(SEED)
hold = set()
for grp, g in lab.groupby("sector_group"):
    projs = sorted(g["project"].unique())
    rng.shuffle(projs)
    hold |= set(projs[: int(round(HOLDOUT * len(projs)))])
tr, te = lab[~lab["project"].isin(hold)].copy(), lab[lab["project"].isin(hold)].copy()
R = {
    "config": dict(
        seed=SEED,
        split="same 60/40 project split as RR-17",
        train_projects=int(tr["project"].nunique()),
        train_rows=int(len(tr)),
        holdout_projects=int(te["project"].nunique()),
        holdout_rows=int(len(te)),
        holdout_base_rates={
            lb: round(float(te[lb].mean()), 4)
            for lb in ("is_late", "is_late_7", "grew")
        },
    )
}
te_b = te[te["sector_group"] == "buildings"]

# ---------- Part A: new-project hold-out ----------
A, fitted = {}, {}
for lbl in ("is_late", "is_late_7", "grew"):
    A[lbl] = {
        "reference_rel_position": (lambda a: round(max(a, 1 - a), 4))(
            auc(te[lbl], te["rel_position"].fillna(0))
        ),
        "reference_duration": (lambda a: round(max(a, 1 - a), 4))(
            auc(te[lbl], te["planned_duration_days"].fillna(0))
        ),
    }
    for name, est in models().items():
        m = fit(est, tr, tr[lbl])
        p = m.predict_proba(te)[:, 1]
        fitted[(name, lbl)] = m
        A[lbl][name] = dict(
            pooled=auc(te[lbl], p),
            per_project=per_project(te, lbl, p),
            buildings=auc(te_b[lbl], p[(te["sector_group"] == "buildings").to_numpy()]),
            by_group={
                g: auc(x[lbl], p[(te["sector_group"] == g).to_numpy()])
                for g, x in te.groupby("sector_group")
            },
        )
    print(
        "A",
        lbl,
        {
            k: (
                v["pooled"],
                v["per_project"]["median"] if v.get("per_project") else None,
            )
            for k, v in A[lbl].items()
            if isinstance(v, dict)
        },
    )
R["part_A_new_project_holdout"] = A


# ---------- Part B: within-project scenario B on ALL labeled DSLIB projects (customer's ongoing project) ----------
def temporal_split(df):
    a_, b_ = [], []
    for _, g in df.groupby("project"):
        if len(g) < MIN_LABELED:
            continue
        cut = g["rel_position"].quantile(TEMPORAL_Q)
        a, b = g[g["rel_position"] <= cut], g[g["rel_position"] > cut]
        if len(a) >= MIN_PER_SIDE and len(b) >= MIN_PER_SIDE:
            a_.append(a)
            b_.append(b)
    return pd.concat(a_), pd.concat(b_)


B_tr, B_te = temporal_split(lab)
B = {
    "n_train": int(len(B_tr)),
    "n_test": int(len(B_te)),
    "projects": int(B_tr["project"].nunique()),
    "results": {},
}
for lbl in ("is_late", "grew"):
    B["results"][lbl] = {
        name: auc(B_te[lbl], fit(est, B_tr, B_tr[lbl]).predict_proba(B_te)[:, 1])
        for name, est in models().items()
    }
    B["results"][lbl]["reference_rel_position"] = (lambda a: round(max(a, 1 - a), 4))(
        auc(B_te[lbl], B_te["rel_position"].fillna(0))
    )
print("B", B["results"])
R["part_B_within_project_scenarioB"] = B

# ---------- Part C: learning curve by number of customer projects ----------
train_projects = sorted(tr["project"].unique())
C = {"n_train_projects_available": len(train_projects), "curve": {}}
for lbl in ("is_late", "grew"):
    C["curve"][lbl] = {}
    for n in (5, 10, 20, 40, len(train_projects)):
        vals, meds = [], []
        for d in range(10 if n < len(train_projects) else 1):
            r2 = np.random.default_rng(SEED + d)
            sub = tr[tr["project"].isin(r2.choice(train_projects, n, replace=False))]
            if sub[lbl].nunique() < 2:
                continue
            p = fit(
                RandomForestClassifier(
                    class_weight="balanced", random_state=SEED, n_jobs=-1, **RF_PARAMS
                ),
                sub,
                sub[lbl],
            ).predict_proba(te)[:, 1]
            vals.append(roc_auc_score(te[lbl], p))
            pp = per_project(te, lbl, p)
            meds.append(pp["median"] if pp else np.nan)
        v = np.array(vals)
        C["curve"][lbl][str(n)] = dict(
            draws=len(v),
            pooled_median=round(float(np.median(v)), 4),
            pooled_iqr=round(float(np.percentile(v, 75) - np.percentile(v, 25)), 4),
            pooled_min=round(float(v.min()), 4),
            pooled_max=round(float(v.max()), 4),
            per_project_median_of_medians=round(float(np.nanmedian(meds)), 4),
            rows_median=int(
                np.median(
                    [
                        len(
                            tr[
                                tr["project"].isin(
                                    np.random.default_rng(SEED + d).choice(
                                        train_projects, n, replace=False
                                    )
                                )
                            ]
                        )
                        for d in range(len(v))
                    ]
                )
            ),
        )
    print("C", lbl, {k: v["pooled_median"] for k, v in C["curve"][lbl].items()})
R["part_C_learning_curve"] = C

# ---------- Part D: as-of combination on hold-out snapshots ----------
inst_df = pd.read_csv(INST)
inst_df["task_type"] = "NA"
I_tr, I_te = (
    inst_df[~inst_df["project"].isin(hold)].copy(),
    inst_df[inst_df["project"].isin(hold)].copy(),
)
D = {
    "holdout_instances": int(len(I_te)),
    "holdout_snapshots": int(I_te.groupby(["project", "tp"]).ngroups),
    "holdout_projects": int(I_te["project"].nunique()),
    "results": {},
}
for lbl in ("is_late", "grew"):
    m = fitted[("random_forest", lbl)]
    I_te["m"] = m.predict_proba(I_te)[
        :, 1
    ]  # plan-time model trained on train projects only
    # stacking without leakage: the combiner must see OUT-OF-FOLD model scores on the train instances (GroupKFold by project)
    from sklearn.model_selection import GroupKFold

    oof = np.zeros(len(I_tr))
    for a_, b_ in GroupKFold(n_splits=5).split(I_tr, I_tr[lbl], groups=I_tr["project"]):
        sub_tr = tr[tr["project"].isin(I_tr.iloc[a_]["project"].unique())]
        oof[b_] = fit(
            RandomForestClassifier(
                class_weight="balanced", random_state=SEED, n_jobs=-1, **RF_PARAMS
            ),
            sub_tr,
            sub_tr[lbl],
        ).predict_proba(I_tr.iloc[b_])[:, 1]
    I_tr["m"] = oof
    drift = I_te["median_start_slip_so_far"].fillna(0)
    share_late = I_te["share_finished_late_so_far"].fillna(0)
    res = {
        "plan_time_model_alone": auc(I_te[lbl], I_te["m"]),
        "drift_rule_alone": (lambda a: round(max(a, 1 - a), 4))(auc(I_te[lbl], drift)),
        "share_finished_late_alone": (lambda a: round(max(a, 1 - a), 4))(
            auc(I_te[lbl], share_late)
        ),
        "plan_time_model_per_project": per_project(I_te, lbl, I_te["m"]),
    }
    cols = ["m", "median_start_slip_so_far", "share_finished_late_so_far"]
    comb = Pipeline(
        [
            ("imp", SimpleImputer(strategy="median")),
            ("sc", StandardScaler()),
            ("lr", LogisticRegression(max_iter=2000, class_weight="balanced")),
        ]
    )
    comb.fit(I_tr[cols], I_tr[lbl])
    pc = comb.predict_proba(I_te[cols])[:, 1]
    res["combination_model+drift_logistic"] = auc(I_te[lbl], pc)
    res["combination_per_project"] = per_project(I_te, lbl, pc)
    res["combination_coefficients"] = dict(
        zip(cols, [round(float(c), 3) for c in comb.named_steps["lr"].coef_[0]])
    )
    res["gain_over_drift_rule"] = round(
        res["combination_model+drift_logistic"] - res["drift_rule_alone"], 4
    )
    D["results"][lbl] = res
    print("D", lbl, {k: v for k, v in res.items() if not isinstance(v, dict)})
R["part_D_asof_combination"] = D

# ---------- Part E: per-customer calibration ----------
fit_parts, cal_parts = [], []
for _, g in tr.groupby("project"):
    c = g["rel_position"].quantile(0.75)
    fit_parts.append(g[g["rel_position"] <= c])
    cal_parts.append(g[g["rel_position"] > c])
F, Cc = pd.concat(fit_parts), pd.concat(cal_parts)
E = {"n_fit": int(len(F)), "n_cal": int(len(Cc)), "holdout": {}}
for lbl in ("is_late", "grew"):
    rf = fit(
        RandomForestClassifier(
            class_weight="balanced", random_state=SEED, n_jobs=-1, **RF_PARAMS
        ),
        F,
        F[lbl],
    )
    cal = CalibratedClassifierCV(FrozenEstimator(rf), method="sigmoid")
    cal.fit(Cc, Cc[lbl])
    pu, pc = rf.predict_proba(te)[:, 1], cal.predict_proba(te)[:, 1]
    E["holdout"][lbl] = dict(
        brier_dummy=dummy_brier(te[lbl]),
        brier_uncalibrated=brier(te[lbl], pu),
        brier_calibrated=brier(te[lbl], pc),
        mean_p_calibrated=round(float(pc.mean()), 4),
        base_rate=round(float(te[lbl].mean()), 4),
        auc_calibrated=auc(te[lbl], pc),
    )
print("E", E["holdout"])
R["part_E_customer_calibration"] = E

# ---------- Part F: reverse transfer to OUR corpus ----------
own = pd.read_csv(OWN)
own = own[~own["project"].isin(EXCLUDE_OWN)]
own = own[own["is_late"].notna()].copy()
own["is_late"] = (
    own["is_late"].astype(str).str.lower().isin(["true", "1", "1.0"]).astype(int)
)
p = fitted[("random_forest", "is_late")].predict_proba(own[NUM + CAT])[:, 1]
R["part_F_reverse_transfer_to_own"] = dict(
    n=int(len(own)),
    pooled_auc=auc(own["is_late"], p),
    per_project=per_project(own, "is_late", p),
    note="DSLIB-only RF (is_late) scored on our labeled corpus; v4 on DSLIB gave 0.389 (RR-17)",
)
print("F", R["part_F_reverse_transfer_to_own"])
json.dump(R, open(OUT / "rr18_customer_sim.json", "w"), indent=1, default=str)
print("saved")
