"""PRED-15 (KAN-94): the served champion has a global mean-|SHAP| ranking, served by
GET /explain/global. CI fails when a new champion is promoted without regenerating it
(data-pipeline/src/global_shap.py) — that is how "regenerated with every promoted
champion" is enforced."""
import json
import os

import pytest
from app import main
from fastapi.testclient import TestClient

client = TestClient(main.app)

pytestmark = pytest.mark.skipif(
    not client.get("/health").json().get("model_loaded") and os.environ.get("REQUIRE_MODEL") != "1",
    reason="no model artifact; CI sets REQUIRE_MODEL=1")


def test_served_champion_has_a_current_global_ranking():
    reg = main.get_registry()
    path = reg.dir / main.GLOBAL_SHAP_FILE
    assert path.exists(), f"registry {reg.version} has no {main.GLOBAL_SHAP_FILE} — run data-pipeline/src/global_shap.py"
    data = json.loads(path.read_text())
    assert data["model_version"] == reg.version
    assert data["feature_schema_version"] == reg.schema_version
    assert data["units"] == "calibrated_probability"
    feats = [r["feature"] for r in data["ranking"]]
    assert sorted(feats) == sorted(main.DOMAIN_LABELS)                 # every feature, once
    values = [r["mean_abs_contribution"] for r in data["ranking"]]
    assert values == sorted(values, reverse=True) and all(v >= 0 for v in values)
    assert [r["rank"] for r in data["ranking"]] == list(range(1, len(feats) + 1))
    assert all(r["label_he"] == main.DOMAIN_LABELS[r["feature"]][1] for r in data["ranking"])


def test_endpoint_serves_it():
    r = client.get("/explain/global")
    assert r.status_code == 200
    assert r.json()["model_version"] == main.get_registry().version


def test_stale_ranking_is_refused(monkeypatch):
    reg = main.get_registry()
    monkeypatch.setattr(reg, "version", "v999")
    r = client.get("/explain/global")
    assert r.status_code == 409 and "regenerate" in r.json()["detail"]


def test_global_ranking_function_matches_local_units():
    """Small in-process run: same units/labels as /explain, ranking sorted."""
    import pandas as pd
    rows = pd.DataFrame([{
        "planned_duration_days": 5 + i, "total_float_hr": None, "free_float_hr": None,
        "rel_position": i / 20, "proj_n_tasks": 400, "proj_span_days": 300, "n_pred": i % 3,
        "n_succ": i % 4, "upstream_cnt": i, "downstream_cnt": 20 - i, "task_type": "TT_Task"} for i in range(20)])
    out = main.global_ranking(main.get_registry(), rows, sample=10)
    assert out["n_rows"] == 10 and out["units"] == "calibrated_probability"
    vals = [r["mean_abs_contribution"] for r in out["ranking"]]
    assert vals == sorted(vals, reverse=True)
