"""
RR-15 — External validation at ACTIVITY level on the Cambridge JPF corpus.

Question: does the plan-time delay model (registry v4, trained on Buildings.Historical.Data,
Middle-East buildings) rank delay risk on 258K activities from 299 UK infrastructure
projects it has never seen? This is the activity-level rung missing between scenario B
(within-project, AUC 0.72) and RR-8 (NYC, project-level, AUC 0.60–0.68).

PRE-REGISTERED HYPOTHESIS (written before any number was computed, 2.9.2026):
  H1  Pooled AUC of v4 on JPF (date label, is_late = actual_finish > planned_finish)
      lies in [0.55, 0.70] — above chance, below within-project scenario B (0.7228),
      consistent with RR-13's "weak but real transfer" finding.
  H2  Per-project AUC is widely dispersed (IQR width ≥ 0.10), as in LOPO (RR-13).
  H3  Calibration does NOT transfer: JPF base rate (~0.16) ≠ training base rate (0.41),
      so served probabilities over-state risk; Brier is reported but is NOT a validity metric here.
  H4  The duration-growth label (at-completion duration > original estimate) gives AUC
      within ±0.05 of the date label — the two label definitions agree on ranking.
A result outside these ranges is a finding, not a failure; nothing here is tuned.

Data: JPF_Anonymised_Project_Data.json (Brilakis, Fitzsimmons & Lu 2020, Apollo,
CC BY 4.0, doi:10.17863/CAM.53890). Profile (2.9.26): 299 projects, 444,156 activities,
258,352 with planned+actual finish; base rate 0.157 (calendar days); 91% have predecessors.

Feature derivation mirrors data-pipeline/src/etl.py exactly (same names, same graph BFS cap):
  planned_duration_days, total_float_hr (Total_Float(d)×8h — P6 default day), free_float_hr,
  rel_position (vs the project's own min planned start / max planned finish, as etl.py does),
  proj_n_tasks, proj_span_days, n_pred, n_succ, upstream_cnt, downstream_cnt (all relationship
  types, as etl.py takes every TASKPRED row), task_type = None (JPF's Task_Type field is broken —
  it repeats Task_ID — so the categorical is missing; the pipeline imputes "NA").
Labels: delay_days = actual_finish.date − planned_finish.date (calendar days; time-of-day stripped —
  JPF plans carry 16:00/17:00 while actuals carry 00:00), is_late = delay_days > 0,
  is_late_7 = > 7 days, grew = at_completion_duration > original_duration_estimate.

Run:  python rr15_jpf.py <JPF json or zip> <registry_dir> [out_dir]
"""

from __future__ import annotations
import json
import sys
import zipfile
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path

import ijson
import numpy as np
import pandas as pd

SRC = Path(sys.argv[1])
REG = Path(sys.argv[2])
OUT = Path(sys.argv[3] if len(sys.argv) > 3 else "outputs")
OUT.mkdir(parents=True, exist_ok=True)
HOURS_PER_DAY = 8.0
BFS_CAP = 5000  # same as etl.py


def pdate(s):
    if not s:
        return None
    s = s.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def fnum(x):
    try:
        v = float(x)
        return v if v == v else np.nan
    except (TypeError, ValueError):
        return np.nan


def graph_stats(ids, edges):
    succ, pred = defaultdict(list), defaultdict(list)
    for a, b in edges:
        if a in ids and b in ids:
            succ[a].append(b)
            pred[b].append(a)

    def reach(start, adj, cap=BFS_CAP):
        seen, q = {start}, deque([start])
        while q and len(seen) < cap:
            for n in adj[q.popleft()]:
                if n not in seen:
                    seen.add(n)
                    q.append(n)
        return len(seen) - 1

    return {
        t: dict(
            n_pred=len(pred[t]),
            n_succ=len(succ[t]),
            upstream_cnt=reach(t, pred),
            downstream_cnt=reach(t, succ),
        )
        for t in ids
    }


def open_json(p: Path):
    if p.suffix == ".zip":
        z = zipfile.ZipFile(p)
        name = [
            n for n in z.namelist() if n.endswith(".json") and not n.startswith("__")
        ][0]
        return z.open(name)
    return open(p, "rb")


rows = []
task_id_projects = defaultdict(set)
with open_json(SRC) as f:
    for pid, proj in ijson.kvitems(f, "Projects"):
        acts = proj["Activities"]
        ids = set(acts.keys())
        edges = []
        for aid, a in acts.items():
            rels = a.get("Activity_Relationships") or {}
            if isinstance(rels, dict):
                for r in rels.values():
                    p_ = r.get("Predecessor_ID")
                    if p_:
                        edges.append((str(p_), str(aid)))
        g = graph_stats(ids, edges)
        starts = [pdate(a.get("Planned_Start_Date")) for a in acts.values()]
        fins = [pdate(a.get("Planned_Finish_Date")) for a in acts.values()]
        starts = [d for d in starts if d]
        fins = [d for d in fins if d]
        p0, p1 = (min(starts) if starts else None), (max(fins) if fins else None)
        span = max((p1 - p0).days, 1) if p0 and p1 else np.nan
        for aid, a in acts.items():
            task_id_projects[aid].add(pid)
            ps, pf = (
                pdate(a.get("Planned_Start_Date")),
                pdate(a.get("Planned_Finish_Date")),
            )
            as_, af = (
                pdate(a.get("Actual_Start_Date")),
                pdate(a.get("Actual_Finish_Date")),
            )
            gs = g[aid]
            delay = (af.date() - pf.date()).days if (af and pf) else np.nan
            ode, aod = (
                fnum(a.get("Original_Duration_Estimate(ODE)")),
                fnum(a.get("At_Completion_Duration")),
            )
            rows.append(
                dict(
                    project=pid,
                    project_type=proj.get("Project_Type"),
                    region=proj.get("UK_Region"),
                    task_id=aid,
                    planned_duration_days=((pf - ps).days if ps and pf else np.nan),
                    total_float_hr=fnum(a.get("Total_Float(d)")) * HOURS_PER_DAY,
                    free_float_hr=fnum(a.get("Free_Float(hrs)")),
                    rel_position=(
                        ((ps - p0).days / span)
                        if ps and p0 and span == span
                        else np.nan
                    ),
                    proj_n_tasks=len(acts),
                    proj_span_days=span,
                    **gs,
                    task_type=None,
                    started_early_days=(
                        (ps.date() - as_.date()).days if ps and as_ else np.nan
                    ),
                    delay_days=delay,
                    is_late=(float(delay > 0) if delay == delay else np.nan),
                    is_late_7=(float(delay > 7) if delay == delay else np.nan),
                    grew=(
                        float(aod > ode)
                        if (ode == ode and aod == aod and (af is not None))
                        else np.nan
                    ),
                )
            )

df = pd.DataFrame(rows)
dups = sum(1 for v in task_id_projects.values() if len(v) > 1)
df.to_csv(OUT / "jpf_labeled_tasks.csv", index=False)
lab = df[df["is_late"].notna()]
summary = dict(
    projects=int(df["project"].nunique()),
    activities=int(len(df)),
    labeled=int(len(lab)),
    late_rate=round(float(lab["is_late"].mean()), 4),
    late7_rate=round(float(lab["is_late_7"].mean()), 4),
    grew_rate=round(float(lab["grew"].mean()), 4),
    task_ids_shared_across_projects=dups,
)
print(json.dumps(summary, indent=1))
json.dump(summary, open(OUT / "jpf_etl_summary.json", "w"), indent=1)
