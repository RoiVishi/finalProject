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
  A (transfer sanity):                 champion median AUC over 20 repeated project splits > 0.5
       AND >= 75% of splits above chance (RR-19, 7.9.26; before: a single split, which RR-13 showed
       to range 0.18–0.88 by seed). AUC only — the F1 clause was removed 16.8: with a majority-class
       dummy F1 of exactly 0.0, any model that predicts zero positives in the hard transfer setting
       would fail on a technicality.
  Calibration:                         calibrated Brier <= uncalibrated (same base).
  Within project (since v6, external review 20.10.26) — the product's main use is ranking the
  activities of ONE project, which pooled AUC does not measure:
    B served: median per-project AUC > 0.5 AND >= 60% of test projects above chance;
    A nested: same floor over the UNIQUE held-out projects of the 20 splits.
  These are floors (better than chance for most projects), not quality claims; the measured
  values are reported in model_comparison.json and meta.json.

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

    # scenario A — transfer sanity on REPEATED project splits (RR-13 follow-up, adopted 7.9.26 / RR-19).
    # A single GroupShuffleSplit is noise (RR-13: 0.18–0.88 across seeds); the rule is now the median
    # over 20 splits > 0.5 AND at least 75% of splits above chance — stricter than the old single split
    # (a model that passed by luck on one seed fails here; one that failed by luck on one seed passes).
    # The single split is still reported for continuity but no longer blocks.
    rep = r["classification"].get("A_repeated", {}).get(champ)
    if rep is None:
        a = r["classification"]["A_cross_project"]      # legacy artifacts without A_repeated
        if a[champ].get("roc_auc", 0) <= 0.5:
            failures.append(f"[A] champion {champ} roc_auc={a[champ].get('roc_auc')} <= chance 0.5")
    else:
        if rep.get("median_auc", 0) <= 0.5:
            failures.append(f"[A repeated] champion {champ} median roc_auc={rep.get('median_auc')} <= chance 0.5")
        if rep.get("share_above_chance", 0) < 0.75:
            failures.append(f"[A repeated] champion {champ} only {rep.get('share_above_chance')} of splits above chance (< 0.75)")

    # within-project floors. REQUIRED from v6 on (results carry config.target); only pre-v6 artifacts,
    # which never computed them, are exempt — a v6+ run that lacks them fails.
    floor_med, floor_share = 0.5, 0.6
    required = "target" in r.get("config", {})
    for label, block in (("B served within-project", r.get("calibration", {}).get("B_temporal", {}).get("within_project", {}).get("all")),
                         ("A nested within-project", (rep or {}).get("within_project", {}).get("all"))):
        if not block:
            if required:
                failures.append(f"[{label}] missing — v6+ results must report within-project ranking")
            continue
        share = block.get("share_point_estimate_above_0.5", block.get("share_above_chance")) or 0
        if (block.get("median_auc") or 0) <= floor_med or share < floor_share:
            failures.append(f"[{label}] {block} — below the floor (median > {floor_med}, share >= {floor_share})")

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
    champ_reg = r["champion"].get("regressor")

    # PRED-11 consistency note (non-blocking). Registry v6 trains no regressor at all.
    g = r.get("regression", {}).get("B_temporal")
    if champ_reg is None or g is None:
        print("NOTE [PRED-11]: no regressor trained — classification-only deployment.")
    elif not g[champ_reg]["mae_days"] < g["dummy_median"]["mae_days"]:
        print(f"NOTE [PRED-11]: regression gated off (MAE {g[champ_reg]['mae_days']} "
              f">= dummy {g['dummy_median']['mae_days']}) — classification-only deployment.")

    failures = check(r)
    if failures:
        print("MODEL QUALITY GATE: FAILED")
        for f in failures:
            print("  -", f)
        return 1
    print(f"MODEL QUALITY GATE: PASSED (target={r['config'].get('target', 'is_late')}, "
          f"classifier={r['champion']['classifier']}, regressor={champ_reg})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
