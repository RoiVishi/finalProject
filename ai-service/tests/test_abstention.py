"""PRED-10 (KAN-89): minimum-input policy and abstention — one test per reason.

When the required-feature subset cannot be satisfied, /predict/project abstains:
prediction=null, risk_level="unknown", and a machine-readable abstain_reason.
Unseen categorical values are treated as missing, not as a new one-hot pattern.
"""
import os

import pytest
from app import main
from fastapi.testclient import TestClient

client = TestClient(main.app)

pytestmark = pytest.mark.skipif(
    not client.get("/health").json().get("model_loaded") and os.environ.get("REQUIRE_MODEL") != "1",
    reason="no model artifact; CI sets REQUIRE_MODEL=1")


def _payload(**task_overrides):
    tasks = [
        {"id": "a", "planned_start": "2026-01-01", "planned_finish": "2026-01-10"},
        {"id": "b", "planned_start": "2026-01-11", "planned_finish": "2026-02-01"},
        {"id": "c", "planned_start": "2026-02-02", "planned_finish": "2026-03-01", **task_overrides},
    ]
    return {"project": {"planned_start": "2026-01-01", "planned_finish": "2026-03-01", "completed_share": 0.5},
            "tasks": tasks, "dependencies": [{"predecessor_id": "a", "successor_id": "b"}]}


def _by_id(r):
    assert r.status_code == 200
    return {x["task_id"]: x for x in r.json()}


def test_scored_activity_has_no_reason_and_a_band():
    out = _by_id(client.post("/predict/project", json=_payload()))
    for x in out.values():
        assert x["prediction"] is not None and x["abstain_reason"] is None
        assert x["risk_level"] == x["prediction"]["risk_level"] in {"low", "medium", "high"}


def test_reason_missing_planned_dates():
    out = _by_id(client.post("/predict/project", json=_payload(planned_finish=None)))
    c = out["c"]
    assert c["prediction"] is None
    assert c["risk_level"] == "unknown"
    assert c["abstain_reason"] == "missing_planned_dates"
    # the other activities are still scored — abstention is per activity
    assert out["a"]["prediction"] is not None and out["b"]["prediction"] is not None


def test_reason_missing_project_timeline():
    """No planned dates anywhere → no project span → rel_position unknown for everyone."""
    p = {"project": {"completed_share": 0.5},
         "tasks": [{"id": "x"}, {"id": "y"}], "dependencies": []}
    out = _by_id(client.post("/predict/project", json=p))
    # planned_duration_days is checked first; both rules are unmet here
    assert {x["abstain_reason"] for x in out.values()} == {"missing_planned_dates"}
    # an activity WITH its own dates but no usable project span (zero-length span):
    p2 = {"project": {"planned_start": "2026-01-01", "planned_finish": "2026-01-01", "completed_share": 0.5},
          "tasks": [{"id": "z", "planned_start": "2026-01-01", "planned_finish": "2026-01-01"}]}
    z = _by_id(client.post("/predict/project", json=p2))["z"]
    assert z["prediction"] is None and z["abstain_reason"] == "missing_project_timeline"


def test_reason_low_project_history(monkeypatch):
    monkeypatch.setattr(main, "COLD_START_POLICY", "abstain")
    p = _payload()
    p["project"]["completed_share"] = 0.1
    out = _by_id(client.post("/predict/project", json=p))
    assert all(x["prediction"] is None and x["risk_level"] == "unknown"
               and x["abstain_reason"] == "low_project_history" for x in out.values())


def test_unseen_category_is_treated_as_missing():
    base = {"planned_duration_days": 14, "rel_position": 0.5, "proj_n_tasks": 300, "proj_span_days": 400,
            "n_pred": 1, "n_succ": 2, "upstream_cnt": 3, "downstream_cnt": 4}
    unseen = client.post("/predict", json={**base, "task_type": "TT_NeverSeenBefore"}).json()
    missing = client.post("/predict", json={**base, "task_type": None}).json()
    assert unseen["late_probability"] == missing["late_probability"]


def test_health_lists_the_policy():
    h = client.get("/health").json()["abstention"]
    assert h["required_features"] == ["planned_duration_days", "rel_position"]
    assert set(h["reasons"]) == {"missing_planned_dates", "missing_project_timeline", "low_project_history"}
