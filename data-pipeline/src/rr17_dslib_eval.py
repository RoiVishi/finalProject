"""
RR-17 — DSLIB (Ghent) as third corpus: transfer, corpus v3 pooled training, buildings calibrator,
label-construct sensitivity, and the first as-of ("breathing") test on REAL tracking snapshots.

PRE-REGISTERED (written 2.9.2026 after the ETL profile, BEFORE any model was scored on DSLIB).
Facts already known from the profile (not hypotheses): DSLIB construction = 163 projects / 17,866 leaf
activities / 8,040 labeled in 117 tracked projects; frozen-baseline late rate 0.64, but 99% of late-starting
activities finish late and only 10% of on-time starters do → the is_late label is mostly INHERITED project
drift; the activity's own overrun (`grew`) is 25%. Within-project, rel_position alone ranks is_late at
AUC ≈0.64 but grew at ≈0.50. Own/JPF labels are against the LATEST plan, DSLIB's against the ORIGINAL
baseline — a different construct, hence the sensitivity analysis.

Part A — transfer, nothing fitted (v4 served; v5-candidate RF-B from RR-16):
  H1  v4 pooled AUC on DSLIB-buildings for `grew` in [0.55, 0.70] (same band as RR-15 on JPF).
  H2  For `is_late`, v4 does NOT beat the rel_position-only reference by more than 0.03 on DSLIB —
      a plan-time model cannot see drift, so the inherited-drift label is not where it can shine.
  H3  v5-candidate (own+JPF) ≥ v4 on DSLIB-buildings `grew` by ≥ 0.02 (pooling generalises) — uncertain, tested.
Part B — corpus v3 pooled training (own + JPF + DSLIB-train; scenario B q0.7 per project; v4 params, no retune;
  source-balanced weights = RR-16 variant B; RF and XGB). DSLIB projects split 60/40 BY PROJECT (seed 42,
  stratified by sector group); the 40% hold-out is never trained on and is scored as whole projects.
  H4  Own-slice AUC stays within ±0.02 of RR-16 RF (0.758): adding DSLIB does not hurt the buildings slice.
  H5  DSLIB hold-out buildings AUC (is_late, primary label) for v3-RF ≥ v5-candidate transfer + 0.03.
  H6  Label harmonisation: training DSLIB rows with `grew` instead of `is_late` changes the own-slice AUC by
      < 0.01 (own rows dominate the buildings signal) but raises hold-out `grew` AUC by ≥ 0.03.
Part C — buildings calibrator (Platt on own-cal + DSLIB-train buildings-cal slices):
  H7  Own-slice Brier ≤ 0.195 (RR-16 own-domain calibrator: 0.190; v4: 0.207; dummy 0.209).
Part D — RR-14 on real snapshots (DSLIB only; GroupKFold by project, 5 folds, RF v4 params):
  instances = not-yet-started activities at each usable TP (≥5 finished & ≥5 not-started-labeled);
  as-of features (all computable at the TP status date): elapsed_share, share_started, share_finished,
  median_start_slip_so_far, share_finished_late_so_far, mean_grew_so_far (project-level drift; no per-predecessor slip in this round).
  H8  plan-time + as-of beats plan-time alone by ≥ +0.08 AUC on `is_late` (drift is inheritable).
  H9  the gain on `grew` is ≤ +0.03 (own overrun is not inherited).
  H10 the naive rule "median start slip so far > 0" alone reaches AUC ≥ 0.70 on is_late — the model must beat it.
Anything outside these bands is a finding, not a failure; nothing is tuned on DSLIB.

Run: python rr17_dslib_eval.py <own_labeled.csv> <jpf_labeled.csv> <dslib_labeled.csv> <dslib_snapshots.csv> <schema.json> <registry_dir> <v5_rf.joblib> <out_dir>
"""
from __future__ import annotations
import json, sys, warnings
from pathlib import Path
import numpy as np, pandas as pd, joblib
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score, brier_score_loss
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier
warnings.filterwarnings("ignore")

