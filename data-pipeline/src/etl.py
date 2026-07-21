"""
ETL: Build a labeled task-delay dataset from Primavera P6 exports.

Input : Buildings.Historical.Data repo (one folder per project, P6 tables as CSV)
Output: outputs/labeled_tasks.csv  - one row per task with plan-time features + delay label
        outputs/etl_summary.json   - counts and dedup decisions (for the project book)

Key design decisions (documented for the project book):
1. Label   : delay_days = act_end_date - target_end_date (calendar days).
             is_late = delay_days > 0. Only tasks having BOTH dates are labeled.
2. Leakage : features use ONLY plan-time information (target dates, floats,
             dependency network). Actual dates are never used as features.
3. Dedup   : some folders are versions/baselines of the same project. We
             fingerprint each project by its set of task_codes and drop
             near-duplicates (Jaccard > 0.8), keeping the version with the
             most labeled tasks.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict, deque
from pathlib import Path

import numpy as np
import pandas as pd

DATA_DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/Buildings Data")
OUT_DIR = Path(__file__).resolve().parents[1] / "outputs"
OUT_DIR.mkdir(parents=True, exist_ok=True)

READ_KW = dict(encoding="utf-8", encoding_errors="replace", on_bad_lines="skip", low_memory=False)


def read_table(proj_dir: Path, name: str) -> pd.DataFrame | None:
    f = proj_dir / f"{name}.csv"
    if not f.exists():
        return None
    try:
        return pd.read_csv(f, **READ_KW)
    except Exception as e:  # a handful of files are malformed; skip, don't crash
        print(f"  [warn] {proj_dir.name}/{name}.csv unreadable: {e}")
        return None


def graph_stats(task_ids: set, edges: list[tuple]) -> dict:
    """Per-task dependency-network features: in/out degree and reachable
    upstream/downstream counts (BFS, capped for safety)."""
    succ, pred = defaultdict(list), defaultdict(list)
    for a, b in edges:  # a -> b  (a precedes b)
        if a in task_ids and b in task_ids:
            succ[a].append(b)
            pred[b].append(a)

    def reach(start, adj, cap=5000):
        seen, q = {start}, deque([start])
        while q and len(seen) < cap:
            for n in adj[q.popleft()]:
                if n not in seen:
                    seen.add(n)
                    q.append(n)
        return len(seen) - 1

    out = {}
    for t in task_ids:
        out[t] = dict(
            n_pred=len(pred[t]),
            n_succ=len(succ[t]),
            upstream_cnt=reach(t, pred),
            downstream_cnt=reach(t, succ),
        )
    return out


def process_project(proj_dir: Path) -> pd.DataFrame | None:
    tasks = read_table(proj_dir, "TASK")
    if tasks is None or "task_id" not in tasks.columns:
        return None
    tasks.columns = [c.strip().lower() for c in tasks.columns]

    for col in ["target_start_date", "target_end_date", "act_start_date", "act_end_date"]:
        if col in tasks.columns:
            tasks[col] = pd.to_datetime(tasks[col], errors="coerce")
        else:
            tasks[col] = pd.NaT

    # dependency edges
    preds = read_table(proj_dir, "TASKPRED")
    edges = []
    if preds is not None:
        preds.columns = [c.strip().lower() for c in preds.columns]
        if {"task_id", "pred_task_id"}.issubset(preds.columns):
            edges = list(zip(preds["pred_task_id"], preds["task_id"]))

    ids = set(tasks["task_id"])
    g = graph_stats(ids, edges)

    proj_start = tasks["target_start_date"].min()
    proj_end = tasks["target_end_date"].max()
    span_days = max((proj_end - proj_start).days, 1) if pd.notna(proj_start) and pd.notna(proj_end) else np.nan

    rows = []
    for _, t in tasks.iterrows():
        gs = g.get(t["task_id"], dict(n_pred=0, n_succ=0, upstream_cnt=0, downstream_cnt=0))
        planned_dur = (
            (t["target_end_date"] - t["target_start_date"]).days
            if pd.notna(t["target_end_date"]) and pd.notna(t["target_start_date"])
            else np.nan
        )
        rel_pos = (
            (t["target_start_date"] - proj_start).days / span_days
            if pd.notna(t["target_start_date"]) and not np.isnan(span_days)
            else np.nan
        )
        delay = (
            (t["act_end_date"] - t["target_end_date"]).days
            if pd.notna(t["act_end_date"]) and pd.notna(t["target_end_date"])
            else np.nan
        )
        rows.append(
            dict(
                project=proj_dir.name,
                task_id=t["task_id"],
                task_code=t.get("task_code"),
                task_name=str(t.get("task_name", ""))[:120],
                task_type=t.get("task_type"),
                status_code=t.get("status_code"),
                planned_duration_days=planned_dur,
                total_float_hr=pd.to_numeric(t.get("total_float_hr_cnt"), errors="coerce"),
                free_float_hr=pd.to_numeric(t.get("free_float_hr_cnt"), errors="coerce"),
                rel_position=rel_pos,
                proj_n_tasks=len(tasks),
                proj_span_days=span_days,
                **gs,
                delay_days=delay,
                is_late=(delay > 0) if not pd.isna(delay) else np.nan,
            )
        )
    return pd.DataFrame(rows)


def main():
    frames, summary = [], {"projects_read": 0, "projects_skipped": []}
    for proj_dir in sorted(p for p in DATA_DIR.iterdir() if p.is_dir()):
        df = process_project(proj_dir)
        if df is None or df.empty:
            summary["projects_skipped"].append(proj_dir.name)
            continue
        frames.append(df)
        summary["projects_read"] += 1
        print(f"  {proj_dir.name}: {len(df)} tasks, {int(df['is_late'].notna().sum())} labeled")

    full = pd.concat(frames, ignore_index=True)

    # ---- dedup near-identical project versions ----
    # Fingerprint = (task_code, task_name) pairs. P6 task codes are auto-generated
    # (A1000, A1010, ...) so codes alone falsely match unrelated projects.
    fp = {
        p: set(zip(g["task_code"].astype(str), g["task_name"].astype(str).str[:40]))
        for p, g in full.groupby("project")
    }
    labeled_cnt = full.groupby("project")["is_late"].apply(lambda s: s.notna().sum())
    drop = set()
    projs = sorted(fp)
    for i, a in enumerate(projs):
        for b in projs[i + 1:]:
            if a in drop or b in drop or not fp[a] or not fp[b]:
                continue
            jac = len(fp[a] & fp[b]) / len(fp[a] | fp[b])
            if jac > 0.8:  # same project, different baseline/version
                loser = a if labeled_cnt[a] < labeled_cnt[b] else b
                drop.add(loser)
                summary.setdefault("dedup_dropped", []).append(
                    {"kept": b if loser == a else a, "dropped": loser, "jaccard": round(jac, 3)}
                )
    full = full[~full["project"].isin(drop)]

    # ---- outlier policy: keep, but flag extreme delays (documented, not hidden) ----
    full["extreme_delay"] = full["delay_days"].abs() > 365

    full.to_csv(OUT_DIR / "labeled_tasks.csv", index=False)
    lab = full[full["is_late"].notna()]
    summary.update(
        total_tasks=int(len(full)),
        labeled_tasks=int(len(lab)),
        pct_late=round(float(lab["is_late"].mean()) * 100, 1),
        projects_after_dedup=int(full["project"].nunique()),
        projects_with_labels=int(lab["project"].nunique()),
        median_delay_days=float(lab["delay_days"].median()),
    )
    (OUT_DIR / "etl_summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print("\n=== ETL summary ===")
    print(json.dumps({k: v for k, v in summary.items() if k != "projects_skipped" and k != "dedup_dropped"}, indent=2))


if __name__ == "__main__":
    main()
