"""Cleaning rules for the corpus used from E3 on (advisor feedback 8.11.2026, item 6).

Until E3 these rules lived only in experiment scripts (e2_data_audit.py, e2c_eligibility.py), and the
official training (train_compare.py) still read the uncleaned corpus_v3_buildings.csv. This module is
the one permanent home of the rules; build_corpus_v4.py applies them. It is written independently of the
experiment scripts; the test checks that it gives exactly the corpus of E2 + E2c (51 projects, 7,349
activities).

Rules
  1. BHD: work activities only (task_type TT_Task / TT_Rsrc). Milestones, level-of-effort and WBS
     summary rows are not activities: a milestone has no duration, so its `grew` is 0 by construction;
     an LOE row's duration is set by other activities (E2: 83% "overrun").
  2. Planned duration > 0 (BHD: planned hours; DSLIB: planned working days). With nothing planned,
     "longer than planned" has no meaning.
  3. Overwritten plan: a project is dropped when, on >= 90% of its activities, the planned start AND
     finish equal the actual ones. Its plan is a copy of the execution, so `grew` is 0 by construction.
     BHD: counted over its completed work activities in the raw P6 table (as in E2).
     DSLIB: counted over its activities left after rules 1-2 (as in E2c).
     The 90% threshold was set in E2 after looking at BHD (jumaira 100%, cairo alex-road 91%), and
     applied to DSLIB unchanged in E2c.
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

WORK_TYPES = {"TT_Task", "TT_Rsrc"}
OVERWRITTEN_SHARE = 0.90
BHD_DATES = ["target_start_date", "target_end_date", "act_start_date", "act_end_date"]


def read_bhd_tasks(raw_dir: Path, project: str) -> pd.DataFrame:
    """The columns the rules need from one raw BHD TASK.csv, dates as calendar days."""
    t = pd.read_csv(Path(raw_dir) / project / "TASK.csv", encoding="utf-8", encoding_errors="replace",
                    on_bad_lines="skip", low_memory=False)
    t.columns = [c.strip().lower() for c in t.columns]
    out = pd.DataFrame({"project": "own::" + project, "task_id": t["task_id"], "task_type": t["task_type"],
                        "status": t["status_code"],
                        "planned_hr": pd.to_numeric(t["target_drtn_hr_cnt"], errors="coerce")})
    for c in BHD_DATES:
        out[c] = pd.to_datetime(t[c], errors="coerce").dt.normalize()
    return out


def overwritten_projects(start_equal: pd.Series, finish_equal: pd.Series, project: pd.Series) -> list[str]:
    """Projects whose planned start and finish both equal the actual ones on >= OVERWRITTEN_SHARE."""
    both = (start_equal & finish_equal).groupby(project).mean()
    return sorted(both[both >= OVERWRITTEN_SHARE].index)


def clean_bhd(corpus: pd.DataFrame, raw: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """corpus: the BHD rows of corpus v3; raw: read_bhd_tasks() of the same projects, stacked."""
    own = corpus.merge(raw[["project", "task_id", "task_type", "planned_hr"]].rename(columns={"task_type": "raw_type"}),
                       on=["project", "task_id"], how="left", validate="one_to_one")
    n0 = len(own)
    own = own[own["raw_type"].isin(WORK_TYPES)]
    n1 = len(own)
    own = own[own["planned_hr"] > 0]
    n2 = len(own)
    done = raw[(raw["status"] == "TK_Complete") & raw[BHD_DATES].notna().all(axis=1) & raw["task_type"].isin(WORK_TYPES)]
    dropped = overwritten_projects(done["target_start_date"] == done["act_start_date"],
                                   done["target_end_date"] == done["act_end_date"], done["project"])
    own = own[~own["project"].isin(dropped)]
    report = {"start": n0, "work_types_only": n1, "planned_duration_gt_0": n2, "after_overwritten": len(own),
              "dropped_projects": dropped}
    return own[corpus.columns], report


def clean_dslib(corpus: pd.DataFrame, ds: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    """corpus: the DSLIB rows of corpus v3; ds: dslib_labeled_tasks.csv with project ids 'dslib::<code>'."""
    cols = ["project", "task_id", "planned_duration_wd", "baseline_start", "baseline_end", "actual_start", "actual_end"]
    d = corpus.merge(ds[cols], on=["project", "task_id"], how="left", validate="one_to_one")
    n0 = len(d)
    d = d[d["planned_duration_wd"] > 0]
    n1 = len(d)
    day = lambda c: pd.to_datetime(d[c], errors="coerce").dt.normalize()  # noqa: E731
    dropped = overwritten_projects(day("baseline_start") == day("actual_start"),
                                   day("baseline_end") == day("actual_end"), d["project"])
    d = d[~d["project"].isin(dropped)]
    report = {"start": n0, "planned_duration_gt_0": n1, "after_overwritten": len(d), "dropped_projects": dropped}
    return d[corpus.columns], report