OWN, JPF, DSL, SNAP, SCHEMA, REG, V5, OUT = map(Path, sys.argv[1:9]); OUT.mkdir(parents=True, exist_ok=True)
SEED, TEMPORAL_Q, MIN_LABELED, MIN_PER_SIDE, HOLDOUT = 42, 0.7, 30, 10, 0.4
schema = json.loads(SCHEMA.read_text())
NUM = [f["name"] for f in schema["features"] if f["role"] == "numeric"]
CAT = [f["name"] for f in schema["features"] if f["role"] == "categorical"]
XGB_PARAMS = dict(learning_rate=0.05, max_depth=3, n_estimators=300, subsample=0.8)
RF_PARAMS = dict(max_features="sqrt", min_samples_leaf=20, n_estimators=300)
EXCLUDE_OWN = {"MERGE PROJECTS", "Enppi", "schedule of Medor", "HHI", "Ma'aden", "el ezz warehouse",
               "Baseline 15-11-2010", "Beyti plant baseline -b(fm-baseline)"}
R = {"config": dict(seed=SEED, holdout_share=HOLDOUT, protocol="scenario B q0.7 per project; v4 params; variant B weights")}

def auc(y, s):
    y = np.asarray(y); return round(float(roc_auc_score(y, s)), 4) if len(np.unique(y)) > 1 else None
def brier(y, p): return round(float(brier_score_loss(y, p)), 4)
def dummy_brier(y): y = np.asarray(y, float); return round(float(((y.mean() - y) ** 2).mean()), 4)

# ---------- corpora ----------
own = pd.read_csv(OWN); own = own[~own["project"].isin(EXCLUDE_OWN)].copy(); own["source"] = "own"; own["project"] = "own::" + own["project"].astype(str)
jpf = pd.read_csv(JPF, dtype={"project": str, "task_id": str})
jpf = jpf[~jpf["project"].isin({p["contained"] for p in json.load(open(JPF.parent / "jpf_dedup_containment.json"))})].copy()
jpf["source"] = "jpf"; jpf["project"] = "jpf::" + jpf["project"]; jpf["task_type"] = np.nan
dsl = pd.read_csv(DSL, dtype={"project": str}); dsl["project_code"] = dsl["project"]; dsl["project"] = "dslib::" + dsl["project"]; dsl["task_type"] = np.nan
for d in (own, jpf):
    if "is_late_7" not in d: d["is_late_7"] = (d["delay_days"] > 7).astype(float).where(d["delay_days"].notna())
    for c in ("grew", "sector_group"): d[c] = np.nan if c == "grew" else "buildings" if d is own else "infrastructure"
cols = list(dict.fromkeys(["project", "source", "sector_group", *NUM, *CAT, "rel_position", "delay_days", "is_late", "is_late_7", "grew"]))
dsl_lab = dsl[dsl["is_late"].notna()].copy()

# DSLIB project split: 60/40 by project, stratified by sector group
rng = np.random.default_rng(SEED); hold = set()
for grp, g in dsl_lab.groupby("sector_group"):
    projs = sorted(g["project"].unique()); rng.shuffle(projs); hold |= set(projs[: int(round(HOLDOUT * len(projs)))])
dsl_lab["split"] = np.where(dsl_lab["project"].isin(hold), "holdout", "train")
R["dslib"] = dict(projects=int(dsl_lab["project"].nunique()), labeled=int(len(dsl_lab)),
                  holdout_projects=len(hold), holdout_labeled=int((dsl_lab["split"] == "holdout").sum()),
                  by_group={g: dict(projects=int(x["project"].nunique()), labeled=int(len(x)), late_rate=round(float(x["is_late"].mean()), 3),
                                    grew_rate=round(float(x["grew"].mean()), 3)) for g, x in dsl_lab.groupby("sector_group")})

# ---------- Part A: transfer ----------
def ref_aucs(d, lbl):
    out = {}
    for f in ("rel_position", "planned_duration_days"):
        s = d[f].fillna(d[f].median()); a = auc(d[lbl], s); out[f] = round(max(a, 1 - a), 4) if a is not None else None
    return out
def per_project(d, lbl, score):
    vals = []
    for _, g in d.assign(_s=score).groupby("project"):
        if len(g) < 30 or g[lbl].sum() < 5 or (len(g) - g[lbl].sum()) < 5: continue
        vals.append(auc(g[lbl], g["_s"]))
    v = np.array(vals, float)
    return dict(n_projects=len(v), median=round(float(np.median(v)), 4), q25=round(float(np.percentile(v, 25)), 4),
                q75=round(float(np.percentile(v, 75)), 4), share_above_chance=round(float((v > 0.5).mean()), 3)) if len(v) else None

