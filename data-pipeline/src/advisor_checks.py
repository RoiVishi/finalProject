"""Advisor feedback (8.11.2026) — first checks, items 1, 4, 5 and 8.

Reads outputs/corpus_v3_buildings.csv (the registry v6 corpus) and writes
outputs/advisor_checks.json. Nothing here changes the served model.

Options (E2 re-run on the cleaned rows):
  --corpus outputs/corpus_v3_clean.csv    another corpus file with the same columns
  --families outputs/project_families.json  family map from e2_data_audit.py instead of signatures
  --out advisor_checks_clean.json          output file name in outputs/

What is compared
  Feature sets (XGBoost, the v6 hyper-parameters, refit per split):
    full          the 11 v6 features                                   (= v6)
    no_project    full minus proj_span_days, proj_n_tasks              (item 1a)
    project_only  proj_span_days, proj_n_tasks only                    (item 1b)
    serving       trained like v6, but TESTED with the inputs the service really sends:
                  float = None, task_type = "TT_Task" for every activity (item 5)
    clean         no project features, no float, no task_type          (items 1 + 5)
  Rule baselines (no training, item 8):
    duration      score = planned_duration_days
    successors    score = n_succ
    source        score = the source corpus's grew rate in train (constant inside a project)

  Scenarios:
    B             per-project temporal cut, exactly as train_compare.temporal_split
    A_project     20 GroupShuffleSplits (25% test), groups = project      (as in v6)
    A_family      the same, groups = schedule family                       (item 4)

  Metrics: pooled AUC; within-project AUC (eligible projects, median + bootstrap CI over
  projects, and by source); top-10% hit rate vs the project's own grew rate (item 1f).

Simplification, stated: hyper-parameters are fixed at the v6 values instead of a nested grid
search in every split, so every variant is trained the same way. Absolute numbers can differ
slightly from meta.json; the comparison between variants is what this script is for.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupShuffleSplit
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder
from xgboost import XGBClassifier

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from train_compare import (SEED, TARGET, eligibility, load_corpus, summarise_aucs,  # noqa: E402
                           temporal_split)

OUT = HERE.parent / "outputs"
N_SPLITS = 20
V6_PARAMS = dict(n_estimators=300, max_depth=6, learning_rate=0.05, subsample=0.8)

ALL_NUM = ["planned_duration_days", "total_float_hr", "free_float_hr", "rel_position", "proj_n_tasks",
           "proj_span_days", "n_pred", "n_succ", "upstream_cnt", "downstream_cnt"]
PROJECT = ["proj_span_days", "proj_n_tasks"]
FLOAT = ["total_float_hr", "free_float_hr"]

FEATURE_SETS = {
    "full": (ALL_NUM, ["task_type"]),
    "no_project": ([f for f in ALL_NUM if f not in PROJECT], ["task_type"]),
    "project_only": (PROJECT, []),
    "serving": (ALL_NUM, ["task_type"]),
    "clean": ([f for f in ALL_NUM if f not in PROJECT + FLOAT], []),
}
RULES = ["duration", "successors", "source"]


# ---------------------------------------------------------------- schedule families (item 4)
def families(df: pd.DataFrame) -> pd.Series:
    """Project -> family id, generated from the data (no hand-written list).

    Two projects are one family when their project-level signature is identical:
    source, number of labelled activities, proj_span_days, proj_n_tasks and the sum of planned
    durations. On top of that, the pair that buildings.py documents as one schedule family
    (129 trial / 130 TRIAL) is merged, conservatively, although their task codes overlap only 4%.
    """
    sig = df.groupby("project").agg(src=("source", "first"), n=(TARGET, "size"),
                                    span=("proj_span_days", "first"), nt=("proj_n_tasks", "first"),
                                    dur=("planned_duration_days", "sum"))
    key = sig.apply(lambda r: f"{r.src}|{r.n}|{r.span}|{r.nt}|{round(r.dur, 1)}", axis=1)
    fam = key.map({k: f"F{i:02d}" for i, k in enumerate(sorted(key.unique()))})
    if {"own::129 trial", "own::130 TRIAL"} <= set(fam.index):
        fam["own::130 TRIAL"] = fam["own::129 trial"]
    return fam


# ---------------------------------------------------------------- model and scores
def fit(train: pd.DataFrame, num: list[str], cat: list[str]) -> Pipeline:
    parts = [("num", SimpleImputer(strategy="median"), num)]
    if cat:
        parts.append(("cat", Pipeline([("imp", SimpleImputer(strategy="constant", fill_value="NA")),
                                       ("oh", OneHotEncoder(handle_unknown="ignore"))]), cat))
    pipe = Pipeline([("pre", ColumnTransformer(parts)),
                     ("model", XGBClassifier(random_state=SEED, n_jobs=-1, eval_metric="logloss",
                                             tree_method="hist", **V6_PARAMS))])
    return pipe.fit(train[num + cat], train[TARGET])


def as_served(test: pd.DataFrame) -> pd.DataFrame:
    """What ai-service/app/adapter.py actually sends: no float, task_type mapped to TT_Task."""
    t = test.copy()
    t[FLOAT] = np.nan
    t["task_type"] = "TT_Task"
    return t


def scores(variant: str, train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    if variant == "duration":
        return test["planned_duration_days"].fillna(0).to_numpy()
    if variant == "successors":
        return test["n_succ"].fillna(0).to_numpy()
    if variant == "source":
        return test["source"].map(train.groupby("source")[TARGET].mean()).to_numpy()
    num, cat = FEATURE_SETS[variant]
    model = fit(train, num, cat)
    x = as_served(test) if variant == "serving" else test
    return model.predict_proba(x[num + cat])[:, 1]


# ---------------------------------------------------------------- metrics
def per_project(test: pd.DataFrame, s: np.ndarray) -> pd.DataFrame:
    """Within-project AUC and top-10% hit rate for every eligible project of one test set."""
    rows = []
    for proj, g in test.assign(_s=s).groupby("project"):
        if eligibility(g):
            continue
        y = g[TARGET].to_numpy()
        k = max(1, int(round(0.10 * len(g))))
        top = g.nlargest(k, "_s")
        rows.append((proj, g["source"].iloc[0], roc_auc_score(y, g["_s"]), float(top[TARGET].mean()),
                     float(y.mean())))
    return pd.DataFrame(rows, columns=["project", "source", "auc", "top10_rate", "base_rate"])


PER_PROJECT: dict[tuple[str, str], pd.Series] = {}   # (variant, scenario) -> project -> mean within-project AUC


def paired(a: pd.Series, b: pd.Series) -> dict:
    """Paired comparison over the projects both variants scored: median of (a - b) per project,
    with a bootstrap CI over projects (item 8: is the model better than a rule?)."""
    d = (a - b).dropna()
    rng = np.random.default_rng(SEED)
    meds = np.median(rng.choice(d.values, size=(5000, len(d)), replace=True), axis=1)
    return {"n_projects": int(len(d)), "median_diff": round(float(d.median()), 4),
            "ci95": [round(float(q), 4) for q in np.quantile(meds, [0.025, 0.975])],
            "projects_a_better": int((d > 0).sum())}


def summarise(pp: pd.DataFrame, pooled: list[float]) -> dict:
    """pp: one row per (split, project). A project seen in several splits is averaged first."""
    proj = pp.groupby(["project", "source"], as_index=False)[["auc", "top10_rate", "base_rate"]].mean()
    out = {
        "pooled_auc_median": round(float(np.median(pooled)), 4),
        "pooled_auc_q25_q75": [round(float(q), 4) for q in np.quantile(pooled, [0.25, 0.75])] if len(pooled) > 1 else None,
        "within_project": summarise_aucs(proj["auc"]),
        "within_by_source": {s: summarise_aucs(g["auc"]) for s, g in proj.groupby("source")},
        "top10_hit_rate_median": round(float(proj["top10_rate"].median()), 3),
        "project_grew_rate_median": round(float(proj["base_rate"].median()), 3),
        "top10_lift_median": round(float((proj["top10_rate"] / proj["base_rate"]).median()), 2),
    }
    return out


def run_B(df: pd.DataFrame, variant: str) -> dict:
    tr, te, _ = temporal_split(df, ineligible_to_train=True)
    s = scores(variant, tr, te)
    pp = per_project(te, s)
    PER_PROJECT[(variant, "B")] = pp.set_index("project")["auc"]
    return summarise(pp, [roc_auc_score(te[TARGET], s)])


def run_A(df: pd.DataFrame, variant: str, groups: pd.Series, name: str) -> dict:
    pooled, pps = [], []
    g = df["project"].map(groups)
    for seed in range(N_SPLITS):
        tr_i, te_i = next(GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=seed).split(df, groups=g))
        tr, te = df.iloc[tr_i], df.iloc[te_i]
        s = scores(variant, tr, te)
        pooled.append(roc_auc_score(te[TARGET], s))
        pps.append(per_project(te, s))
    pp = pd.concat(pps)
    PER_PROJECT[(variant, name)] = pp.groupby("project")["auc"].mean()
    return summarise(pp, pooled)


def main() -> int:
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default=None)
    ap.add_argument("--families", default=None)
    ap.add_argument("--out", default="advisor_checks.json")
    args = ap.parse_args()
    if args.corpus:
        df = pd.read_csv(args.corpus, low_memory=False)
        df[TARGET] = df[TARGET].astype(int)
    else:
        df = load_corpus()
    if args.families:
        fmap = json.loads(Path(args.families).read_text())
        fam = pd.Series({p: fmap[p] for p in df["project"].unique()})
    else:
        fam = families(df)
    proj_groups = pd.Series(df["project"].unique(), index=df["project"].unique())
    merged = fam.groupby(fam).apply(lambda s: sorted(s.index)).loc[lambda x: x.str.len() > 1]
    result = {
        "config": {"corpus": args.corpus or "outputs/corpus_v3_buildings.csv",
                   "families": args.families or "identical project signatures (families())", "n_activities": len(df),
                   "n_projects": int(df["project"].nunique()), "n_families": int(fam.nunique()),
                   "families_with_more_than_one_project": merged.tolist(),
                   "model": f"XGBoost {V6_PARAMS} (fixed, v6 values)", "a_splits": N_SPLITS,
                   "eligibility": "within-project AUC: >=30 test activities and >=5 in each class"},
        "results": {},
    }
    variants = list(FEATURE_SETS) + RULES
    for v in variants:
        print(f"[{v}]", flush=True)
        result["results"][v] = {
            "B": run_B(df, v),
            "A_project": run_A(df, v, proj_groups, "A_project"),
            "A_family": run_A(df, v, fam, "A_family"),
        }
    result["paired_within_project"] = {
        sc: {f"{a} - {b}": paired(PER_PROJECT[(a, sc)], PER_PROJECT[(b, sc)])
             for a, b in [("full", "duration"), ("clean", "duration"), ("clean", "full"),
                          ("no_project", "full"), ("serving", "full")]}
        for sc in ("A_family", "A_project", "B")}
    m = fit(df, *FEATURE_SETS["full"])
    num, cat = FEATURE_SETS["full"]
    result["serving_probability_level"] = {
        src: {"observed_grew_rate": round(float(g[TARGET].mean()), 3),
              "mean_p_as_trained": round(float(m.predict_proba(g[num + cat])[:, 1].mean()), 3),
              "mean_p_as_served": round(float(m.predict_proba(as_served(g)[num + cat])[:, 1].mean()), 3)}
        for src, g in df.groupby("source")}
    (OUT / args.out).write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")

    rows = []
    for v, r in result["results"].items():
        for sc in ("B", "A_project", "A_family"):
            x = r[sc]
            rows.append((v, sc, x["pooled_auc_median"], x["within_project"]["median_auc"],
                         x["within_project"]["median_ci95"], x["within_project"]["n_projects"],
                         x["top10_lift_median"]))
    print(pd.DataFrame(rows, columns=["variant", "scenario", "pooled", "within", "within_ci", "n_proj",
                                      "top10_lift"]).to_string(index=False))
    print(json.dumps(result["paired_within_project"]["A_family"], indent=1))
    print(json.dumps(result["serving_probability_level"], indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
