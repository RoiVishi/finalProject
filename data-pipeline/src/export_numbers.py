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
        "external_validation_RR8": (lambda p: (
            {"descriptive": json.loads(p.read_text())["descriptive"],
             "auc_unseen_agency": {k: {m: v["auc_mean"] for m, v in
                                       json.loads(p.read_text())[k].get("models", {}).items()}
                                   for k in ("model_slipped_new_cohort", "model_late_actual")}}
            if p.exists() else None))(OUT / "rr8_nyc.json"),

        # ---- corpus expansion (2.9.26): Cambridge JPF — RR-15 transfer + RR-16 pooled retraining ----
        "corpus_expansion_JPF": (lambda p15, p16, p16s, pe: (
            {"source": "JPF Anonymised Project Data (Brilakis, Fitzsimmons & Lu 2020; Apollo doi:10.17863/CAM.53890; CC BY 4.0)",
             "etl": json.loads(pe.read_text()) if pe.exists() else None,
             "rr15_transfer_v4": (lambda r: {"n_projects": r["n_projects"], "n_labeled": r["n_labeled"],
                 "base_rate": r["base_rate_is_late"], "pooled_auc_date_label": r["pooled_auc_is_late"],
                 "pooled_auc_gt7d": r["pooled_auc_is_late_7"], "pooled_auc_duration_growth": r["pooled_auc_grew"],
                 "duration_only_reference_auc": r["ref_auc_planned_duration_days"],
                 "brier_served": r["brier_served"], "brier_dummy": r["brier_dummy_jpf_rate"],
                 "per_project": {k: v for k, v in r["per_project"].items()},
                 "excluded_contained_projects": len(r["excluded_contained_projects"])})(json.loads(p15.read_text())) if p15.exists() else None,
             "rr16_corpus_v2": (lambda r, s: {"config": {k: v for k, v in r["config"].items() if k not in ("own_excluded", "jpf_excluded_contained")},
                 "scenario_B_auc": {v: {m: r["variants"][v][m]["pooled_test"]["auc"] for m in r["variants"][v]} for v in r["variants"]},
                 "own_domain_slice_auc": {v: {m: r["variants"][v][m]["own_slice"]["auc"] for m in r["variants"][v]} for v in r["variants"]},
                 "jpf_slice_auc": {v: {m: r["variants"][v][m]["jpf_slice"]["auc"] for m in r["variants"][v]} for v in r["variants"]},
                 "own_slice_f1_rf_B": r["variants"]["B"]["random_forest"]["own_slice"],
                 "lopo": {k: v for k, v in r["lopo"].items() if k != "table"},
                 "served_candidate_xgb_B": r["served_candidate"],
                 "served_candidate_rf": s,
                 "champion_by_prereg_rule": "random_forest (scenario-B AUC 0.784 vs XGBoost 0.749–0.761)",
                 "status": "v5 CANDIDATE — not published to the live registry; adoption, per-domain calibration and artifact size pending advisor decision"
                 })(json.loads(p16.read_text()), json.loads(p16s.read_text()) if p16s.exists() else None) if p16.exists() else None}
        ))(OUT / "rr15_jpf.json", OUT / "rr16_corpus_v2.json", OUT / "rr16_supplement.json", OUT / "jpf_etl_summary.json"),

        # ---- corpus expansion (2.9.26): Ghent DSLIB — RR-17 transfer, corpus v3, buildings calibrator, as-of on real snapshots ----
        "corpus_expansion_DSLIB": (lambda p17, pe: (
            {"source": "DSLIB v3.4 — Batselier & Vanhoucke 2015, IJPM 33(3) 697–710; OR-AS / Ghent University; per-project Excel exports",
             "etl": json.loads(pe.read_text()) if pe.exists() else None,
             "rr17": (lambda r: {
                 "dslib_split": r["dslib"],
                 "transfer_v4": {lb: {"pooled_auc": r["part_A_transfer"]["labels"][lb]["v4"]["pooled"],
                                     "per_project": r["part_A_transfer"]["labels"][lb]["v4"]["per_project"],
                                     "buildings_auc": r["part_A_transfer"]["labels"][lb]["by_group"]["buildings"]["v4"]} for lb in r["part_A_transfer"]["labels"]},
                 "transfer_v5_candidate": {lb: {"pooled_auc": r["part_A_transfer"]["labels"][lb]["v5_candidate"]["pooled"],
                                               "buildings_auc": r["part_A_transfer"]["labels"][lb]["by_group"]["buildings"]["v5_candidate"]} for lb in r["part_A_transfer"]["labels"]},
                 "v4_mean_predicted_p": r["part_A_transfer"]["labels"]["is_late"]["v4"]["mean_p"],
                 "v4_brier_vs_dummy": [r["part_A_transfer"]["labels"]["is_late"]["v4"]["brier"], r["part_A_transfer"]["brier_dummy_is_late"]],
                 "label_construct": r.get("post_hoc_label_construct"),
                 "corpus_v3": {k: {"pooled_test_auc": v["pooled_test_auc"], "slices": v["slices"],
                                   "dslib_holdout_all": {lb: v["dslib_holdout"][lb]["all"] for lb in v["dslib_holdout"]},
                                   "dslib_holdout_buildings": {lb: v["dslib_holdout"][lb]["by_group"]["buildings"] for lb in v["dslib_holdout"]}}
                               for k, v in r["part_B_corpus_v3"]["runs"].items()},
                 "corpus_v3_references": r["part_B_corpus_v3"]["references"],
                 "calibration": r["part_C_calibration"],
                 "asof_snapshots": {k: v for k, v in r["part_D_asof_snapshots"].items()},
                 "asof_post_hoc": r.get("post_hoc_part_D_variants"),
                 "status": "RR-17 complete 2.9.26 — no registry change; frozen-baseline label is a different construct from the platform's updated-plan label; v6 not proposed"
                 })(json.loads(p17.read_text())) if p17.exists() else None}
        ))(OUT / "rr17_dslib.json", OUT / "dslib_etl_summary.json"),

        # ---- RR-18 (2.9.26): per-customer model simulation on DSLIB (train on one customer's history only) ----
        "customer_model_RR18": (lambda p: (lambda r: {
            "config": r["config"],
            "new_project_holdout": {lb: {m: {"pooled_auc": r["part_A_new_project_holdout"][lb][m]["pooled"],
                                            "per_project_median": r["part_A_new_project_holdout"][lb][m]["per_project"]["median"],
                                            "buildings_auc": r["part_A_new_project_holdout"][lb][m]["buildings"]}
                                        for m in ("random_forest", "xgboost", "logistic_regression")}
                                    for lb in r["part_A_new_project_holdout"]},
            "within_project_scenarioB": r["part_B_within_project_scenarioB"]["results"],
            "learning_curve": {lb: {n: {"pooled_median": v["pooled_median"], "per_project_median": v["per_project_median_of_medians"], "rows": v["rows_median"]}
                                   for n, v in r["part_C_learning_curve"]["curve"][lb].items()} for lb in r["part_C_learning_curve"]["curve"]},
            "asof_combination": {lb: {k: v for k, v in r["part_D_asof_combination"]["results"][lb].items() if not isinstance(v, dict)} for lb in r["part_D_asof_combination"]["results"]},
            "customer_calibration_holdout": r["part_E_customer_calibration"]["holdout"],
            "reverse_transfer_to_own": {k: v for k, v in r["part_F_reverse_transfer_to_own"].items() if k != "note"},
            "status": "simulation only — no per-tenant training in the product yet; minimum ~20 customer projects before the gate opens"
            })(json.loads(p.read_text())) if p.exists() else None)(OUT / "rr18_customer_sim.json"),
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
