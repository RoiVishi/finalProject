"""RR-15 part 2 — score registry v4 (as served, untouched) on JPF. AUC is the validity metric.
Dedup policy = DATA-2: a project contained (>=50% of its task ids) in a larger project is excluded;
the container keeps the unique labels. Nothing is fitted here — pure external validation."""
import json, sys
from pathlib import Path
import numpy as np, pandas as pd, joblib
from sklearn.metrics import roc_auc_score, brier_score_loss

OUT = Path("outputs"); REG = Path(sys.argv[1])
versions = sorted((p for p in REG.glob("v*") if p.name[1:].isdigit()), key=lambda p: int(p.name[1:]))
vdir = versions[-1]; clf = joblib.load(vdir / "classifier.joblib"); meta = json.loads((vdir / "meta.json").read_text())
NUM, CAT = meta["features_num"], meta["features_cat"]

df = pd.read_csv(OUT / "jpf_labeled_tasks.csv", dtype={"project": str, "task_id": str})
pairs = json.load(open(OUT / "jpf_dedup_containment.json"))
excluded = sorted({p["contained"] for p in pairs})
df = df[~df["project"].isin(excluded)]
lab = df[df["is_late"].notna()].copy()
lab["task_type"] = None  # missing categorical → pipeline imputes "NA"
X = lab[NUM + CAT]
p = clf.predict_proba(X)[:, 1]
lab["p"] = p

def auc(y, s):
    y = np.asarray(y); return float(roc_auc_score(y, s)) if len(np.unique(y)) > 1 else None

res = {"served_version": vdir.name, "excluded_contained_projects": excluded,
       "n_projects": int(lab["project"].nunique()), "n_labeled": int(len(lab)),
       "base_rate_is_late": round(float(lab["is_late"].mean()), 4)}
# H1 / H4 — pooled AUC per label definition
for lbl in ("is_late", "is_late_7", "grew"):
    m = lab[lbl].notna()
    res[f"pooled_auc_{lbl}"] = round(auc(lab.loc[m, lbl], lab.loc[m, "p"]), 4)
# H3 — calibration transfer (report only)
res["brier_served"] = round(float(brier_score_loss(lab["is_late"], p)), 4)
res["brier_dummy_jpf_rate"] = round(float(((lab["is_late"].mean() - lab["is_late"]) ** 2).mean()), 4)
res["mean_predicted_p"] = round(float(p.mean()), 4)
# single-feature reference points (no fitting): does the model beat trivial rankings?
for f in ("planned_duration_days", "upstream_cnt", "total_float_hr"):
    s = lab[f].fillna(lab[f].median()); a = auc(lab["is_late"], s)
    res[f"ref_auc_{f}"] = round(max(a, 1 - a), 4) if a is not None else None  # direction-agnostic
# H2 — per-project dispersion
per = []
for pid, g in lab.groupby("project"):
    if len(g) < 30 or g["is_late"].sum() < 5 or (len(g) - g["is_late"].sum()) < 5: continue
    per.append(dict(project=pid, type=g["project_type"].iloc[0], n=int(len(g)),
                    late_rate=round(float(g["is_late"].mean()), 3), auc=round(auc(g["is_late"], g["p"]), 4)))
pa = np.array([x["auc"] for x in per])
res["per_project"] = dict(n_projects=len(per), median_auc=round(float(np.median(pa)), 4),
                          q25=round(float(np.percentile(pa, 25)), 4), q75=round(float(np.percentile(pa, 75)), 4),
                          min=round(float(pa.min()), 4), max=round(float(pa.max()), 4),
                          share_above_chance=round(float((pa > 0.5).mean()), 3),
                          weighted_mean_auc=round(float(np.average(pa, weights=[x["n"] for x in per])), 4))
# by project type
bt = {}
for t, g in lab.groupby("project_type"):
    if len(g) >= 500 and g["is_late"].nunique() > 1:
        bt[t] = dict(n=int(len(g)), projects=int(g["project"].nunique()), late_rate=round(float(g["is_late"].mean()), 3),
                     auc=round(auc(g["is_late"], g["p"]), 4))
res["by_project_type"] = bt
res["per_project_table"] = per
json.dump(res, open(OUT / "rr15_jpf.json", "w"), indent=1)
show = {k: v for k, v in res.items() if k not in ("per_project_table", "excluded_contained_projects")}
print(json.dumps(show, indent=1))

# figure — same conventions as scenario_a_stability.png
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.6), dpi=150)
ax1.axvline(0.5, ls="--", lw=1, color="#9a9a9a")
ax1.hist(pa, bins=20, color="#2a78d6", alpha=0.85)
ax1.axvline(np.median(pa), color="#1F3864", lw=2)
ax1.annotate(f"median {np.median(pa):.2f}", xy=(np.median(pa), ax1.get_ylim()[1] * 0.9), xytext=(6, 0),
             textcoords="offset points", fontsize=9, color="#1F3864")
ax1.set_xlabel("ROC-AUC per JPF project (v4, untouched)"); ax1.set_ylabel("Projects")
ax1.set_title(f"RR-15 — per-project transfer AUC ({len(per)} projects)"); ax1.grid(alpha=0.25, lw=0.5, axis="y")
labels = ["pooled JPF\n(date label)", "pooled JPF\n(>7 days)", "pooled JPF\n(duration grew)", "scenario B\n(within-project)", "RR-8 NYC\n(project level)"]
vals = [res["pooled_auc_is_late"], res["pooled_auc_is_late_7"], res["pooled_auc_grew"],
        meta["served_metrics_B_temporal"]["roc_auc"], 0.68]
cols = ["#2a78d6", "#2a78d6", "#2a78d6", "#1baf7a", "#eb6834"]
ax2.axhline(0.5, ls="--", lw=1, color="#9a9a9a")
ax2.bar(range(len(vals)), vals, color=cols, alpha=0.85)
for i, v in enumerate(vals): ax2.text(i, v + 0.01, f"{v:.3f}", ha="center", fontsize=9)
ax2.set_xticks(range(len(vals))); ax2.set_xticklabels(labels, fontsize=8); ax2.set_ylim(0.4, 0.85)
ax2.set_ylabel("ROC-AUC"); ax2.set_title("Where the JPF transfer sits"); ax2.grid(alpha=0.25, lw=0.5, axis="y")
plt.tight_layout(); (OUT / "figures").mkdir(exist_ok=True); plt.savefig(OUT / "figures" / "rr15_jpf.png"); print("figure saved")
