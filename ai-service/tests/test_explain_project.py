"""KAN-40 / sprint 8 T25: PRED-3 explanations from raw platform entities.

The backend never computes a feature (PRED-9), so it cannot call /explain. These
tests pin the contract of /explain/project: same adapter, same gate and same
abstentions as /predict/project, and the same number.
"""
import os

import pytest
from fastapi.testclient import TestClient

from app import main

client = TestClient(main.app)

pytestmark = pytest.mark.skipif(
    not client.get("/health").json().get("model_loaded") and os.environ.get("REQUIRE_MODEL") != "1",
    reason="no model artifact; CI sets REQUIRE_MODEL=1")


def _graph(**c_overrides):
    tasks = [
        {"id": "a", "planned_start": "2026-01-01", "planned_finish": "2026-01-10"},
        {"id": "b", "planned_start": "2026-01-11", "planned_finish": "2026-02-01"},
        {"id": "c", "planned_start": "2026-02-02", "planned_finish": "2026-03-01", **c_overrides},
    ]
    return {"project": {"planned_start": "2026-01-01", "planned_finish": "2026-03-01", "completed_share": 0.5},
            "tasks": tasks,
            "dependencies": [{"predecessor_id": "a", "successor_id": "b"},
                             {"predecessor_id": "b", "successor_id": "c"}]}


def _explain(graph, ids, **params):
    return client.post("/explain/project", params=params, json={**graph, "task_ids": ids})


def test_same_number_as_predict_project():
    g = _graph()
    preds = {x["task_id"]: x for x in client.post("/predict/project", json=g).json()}
    r = _explain(g, ["a", "b", "c"])
    assert r.status_code == 200
    for x in r.json():
        p = preds[x["task_id"]]
        assert x["explanation"]["prediction"] == p["prediction"]
        assert x["risk_level"] == p["risk_level"]
        assert x["reliability"] == p["reliability"]


def test_contributions_add_up_and_are_in_domain_language():
    x = _explain(_graph(), ["b"], top_k=len(main.DOMAIN_LABELS)).json()[0]["explanation"]
    total = x["base_probability"] + sum(c["contribution"] for c in x["top_contributions"])
    assert total == pytest.approx(x["prediction"]["late_probability"], abs=0.01)
    for c in x["top_contributions"]:
        assert c["label_he"] and c["label_en"] and c["feature"] in main.DOMAIN_LABELS


def test_top_k_and_order_follow_the_request():
    out = _explain(_graph(), ["c", "a", "c"], top_k=3).json()
    assert [x["task_id"] for x in out] == ["c", "a"]          # request order, duplicates dropped
    assert all(len(x["explanation"]["top_contributions"]) == 3 for x in out)


def test_one_activity_is_explained_inside_the_whole_graph():
    """Explaining b alone must use a's and c's existence (reach, position)."""
    g = _graph()
    alone = _explain(g, ["b"]).json()[0]
    together = {x["task_id"]: x for x in _explain(g, ["a", "b", "c"]).json()}["b"]
    assert alone["explanation"] == together["explanation"]
    values = {c["feature"]: c["value"] for c in _explain(
        g, ["b"], top_k=len(main.DOMAIN_LABELS)).json()[0]["explanation"]["top_contributions"]}
    assert values["n_pred"] == 1 and values["n_succ"] == 1 and values["proj_n_tasks"] == 3


def test_no_explanation_where_predict_project_abstains():
    g = _graph(planned_finish=None)
    c = _explain(g, ["a", "c"]).json()
    assert c[1]["explanation"] is None and c[1]["risk_level"] == "unknown"
    assert c[1]["abstain_reason"] == "missing_planned_dates"
    assert c[0]["explanation"] is not None                  # abstention is per activity


def test_low_project_history_under_abstain_policy(monkeypatch):
    monkeypatch.setattr(main, "COLD_START_POLICY", "abstain")
    g = _graph()
    g["project"]["completed_share"] = 0.1
    out = _explain(g, ["a", "b"]).json()
    assert all(x["explanation"] is None and x["abstain_reason"] == "low_project_history" for x in out)


def test_low_history_under_flag_policy_is_explained_and_flagged(monkeypatch):
    monkeypatch.setattr(main, "COLD_START_POLICY", "flag")
    g = _graph()
    g["project"]["completed_share"] = 0.1
    x = _explain(g, ["a"]).json()[0]
    assert x["explanation"] is not None and x["reliability"] == "low_transfer_prior"


def test_unknown_or_empty_ids_are_rejected():
    assert _explain(_graph(), ["zzz"]).status_code == 422
    assert _explain(_graph(), []).status_code == 422


def test_batch_limit(monkeypatch):
    monkeypatch.setattr(main, "MAX_EXPLAIN_BATCH", 1)
    assert _explain(_graph(), ["a", "b"]).status_code == 413
    assert _explain(_graph(), ["a", "a"]).status_code == 200     # one distinct activity
