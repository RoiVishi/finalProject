"""
E4 feasibility: can DSLIB tracking periods serve as as-of snapshots (advisor item 2)?

Reads outputs/dslib_snapshots.csv (one row per project x tracking period x activity, from
rr17_dslib_etl.py) and keeps the DSLIB projects of corpus v4 that are NOT in the frozen
test set (development only). No model is trained and no model result is read.

Checks per project:
  tp_sorted            status dates strictly increase with the TP number
  gap_days_median      median days between consecutive status dates
  started_after_sd     rows with actual_start later than the TP status date (future information)
  pct_decreases        activity-to-next-TP steps in which pct_complete goes down
  start_changed_share  share of started activities whose actual_start differs between TPs
  finished_after_sd    share of 'finished' rows whose end (actual_start + actual duration in
                       Mon-Fri working days) falls after the TP status date
  inprog_equals_final  share of activities that were 'in_progress' in some TP before the last one and whose
                       actual duration there already equals the duration of the last TP (a sign the TP
                       was rebuilt afterwards). Counted once per activity.

Run (from data-pipeline):  python3 src/e4_feasibility.py   -> outputs/e4_feasibility.json
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from frozen import frozen_projects

OUT = Path(__file__).resolve().parent.parent / "outputs"


def development_dslib_projects() -> list[str]:
    corpus = pd.read_csv(OUT / "corpus_v4.csv", usecols=["project", "source"])
    dslib = set(corpus.loc[corpus["source"] == "dslib", "project"])
    dev = dslib - frozen_projects()
    return sorted(p.split("::", 1)[-1] for p in dev)  # corpus keys are "dslib::<name>"


def end_date(start: pd.Series, dur_wd: pd.Series) -> pd.Series:
    days = np.ceil(dur_wd.fillna(0)).astype(int)
    d = np.busday_offset(
        start.values.astype("datetime64[D]"), np.maximum(days - 1, 0), roll="forward"
    )
    return pd.to_datetime(d)


def check_project(s: pd.DataFrame) -> dict:
    s = s.sort_values(["task_id", "tp"])
    sd = s.groupby("tp")["status_date"].first().sort_index()
    gaps = sd.diff().dt.days.dropna()
    started = s[s["actual_start"].notna()]
    nxt = s.groupby("task_id")["pct_complete"].shift(-1)
    final = s[s["tp"] == s["tp"].max()].set_index("task_id")["actual_duration_wd"]
    # in-progress rows before the last TP (in the last TP the duration is the final one by definition)
    inprog = s[(s["status"] == "in_progress") & (s["tp"] < s["tp"].max())]
    # per activity: True if, in some TP where it was still running, its duration already equals the final one
    eq = inprog["actual_duration_wd"].values == final.reindex(inprog["task_id"]).values
    eq = pd.Series(eq, index=inprog["task_id"].values).groupby(level=0).any()
    fin = s[s["status"] == "finished"]
    ends = end_date(fin["actual_start"], fin["actual_duration_wd"])
    return {
        "n_tps": int(sd.size),
        "tp_sorted": bool(sd.is_monotonic_increasing and sd.is_unique),
        "gap_days_median": float(gaps.median()) if len(gaps) else None,
        "started_after_sd": int(
            (started["actual_start"].dt.normalize() > started["status_date"]).sum()
        ),
        "pct_decreases": int((nxt < s["pct_complete"] - 1e-9).sum()),
        "start_changed_share": round(
            float((started.groupby("task_id")["actual_start"].nunique() > 1).mean()), 3
        ),
        "finished_after_sd": round(
            float((ends.values > fin["status_date"].values).mean()), 3
        )
        if len(fin)
        else 0.0,
        "n_in_progress_activities": int(eq.size),
        "n_inprog_equals_final": int(eq.sum()),
        "inprog_equals_final": round(float(eq.mean()), 3) if eq.size else None,
    }


def main() -> None:
    snaps = pd.read_csv(
        OUT / "dslib_snapshots.csv", parse_dates=["status_date", "actual_start"]
    )
    projects = development_dslib_projects()
    missing = [p for p in projects if p not in set(snaps["project"])]
    res = {
        p: check_project(snaps[snaps["project"] == p])
        for p in projects
        if p not in missing
    }
    n_in = sum(r["n_in_progress_activities"] for r in res.values())
    n_eq = sum(r["n_inprog_equals_final"] for r in res.values())
    out = {
        "n_projects": len(res),
        "missing_from_snapshots": missing,
        "inprog_equals_final_pooled": {
            "activities": n_in,
            "equal": n_eq,
            "share": round(n_eq / max(n_in, 1), 4),
        },
        "per_project": res,
    }
    (OUT / "e4_feasibility.json").write_text(json.dumps(out, indent=2))
    print(pd.DataFrame(res).T.to_string())
    print(
        "projects:",
        len(res),
        "missing:",
        missing,
        "in-progress = final (pooled):",
        out["inprog_equals_final_pooled"],
    )


if __name__ == "__main__":
    main()
