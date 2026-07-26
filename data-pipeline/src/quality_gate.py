"""
PRED-6 — Model quality gate.

The champion model may only be deployed if it beats BOTH baselines
(dummy and logistic regression) on the primary metrics in BOTH
evaluation scenarios:

  classification: F1 and ROC-AUC   (champion vs dummy_majority AND logistic_regression*)
  regression:     MAE              (champion vs dummy_median)

* In scenario A (cross-project transfer) all models are near-random — a known,
  documented limitation. The gate therefore requires strict superiority over the
  dummy in both scenarios, and superiority over logistic regression in scenario B
  (the deployment claim).

Exit code 0 = gate passed; 1 = gate failed (CI blocks deployment).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "outputs"


def main() -> int:
    path = OUT / "model_comparison.json"
    if not path.exists():
        print("GATE FAIL: outputs/model_comparison.json not found — run train_compare.py first.")
        return 1
    r = json.loads(path.read_text())
    champ = r["champion"]["classifier"]
    champ_reg = r["champion"]["regressor"]
    failures: list[str] = []

    for scen in ("A_cross_project", "B_temporal"):
        c = r["classification"][scen]
        dummy = c["dummy_majority"]
        m = c[champ]
        for metric in ("f1", "roc_auc"):
            if m.get(metric, 0) <= dummy.get(metric, 0):
                failures.append(f"[{scen}] champion {champ} {metric}={m.get(metric)} "
                                f"<= dummy {dummy.get(metric)}")
    b = r["classification"]["B_temporal"]
    if b[champ].get("roc_auc", 0) <= b["logistic_regression"].get("roc_auc", 0):
        failures.append(f"[B_temporal] champion {champ} roc_auc <= logistic_regression")

    for scen in ("A_cross_project", "B_temporal"):
        g = r["regression"][scen]
        if scen == "B_temporal" and g[champ_reg]["mae_days"] >= g["dummy_median"]["mae_days"]:
            failures.append(f"[{scen}] champion regressor {champ_reg} MAE "
                            f"{g[champ_reg]['mae_days']} >= dummy {g['dummy_median']['mae_days']}")

    if failures:
        print("MODEL QUALITY GATE: FAILED")
        for f in failures:
            print("  -", f)
        return 1
    print(f"MODEL QUALITY GATE: PASSED (classifier={champ}, regressor={champ_reg})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
