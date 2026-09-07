# ruff: noqa: F821 — this supplement exec()s the corpus-building prelude of rr16_corpus_v2.py; the names it uses (lab, temporal_split, weights, prep, SEED, RF_PARAMS) are defined there.
"""RR-16 supplement: (1) RF champion candidate under the pre-registered rule (best scenario-B AUC);
(2) per-source calibration — does a domain-specific calibrator fix the own-domain Brier?"""

import json
import sys
import pandas as pd
import joblib
from sklearn.ensemble import RandomForestClassifier
from sklearn.calibration import CalibratedClassifierCV
from sklearn.frozen import FrozenEstimator
from sklearn.metrics import roc_auc_score, brier_score_loss
from sklearn.pipeline import Pipeline

sys.argv = [
    "x",
    "/mnt/user-data/uploads/פם/code/data-pipeline/outputs/labeled_tasks.csv",
    "outputs/jpf_labeled_tasks.csv",
    "/home/claude/pm/code/feature_schema.json",
    "outputs",
]
src = (
    open("rr16_corpus_v2.py").read().split("results = {")[0]
)  # reuse corpus building + helpers
exec(src)
B_tr, B_te, B_projects = temporal_split(lab)
fit_parts, cal_parts = [], []
for _, g in B_tr.groupby("project"):
    c = g["rel_position"].quantile(0.75)
    fit_parts.append(g[g["rel_position"] <= c])
    cal_parts.append(g[g["rel_position"] > c])
B_fit, B_cal = pd.concat(fit_parts), pd.concat(cal_parts)
out = {}
for variant in ("A", "B"):
    wf = weights(B_fit, variant)
    rf = Pipeline(
        [
            ("prep", prep()),
            (
                "model",
                RandomForestClassifier(
                    class_weight="balanced", random_state=SEED, n_jobs=-1, **RF_PARAMS
                ),
            ),
        ]
    )
    rf.fit(
        B_fit, B_fit["is_late"], **({} if wf is None else {"model__sample_weight": wf})
    )
    pu = rf.predict_proba(B_te)[:, 1]
    cal = CalibratedClassifierCV(FrozenEstimator(rf), method="sigmoid")
    cal.fit(B_cal, B_cal["is_late"])
    pc = cal.predict_proba(B_te)[:, 1]
    r = {
        "pooled_auc_calibrated": round(float(roc_auc_score(B_te["is_late"], pc)), 4),
        "pooled_brier": round(float(brier_score_loss(B_te["is_late"], pc)), 4),
        "by_source": {},
    }
    for s, g in B_te.groupby("source"):
        m = (B_te["source"] == s).to_numpy()
        # per-source calibrator: fitted on that source's calibration slice only
        cs = B_cal[B_cal["source"] == s]
        cal_s = CalibratedClassifierCV(FrozenEstimator(rf), method="sigmoid")
        cal_s.fit(cs, cs["is_late"])
        ps = cal_s.predict_proba(g)[:, 1]
        r["by_source"][s] = {
            "auc": round(float(roc_auc_score(g["is_late"], pc[m])), 4),
            "brier_pooled_calibrator": round(
                float(brier_score_loss(g["is_late"], pc[m])), 4
            ),
            "brier_source_calibrator": round(
                float(brier_score_loss(g["is_late"], ps)), 4
            ),
            "brier_dummy": round(
                float(((g["is_late"].mean() - g["is_late"]) ** 2).mean()), 4
            ),
            "n_cal_source": int(len(cs)),
        }
    out[f"rf_variant_{variant}"] = r
    if variant == "B":
        joblib.dump(
            cal,
            "outputs/registry_candidate/v5-candidate/classifier_rf.joblib",
            compress=3,
        )
json.dump(out, open("outputs/rr16_supplement.json", "w"), indent=1)
print(json.dumps(out, indent=1))
