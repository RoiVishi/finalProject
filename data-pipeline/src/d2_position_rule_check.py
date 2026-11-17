"""Decision D2 — does labelling the running overruns inflate a within-project score? No model is trained.

Decision 5 of D1 put the BHD activities that were still running at the data date, and had already
run longer than planned, into the main analysis with grew = 1. Only overruns can be added this way:
a running activity that will finish within plan has no label yet.

The check (proposed and first run by Shira): take a rule that knows nothing about an activity except
where it sits in the plan — rank by planned position (rel_position) — and measure its within-project
AUC twice: on the completed activities only, and with the running overruns added. If the rule gets
better just because those activities were added, the gain comes from how they are labelled, not from
any ability to predict. rel_position is a model feature, so a model could collect the same gain.

BHD only (DSLIB projects are complete). BHD is not frozen, so the frozen test set is not touched.
Rows: work activities with planned hours > 0 of the 7 BHD projects of the cleaned corpus; `grew` in
calendar days, as in E1–E2b (e2_data_audit.read_bhd). Eligibility: >= 30 activities, >= 5 per class.

Writes outputs/d2_position_rule_check.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd
from sklearn.metrics import roc_auc_score

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from e2_data_audit import WORK_TYPES, read_bhd  # noqa: E402

OUT = HERE.parent / "outputs"
MIN_ACTIVITIES, MIN_CLASS = 30, 5


def position_auc(d: pd.DataFrame) -> float | None:
    """Within-project AUC of 'later in the plan = more likely to overrun'. None when not eligible."""
    pos = int(d["grew"].sum())
    if len(d) < MIN_ACTIVITIES or min(pos, len(d) - pos) < MIN_CLASS:
        return None
    return round(float(roc_auc_score(d["grew"].astype(int), d["rel_position"])), 3)


def project_row(project: str, work: pd.DataFrame) -> dict:
    done = work[work["grew"].notna()]
    running = work[work["running_overrun_known"]].assign(grew=1.0)
    both = pd.concat([done, running], ignore_index=True)
    return {"project": project,
            "completed": int(len(done)), "completed_grew_rate": round(float(done["grew"].mean()), 3),
            "running_overruns": int(len(running)),
            "median_position_completed": round(float(done["rel_position"].median()), 2),
            "median_position_running_overruns": (round(float(running["rel_position"].median()), 2)
                                                 if len(running) else None),
            "auc_completed_only": position_auc(done), "auc_with_running_overruns": position_auc(both)}


def summarise(rows: list[dict]) -> dict:
    t = pd.DataFrame(rows)
    paired = t.dropna(subset=["auc_completed_only", "auc_with_running_overruns"])
    gain = paired["auc_with_running_overruns"] - paired["auc_completed_only"]
    return {"median_auc_completed_only": round(float(t["auc_completed_only"].median()), 3),
            "median_auc_with_running_overruns": round(float(t["auc_with_running_overruns"].median()), 3),
            "projects_eligible_in_both": int(len(paired)),
            "projects_where_the_rule_improves": int((gain > 0).sum()),
            "gain_min_median_max": [round(float(v), 3) for v in (gain.min(), gain.median(), gain.max())],
            "projects_below_0_5_completed_only": sorted(t.loc[t["auc_completed_only"] < 0.5, "project"])}


def main() -> int:
    clean = pd.read_csv(OUT / "corpus_v3_clean.csv", low_memory=False)
    own = clean[clean["source"] == "own"]
    rows = []
    for project in sorted(own["project"].unique()):
        b = read_bhd(project.removeprefix("own::"))
        work = b[b["task_type"].isin(WORK_TYPES) & (b["planned_hr"] > 0)]
        row = project_row(project, work)
        assert row["completed"] == int((own["project"] == project).sum()), "rows must be those of the cleaned corpus"
        rows.append(row)
    result = {"rule": "rank by planned position (rel_position); no model",
              "eligibility": f">= {MIN_ACTIVITIES} activities and >= {MIN_CLASS} in each class",
              "running_overruns_total": int(sum(r["running_overruns"] for r in rows)),
              "summary": summarise(rows), "per_project": rows}
    (OUT / "d2_position_rule_check.json").write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n")
    for r in rows:
        print(f"{r['project']:36s} completed {r['auc_completed_only']}   with running {r['auc_with_running_overruns']}")
    print(json.dumps(result["summary"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
