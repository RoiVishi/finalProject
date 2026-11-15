"""d2_position_rule_check: eligibility, and the artefact itself on made-up data."""
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from d2_position_rule_check import position_auc, project_row, summarise  # noqa: E402


def _work(n_done=40, n_running=20):
    # completed activities: overruns spread evenly over the plan, so position says nothing (AUC 0.5)
    done = pd.DataFrame({"rel_position": [i / n_done * 0.6 for i in range(n_done)],
                         "grew": [float(i % 2) for i in range(n_done)], "running_overrun_known": False})
    # running overruns: later in the plan, no label yet
    run = pd.DataFrame({"rel_position": [0.6 + i / n_running * 0.4 for i in range(n_running)],
                        "grew": float("nan"), "running_overrun_known": True})
    return pd.concat([done, run], ignore_index=True)


def test_not_eligible_returns_none():
    few = pd.DataFrame({"rel_position": [0.1, 0.2, 0.3], "grew": [0.0, 1.0, 0.0]})
    one_class = pd.DataFrame({"rel_position": [i / 40 for i in range(40)], "grew": [1.0] * 38 + [0.0] * 2})
    assert position_auc(few) is None and position_auc(one_class) is None


def test_adding_late_overruns_raises_a_rule_that_knows_only_the_position():
    r = project_row("own::made-up", _work())
    assert r["completed"] == 40 and r["running_overruns"] == 20
    assert abs(r["auc_completed_only"] - 0.5) < 0.03          # position is uninformative on the completed ones
    assert r["auc_with_running_overruns"] > 0.7                # and looks informative once the overruns are added


def test_summary_counts_only_projects_eligible_in_both():
    rows = [{"project": "a", "auc_completed_only": 0.40, "auc_with_running_overruns": 0.50},
            {"project": "b", "auc_completed_only": 0.60, "auc_with_running_overruns": 0.70},
            {"project": "c", "auc_completed_only": None, "auc_with_running_overruns": 0.60}]
    s = summarise(rows)
    assert s["projects_eligible_in_both"] == 2 and s["projects_where_the_rule_improves"] == 2
    assert s["projects_below_0_5_completed_only"] == ["a"]
