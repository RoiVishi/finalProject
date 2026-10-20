"""PRED-6 gate — the within-project floors added in v6 (external review 20.10.26)."""
import copy
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from quality_gate import check  # noqa: E402

PASSING = {
    "champion": {"classifier": "xgboost"},
    "classification": {
        "B_temporal": {"dummy_majority": {"f1": 0.0, "roc_auc": 0.5}, "logistic_regression": {"roc_auc": 0.7},
                       "xgboost": {"f1": 0.7, "roc_auc": 0.85}},
        "A_repeated": {"xgboost": {"median_auc": 0.72, "share_above_chance": 0.85,
                                   "within_project": {"all": {"median_auc": 0.55, "share_above_chance": 0.7}}}},
    },
    "served_model": {"metrics_B_test": {"roc_auc": 0.84, "f1": 0.7}},
    "calibration": {"B_temporal": {"brier_calibrated": 0.16, "brier_uncalibrated_same_base": 0.17,
                                   "within_project": {"all": {"median_auc": 0.63, "share_above_chance": 0.86}}}},
}


def test_passing_results_pass():
    assert check(PASSING) == []


def test_weak_within_project_ranking_fails_even_with_good_pooled_auc():
    r = copy.deepcopy(PASSING)
    r["classification"]["A_repeated"]["xgboost"]["within_project"]["all"] = {"median_auc": 0.49, "share_above_chance": 0.4}
    assert any("A nested within-project" in f for f in check(r))
    r = copy.deepcopy(PASSING)
    r["calibration"]["B_temporal"]["within_project"]["all"]["share_above_chance"] = 0.5
    assert any("B served within-project" in f for f in check(r))


def test_pre_v6_results_without_within_project_are_not_failed_for_it():
    r = copy.deepcopy(PASSING)
    del r["classification"]["A_repeated"]["xgboost"]["within_project"]
    del r["calibration"]["B_temporal"]["within_project"]
    assert check(r) == []


def test_v6_results_must_report_within_project():
    r = copy.deepcopy(PASSING)
    r["config"] = {"target": "grew"}            # v6+ marker
    assert check(r) == []
    del r["calibration"]["B_temporal"]["within_project"]
    assert any("B served within-project] missing" in f for f in check(r))
