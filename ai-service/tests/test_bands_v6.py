"""PRED-12 bands from the served model's meta (registry v6+) and the SHAP link for
margin-space boosters (v6 champion is XGBoost)."""
import numpy as np
import pytest
from fastapi.testclient import TestClient

import app.main as main

client = TestClient(main.app)

SAMPLE = {
    "planned_duration_days": 14, "total_float_hr": 40, "rel_position": 0.8,
    "proj_n_tasks": 500, "proj_span_days": 400, "n_pred": 3,
    "n_succ": 8, "upstream_cnt": 12, "downstream_cnt": 25, "task_type": "TT_Task",
}


class _Reg:
    def __init__(self, meta):
        self.meta = meta


@pytest.fixture(autouse=True)
def _no_band_env(monkeypatch):
    for k in ("RISK_BAND_T1", "RISK_BAND_T2", "DECISION_THRESHOLD"):
        monkeypatch.delenv(k, raising=False)


def test_bands_come_from_the_registry_meta():
    b = main.active_bands(_Reg({"risk_bands": {"t1": 0.29, "t2": 0.85, "decision_threshold": 0.29}}))
    assert (b["t1"], b["t2"], b["decision_threshold"]) == (0.29, 0.85, 0.29)
    assert set(b["source"].values()) == {"registry"}


def test_env_overrides_registry_and_default_covers_legacy(monkeypatch):
    monkeypatch.setenv("RISK_BAND_T2", "0.9")
    b = main.active_bands(_Reg({"risk_bands": {"t1": 0.29, "t2": 0.85, "decision_threshold": 0.29}}))
    assert b["t2"] == 0.9 and b["source"]["t2"] == "env" and b["source"]["t1"] == "registry"
    monkeypatch.delenv("RISK_BAND_T2")
    legacy = main.active_bands(_Reg({}))           # v5 and older ship no bands
    assert (legacy["t1"], legacy["t2"], legacy["decision_threshold"]) == (0.33, 0.66, 0.5)
    monkeypatch.setenv("RISK_BAND_T1", "")         # compose passes an empty value = "not set"
    assert main.active_bands(_Reg({}))["source"]["t1"] == "default"


def test_invalid_bands_are_refused(monkeypatch):
    monkeypatch.setenv("RISK_BAND_T1", "0.9")
    monkeypatch.setenv("RISK_BAND_T2", "0.1")
    with pytest.raises(RuntimeError):
        main.active_bands(_Reg({}))


def test_served_model_ships_its_bands_and_target():
    h = client.get("/health").json()
    if not h["model_loaded"]:
        pytest.skip("no model artifact")
    meta = main.get_registry().meta
    if "risk_bands" not in meta:
        pytest.skip("legacy artifact without bands")
    assert h["target"] == meta["target"]
    assert h["risk_bands"]["t1"] == meta["risk_bands"]["t1"]
    assert h["risk_bands"]["source"]["t1"] == "registry"


def test_flag_and_band_never_disagree():
    """v6 protocol: t1 == decision threshold, so 'flagged' == 'medium or high'."""
    reg = main.get_registry()
    if not reg.ready or "risk_bands" not in reg.meta:
        pytest.skip("no v6 artifact")
    tasks = [{**SAMPLE, "planned_duration_days": d, "proj_span_days": s, "rel_position": r}
             for d in (0, 3, 14, 60) for s in (30, 400, 1500) for r in (0.1, 0.5, 0.9)]
    for p in client.post("/predict/batch", json=tasks).json():
        assert p["is_late"] == (p["risk_level"] in {"medium", "high"})


def test_margin_link_maps_into_served_probability():
    """XGBoost explains log-odds; with the sigmoid link the contributions add up to the
    served probability and stay in probability units."""
    class Sigmoid:
        a, b = -4.0, 2.0
        def predict(self, x):
            return 1 / (1 + np.exp(self.a * np.asarray(x) + self.b))

    cals = [Sigmoid()]
    base_margin = -0.4
    raw = np.array([[0.9, -0.3, 0.2], [-1.5, 0.1, 0.0], [0.0, 0.0, 0.0]])
    p_served = np.array([main._calibrated(cals, main._sigmoid(base_margin + r.sum())) for r in raw])
    out, base = main._to_calibrated_space(raw, base_margin, p_served, cals, main._sigmoid)
    assert base == pytest.approx(main._calibrated(cals, main._sigmoid(base_margin)))
    assert (base + out.sum(axis=1)) == pytest.approx(p_served, abs=1e-9)
    assert np.all(np.abs(out) <= 1.0)
    assert np.sign(out[0][0]) == np.sign(raw[0][0])          # direction preserved


def test_artifact_contributions_are_probability_sized():
    reg = main.get_registry()
    if not reg.ready:
        pytest.skip("no model artifact")
    tasks = [{**SAMPLE, "planned_duration_days": d, "proj_span_days": s}
             for d in (1, 14, 90) for s in (60, 400, 2000)]
    for e in client.post(f"/explain/batch?top_k={len(main.DOMAIN_LABELS)}", json=tasks).json():
        assert all(abs(c["contribution"]) <= 1.0 for c in e["top_contributions"])
        total = e["base_probability"] + sum(c["contribution"] for c in e["top_contributions"])
        assert total == pytest.approx(e["prediction"]["late_probability"], abs=2e-3)
