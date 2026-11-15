"""e2c_eligibility: comparable pairs, the overwritten-plan rule, eligibility rules, freeze simulation."""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from e2c_eligibility import (MIN_PAIRS, add_labels, comparable_pairs, overwritten,  # noqa: E402
                             project_table, simulate_freeze)


def _rows(project, planned, actual, start_equal=False, finish_equal=False, source="dslib"):
    n = len(planned)
    return pd.DataFrame({"project": project, "source": source, "task_id": range(n),
                         "grew": [int(a > p) for a, p in zip(actual, planned)],
                         "planned_wd": planned, "actual_wd": actual,
                         "start_equal": start_equal, "finish_equal": finish_equal})


def test_comparable_pairs():
    assert comparable_pairs(pd.Series([1.0, 1.0, 1.0])) == 0          # all tied: nothing to rank
    assert comparable_pairs(pd.Series([1.0, 1.0, 2.0])) == 2
    assert comparable_pairs(pd.Series([1.0, 1.5, 2.0])) == 3
    # the weakest project the `grew` rule allows, 5 against 25, gives exactly MIN_PAIRS
    assert comparable_pairs(pd.Series([2.0] * 5 + [1.0] * 25)) == MIN_PAIRS == 125


def test_overwritten_rule_uses_both_dates_and_the_90_percent_threshold():
    a = _rows("dslib::copy", [5] * 10, [5] * 10, start_equal=True, finish_equal=True)
    b = _rows("dslib::moved", [5] * 10, [5] * 10, start_equal=True, finish_equal=False)
    c = _rows("dslib::nine", [5] * 10, [5] * 10)
    c["start_equal"] = [True] * 9 + [False]
    c["finish_equal"] = [True] * 9 + [False]
    out = overwritten(pd.concat([a, b, c]))
    assert out["dslib::copy"]["labels_invalid"] is True
    assert out["dslib::moved"]["labels_invalid"] is False            # start moved, finish not: kept
    assert out["dslib::nine"]["labels_invalid"] is True              # exactly 90% counts


def test_eligibility_rules():
    # 30 activities, every one exactly 20% longer than planned: many `grew`, no ranking information
    same = _rows("dslib::same", [5] * 30, [6] * 30)
    # 30 activities, 5 overruns of different sizes
    mixed = _rows("dslib::mixed", [10] * 30, [10] * 25 + [11, 12, 13, 14, 15])
    t = project_table(add_labels(pd.concat([same, mixed]))).set_index("project")
    assert t.loc["dslib::same", "comparable_pairs"] == 0
    assert bool(t.loc["dslib::same", "eligible_ratio_A"]) and not bool(t.loc["dslib::same", "eligible_ratio_B"])
    assert not bool(t.loc["dslib::same", "eligible_grew"])           # one class only
    assert t.loc["dslib::mixed", "comparable_pairs"] == 5 * 25 + 10  # 125 against the 1.0s + 10 among the five
    assert bool(t.loc["dslib::mixed", "eligible_grew"]) and bool(t.loc["dslib::mixed", "eligible_ratio_B"])
    # only 3 of the 5 overruns pass the tolerance label (> 20% and >= 2 working days)
    assert t.loc["dslib::mixed", "tolerance_pos"] == 3 and not bool(t.loc["dslib::mixed", "eligible_tolerance"])


def test_ratio_needs_a_planned_duration():
    r = add_labels(_rows("own::p", [0, 2], [1, 3], source="own"))
    assert pd.isna(r["ratio"].iloc[0]) and r["ratio"].iloc[1] == 1.5


def test_freeze_simulation_takes_whole_families():
    rows = pd.concat([_rows(f"dslib::p{i}", [10] * 30, [10] * 25 + [11, 12, 13, 14, 15]) for i in range(20)])
    table = project_table(add_labels(rows))
    fam = {f"dslib::p{i}": f"F{i // 2}" for i in range(20)}         # 10 families of 2 projects
    sim = simulate_freeze(table, fam, n_draws=200, seed=0)
    assert sim["frozen_projects_mean"] == 16.0                       # 8 whole families: the first count >= 15
    assert sim["eligible_in_frozen_set"]["grew"]["mean"] == 16.0
