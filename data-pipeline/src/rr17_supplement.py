"""RR-17 supplement (POST-HOC — written after seeing rr17_dslib.json; labelled as such in every output key).
(1) Label-construct diagnostic: direction of rel_position→label and duration→label within projects, per corpus.
    Explains the below-chance transfer of v4 to DSLIB: own labels are against the UPDATED plan (later tasks → less late),
    DSLIB labels against the FROZEN baseline (later tasks → more late, inherited drift).
(2) Part D variants: the pre-registered RF (11 plan-time + 6 as-of) under-performed the naive drift rule; test whether
    the two project-size features (proj_n_tasks, proj_span_days) let the forest memorise project identity, and what
    as-of features alone achieve (RF and logistic).
Run: python rr17_supplement.py <own.csv> <jpf.csv> <dslib.csv> <asof_instances.csv> <schema.json> <out_dir>"""
import json, sys, warnings, numpy as np, pandas as pd
from pathlib import Path
from sklearn.metrics import roc_auc_score
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import StandardScaler
warnings.filterwarnings("ignore")
OWN, JPF, DSL, INST, SCHEMA, OUT = map(Path, sys.argv[1:7])
schema = json.loads(SCHEMA.read_text()); NUM = [f["name"] for f in schema["features"] if f["role"] == "numeric"]
RF_PARAMS = dict(max_features="sqrt", min_samples_leaf=20, n_estimators=300); SEED = 42
ASOF = ["elapsed_share", "share_started", "share_finished", "median_start_slip_so_far", "share_finished_late_so_far", "mean_grew_so_far"]
R = json.load(open(OUT / "rr17_dslib.json"))

def binar(s): return s.astype(str).str.lower().isin(["true", "1", "1.0"]).astype(int)
own = pd.read_csv(OWN); own = own[own["is_late"].notna()].copy(); own["is_late"] = binar(own["is_late"])
jpf = pd.read_csv(JPF, dtype={"project": str}); jpf = jpf[jpf["is_late"].notna()].copy(); jpf["is_late"] = jpf["is_late"].astype(int)
dsl = pd.read_csv(DSL); dsl = dsl[dsl["is_late"].notna()].copy(); dsl["is_late"] = dsl["is_late"].astype(int); dsl["grew"] = dsl["grew"].astype(int)
jg = jpf[jpf["grew"].notna()].copy(); jg["grew"] = jg["grew"].astype(int)

def direction(x, lbl):
    r, rd = [], []
    for _, g in x.groupby("project"):
        if len(g) >= 30 and min(g[lbl].sum(), len(g) - g[lbl].sum()) >= 5:
            r.append(roc_auc_score(g[lbl], g["rel_position"].fillna(0))); rd.append(roc_auc_score(g[lbl], g["planned_duration_days"].fillna(0)))
    r, rd = np.array(r), np.array(rd)
    return dict(projects=len(r), auc_position_median=round(float(np.median(r)), 3), share_position_below_chance=round(float((r < 0.5).mean()), 2),
                auc_duration_median=round(float(np.median(rd)), 3))
def terciles(x, lbls):
    x = x.assign(pos_bin=pd.qcut(x["rel_position"], 3, labels=["early", "mid", "late"]))
    return {l: x.groupby("pos_bin", observed=True)[l].mean().round(3).to_dict() for l in lbls}
R["post_hoc_label_construct"] = {
    "note": "signed AUC of a single plan-time feature → label, within projects (≥30 labels, ≥5 per class). <0.5 = later/longer tasks are LESS late.",
    "own_is_late_updated_plan": direction(own, "is_late"), "jpf_is_late": direction(jpf, "is_late"), "jpf_grew": direction(jg, "grew"),
    "dslib_is_late_frozen_baseline": direction(dsl, "is_late"), "dslib_grew": direction(dsl, "grew"),
    "late_rate_by_position_tercile": {"own": terciles(own, ["is_late"]), "dslib": terciles(dsl, ["is_late", "grew"])}}

I = pd.read_csv(INST)
def per_project(d, lbl, score):
    v = []
    for _, g in d.assign(_s=score).groupby("project"):
        if len(g) >= 30 and min(g[lbl].sum(), len(g) - g[lbl].sum()) >= 5: v.append(roc_auc_score(g[lbl], g["_s"]))
    v = np.array(v); return dict(n_projects=len(v), median=round(float(np.median(v)), 4), share_above_chance=round(float((v > 0.5).mean()), 3))
gkf = GroupKFold(n_splits=5); noproj = [c for c in NUM if c not in ("proj_n_tasks", "proj_span_days")]
variants = {"plan_time_only_without_project_size": noproj, "asof_only_rf": ASOF, "asof_only_logreg": ASOF,
            "plan_time_without_project_size_plus_asof": noproj + ASOF}
D = {"note": "POST-HOC variants of Part D (GroupKFold by project, 5 folds). as-of features are project-level, hence constant within a (project, TP) — they can move pooled AUC, not within-project ranking.", "results": {}}
for lbl in ("is_late", "grew"):
    D["results"][lbl] = {}
    for name, cols in variants.items():
        oof = np.zeros(len(I))
        for tr, te in gkf.split(I, I[lbl], groups=I["project"]):
            est = LogisticRegression(max_iter=2000, class_weight="balanced") if "logreg" in name else RandomForestClassifier(class_weight="balanced", random_state=SEED, n_jobs=-1, **RF_PARAMS)
            pipe = Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler()), ("m", est)])
            pipe.fit(I.iloc[tr][cols], I.iloc[tr][lbl]); oof[te] = pipe.predict_proba(I.iloc[te][cols])[:, 1]
        D["results"][lbl][name] = dict(auc=round(float(roc_auc_score(I[lbl], oof)), 4), per_project=per_project(I, lbl, oof))
R["post_hoc_part_D_variants"] = D
json.dump(R, open(OUT / "rr17_dslib.json", "w"), indent=1, default=str)
print(json.dumps({"label_construct": R["post_hoc_label_construct"], "partD_variants": D}, indent=1, default=str))
