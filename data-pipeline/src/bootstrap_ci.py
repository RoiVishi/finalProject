"""
Bootstrap confidence intervals for the two claims a judge will push on (16.8 audit):

1. Brier of the served calibrated model — CI + paired deltas vs two dummies:
   - "oracle" dummy: constant = TEST-period base rate (not deployable; knows the future)
   - deployable dummy: constant = calibration-slice base rate (best honest constant)
2. Champion vs runner-up AUC on scenario-B test — is the winner statistically
   distinguishable, or a pre-registered-rule tiebreak? (XGB 0.7505 vs RF 0.7501)

Paired bootstrap over test tasks, B=5000, seed 42.
Output: outputs/bootstrap_ci.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import roc_auc_score
from sklearn.pipeline import Pipeline

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_compare import SEED, load_labeled, make_preprocessor, temporal_split

BASE = Path(__file__).resolve().parents[1]
OUT = BASE / "outputs"
REGISTRY = BASE.parent / "ai-service" / "model" / "registry"
B = 5000


def build_estimator(name: str, params: dict):
    if name == "xgboost":
        from xgboost import XGBClassifier
        return XGBClassifier(random_state=SEED, n_jobs=-1, eval_metric="logloss",
                             tree_method="hist", **params)
    if name == "random_forest":
        return RandomForestClassifier(class_weight="balanced", random_state=SEED,
                                      n_jobs=-1, **params)
    raise ValueError(f"no builder for {name}")


def ci(a, lo=2.5, hi=97.5):
    return [round(float(x), 4) for x in np.percentile(a, [lo, hi])]


def main() -> int:
    rng = np.random.default_rng(SEED)
    r = json.loads((OUT / "model_comparison.json").read_text())

    lab = load_labeled()
    tr, te, _ = temporal_split(lab)
    y = te["is_late"].to_numpy().astype(float)
    n = len(y)
    idx = rng.integers(0, n, size=(B, n))

    # ---------- part 1: Brier of the served artifact ----------
    versions = sorted((p for p in REGISTRY.glob("v*") if p.name[1:].isdigit()),
                      key=lambda p: int(p.name[1:]))
    served = joblib.load(versions[-1] / "classifier.joblib")
    p_served = served.predict_proba(te)[:, 1]

    r_oracle = float(y.mean())                       # test base rate (oracle, not deployable)
    cal_parts = [g[g["rel_position"] > g["rel_position"].quantile(0.75)]
                 for _, g in tr.groupby("project")]
    import pandas as pd
    r_cal = float(pd.concat(cal_parts)["is_late"].mean())   # deployable constant

    bs_model = ((p_served[idx] - y[idx]) ** 2).mean(axis=1)
    bs_oracle = ((r_oracle - y[idx]) ** 2).mean(axis=1)
    bs_calslice = ((r_cal - y[idx]) ** 2).mean(axis=1)
    d_oracle = bs_model - bs_oracle
    d_cal = bs_model - bs_calslice

    brier_part = {
        "served_version": versions[-1].name,
        "point": {
            "model": round(float(((p_served - y) ** 2).mean()), 4),
            "dummy_oracle_rate": round(float(((r_oracle - y) ** 2).mean()), 4),
            "dummy_cal_slice_rate": round(float(((r_cal - y) ** 2).mean()), 4),
            "oracle_rate": round(r_oracle, 3), "cal_slice_rate": round(r_cal, 3),
        },
        "ci95_model_brier": ci(bs_model),
        "delta_vs_oracle_dummy": {"ci95": ci(d_oracle),
                                  "p_model_better": round(float((d_oracle < 0).mean()), 4)},
        "delta_vs_cal_slice_dummy": {"ci95": ci(d_cal),
                                     "p_model_better": round(float((d_cal < 0).mean()), 4)},
    }

    # ---------- part 2: champion vs runner-up AUC (scenario B) ----------
    champ = r["champion"]["classifier"]
    runner = r["champion"].get("runner_up_classifier") or "random_forest"
    probas = {}
    for name in (champ, runner):
        params = {k.replace("model__", ""): v for k, v in r["best_params"].get(name, {}).items()}
        pipe = Pipeline([("prep", make_preprocessor()),
                         ("model", build_estimator(name, params))])
        pipe.fit(tr, tr["is_late"])
        probas[name] = pipe.predict_proba(te)[:, 1]

    deltas = np.empty(B)
    for b in range(B):
        ii = idx[b]
        yb = y[ii]
        if yb.min() == yb.max():          # degenerate resample — skip
            deltas[b] = np.nan
            continue
        deltas[b] = roc_auc_score(yb, probas[champ][ii]) - roc_auc_score(yb, probas[runner][ii])
    deltas = deltas[~np.isnan(deltas)]
    auc_part = {
        "champion": champ, "runner_up": runner,
        "point_auc": {champ: round(float(roc_auc_score(y, probas[champ])), 4),
                      runner: round(float(roc_auc_score(y, probas[runner])), 4)},
        "delta_auc_ci95": ci(deltas),
        "p_champion_better": round(float((deltas > 0).mean()), 4),
        "statistically_tied": bool(ci(deltas)[0] < 0 < ci(deltas)[1]),
        "note": "tie ⇒ champion stands on the pre-registered rule (B roc_auc), not on evidence of superiority",
    }

    out = {"config": {"seed": SEED, "B": B, "n_test": n, "method": "paired bootstrap over test tasks"},
           "brier": brier_part, "auc_champion_vs_runner_up": auc_part}
    (OUT / "bootstrap_ci.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