versions = sorted((p for p in REG.glob("v*") if p.name[1:].isdigit()), key=lambda p: int(p.name[1:]))
v4 = joblib.load(versions[-1] / "classifier.joblib"); v5 = joblib.load(V5)
X_all = dsl_lab[NUM + CAT]
A = {"served_version": versions[-1].name, "labels": {}}
for lbl in ("is_late", "is_late_7", "grew"):
    m = dsl_lab[lbl].notna(); d = dsl_lab[m]
    p4 = v4.predict_proba(d[NUM + CAT])[:, 1]; p5 = v5.predict_proba(d[NUM + CAT])[:, 1]
    e = dict(n=int(len(d)), base_rate=round(float(d[lbl].mean()), 4),
             v4=dict(pooled=auc(d[lbl], p4), per_project=per_project(d, lbl, p4), mean_p=round(float(p4.mean()), 4),
                     brier=brier(d[lbl], p4) if lbl == "is_late" else None),
             v5_candidate=dict(pooled=auc(d[lbl], p5), per_project=per_project(d, lbl, p5), mean_p=round(float(p5.mean()), 4)),
             reference=ref_aucs(d, lbl), by_group={})
    for grp, g in d.groupby("sector_group"):
        i = (d["sector_group"] == grp).to_numpy()
        e["by_group"][grp] = dict(n=int(len(g)), base_rate=round(float(g[lbl].mean()), 3), v4=auc(g[lbl], p4[i]), v5_candidate=auc(g[lbl], p5[i]),
                                  reference=ref_aucs(g, lbl))
    A["labels"][lbl] = e
A["brier_dummy_is_late"] = dummy_brier(dsl_lab["is_late"])
R["part_A_transfer"] = A
print("Part A done:", json.dumps({l: dict(v4=A["labels"][l]["v4"]["pooled"], v5=A["labels"][l]["v5_candidate"]["pooled"], ref=A["labels"][l]["reference"]) for l in A["labels"]}, indent=1))

