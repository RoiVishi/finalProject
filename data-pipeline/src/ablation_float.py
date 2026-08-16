"""
RR-12 — Does the ML add value beyond the engineer's own CPM heuristic?

Judge question this answers: "the contractor already knows a zero-float task is
risky — maybe your model just re-encodes total_float?"

Three contenders, scenario B (dedup-hardened, per-project temporal split):
  1. champion (full features)         — the deployed configuration
  2. champion without float features  — ablation: total_float_hr + free_float_hr dropped
  3. CPM heuristic                    — score = -total_float_hr (less float = riskier);
                                        binary rule "late if float < X" with X chosen on
                                        TRAIN only (best F1); missing float = riskiest.

If (1) ≈ (3), the ML adds nothing over domain knowledge. If (1) > (3) and
(2) is close to (1), the signal is spread across the other features. Both
outcomes are informative for the book.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import f1_score, recall_score, roc_auc_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from xgboost import XGBClassifier

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_compare import CAT_FEATURES, NUM_FEATURES, SEED, load_labeled, temporal_split

OUT = Path(__file__).resolve().parents[1] / "outputs"
FLOAT_FEATURES = ["total_float_hr", "free_float_hr"]


def make_prep(num, cat):
    return ColumnTransformer([
        ("num", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]), num),
        ("cat", Pipeline([("imp", SimpleImputer(strategy="constant", fill_value="NA")),
                          ("oh", OneHotEncoder(handle_unknown="ignore"))]), cat),
    ])


def champ_params():
    r = json.loads((OUT / "model_comparison.json").read_text())
    return {k.replace("model__", ""): v for k, v in r["best_params"][r["champion"]["classifier"]].items()}


def evaluate(y, proba, thresh=0.5):
    pred = (proba >= thresh).astype(int)
    return {"auc": round(float(roc_auc_score(y, proba)), 4),
            "f1": round(float(f1_score(y, pred, zero_division=0)), 4),
            "recall": round(float(recall_score(y, pred, zero_division=0)), 4)}


def main() -> int:
    lab = load_labeled()
    tr, te, projects = temporal_split(lab)
    y_tr, y_te = tr["is_late"], te["is_late"]
    params = champ_params()
    results = {}

    # 1. full champion
    full = Pipeline([("prep", make_prep(NUM_FEATURES, CAT_FEATURES)),
                     ("model", XGBClassifier(random_state=SEED, n_jobs=-1,
                                             eval_metric="logloss", tree_method="hist", **params))])
    full.fit(tr, y_tr)
    results["champion_full"] = evaluate(y_te, full.predict_proba(te)[:, 1])

    # 2. ablation: no float
    num_nf = [f for f in NUM_FEATURES if f not in FLOAT_FEATURES]
    nofloat = Pipeline([("prep", make_prep(num_nf, CAT_FEATURES)),
                        ("model", XGBClassifier(random_state=SEED, n_jobs=-1,
                                                eval_metric="logloss", tree_method="hist", **params))])
    nofloat.fit(tr, y_tr)
    results["champion_no_float"] = evaluate(y_te, nofloat.predict_proba(te)[:, 1])

    # 3. CPM heuristic: less float = riskier; missing float treated as riskiest
    # ONE impute policy everywhere: missing float = riskiest (worst observed - 1).
    worst = float(min(tr["total_float_hr"].min(), te["total_float_hr"].min()) - 1)

    def heuristic_score(df):
        return -df["total_float_hr"].fillna(worst)
    s_te = heuristic_score(te)
    # choose the binary threshold on TRAIN only (best F1 over float quantiles)
    cands = np.unique(np.quantile(tr["total_float_hr"].dropna(), np.linspace(0.05, 0.95, 19)))
    best_x, best_f1 = None, -1
    for x in cands:
        pred = (tr["total_float_hr"].fillna(worst) < x).astype(int)
        f1 = f1_score(y_tr, pred, zero_division=0)
        if f1 > best_f1:
            best_f1, best_x = f1, float(x)
    pred_te = (te["total_float_hr"].fillna(worst) < best_x).astype(int)
    # honesty check: 68% of test floats are missing, so the pooled heuristic AUC mostly
    # scores the imputation. Report the float-PRESENT subset separately.
    present = te["total_float_hr"].notna()
    auc_present = (round(float(roc_auc_score(y_te[present], s_te[present])), 4)
                   if y_te[present].nunique() > 1 else None)
    results["cpm_heuristic"] = {
        "auc": round(float(roc_auc_score(y_te, s_te)), 4),
        "auc_float_present_subset": auc_present,
        "n_float_present_test": int(present.sum()),
        "f1": round(float(f1_score(y_te, pred_te, zero_division=0)), 4),
        "recall": round(float(recall_score(y_te, pred_te, zero_division=0)), 4),
        "rule": f"late if total_float_hr < {best_x:.0f}h (threshold chosen on train; missing = riskiest)",
        "float_missing_share_test": round(float(te["total_float_hr"].isna().mean()), 3),
    }

    out = {"config": {"seed": SEED, "scenario": "B temporal, dedup-hardened",
                      "n_train": len(tr), "n_test": len(te), "n_projects": len(projects),
                      "champion_params": params},
           "results": results,
           "delta_auc_full_vs_heuristic": round(results["champion_full"]["auc"] - results["cpm_heuristic"]["auc"], 4),
           "delta_auc_full_vs_no_float": round(results["champion_full"]["auc"] - results["champion_no_float"]["auc"], 4)}
    (OUT / "ablation_float.json").write_text(json.dumps(out, indent=2))
    for k, v in results.items():
        print(k, v)
    print("Δ AUC (ML vs heuristic):", out["delta_auc_full_vs_heuristic"],
          "| Δ AUC (full vs no-float):", out["delta_auc_full_vs_no_float"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
