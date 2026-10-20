"""PRED-14 — leakage prevention as an explicit, testable control.

Three rules, each enforced in code and checked in CI
(data-pipeline/tests/test_leakage.py and ai-service/tests/test_leakage_guard.py):

1. Whitelist = schema. The only columns a model may be fitted on are the plan-time
   features of feature_schema.json (PRED-8). `plan_time()` is the single way the
   training code builds X.
2. Named blacklist. Columns that are known only after the fact (actual dates,
   realised delay, the label, the activity's current status) are listed below.
   `assert_no_leakage()` fails on any of them — on a training frame, or on the
   columns a fitted artifact actually consumes (`consumed_columns()`).
3. As-of rule for scenario B. Inside each project, every training row precedes
   every test row on the plan-time axis (rel_position). A row that happens later
   must never be visible to a model evaluated earlier. `assert_as_of()` checks it.

Why rule 2 checks *consumed* columns and not only the fit frame: registry v1-v5 were
fitted on the whole labeled frame, so the label and three post-hoc columns were
present at fit time; the ColumnTransformer (remainder='drop') discarded them before
the model saw them. `check_artifact()` proves that for every committed artifact, and
`require_clean_fit_frame=True` (used for artifacts trained after this module existed)
additionally requires that no post-hoc column was even passed to fit().
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pandas as pd

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "feature_schema.json"


class LeakageError(AssertionError):
    """A post-hoc (after-the-fact) column reached, or could reach, a model."""


def schema_features(schema_path: Path = SCHEMA_PATH) -> list[str]:
    """Plan-time whitelist, in schema order (numeric first, then categorical)."""
    schema = json.loads(Path(schema_path).read_text())
    num = [f["name"] for f in schema["features"] if f["role"] == "numeric"]
    cat = [f["name"] for f in schema["features"] if f["role"] == "categorical"]
    return num + cat


# Rule 2 — named blacklist: the columns the ETL produces (or a P6 export carries)
# that are known only after the activity has run.
BLACKLIST: frozenset[str] = frozenset({
    # labels and their derivatives (data-pipeline/src/etl.py)
    "is_late", "delay_days", "extreme_delay",
    # actual dates and durations (P6 TASK table)
    "act_start_date", "act_end_date", "actual_start", "actual_finish",
    "actual_duration_days", "act_work_qty", "act_equip_qty",
    # progress / state at extraction time — reflects how the activity turned out
    "status_code", "phys_complete_pct", "complete_pct", "remain_drtn_hr_cnt",
    "remain_work_qty", "reend_date", "restart_date",
    # registry v6 target and its relatives (RR-21: duration overrun; DSLIB / JPF ETL columns)
    "grew", "own_delay", "start_delay_days", "start_late", "started_early_days",
})

# Defensive patterns for columns not named above (a new export, a renamed field).
_POST_HOC_PATTERNS = [re.compile(p) for p in (
    r"^act_", r"actual", r"^delay", r"_delay$", r"^is_late", r"complete_pct",
    r"^remain_", r"^status",
)]

# Identifiers are not post-hoc, but a model must never see them either (memorising
# a project or a task id is leakage of a different kind — scenario A groups on them).
IDENTIFIERS: frozenset[str] = frozenset({"project", "task_id", "task_code", "task_name"})


def is_post_hoc(column: str) -> bool:
    c = column.strip().lower()
    return c in BLACKLIST or any(p.search(c) for p in _POST_HOC_PATTERNS)


def assert_no_leakage(columns, *, context: str = "frame") -> None:
    """Rule 2: fail on any blacklisted (or post-hoc-looking) column."""
    bad = sorted(c for c in columns if is_post_hoc(str(c)))
    if bad:
        raise LeakageError(f"{context}: post-hoc column(s) must not reach a model: {bad}")


def plan_time(df: pd.DataFrame, features: list[str] | None = None) -> pd.DataFrame:
    """Rule 1: the training matrix X — exactly the schema whitelist, in schema order."""
    features = features or schema_features()
    missing = [f for f in features if f not in df.columns]
    if missing:
        raise LeakageError(f"training frame lacks schema feature(s) {missing}")
    assert_no_leakage(features, context="feature_schema.json whitelist")
    return df.loc[:, features]


def assert_as_of(train: pd.DataFrame, test: pd.DataFrame, *,
                 time_col: str = "rel_position", group_col: str = "project") -> None:
    """Rule 3 (scenario B): within each project, every train row precedes every test row.

    temporal_split puts `<= cut` in train and `> cut` in test, so max(train) < min(test)
    must hold strictly for every project present on both sides. Rows without a
    position cannot be ordered and must not be on either side.
    """
    for name, frame in (("train", train), ("test", test)):
        if frame[time_col].isna().any():
            raise LeakageError(f"as-of rule: {name} holds rows with no {time_col} — cannot be ordered")
    for project, te in test.groupby(group_col):
        tr = train[train[group_col] == project]
        if tr.empty:
            continue
        latest_train = tr[time_col].max()
        earliest_test = te[time_col].min()
        if not latest_train < earliest_test:
            raise LeakageError(
                f"as-of rule violated in project {project!r}: a training row at "
                f"{time_col}={latest_train} is not earlier than a test row at {earliest_test}")


# ------------------------------------------------------------- fitted artifacts

def _find_column_transformer(model):
    """Walk Calibrated -> Frozen -> Pipeline -> ColumnTransformer."""
    seen = 0
    stack = [model]
    while stack and seen < 50:
        seen += 1
        m = stack.pop()
        if type(m).__name__ == "ColumnTransformer":
            return m
        for attr in ("calibrated_classifiers_", ):
            stack.extend(getattr(m, attr, []) or [])
        for attr in ("estimator", "base_estimator", "best_estimator_"):
            sub = getattr(m, attr, None)
            if sub is not None:
                stack.append(sub)
        for _, step in getattr(m, "steps", []) or []:
            stack.append(step)
    raise LeakageError("no ColumnTransformer found in the artifact — cannot verify consumed columns")


def consumed_columns(model) -> list[str]:
    """Columns the fitted model actually reads (ColumnTransformer selections)."""
    ct = _find_column_transformer(model)
    cols: list[str] = []
    for name, _, selection in ct.transformers_:
        if name == "remainder":
            if ct.remainder == "drop":
                continue
            raise LeakageError("ColumnTransformer remainder is not 'drop' — unselected columns reach the model")
        cols.extend(list(selection))
    return cols


def fit_frame_columns(model) -> list[str]:
    ct = _find_column_transformer(model)
    return [str(c) for c in getattr(ct, "feature_names_in_", [])]


def check_artifact(model, features: list[str] | None = None, *,
                   require_clean_fit_frame: bool = False) -> dict:
    """Rules 1+2 on a fitted artifact. Returns a small report; raises LeakageError."""
    features = features or schema_features()
    consumed = consumed_columns(model)
    assert_no_leakage(consumed, context="columns consumed by the fitted model")
    if sorted(consumed) != sorted(features):
        raise LeakageError(f"model consumes {sorted(consumed)}, schema whitelist is {sorted(features)}")
    fit_cols = fit_frame_columns(model)
    dropped_post_hoc = sorted(c for c in fit_cols if is_post_hoc(c))
    if require_clean_fit_frame and set(fit_cols) - set(features):
        raise LeakageError(f"fit() received non-feature column(s) {sorted(set(fit_cols) - set(features))}")
    return {"consumed": consumed, "fit_frame_extra": sorted(set(fit_cols) - set(features)),
            "post_hoc_present_at_fit_but_dropped": dropped_post_hoc}