# ---------- Part B: corpus v3 ----------
def prep():
    return ColumnTransformer([("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), NUM),
                              ("cat", Pipeline([("imp", SimpleImputer(strategy="constant", fill_value="NA")), ("oh", OneHotEncoder(handle_unknown="ignore"))]), CAT)])
def weights_B(df):
    w = 1.0 / df["source"].map(df["source"].value_counts()); return (w / w.mean()).to_numpy()
def temporal_split(df):
    tr, te = [], []
    for _, g in df.groupby("project"):
        if len(g) < MIN_LABELED: continue
        cut = g["rel_position"].quantile(TEMPORAL_Q); a, b = g[g["rel_position"] <= cut], g[g["rel_position"] > cut]
        if len(a) >= MIN_PER_SIDE and len(b) >= MIN_PER_SIDE: tr.append(a); te.append(b)
    return pd.concat(tr), pd.concat(te)
def models():
    return {"random_forest": RandomForestClassifier(class_weight="balanced", random_state=SEED, n_jobs=-1, **RF_PARAMS),
            "xgboost": XGBClassifier(random_state=SEED, n_jobs=-1, eval_metric="logloss", tree_method="hist", **XGB_PARAMS)}

dsl_train = dsl_lab[dsl_lab["split"] == "train"]; dsl_hold = dsl_lab[dsl_lab["split"] == "holdout"]
pool = pd.concat([own[cols], jpf[cols], dsl_train[cols]], ignore_index=True)
pool = pool[pool["is_late"].notna()].copy(); pool["y_islate"] = pool["is_late"].astype(int)
pool["y_harmonised"] = np.where(pool["source"] == "dslib", pool["grew"], pool["is_late"]); pool = pool[pool["y_harmonised"].notna()]; pool["y_harmonised"] = pool["y_harmonised"].astype(int)
B_tr, B_te = temporal_split(pool)
R["part_B_corpus_v3"] = {"n_train": int(len(B_tr)), "n_test": int(len(B_te)), "projects_B": int(B_tr["project"].nunique()),
                         "train_by_source": B_tr["source"].value_counts().to_dict(), "runs": {}}
hold_X = dsl_hold; fitted = {}
for target in ("y_islate", "y_harmonised"):
    for name, est in models().items():
        pipe = Pipeline([("prep", prep()), ("model", est)]); pipe.fit(B_tr, B_tr[target], model__sample_weight=weights_B(B_tr))
        pt = pipe.predict_proba(B_te)[:, 1]; ph = pipe.predict_proba(hold_X)[:, 1]
        run = {"pooled_test_auc": auc(B_te[target], pt),
               "slices": {s: auc(B_te.loc[B_te["source"] == s, target], pt[(B_te["source"] == s).to_numpy()]) for s in ("own", "jpf", "dslib")},
               "dslib_holdout": {lbl: dict(all=auc(dsl_hold[lbl], ph), per_project=per_project(dsl_hold, lbl, ph),
                                           by_group={g: auc(x[lbl], ph[(dsl_hold["sector_group"] == g).to_numpy()]) for g, x in dsl_hold.groupby("sector_group")})
                                 for lbl in ("is_late", "grew")}}
        R["part_B_corpus_v3"]["runs"][f"{name}__{target}"] = run; fitted[(name, target)] = pipe
        print(name, target, json.dumps(run["slices"]), "holdout", json.dumps({l: run["dslib_holdout"][l]["all"] for l in run["dslib_holdout"]}))
R["part_B_corpus_v3"]["references"] = dict(rr16_rf_own_slice=0.758, v4_selection_fit=0.7505,
                                           v5_transfer_holdout_is_late=auc(dsl_hold["is_late"], v5.predict_proba(dsl_hold[NUM + CAT])[:, 1]),
                                           v5_transfer_holdout_grew=auc(dsl_hold["grew"], v5.predict_proba(dsl_hold[NUM + CAT])[:, 1]),
                                           v4_transfer_holdout_is_late=auc(dsl_hold["is_late"], v4.predict_proba(dsl_hold[NUM + CAT])[:, 1]),
                                           v4_transfer_holdout_grew=auc(dsl_hold["grew"], v4.predict_proba(dsl_hold[NUM + CAT])[:, 1]))

# ---------- Part C: buildings calibrator (RF, is_late target) ----------
fit_parts, cal_parts = [], []
for _, g in B_tr.groupby("project"):
    c = g["rel_position"].quantile(0.75); fit_parts.append(g[g["rel_position"] <= c]); cal_parts.append(g[g["rel_position"] > c])
B_fit, B_cal = pd.concat(fit_parts), pd.concat(cal_parts)
rf = Pipeline([("prep", prep()), ("model", RandomForestClassifier(class_weight="balanced", random_state=SEED, n_jobs=-1, **RF_PARAMS))])
rf.fit(B_fit, B_fit["y_islate"], model__sample_weight=weights_B(B_fit))
own_te = B_te[B_te["source"] == "own"]; C = {"n_fit": int(len(B_fit)), "n_cal": int(len(B_cal)), "own_test_n": int(len(own_te)), "own_brier_dummy": dummy_brier(own_te["y_islate"])}
def calib(sub):
    c = CalibratedClassifierCV(FrozenEstimator(rf), method="sigmoid"); c.fit(sub, sub["y_islate"]); return c
cal_pooled = calib(B_cal); cal_own = calib(B_cal[B_cal["source"] == "own"])
bld_cal = B_cal[(B_cal["source"] == "own") | ((B_cal["source"] == "dslib") & (B_cal["sector_group"] == "buildings"))]; cal_bld = calib(bld_cal)
C["own_slice"] = {"auc_uncalibrated": auc(own_te["y_islate"], rf.predict_proba(own_te)[:, 1]),
                  "brier_pooled_calibrator": brier(own_te["y_islate"], cal_pooled.predict_proba(own_te)[:, 1]),
                  "brier_own_calibrator": brier(own_te["y_islate"], cal_own.predict_proba(own_te)[:, 1]),
                  "brier_buildings_calibrator_own+dslib": brier(own_te["y_islate"], cal_bld.predict_proba(own_te)[:, 1]),
                  "n_cal_own": int((B_cal["source"] == "own").sum()), "n_cal_buildings": int(len(bld_cal))}
hb = dsl_hold[dsl_hold["sector_group"] == "buildings"]
C["dslib_holdout_buildings"] = {"n": int(len(hb)), "brier_dummy": dummy_brier(hb["is_late"]),
                                "brier_pooled_calibrator": brier(hb["is_late"], cal_pooled.predict_proba(hb)[:, 1]),
                                "brier_buildings_calibrator": brier(hb["is_late"], cal_bld.predict_proba(hb)[:, 1]),
                                "brier_v4_served": brier(hb["is_late"], v4.predict_proba(hb[NUM + CAT])[:, 1])}
R["part_C_calibration"] = C; print("Part C:", json.dumps(C["own_slice"]))
joblib.dump(cal_bld, OUT / "v6_candidate_rf_buildings_calibrator.joblib", compress=3)

# ---------- Part D: as-of on real snapshots ----------
snap = pd.read_csv(SNAP, parse_dates=["status_date", "actual_start"]); snap["project"] = "dslib::" + snap["project"].astype(str)
meta_cols = dsl.set_index(["project", "task_id"])[["rel_position", "proj_span_days", "is_late", "grew", "start_delay_days", "delay_days"]]
bstart = pd.to_datetime(dsl.set_index(["project", "task_id"])["baseline_start"])  # frozen baseline start per task
# as-of features are PROJECT-level drift (no per-predecessor slip yet — the labeled file carries counts, not ids; documented)
inst = []
for (pid, tp), g in snap.groupby(["project", "tp"]):
    fin = g[g["status"] == "finished"]; started = g[g["status"] != "not_started"]; ns = g[g["status"] == "not_started"]
    idx_ns = list(zip(ns["project"], ns["task_id"])); lab_ns = meta_cols.reindex(idx_ns)
    lab_ns = lab_ns[lab_ns["is_late"].notna()]
    if len(fin) < 5 or len(lab_ns) < 5: continue
    sd = g["status_date"].iloc[0]
    st_idx = list(zip(started["project"], started["task_id"]))
    slip = (started["actual_start"].to_numpy() - bstart.reindex(st_idx).to_numpy()).astype("timedelta64[D]").astype(float)
    fin_meta = meta_cols.reindex(list(zip(fin["project"], fin["task_id"])))
    p0 = bstart.loc[pid].min(); span = meta_cols.loc[pid, "proj_span_days"].iloc[0]
    feats = dict(elapsed_share=float((sd - p0).days / span) if span else np.nan, share_started=len(started) / len(g), share_finished=len(fin) / len(g),
                 median_start_slip_so_far=float(np.nanmedian(slip)) if len(slip) else 0.0,
                 share_finished_late_so_far=float(fin_meta["is_late"].mean()) if fin_meta["is_late"].notna().any() else np.nan,
                 mean_grew_so_far=float(fin_meta["grew"].mean()) if fin_meta["grew"].notna().any() else np.nan)
    for (pp, tid), row in lab_ns.iterrows():
        inst.append(dict(project=pp, task_id=tid, tp=tp, **feats, is_late=int(row["is_late"]), grew=int(row["grew"])))
I = pd.DataFrame(inst).merge(dsl[["project", "task_id", *NUM]], on=["project", "task_id"], how="left"); I["task_type"] = "NA"
ASOF = ["elapsed_share", "share_started", "share_finished", "median_start_slip_so_far", "share_finished_late_so_far", "mean_grew_so_far"]
D = {"n_instances": int(len(I)), "n_snapshots": int(I.groupby(["project", "tp"]).ngroups), "n_projects": int(I["project"].nunique()),
     "base_rate_is_late": round(float(I["is_late"].mean()), 4), "base_rate_grew": round(float(I["grew"].mean()), 4), "results": {}}
def prep_asof(extra):
    return ColumnTransformer([("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), NUM + extra),
                              ("cat", Pipeline([("imp", SimpleImputer(strategy="constant", fill_value="NA")), ("oh", OneHotEncoder(handle_unknown="ignore"))]), CAT)])
gkf = GroupKFold(n_splits=5)
for lbl in ("is_late", "grew"):
    res = {}
    for name, extra in (("plan_time_only", []), ("plan_time_plus_asof", ASOF)):
        oof = np.zeros(len(I))
        for tr, te in gkf.split(I, I[lbl], groups=I["project"]):
            pipe = Pipeline([("prep", prep_asof(extra)), ("model", RandomForestClassifier(class_weight="balanced", random_state=SEED, n_jobs=-1, **RF_PARAMS))])
            pipe.fit(I.iloc[tr], I.iloc[tr][lbl]); oof[te] = pipe.predict_proba(I.iloc[te])[:, 1]
        res[name] = dict(auc=auc(I[lbl], oof), per_project=per_project(I, lbl, oof))
    a = auc(I[lbl], I["median_start_slip_so_far"].fillna(0)); res["naive_rule_median_slip"] = round(max(a, 1 - a), 4)
    a = auc(I[lbl], I["share_finished_late_so_far"].fillna(0)); res["naive_rule_share_late"] = round(max(a, 1 - a), 4)
    res["gain_asof"] = round(res["plan_time_plus_asof"]["auc"] - res["plan_time_only"]["auc"], 4)
    D["results"][lbl] = res; print("Part D", lbl, json.dumps(res))
R["part_D_asof_snapshots"] = D
json.dump(R, open(OUT / "rr17_dslib.json", "w"), indent=1, default=str); print("saved", OUT / "rr17_dslib.json")
