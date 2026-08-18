"""PRED-9 adapter tests — mock project, no platform needed.

The mock is the 7-activity network from the CPM lesson: excavation → foundations
→ skeleton → {electrical, plumbing} → gypsum → finish.
"""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.adapter import ProjectGraphPayload, bounded_reach, compute_features  # noqa: E402
from app.main import app, get_registry  # noqa: E402

client = TestClient(app)


def _model_available() -> bool:
    try:
        get_registry()
        return True
    except Exception:
        return False


def mock_payload() -> dict:
    t = lambda i, s, f, ty="task": {"id": i, "planned_start": s, "planned_finish": f, "type": ty}  # noqa: E731
    return {
        "project": {"planned_start": "2026-01-01", "planned_finish": "2026-02-21"},
        "tasks": [
            t("exc", "2026-01-01", "2026-01-04"),
            t("fnd", "2026-01-05", "2026-01-16"),
            t("skl", "2026-01-17", "2026-01-31"),
            t("ele", "2026-02-01", "2026-02-04"),
            t("plm", "2026-02-01", "2026-02-07"),
            t("gyp", "2026-02-08", "2026-02-15"),
            t("fin", "2026-02-16", "2026-02-21", "milestone"),
        ],
        "dependencies": [
            {"predecessor_id": "exc", "successor_id": "fnd"},
            {"predecessor_id": "fnd", "successor_id": "skl"},
            {"predecessor_id": "skl", "successor_id": "ele"},
            {"predecessor_id": "skl", "successor_id": "plm"},
            {"predecessor_id": "ele", "successor_id": "gyp"},
            {"predecessor_id": "plm", "successor_id": "gyp"},
            {"predecessor_id": "gyp", "successor_id": "fin"},
        ],
    }


def test_feature_computation():
    feats = compute_features(ProjectGraphPayload(**mock_payload()))
    by_id = dict(zip([t["id"] for t in mock_payload()["tasks"]], feats))

    gyp = by_id["gyp"]
    assert gyp["planned_duration_days"] == 7.0
    assert gyp["n_pred"] == 2 and gyp["n_succ"] == 1
    assert gyp["upstream_cnt"] == 5          # ele, plm, skl, fnd, exc
    assert gyp["downstream_cnt"] == 1        # fin
    assert gyp["proj_n_tasks"] == 7
    assert gyp["proj_span_days"] == 51.0
    assert 0.0 <= gyp["rel_position"] <= 1.0
    assert gyp["total_float_hr"] is None and gyp["free_float_hr"] is None  # RR-12
    assert gyp["task_type"] == "TT_Task"
    assert by_id["fin"]["task_type"] == "TT_Mile"
    assert by_id["exc"]["upstream_cnt"] == 0 and by_id["exc"]["downstream_cnt"] == 6


def test_missing_dates_yield_nones_not_errors():
    p = mock_payload()
    p["tasks"][2]["planned_start"] = None
    p["tasks"][2]["planned_finish"] = None
    feats = compute_features(ProjectGraphPayload(**p))
    skl = feats[2]
    assert skl["planned_duration_days"] is None and skl["rel_position"] is None
    assert skl["n_pred"] == 1                # graph features unaffected


def test_cycle_safe_traversal():
    adj = {"a": ["b"], "b": ["c"], "c": ["a"]}   # cycle — must terminate
    assert bounded_reach("a", adj) == 2


def test_rel_position_clamped():
    p = mock_payload()
    p["project"]["planned_finish"] = "2026-01-20"   # project window shorter than tasks
    feats = compute_features(ProjectGraphPayload(**p))
    assert all(f["rel_position"] is None or 0.0 <= f["rel_position"] <= 1.0 for f in feats)


def test_endpoint_end_to_end():
    if not _model_available():
        return
    r = client.post("/predict/project", json=mock_payload())
    assert r.status_code == 200
    body = r.json()
    assert len(body) == 7
    assert {x["task_id"] for x in body} == {t["id"] for t in mock_payload()["tasks"]}
    for x in body:
        pr = x["prediction"]
        assert 0.0 <= pr["late_probability"] <= 1.0
        assert pr["estimated_delay_days"] is None          # PRED-11
        assert pr["model_version"] == "v4" or pr["model_version"].startswith("v")


def test_endpoint_empty_and_strict():
    r = client.post("/predict/project", json={"project": {}, "tasks": [], "dependencies": []})
    assert r.status_code == 200 and r.json() == []
    bad = mock_payload()
    bad["tasks"][0]["actual_finish"] = "2026-01-03"        # post-hoc field → forbidden
    r = client.post("/predict/project", json=bad)
    assert r.status_code == 422


def test_cold_start_flagging():
    """No completed_share → low_transfer_prior, prediction still returned (flag policy)."""
    if not _model_available():
        return
    r = client.post("/predict/project", json=mock_payload())
    assert r.status_code == 200
    for x in r.json():
        assert x["reliability"] == "low_transfer_prior"
        assert x["prediction"] is not None      # default policy = flag, not abstain
        assert "RR-11" in (x["note"] or "")

    mature = mock_payload()
    mature["project"]["completed_share"] = 0.55  # above the 40% RR-11 threshold
    r2 = client.post("/predict/project", json=mature)
    assert all(x["reliability"] == "ok" and x["note"] is None for x in r2.json())


def test_cold_start_abstain_policy(monkeypatch):
    """Under COLD_START_POLICY=abstain a young project gets null predictions."""
    import app.main as m
    monkeypatch.setattr(m, "COLD_START_POLICY", "abstain")
    young = mock_payload()
    young["project"]["completed_share"] = 0.1
    r = client.post("/predict/project", json=young)
    assert r.status_code == 200
    for x in r.json():
        assert x["reliability"] == "low_transfer_prior"
        assert x["prediction"] is None
