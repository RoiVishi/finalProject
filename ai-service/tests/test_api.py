"""Unit tests for the AI service API (PRED-1..5)."""
from fastapi.testclient import TestClient

import app.main as main

client = TestClient(main.app)

SAMPLE = {
    "planned_duration_days": 14, "total_float_hr": 40, "rel_position": 0.8,
    "proj_n_tasks": 500, "proj_span_days": 400, "n_pred": 3,
    "n_succ": 8, "upstream_cnt": 12, "downstream_cnt": 25, "task_type": "TT_Task",
}


def _model_available() -> bool:
    return client.get("/health").json()["model_loaded"]


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert "model_version" in body


def test_predict_shape():
    r = client.post("/predict", json=SAMPLE)
    # 503 acceptable when no artifact exists (CI without a pipeline run) — PRED-5
    assert r.status_code in (200, 503)
    if r.status_code == 200:
        body = r.json()
        assert 0.0 <= body["late_probability"] <= 1.0
        assert body["risk_level"] in {"low", "medium", "high"}
        assert body["model_version"]  # PRED-4: every response names its model version


def test_predict_batch():
    r = client.post("/predict/batch", json=[SAMPLE, SAMPLE])
    assert r.status_code in (200, 503)
    if r.status_code == 200:
        body = r.json()
        assert len(body) == 2
        assert body[0]["model_version"] == body[1]["model_version"]


def test_explain_contract():
    """PRED-3: explanation returns top-k signed contributions with domain labels."""
    if not _model_available():
        return  # covered by degradation test below
    r = client.post("/explain?top_k=5", json=SAMPLE)
    assert r.status_code in (200, 501)
    if r.status_code == 200:
        body = r.json()
        assert len(body["top_contributions"]) <= 5
        for c in body["top_contributions"]:
            assert c["label_en"] and c["label_he"]
            assert isinstance(c["contribution"], float)
        # sorted by absolute contribution, descending
        mags = [abs(c["contribution"]) for c in body["top_contributions"]]
        assert mags == sorted(mags, reverse=True)


def test_degradation_when_registry_missing(tmp_path, monkeypatch):
    """PRED-5: with no registry and no legacy model, endpoints return 503 with guidance."""
    monkeypatch.setattr(main, "REGISTRY", tmp_path / "empty-registry")
    monkeypatch.setattr(main, "LEGACY_MODEL", tmp_path / "missing.joblib")
    monkeypatch.setattr(main, "_registry", None)
    bare = TestClient(main.app)
    r = bare.post("/predict", json=SAMPLE)
    assert r.status_code == 503
    assert "train_compare" in r.json()["detail"]
    monkeypatch.setattr(main, "_registry", None)  # let other tests reload


def test_schema_mismatch_is_refused():
    """PRED-8: an artifact recorded against a different schema version is refused."""
    schema = {"feature_schema_version": "1.0"}
    assert main.schema_mismatch({"feature_schema_version": "1.0"}, schema) is None
    assert main.schema_mismatch({}, schema) is None                      # legacy meta — allowed
    reason = main.schema_mismatch({"feature_schema_version": "0.9"}, schema)
    assert reason and "0.9" in reason and "1.0" in reason


def test_schema_refusal_returns_503(tmp_path, monkeypatch):
    """PRED-8: refusal happens at load time and surfaces as 503 with the reason."""
    import json as _json
    vdir = tmp_path / "registry" / "v1"
    vdir.mkdir(parents=True)
    (vdir / "meta.json").write_text(_json.dumps({"feature_schema_version": "0.9", "version": "v1"}))
    monkeypatch.setattr(main, "REGISTRY", tmp_path / "registry")
    monkeypatch.setattr(main, "LEGACY_MODEL", tmp_path / "missing.joblib")
    monkeypatch.setattr(main, "_registry", None)
    bare = TestClient(main.app)
    health = bare.get("/health").json()
    assert health["model_loaded"] is False
    assert "refused" in (health["refusal"] or "")
    r = bare.post("/predict", json=SAMPLE)
    assert r.status_code == 503 and "schema" in r.json()["detail"]
    monkeypatch.setattr(main, "_registry", None)


def test_schema_version_in_response():
    """PRED-8: every prediction names the feature-schema version it was computed with."""
    if not _model_available():
        return
    r = client.post("/predict", json=SAMPLE)
    if r.status_code == 200:
        assert r.json()["feature_schema_version"] is not None
