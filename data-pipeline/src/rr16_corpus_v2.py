"""
RR-16 — Corpus v2: retrain on the POOLED corpus (Buildings.Historical.Data + Cambridge JPF).

Advisor direction (1.9.26): the model must learn from broader data. RR-15 showed transfer of the
v4 model to JPF is weak (AUC 0.661, below a duration-only ranking 0.685) — so the gain must come
from TRAINING on JPF, not from validating on it.

PRE-REGISTERED (written 2.9.2026 before any number was computed):
  Protocol — identical to train_compare.py scenario B: per-project temporal cut at the project's
  own 70th percentile of rel_position; projects need >=30 labels and >=10 on each side; XGBoost
  with the v4 tuned params (depth 3, lr 0.05, n 300, subsample 0.8) — NO re-tuning, so any change
  is attributable to data, not to search; baselines dummy / LogReg / RF(v4 params).
  Labels — primary: is_late = delay_days > 0 (identical to v4). Sensitivity: is_late_7 (> 7 days).
  Variants — A: pooled raw (JPF outweighs own corpus ~24:1);
             B: source-balanced sample weights (each SOURCE gets equal total weight);
             C: project-balanced weights (each PROJECT gets total weight sqrt(n)) — tames mega-projects.
  H1  Pooled scenario-B test AUC (variant A) >= 0.70.
  H2  THE product question: AUC on the OWN-corpus test slice (the 3,108 building activities of v4's
      test) stays within ±0.03 of v4's selection fit (0.7505) for at least one variant. A drop > 0.03
      in all variants means pooling hurts the target domain (buildings) and JPF should be used only
      as pre-training / separate model.
  H3  Per-source AUC: JPF slice >= 0.66 (RR-15 transfer) — training on JPF must beat transferring to it.
  H4  LOPO over all eligible projects (~200): median AUC > 0.60 and IQR narrower than RR-13's.
  Calibration — v4 protocol (sigmoid on the latest 25% of train, per project). Pooled base rate differs
  by source, so calibration is additionally reported PER SOURCE.
  The candidate is written to registry_candidate/ (NOT the live registry) — publication is an
  advisor/product decision (base-rate and domain implications), gate-then-publish still applies.
Run: python rr16_corpus_v2.py <own labeled_tasks.csv> <jpf_labeled_tasks.csv> <schema.json> <out_dir>
"""

from __future__ import annotations
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
import joblib
from sklearn.calibration import CalibratedClassifierCV
from sklearn.frozen import FrozenEstimator
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    roc_auc_score,
    f1_score,
    precision_score,
    recall_score,
    brier_score_loss,
)
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

OWN, JPF, SCHEMA, OUT = (
    Path(sys.argv[1]),
    Path(sys.argv[2]),
    Path(sys.argv[3]),
    Path(sys.argv[4]),
)
OUT.mkdir(parents=True, exist_ok=True)
SEED, TEMPORAL_Q, MIN_LABELED, MIN_PER_SIDE = 42, 0.7, 30, 10
schema = json.loads(SCHEMA.read_text())
NUM = [f["name"] for f in schema["features"] if f["role"] == "numeric"]
CAT = [f["name"] for f in schema["features"] if f["role"] == "categorical"]
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
XGB_PARAMS = dict(learning_rate=0.05, max_depth=3, n_estimators=300, subsample=0.8)
RF_PARAMS = dict(max_features="sqrt", min_samples_leaf=20, n_estimators=300)

# ---------- corpus ----------
own = pd.read_csv(OWN)
own = own[~own["project"].isin(EXCLUDE_OWN)]
own["source"] = "own"
own["project"] = "own::" + own["project"].astype(str)
jpf = pd.read_csv(JPF, dtype={"project": str, "task_id": str})
jpf_excl = {
    p["contained"] for p in json.load(open(JPF.parent / "jpf_dedup_containment.json"))
}
jpf = jpf[~jpf["project"].isin(jpf_excl)]
jpf["source"] = "jpf"
jpf["project"] = "jpf::" + jpf["project"]
jpf["task_type"] = np.nan
if "is_late_7" not in own:
    own["is_late_7"] = (
        (own["delay_days"] > 7).astype(float).where(own["delay_days"].notna())
    )
cols = [
    "project",
    "source",
    *NUM,
    *CAT,
    "rel_position",
    "delay_days",
    "is_late",
    "is_late_7",
]
cols = list(dict.fromkeys(cols))
pool = pd.concat([own[cols], jpf[cols]], ignore_index=True)
lab = pool[pool["is_late"].notna()].copy()
lab["is_late"] = lab["is_late"].astype(int)
lab["is_late_7"] = lab["is_late_7"].fillna(0).astype(int)


