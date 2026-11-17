"""Corpus v4 cleaning rules (src/clean_rules.py, advisor item 6)."""
import json
import sys
from pathlib import Path

import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from clean_rules import clean_bhd, clean_dslib, overwritten_projects  # noqa: E402

OUT = ROOT / "outputs"
D = pd.Timestamp


def test_overwritten_rule_is_at_least_90_percent():
    proj = pd.Series(["a"] * 10 + ["b"] * 10)
    start = pd.Series([True] * 9 + [False] + [True] * 8 + [False] * 2)     # a: 9/10 equal, b: 8/10
    finish = pd.Series([True] * 20)
    assert overwritten_projects(start, finish, proj) == ["a"]


def test_bhd_keeps_work_activities_with_planned_hours_and_drops_overwritten_projects():
    corpus = pd.DataFrame({"project": ["own::p"] * 4 + ["own::q"] * 2, "task_id": [1, 2, 3, 4, 1, 2],
                           "grew": [1, 0, 1, 0, 0, 0], "source": "own"})
    same, later = D("2010-01-01"), D("2010-01-05")
    raw = pd.DataFrame({
        "project": ["own::p"] * 4 + ["own::q"] * 2, "task_id": [1, 2, 3, 4, 1, 2],
        "task_type": ["TT_Task", "TT_Mile", "TT_Rsrc", "TT_Task", "TT_Task", "TT_Task"],
        "status": "TK_Complete", "planned_hr": [8, 0, 16, 0, 8, 8],
        "target_start_date": same, "target_end_date": same,
        "act_start_date": [later, later, later, later, same, same], "act_end_date": [later] * 4 + [same, same]})
    clean, report = clean_bhd(corpus, raw)
    assert list(clean["task_id"]) == [1, 3]              # milestone and 0-hour rows out; q dropped (100% equal)
    assert report["dropped_projects"] == ["own::q"]
    assert list(clean.columns) == list(corpus.columns)


def test_dslib_keeps_planned_working_days_and_drops_overwritten_projects():
    corpus = pd.DataFrame({"project": ["dslib::x", "dslib::x", "dslib::y"], "task_id": [1, 2, 1],
                           "grew": [1, 0, 0], "source": "dslib"})
    ds = pd.DataFrame({"project": ["dslib::x", "dslib::x", "dslib::y"], "task_id": [1, 2, 1],
                       "planned_duration_wd": [5, 0, 3],
                       "baseline_start": ["2020-01-06 08:00", "2020-01-06", "2020-02-03 08:00"],
                       "baseline_end": ["2020-01-10 17:00", "2020-01-06", "2020-02-05 17:00"],
                       "actual_start": ["2020-01-07 08:00", "2020-01-06", "2020-02-03 08:00"],
                       "actual_end": ["2020-01-14 08:00", "2020-01-06", "2020-02-05 08:00"]})
    clean, report = clean_dslib(corpus, ds)
    assert list(zip(clean["project"], clean["task_id"])) == [("dslib::x", 1)]   # 0 days out; y equal by day
    assert report["dropped_projects"] == ["dslib::y"]


@pytest.mark.skipif(not (OUT / "corpus_v4.csv").exists() or not (OUT / "corpus_v3_clean.csv").exists(),
                    reason="needs the ETL outputs (not in git)")
def test_v4_is_exactly_the_corpus_of_e2_minus_the_13_dslib_projects_of_e2c():
    v4 = pd.read_csv(OUT / "corpus_v4.csv", low_memory=False)
    e2 = pd.read_csv(OUT / "corpus_v3_clean.csv", low_memory=False)
    dropped = json.loads((OUT / "dslib_overwritten_projects.json").read_text())["projects"]
    expected = e2[~e2["project"].isin(dropped)]
    assert v4["project"].nunique() == 51 and len(v4) == 7349
    key = ["project", "task_id"]
    pd.testing.assert_frame_equal(v4.sort_values(key).reset_index(drop=True),
                                  expected.sort_values(key).reset_index(drop=True)[v4.columns], check_dtype=False)
