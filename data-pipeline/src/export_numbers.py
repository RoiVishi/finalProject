"""
Single source of truth for every number quoted in documents, lessons and slides.

Reads all pipeline outputs and writes outputs/numbers.json — a flat, documented
dictionary. Doc builders (build_reqs.js, build_advisor.js, lessons/FACTS.md …)
must take their numbers from here, never hardcode them. Regenerate after every
pipeline run:  python src/export_numbers.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "outputs"
sys.path.insert(0, str(Path(__file__).resolve().parent))
from train_compare import EXCLUDE_PROJECTS, load_labeled  # noqa: E402


def main() -> int:
    r = json.loads((OUT / "model_comparison.json").read_text())
    lc = json.loads((OUT / "learning_curve.json").read_text())
    ab = json.loads((OUT / "ablation_float.json").read_text())
    ba = json.loads((OUT / "bias_and_alerts.json").read_text())
    bs = json.loads((OUT / "bootstrap_ci.json").read_text())

    df = pd.read_csv(OUT / "labeled_tasks.csv")
    df = df[~df["project"].isin(EXCLUDE_PROJECTS)]
    lab = load_labeled()

    b = r["classification"]["B_temporal"]
    champ = r["champion"]["classifier"]
    served = r["served_model"]["metrics_B_test"]
    cal = r["calibration"]["B_temporal"]
    reg = r["regression"]["B_temporal"]
    usab = lc["usability_threshold"]

    numbers = {
        "_generated_from": "export_numbers.py — do not edit; regenerate after each pipeline run",
        "corpus": {
            "tasks_after_dedup": int(len(df)),
            "projects_after_dedup": int(df["project"].nunique()),
            "labeled_tasks": int(len(lab)),
            "labeled_projects": int(lab["project"].nunique()),
            "late_rate": round(float(lab["is_late"].mean()), 3),
            "excluded_duplicates": sorted(EXCLUDE_PROJECTS),
        },
        "split_B": {**{k: r["config"]["scenario_B"][k] for k in ("n_train", "n_test", "n_projects")},
                    "train_late_rate": round(float(
                        pd.concat([g[g.rel_position <= g.rel_position.quantile(0.7)]
                                   for _, g in lab.groupby("project")
                                   if g["project"].iloc[0] in r["config"]["scenario_B"]["projects"]]
                                  )["is_late"].mean()), 3) if True else None},
        "champion": {
            "classifier": champ,
            "best_params": r["best_params"].get(champ, {}),
            "runner_up": r["champion"].get("runner_up_classifier"),
            "delta_auc_vs_runner_up": r["champion"].get("delta_auc_vs_runner_up"),
            "statistically_tied": bs["auc_champion_vs_runner_up"]["statistically_tied"],
            "delta_auc_ci95": bs["auc_champion_vs_runner_up"]["delta_auc_ci95"],
        },
        "selection_fit_B": b[champ],                       # full-train fit — NOT served
        "served_B": {**served, "brier": cal["brier_calibrated"]},
        "baselines_B": {"dummy": b["dummy_majority"], "logreg": b["logistic_regression"],
                        "random_forest": b.get("random_forest"), "mlp": b.get("mlp")},
        "scenario_A": {"champion_auc": r["classification"]["A_cross_project"][champ].get("roc_auc"),
                       "note": "single split — quote only alongside the RR-13 stability results"},
        "scenario_A_stability_RR13": (lambda p: (
            {"repeated_splits": {m: v for m, v in json.loads(p.read_text())["repeated_splits"].items()},
             "lopo_champion_median_auc": json.loads(p.read_text())["lopo_champion"]["median_auc"],
             "lopo_share_above_chance": json.loads(p.read_text())["lopo_champion"]["share_above_chance"]}
            if p.exists() else None))(OUT / "scenario_a_stability.json"),
        "calibration": {"brier_uncal": cal["brier_uncalibrated_same_base"],
                        "brier_cal": cal["brier_calibrated"],
                        "n_fit": r["calibration"]["n_fit"], "n_cal": r["calibration"]["n_cal"],
                        "brier_ci95": bs["brier"]["ci95_model_brier"],
                        "vs_oracle_dummy": bs["brier"]["delta_vs_oracle_dummy"],
                        "vs_deployable_dummy": bs["brier"]["delta_vs_cal_slice_dummy"]},
        "regression": {"champion_mae": reg[r["champion"]["regressor"]]["mae_days"],
                       "dummy_mae": reg["dummy_median"]["mae_days"],
                       "served": False},
        "learning_curve_RR11": {"usable_from_fraction": usab["history_fraction"] if usab else None,
                                "usable_auc": usab["auc"] if usab else None,
                                "full_auc": lc["points"][-1]["auc"]},
        "ablation_RR12": {"full_auc": ab["results"]["champion_full"]["auc"],
                          "no_float_auc": ab["results"]["champion_no_float"]["auc"],
                          "delta_no_float": ab["delta_auc_full_vs_no_float"],
                          "heuristic_auc": ab["results"]["cpm_heuristic"]["auc"],
                          "delta_vs_heuristic": ab["delta_auc_full_vs_heuristic"],
                          "heuristic_auc_float_present": ab["results"]["cpm_heuristic"].get("auc_float_present_subset"),
                          "float_missing_share": ab["results"]["cpm_heuristic"]["float_missing_share_test"]},
        "alert_bands": ba["alert_volume"]["schemes"],
        "history": {"auc_2_projects": 0.828, "auc_13_projects": 0.768,
                    "auc_dedup_hardened": b[champ].get("roc_auc"),
                    "note": "each drop = a deliberate hardening; always the lower honest number was adopted"},
    }
    (OUT / "numbers.json").write_text(json.dumps(numbers, indent=2, ensure_ascii=False))
    print(f"Saved {OUT / 'numbers.json'}")
    print(json.dumps(numbers, indent=2)[:1500])
    return 0


if __name__ == "__main__":
    sys.exit(main())