def temporal_split(df):
    tr, te, projects = [], [], []
    for name, g in df.groupby("project"):
        if len(g) < MIN_LABELED:
            continue
        cut = g["rel_position"].quantile(TEMPORAL_Q)
        a, b = g[g["rel_position"] <= cut], g[g["rel_position"] > cut]
        if len(a) >= MIN_PER_SIDE and len(b) >= MIN_PER_SIDE:
            tr.append(a)
            te.append(b)
            projects.append(name)
    return pd.concat(tr), pd.concat(te), projects


B_tr, B_te, B_projects = temporal_split(lab)
print(
    f"pooled corpus: {len(lab)} labeled | scenario B: {len(B_projects)} projects, "
    f"{len(B_tr)} train / {len(B_te)} test | own projects in B: {sum(p.startswith('own::') for p in B_projects)}"
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


def weights(df, variant):
    if variant == "A":
        return None
    if variant == "B":
        w = 1.0 / df["source"].map(df["source"].value_counts())
        return (w / w.mean()).to_numpy()
    if variant == "C":
        n = df["project"].map(df["project"].value_counts())
        w = np.sqrt(n) / n
        return (w / w.mean()).to_numpy()


def metrics(y, pred, proba):
    return dict(
        auc=round(float(roc_auc_score(y, proba)), 4) if len(np.unique(y)) > 1 else None,
        f1=round(float(f1_score(y, pred, zero_division=0)), 4),
        precision=round(float(precision_score(y, pred, zero_division=0)), 4),
        recall=round(float(recall_score(y, pred, zero_division=0)), 4),
    )


def zoo():
    return {
        "dummy_majority": DummyClassifier(strategy="most_frequent"),
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


results = {
    "config": dict(
        seed=SEED,
        protocol="scenario B per-project q0.7; v4 params, no re-tuning",
        n_projects=len(B_projects),
        n_train=len(B_tr),
        n_test=len(B_te),
        n_own_projects=sum(p.startswith("own::") for p in B_projects),
        own_excluded=sorted(EXCLUDE_OWN),
        jpf_excluded_contained=sorted(jpf_excl),
        base_rate_train=round(float(B_tr["is_late"].mean()), 4),
        base_rate_test=round(float(B_te["is_late"].mean()), 4),
        base_rate_test_by_source=B_te.groupby("source")["is_late"]
        .mean()
        .round(4)
        .to_dict(),
    ),
    "variants": {},
}
own_te, jpf_te = B_te[B_te["source"] == "own"], B_te[B_te["source"] == "jpf"]
fitted = {}
for variant in ("A", "B", "C"):
    w = weights(B_tr, variant)
    results["variants"][variant] = {}
    for name, est in zoo().items():
        pipe = Pipeline([("prep", prep()), ("model", est)])
        fit_kw = (
            {}
            if (w is None or name == "dummy_majority")
            else {"model__sample_weight": w}
        )
        pipe.fit(B_tr, B_tr["is_late"], **fit_kw)
        proba = pipe.predict_proba(B_te)[:, 1]
        pred = (proba >= 0.5).astype(int)
        r = {
            "pooled_test": metrics(B_te["is_late"], pred, proba),
            "own_slice": metrics(
                own_te["is_late"],
                pred[(B_te["source"] == "own").to_numpy()],
                proba[(B_te["source"] == "own").to_numpy()],
            ),
            "jpf_slice": metrics(
                jpf_te["is_late"],
                pred[(B_te["source"] == "jpf").to_numpy()],
                proba[(B_te["source"] == "jpf").to_numpy()],
            ),
        }
        if name == "xgboost":
            p7 = pipe.predict_proba(B_te)[:, 1]
            r["pooled_test_label_gt7d_auc"] = round(
                float(roc_auc_score(B_te["is_late_7"], p7)), 4
            )
        results["variants"][variant][name] = r
        fitted[(variant, name)] = pipe
        print(
            f"[{variant}] {name:20s} pooled AUC={r['pooled_test']['auc']}  own-slice AUC={r['own_slice']['auc']}  jpf-slice AUC={r['jpf_slice']['auc']}"
        )

# ---------- H2 decision + calibration on the best variant by OWN-slice AUC (product domain) ----------
best_variant = max(
    ("A", "B", "C"),
    key=lambda v: results["variants"][v]["xgboost"]["own_slice"]["auc"] or 0,
)
results["decision"] = {
    "best_variant_by_own_slice": best_variant,
    "own_slice_auc_v4_reference_selection_fit": 0.7505,
    "own_slice_auc_v2": results["variants"][best_variant]["xgboost"]["own_slice"][
        "auc"
    ],
}
fit_parts, cal_parts = [], []
for _, g in B_tr.groupby("project"):
    c = g["rel_position"].quantile(0.75)
    fit_parts.append(g[g["rel_position"] <= c])
    cal_parts.append(g[g["rel_position"] > c])
B_fit, B_cal = pd.concat(fit_parts), pd.concat(cal_parts)
wf = weights(B_fit, best_variant)
champ = Pipeline(
    [
        ("prep", prep()),
        (
            "model",
            XGBClassifier(
                random_state=SEED,
                n_jobs=-1,
                eval_metric="logloss",
                tree_method="hist",
                **XGB_PARAMS,
            ),
        ),
    ]
)
champ.fit(
    B_fit, B_fit["is_late"], **({} if wf is None else {"model__sample_weight": wf})
)
cal = CalibratedClassifierCV(FrozenEstimator(champ), method="sigmoid")
cal.fit(B_cal, B_cal["is_late"])
pc = cal.predict_proba(B_te)[:, 1]
pu = champ.predict_proba(B_te)[:, 1]
results["served_candidate"] = {
    "variant": best_variant,
    "n_fit": len(B_fit),
    "n_cal": len(B_cal),
    "pooled": {
        "auc": round(float(roc_auc_score(B_te["is_late"], pc)), 4),
        "brier_calibrated": round(float(brier_score_loss(B_te["is_late"], pc)), 4),
        "brier_uncalibrated": round(float(brier_score_loss(B_te["is_late"], pu)), 4),
    },
    "by_source": {
        s: {
            "auc": round(
                float(
                    roc_auc_score(g["is_late"], pc[(B_te["source"] == s).to_numpy()])
                ),
                4,
            ),
            "brier_calibrated": round(
                float(
                    brier_score_loss(g["is_late"], pc[(B_te["source"] == s).to_numpy()])
                ),
                4,
            ),
            "brier_dummy_source_rate": round(
                float(((g["is_late"].mean() - g["is_late"]) ** 2).mean()), 4
            ),
            "base_rate": round(float(g["is_late"].mean()), 4),
        }
        for s, g in B_te.groupby("source")
    },
}
cand = OUT / "registry_candidate" / "v5-candidate"
cand.mkdir(parents=True, exist_ok=True)
joblib.dump(cal, cand / "classifier.joblib", compress=3)

# ---------- H4: LOPO with the best variant (XGB, v4 params) ----------
lopo = []
for proj in B_projects:
    g = lab[lab["project"] == proj]
    if g["is_late"].sum() < 5 or (len(g) - g["is_late"].sum()) < 5:
        continue
    tr = lab[lab["project"] != proj]
    wtr = weights(tr, best_variant)
    pipe = Pipeline(
        [
            ("prep", prep()),
            (
                "model",
                XGBClassifier(
                    random_state=SEED,
                    n_jobs=-1,
                    eval_metric="logloss",
                    tree_method="hist",
                    **XGB_PARAMS,
                ),
            ),
        ]
    )
    pipe.fit(
        tr, tr["is_late"], **({} if wtr is None else {"model__sample_weight": wtr})
    )
    lopo.append(
        {
            "project": proj,
            "source": g["source"].iloc[0],
            "n": int(len(g)),
            "auc": round(
                float(roc_auc_score(g["is_late"], pipe.predict_proba(g)[:, 1])), 4
            ),
        }
    )
la = np.array([x["auc"] for x in lopo])
results["lopo"] = {
    "n_projects": len(lopo),
    "median": round(float(np.median(la)), 4),
    "q25": round(float(np.percentile(la, 25)), 4),
    "q75": round(float(np.percentile(la, 75)), 4),
    "share_above_chance": round(float((la > 0.5).mean()), 3),
    "own_projects_median": round(
        float(np.median([x["auc"] for x in lopo if x["source"] == "own"])), 4
    )
    if any(x["source"] == "own" for x in lopo)
    else None,
    "rr13_reference": {"median": 0.6597, "share_above_chance": 0.818, "n_projects": 11},
    "table": lopo,
}
json.dump(results, open(OUT / "rr16_corpus_v2.json", "w"), indent=1, default=str)
print(
    json.dumps(
        {k: v for k, v in results.items() if k != "lopo"}
        | {"lopo": {k: v for k, v in results["lopo"].items() if k != "table"}},
        indent=1,
        default=str,
    )
)
