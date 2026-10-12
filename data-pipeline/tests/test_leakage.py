"""PRED-14 (KAN-93): leakage prevention — whitelist, named blacklist, as-of rule."""
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from leakage import (
    BLACKLIST,
    IDENTIFIERS,
    LeakageError,
    assert_as_of,
    assert_no_leakage,
    check_artifact,
    is_post_hoc,
    plan_time,
    schema_features,
)

FEATURES = schema_features()


def _frame(n=40, seed=0):
    rng = np.random.default_rng(seed)
    df = pd.DataFrame({f: rng.random(n) for f in FEATURES if f != "task_type"})
    df["task_type"] = rng.choice(["TT_Task", "TT_Mile"], n)
    df["project"] = np.repeat(["p1", "p2"], n // 2)
    df["task_id"] = range(n)
    df["is_late"] = rng.integers(0, 2, n)
    df["delay_days"] = rng.normal(0, 5, n)
    df["status_code"] = "TK_Complete"
    return df


# ---- rule 1: whitelist = schema ----------------------------------------------

def test_whitelist_is_exactly_the_schema_and_contains_nothing_post_hoc():
    assert FEATURES == [
        "planned_duration_days", "total_float_hr", "free_float_hr", "rel_position", "proj_n_tasks",
        "proj_span_days", "n_pred", "n_succ", "upstream_cnt", "downstream_cnt", "task_type"]
    assert not [f for f in FEATURES if is_post_hoc(f) or f in IDENTIFIERS]


def test_plan_time_returns_only_whitelisted_columns_in_schema_order():
    X = plan_time(_frame())
    assert list(X.columns) == FEATURES
    assert "is_late" not in X and "delay_days" not in X and "project" not in X


def test_plan_time_fails_when_a_schema_feature_is_missing():
    with pytest.raises(LeakageError, match="lacks schema feature"):
        plan_time(_frame().drop(columns=["rel_position"]))


# ---- rule 2: named blacklist -------------------------------------------------

@pytest.mark.parametrize("col", sorted(BLACKLIST) + ["actual_finish_date", "ACT_END_DATE", "is_late_7d", "remain_drtn"])
def test_every_blacklisted_or_post_hoc_looking_column_fails(col):
    with pytest.raises(LeakageError):
        assert_no_leakage(FEATURES + [col])


def test_plan_time_columns_pass():
    assert_no_leakage(FEATURES)


def test_a_model_fitted_on_a_blacklisted_column_fails_the_artifact_check():
    from sklearn.compose import ColumnTransformer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder

    df = _frame()
    leaky = Pipeline([("prep", ColumnTransformer([
        ("num", "passthrough", [f for f in FEATURES if f != "task_type"] + ["delay_days"]),
        ("cat", OneHotEncoder(handle_unknown="ignore"), ["task_type"]),
    ])), ("model", LogisticRegression(max_iter=200))]).fit(df, df["is_late"])
    with pytest.raises(LeakageError, match="post-hoc"):
        check_artifact(leaky)


def test_remainder_passthrough_is_refused():
    from sklearn.compose import ColumnTransformer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline

    df = _frame()[FEATURES[:-1] + ["is_late"]]
    pipe = Pipeline([("prep", ColumnTransformer([("num", "passthrough", FEATURES[:2])], remainder="passthrough")),
                     ("model", LogisticRegression(max_iter=200))]).fit(df.drop(columns="is_late"), df["is_late"])
    with pytest.raises(LeakageError, match="remainder"):
        check_artifact(pipe)


# ---- rule 3: as-of rule for scenario B -----------------------------------------

def _split(df):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
    import train_compare as tc
    old = tc.MIN_LABELED, tc.MIN_PER_SIDE
    tc.MIN_LABELED, tc.MIN_PER_SIDE = 10, 3
    try:
        return tc.temporal_split(df)
    finally:
        tc.MIN_LABELED, tc.MIN_PER_SIDE = old


def test_temporal_split_satisfies_the_as_of_rule():
    tr, te, projects = _split(_frame(60, seed=3))
    assert projects == ["p1", "p2"]
    assert_as_of(tr, te)


def test_a_later_event_must_not_be_visible_earlier():
    """The AC case: a row that happens late in the project must never sit in train."""
    df = _frame(60, seed=4)
    late = df.index[df["project"] == "p1"][-1]
    df.loc[late, "rel_position"] = 0.999          # the latest activity of p1
    tr, te, _ = _split(df)
    assert late not in tr.index and late in te.index
    # and the guard catches it if anything ever moves it back into train:
    with pytest.raises(LeakageError, match="as-of rule violated in project 'p1'"):
        assert_as_of(pd.concat([tr, df.loc[[late]]]), te)


def test_rows_without_position_cannot_be_ordered():
    tr, te, _ = _split(_frame(60, seed=5))
    bad = tr.copy()
    bad.iloc[0, bad.columns.get_loc("rel_position")] = np.nan
    with pytest.raises(LeakageError, match="cannot be ordered"):
        assert_as_of(bad, te)
