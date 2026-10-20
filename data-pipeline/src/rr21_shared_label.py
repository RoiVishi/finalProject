"""RR-21 / RR-21b / RR-21c — one label shared by every corpus, and training on buildings only.
Decision record for registry v6 (20.10.2026).

Question (advisor, Oct 2026): "15 projects is too little — train on much more data."
  RR-16/17 showed is_late is NOT one construct across corpora (own: plan updated in P6;
  DSLIB: frozen baseline). `grew` (actual duration > planned duration) is: the within-project
  signature AUC(rel_position -> label) is ~0.50 in own, DSLIB and JPF alike.

Design (fixed before fitting; RF with the v5 params, no tuning — differences are due to data):
  RR-21   train sets own / +DSLIB / +JPF / all three (+ source-balanced, + source feature)
  RR-21b  own 15 + DSLIB buildings (all 70 / authentic-tracking 57)
  RR-21c  BUILDINGS ONLY (src/buildings.py): own 9 ± DSLIB buildings; E3 = unseen DSLIB-G buildings
  E1 scenario B on own (per-project temporal cut q=0.7) — AUC on the own test rows
  E2 leave-one-project-out over own projects (>=30 labels, >=5 per class) — median AUC
  JPF is capped at 400 activities per project (sampled, seed 42) for compute; every project kept.
  RR-21 measured the uncapped run too (E1 all three: 0.805 = capped 0.802 within noise).

Inputs: outputs/labeled_tasks.csv (etl.py, has `grew`), outputs/dslib_labeled_tasks.csv,
        outputs/jpf_labeled_tasks.csv (rr15_jpf.py; optional — RR-21 JPF rows skipped if absent).
Output: outputs/rr21_shared_label.json
Run:    python src/rr21_shared_label.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import train_compare as tc  # noqa: E402
from buildings import OWN_BUILDINGS, dslib_buildings  # noqa: E402

OUT = HERE.parent / "outputs"
SEED, CAP, Y = 42, 400, "grew"
NUM, CAT = tc.NUM_FEATURES, tc.CAT_FEATURES
COLS = ["project", "source", Y, *NUM, *CAT]


def _none_obj(n, index):
    return pd.Series([None] * n, index=index, dtype=object)


def load():
    own = pd.read_csv(OUT / "labeled_tasks.csv", low_memory=False)
    own = own[~own["project"].isin(tc.EXCLUDE_PROJECTS) & own[Y].notna()].copy()
    own["source"] = "own"
    ds = pd.read_csv(OUT / "dslib_labeled_tasks.csv", low_memory=False)
    ds = ds[ds[Y].notna()].copy()
    dsb = dslib_buildings(ds).copy()
    dsb_all = ds[ds["sector_group"] == "buildings"].copy()
    for d in (ds, dsb, dsb_all):
        d["project"] = "dslib::" + d["project"].astype(str)
        d["source"] = "dslib"
        d["task_type"] = _none_obj(len(d), d.index)
    jp = None
    jpath = OUT / "jpf_labeled_tasks.csv"
    if jpath.exists():
        jp = pd.read_csv(jpath, dtype={"project": str, "task_id": str}, low_memory=False)
        excl = {r["contained"] for r in json.load(open(OUT / "jpf_dedup_containment.json"))}
        jp = jp[~jp["project"].isin(excl) & jp[Y].notna()]
        jp = jp.sample(frac=1.0, random_state=SEED).groupby("project").head(CAP).copy()
        jp["project"] = "jpf::" + jp["project"]
        jp["source"] = "jpf"
        jp["task_type"] = _none_obj(len(jp), jp.index)
    out = {}
    for k, d in {"own": own, "dslib": ds, "dslib_bld": dsb_all, "dslib_bld_G": dsb, "jpf": jp}.items():
        if d is not None:
            d = d[COLS].copy()
            d[Y] = d[Y].astype(int)
            out[k] = d
    return out


def model(with_src=False):
    cat = CAT + (["source"] if with_src else [])
    pre = ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), NUM),
        ("cat", Pipeline([("imp", SimpleImputer(strategy="constant", fill_value="NA")),
                          ("oh", OneHotEncoder(handle_unknown="ignore"))]), cat)])
    rf = RandomForestClassifier(n_estimators=300, max_features="sqrt", min_samples_leaf=2,
                                class_weight="balanced", random_state=SEED, n_jobs=-1)
    return Pipeline([("pre", pre), ("model", rf)]), cat


def fit_predict(parts, te, weighting=None, with_src=False):
    tr = pd.concat(parts, ignore_index=True)
    w = None
    if weighting == "source_balanced":
        n = tr["source"].value_counts()
        w = tr["source"].map(lambda s: len(tr) / (len(n) * n[s])).values
    m, cat = model(with_src)
    m.fit(tr[NUM + cat], tr[Y], model__sample_weight=w)
    return m.predict_proba(te[NUM + cat])[:, 1]


def eligible(df):
    return [p for p, g in df.groupby("project") if len(g) >= 30 and min(g[Y].sum(), len(g) - g[Y].sum()) >= 5]


def signature(df):
    v = [roc_auc_score(g[Y], g["rel_position"].fillna(0)) for p, g in df.groupby("project")
         if p in set(eligible(df))]
    return {"projects": len(v), "auc_position_median": round(float(np.median(v)), 3)} if v else None


def e1(own_eval, own_train_full, sets):
    tr_b, te_b, _ = tc.temporal_split(own_eval)
    tr_all, _, _ = tc.temporal_split(own_train_full)
    res = {}
    for name, (extra, kw, own_side) in sets.items():
        parts = ([tr_all] if own_side == "all15" else [tr_b] if own_side else []) + extra
        res[name] = round(float(roc_auc_score(te_b[Y], fit_predict(parts, te_b, **kw))), 4)
    return {"n_test": len(te_b), "auc": res}


def e2(own_eval, own_train_full, sets):
    elig = eligible(own_eval)
    res = {}
    for name, (extra, kw, own_side) in sets.items():
        v = {}
        for p in elig:
            te = own_eval[own_eval.project == p]
            base = own_train_full if own_side == "all15" else own_eval
            parts = ([base[base.project != p]] if own_side else []) + extra
            v[p] = round(float(roc_auc_score(te[Y], fit_predict(parts, te, **kw))), 4)
        a = np.array(list(v.values()))
        res[name] = {"median": round(float(np.median(a)), 4), "mean": round(float(a.mean()), 4),
                     "share_above_chance": round(float((a > .5).mean()), 3), "per_project": v}
    return {"n_projects": len(elig), "results": res}


def main() -> int:
    C = load()
    own, ds, dsb_all, dsg = C["own"], C["dslib"], C["dslib_bld"], C["dslib_bld_G"]
    jp = C.get("jpf")
    own_b = own[own["project"].isin(OWN_BUILDINGS)]
    R = {"corpora": {k: {"projects": int(d.project.nunique()), "activities": len(d),
                         "grew_rate": round(float(d[Y].mean()), 3)} for k, d in C.items()},
         "signature_grew": {k: signature(d) for k, d in (("own", own), ("dslib", ds), ("jpf", jp)) if d is not None}}

    # RR-21 — three corpora, all 15 own projects
    s21 = {"own": ([], {}, True), "own+dslib": ([ds], {}, True)}
    if jp is not None:
        s21.update({"own+jpf": ([jp], {}, True), "all_three": ([ds, jp], {}, True),
                    "all_three_source_balanced": ([ds, jp], {"weighting": "source_balanced"}, True),
                    "all_three_source_feature": ([ds, jp], {"with_src": True}, True)})
    R["RR21_E1"] = e1(own, own, s21)
    R["RR21_E2"] = e2(own, own, {k: v for k, v in s21.items() if k != "own+jpf"})

    # RR-21c — buildings only
    s21c = {"own_all15_reference": ([], {}, "all15"), "own_buildings": ([], {}, True),
            "own_buildings+dslib_buildings": ([dsb_all], {}, True),
            "own_buildings+dslib_buildings_G": ([dsg], {}, True), "dslib_buildings_G_only": ([dsg], {}, False)}
    R["RR21c_E1"] = e1(own_b, own, s21c)
    R["RR21c_E2"] = e2(own_b, own, s21c)
    e3 = {}
    for name, use_own in (("own_buildings_only", "only"), ("dslib_G_folds", None), ("own_buildings+dslib_G_folds", "plus")):
        ys, ps, per = [], [], []
        for tri, tei in GroupKFold(n_splits=5).split(dsg, groups=dsg.project):
            tr, te = dsg.iloc[tri], dsg.iloc[tei]
            parts = [own_b] if use_own == "only" else ([own_b, tr] if use_own == "plus" else [tr])
            p = fit_predict(parts, te)
            ys += list(te[Y])
            ps += list(p)
            per += [roc_auc_score(g[Y], g["p"]) for _, g in te.assign(p=p).groupby("project")
                    if g[Y].nunique() == 2 and min(g[Y].sum(), len(g) - g[Y].sum()) >= 5]
        e3[name] = {"pooled_auc": round(float(roc_auc_score(ys, ps)), 4),
                    "per_project_median": round(float(np.median(per)), 4), "n_projects": len(per)}
    R["RR21c_E3_unseen_dslib_G_buildings"] = e3
    (OUT / "rr21_shared_label.json").write_text(json.dumps(R, indent=1, ensure_ascii=False) + "\n")
    print(json.dumps({k: R[k] for k in ("RR21_E1", "RR21c_E1")}, indent=1))
    print({k: v["median"] for k, v in R["RR21c_E2"]["results"].items()})
    return 0


if __name__ == "__main__":
    sys.exit(main())
