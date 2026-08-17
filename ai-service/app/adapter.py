"""
PRED-9 — Feature adapter: platform entities → model feature vectors.

The bridge between the platform's world (tasks, dependencies, dates) and the
model's world (the 11-feature contract of feature_schema.json). Design decisions:

1. Lives in the ai-service (not the backend): feature semantics stay in one
   language, next to the schema and the model. The backend sends RAW entities
   and never needs to know what a feature is. The payload models below ARE the
   integration contract for the platform side.
2. No CPM (RR-12): total_float_hr / free_float_hr are sent as None. The float
   ablation showed the model loses only 0.0015 AUC without them, while a CPM
   pass would require full-network recomputation on every schedule edit. The
   pipeline's median imputer handles the Nones. CPM remains a possible PRODUCT
   feature (critical-path display) — deliberately out of scope here.
3. Bounded traversal: upstream/downstream reach is capped (TRAVERSAL_CAP) so a
   pathological graph cannot stall the service; a visited-set makes it cycle-safe
   even though TASK-3 rejects cycles at entry (defence in depth).
4. Plan-time only: nothing here reads actual dates or statuses — same blacklist
   discipline as training (PRED-14).
"""
from __future__ import annotations

from collections import defaultdict, deque
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

TRAVERSAL_CAP = 50_000          # max nodes visited per reach computation
DAY_SECONDS = 86_400.0

# Platform activity types → the P6-era categories the model was trained on.
# Unknown types fall back to TT_Task (OneHotEncoder ignores unseen categories
# anyway — this mapping just keeps the common cases aligned with training).
TASK_TYPE_MAP = {
    "task": "TT_Task",
    "milestone": "TT_Mile",
    "start_milestone": "TT_Mile",
    "finish_milestone": "TT_FinMile",
    "summary": "TT_WBS",
    "hammock": "TT_LOE",
    "level_of_effort": "TT_LOE",
}


# ---------------------------------------------------------------- payload (the contract)

class RawTask(BaseModel):
    """A platform activity, as stored by the backend. Plan-time fields only."""
    model_config = ConfigDict(extra="forbid")

    id: str
    planned_start: date | None = None
    planned_finish: date | None = None
    type: str = "task"                      # platform vocabulary; see TASK_TYPE_MAP


class RawDependency(BaseModel):
    """Finish-to-start edge (TASK-3): successor may start when predecessor finishes."""
    model_config = ConfigDict(extra="forbid")

    predecessor_id: str
    successor_id: str


class RawProject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    planned_start: date | None = None       # optional — derived from tasks if absent
    planned_finish: date | None = None


class ProjectGraphPayload(BaseModel):
    """What the backend sends to POST /predict/project — raw entities, no features."""
    model_config = ConfigDict(extra="forbid")

    project: RawProject = Field(default_factory=RawProject)
    tasks: list[RawTask]
    dependencies: list[RawDependency] = Field(default_factory=list)


# ---------------------------------------------------------------- graph helpers

def _adjacency(deps: list[RawDependency], known_ids: set[str]):
    """Forward and backward adjacency; edges touching unknown task ids are dropped."""
    succ, pred = defaultdict(list), defaultdict(list)
    for d in deps:
        if d.predecessor_id in known_ids and d.successor_id in known_ids:
            succ[d.predecessor_id].append(d.successor_id)
            pred[d.successor_id].append(d.predecessor_id)
    return succ, pred


def bounded_reach(start: str, adjacency: dict[str, list[str]], cap: int = TRAVERSAL_CAP) -> int:
    """Number of DISTINCT nodes reachable from start (excluding start), BFS, capped.

    Cycle-safe by the visited set; the cap bounds worst-case work per task.
    """
    visited = {start}
    q = deque([start])
    count = 0
    while q and count < cap:
        for nxt in adjacency.get(q.popleft(), ()):
            if nxt not in visited:
                visited.add(nxt)
                q.append(nxt)
                count += 1
    return count


# ---------------------------------------------------------------- feature computation

def _days(a: date | None, b: date | None) -> float | None:
    if a is None or b is None:
        return None
    da = a if isinstance(a, date) and not isinstance(a, datetime) else a.date()
    db = b if isinstance(b, date) and not isinstance(b, datetime) else b.date()
    return float((db - da).days)


def compute_features(payload: ProjectGraphPayload) -> list[dict]:
    """Map every task in the payload to a feature dict matching feature_schema v1.0.

    Returns dicts (not TaskFeatures) so the caller decides validation policy.
    Order matches payload.tasks. Missing information → None (imputed downstream).
    """
    tasks = payload.tasks
    ids = {t.id for t in tasks}
    succ, pred = _adjacency(payload.dependencies, ids)

    # project window: explicit if given, else derived from the tasks themselves
    starts = [t.planned_start for t in tasks if t.planned_start]
    finishes = [t.planned_finish for t in tasks if t.planned_finish]
    p_start = payload.project.planned_start or (min(starts) if starts else None)
    p_finish = payload.project.planned_finish or (max(finishes) if finishes else None)
    span = _days(p_start, p_finish)
    span = span if span and span > 0 else None

    out = []
    for t in tasks:
        rel = None
        if span and t.planned_start and p_start:
            rel = _days(p_start, t.planned_start) / span
            rel = min(max(rel, 0.0), 1.0)          # clamp — schema range is [0,1]
        out.append({
            "planned_duration_days": _days(t.planned_start, t.planned_finish),
            "total_float_hr": None,                 # RR-12: no CPM for the model
            "free_float_hr": None,
            "rel_position": rel,
            "proj_n_tasks": len(tasks),
            "proj_span_days": span,
            "n_pred": len(pred.get(t.id, ())),
            "n_succ": len(succ.get(t.id, ())),
            "upstream_cnt": bounded_reach(t.id, pred),
            "downstream_cnt": bounded_reach(t.id, succ),
            "task_type": TASK_TYPE_MAP.get(t.type.lower(), "TT_Task"),
        })
    return out
