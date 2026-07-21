"""Unit tests for the AI service API."""
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_predict_shape():
    r = client.post("/predict", json={
        "planned_duration_days": 14, "total_float_hr": 40, "n_pred": 3,
        "n_succ": 8, "downstream_cnt": 25, "task_type": "TT_Task",
    })
    # 503 is acceptable when model artifact absent (CI without pipeline run)
    assert r.status_code in (200, 503)
    if r.status_code == 200:
        body = r.json()
        assert 0.0 <= body["late_probability"] <= 1.0
        assert body["risk_level"] in {"low", "medium", "high"}
