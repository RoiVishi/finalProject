"""Corpus v3 (registry v6): building projects only, label `grew` — RR-21c."""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))
from build_corpus_v3 import TARGET, build_from  # noqa: E402
from buildings import OWN_BUILDINGS, OWN_NOT_BUILDINGS, OWN_UNKNOWN  # noqa: E402
from leakage import is_post_hoc, plan_time, schema_features  # noqa: E402

FEATURES = schema_features()
SUMMARY = Path(__file__).resolve().parents[1] / "outputs" / "corpus_v3_summary.json"


def _rows(projects, n=4, **extra):
    rng = np.random.default_rng(0)
    rows = []
    for p in projects:
        for i in range(n):
            r = {f: float(rng.random()) for f in FEATURES if f != "task_type"}
            r.update(project=p, task_id=i, task_type="TT_Task", grew=float(i % 2), **extra)
            rows.append(r)
    return pd.DataFrame(rows)


def test_classification_lists_are_disjoint():
    b, n, u = set(OWN_BUILDINGS), set(OWN_NOT_BUILDINGS), set(OWN_UNKNOWN)
    assert not (b & n) and not (b & u) and not (n & u)
    assert all(OWN_BUILDINGS.values()) and all(OWN_NOT_BUILDINGS.values()), "every decision needs a reason"


def test_only_buildings_reach_the_corpus():
    own = _rows([*OWN_BUILDINGS][:2] + [*OWN_NOT_BUILDINGS][:2] + [*OWN_UNKNOWN])
    ds = pd.concat([
        _rows(["C1"], sector_group="buildings", auth_tracking="G"),
        _rows(["C2"], sector_group="buildings", auth_tracking="Y"),   # not authentic
        _rows(["C3"], sector_group="civil", auth_tracking="G"),       # not a building
    ])
    c = build_from(own, ds)
    assert set(c["project"]) == {f"own::{p}" for p in [*OWN_BUILDINGS][:2]} | {"dslib::C1"}
    assert set(c["source"]) == {"own", "dslib"}
    assert c[TARGET].isin([0, 1]).all()
    assert c.loc[c.source == "dslib", "task_type"].isna().all()


def test_unlabeled_rows_are_dropped():
    own = _rows([*OWN_BUILDINGS][:1])
    own.loc[0, TARGET] = np.nan
    c = build_from(own, _rows(["C1"], sector_group="buildings", auth_tracking="G"))
    assert len(c) == len(own) - 1 + 4


def test_target_is_post_hoc_and_never_a_feature():
    assert is_post_hoc(TARGET)
    c = build_from(_rows([*OWN_BUILDINGS][:1]), _rows(["C1"], sector_group="buildings", auth_tracking="G"))
    X = plan_time(c)
    assert list(X.columns) == FEATURES and TARGET not in X.columns


def test_committed_summary_matches_the_classification():
    s = json.loads(SUMMARY.read_text())
    assert s["target"] == TARGET
    assert set(s["sources"]) == {"own", "dslib"}
    assert s["sources"]["own"]["projects"] <= len(OWN_BUILDINGS)
    assert s["own_buildings"] == OWN_BUILDINGS
    assert s["total"]["projects"] == s["sources"]["own"]["projects"] + s["sources"]["dslib"]["projects"]
