"""
PRED-6 — Model quality gate.

Runs in two places:
  1. Inside train_compare.py, BEFORE the registry write — a failing candidate is
     never published (gate-then-publish).
  2. In CI (this file as a script) against the committed model_comparison.json —
     continuous re-verification. Exit code 0 = pass; 1 = fail (CI blocks).

Rules (all against results of the SAME run):
  B (deployment claim, selection fit): champion beats dummy on F1+AUC and LogReg on AUC.
  B (SERVED calibrated pipeline):      AUC beats dummy(0.5) and LogReg; F1 beats dummy.
  A (transfer sanity):                 champion AUC > 0.5 (dummy). AUC only — the F1
       clause was removed 16.8: with a majority-class dummy F1 of exactly 0.0, any model
       that predicts zero positives in the hard transfer setting would fail on a
       technicality; AUC is the threshold-free sanity signal. Single-split A is noisy —
       a repeated-splits formulation is planned.
  Calibration:                         calibrated Brier <= uncalibrated (same base).

The regression row does NOT block (PRED-11): it decides whether the regressor is
served. train_compare omits the artifact when the row fails; here we only print the
consistency note.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "outputs"


def check(r: dict) -> list[str]:
    """Blocking checks only. Returns list of failure strings (empty = pass)."""
    champ = r["champion"]["classifier"]
    failures: list[str] = []

    # scenario B — selection fit vs baselines
    b = r["classification"]["B_temporal"]
    dummy_b = b["dummy_majority"]
    for metric in ("f1", "roc_auc"):
        if b[champ].get(metric, 0) <= dummy_b.get(metric, 0):
            failures.append(f"[B] champion {champ} {metric}={b[champ].get(metric)} <= dummy")
    if b[champ].get("roc_auc", 0) <= b["logistic_regression"].get("roc_auc", 0):
        failures.append(f"[B] champion {champ} roc_auc <= logistic_regression "
                        f"({b['logistic_regression'].get('roc_auc')})")

    # scenario B — the SERVED calibrated pipeline (what users actually get)
    served = r.get("served_model", {}).get("metrics_B_test")
    if served:
        if served.get("roc_auc", 0) <= 0.5:
            failures.append(f"[B served] calibrated roc_auc={served.get('roc_auc')} <= dummy 0.5")
        if served.get("roc_auc", 0) <= b["logistic_regression"].get("roc_auc", 0):
            failures.append("[B served] calibrated roc_auc <= logistic_regression")
        if served.get("f1", 0) <= dummy_b.get("f1", 0):
            failures.append(f"[B served] calibrated f1={served.get('f1')} <= dummy")

    # scenario A — sanity only (AUC > chance)
    a = r["classification"]["A_cross_project"]
    if a[champ].get("roc_auc", 0) <= 0.5:
        failures.append(f"[A] champion {champ} roc_auc={a[champ].get('roc_auc')} <= chance 0.5")

    # PRED-13: calibration must not worsen Brier (scenario B)
    cal = r.get("calibration", {}).get("B_temporal", {})
    if cal and cal.get("brier_calibrated", 1) > cal.get("brier_uncalibrated_same_base", 0):
        failures.append(f"[B] calibrated Brier {cal['brier_calibrated']} > "
                        f"uncalibrated {cal['brier_uncalibrated_same_base']}")
    return failures


def main() -> int:
    path = OUT / "model_comparison.json"
    if not path.exists():
        print("GATE FAIL: outputs/model_comparison.json not found — run train_compare.py first.")
        return 1
    r = json.loads(path.read_text())
    champ_reg = r["champion"]["regressor"]

    # PRED-11 consistency note (non-blocking)
    g = r["regression"]["B_temporal"]
    if not g[champ_reg]["mae_days"] < g["dummy_median"]["mae_days"]:
        print(f"NOTE [PRED-11]: regression gated off (MAE {g[champ_reg]['mae_days']} "
              f">= dummy {g['dummy_median']['mae_days']}) — classification-only deployment.")

    failures = check(r)
    if failures:
        print("MODEL QUALITY GATE: FAILED")
        for f in failures:
            print("  -", f)
        return 1
    print(f"MODEL QUALITY GATE: PASSED (classifier={r['champion']['classifier']}, "
          f"regressor={champ_reg})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
