"""KAN-130: explanations are in the units the user sees, and the batch path is consistent."""
import pytest
from fastapi.testclient import TestClient

import app.main as main

client = TestClient(main.app)

SAMPLE = {
    "planned_duration_days": 14, "total_float_hr": 40, "rel_position": 0.8,
    "proj_n_tasks": 500, "proj_span_days": 400, "n_pred": 3,
    "n_succ": 8, "upstream_cnt": 12, "downstream_cnt": 25, "task_type": "TT_Task",
}
VARIANTS = [
    SAMPLE,
    {**SAMPLE, "planned_duration_days": 90, "rel_position": 0.1, "downstream_cnt": 150},
    {**SAMPLE, "planned_duration_days": 1, "n_pred": 0, "upstream_cnt": 0},
    {**SAMPLE, "task_type": "TT_Mile", "planned_duration_days": 0},
]
ALL = len(main.DOMAIN_LABELS)   # top_k covering every base feature


def _ready() -> bool:
    return client.get("/health").json()["model_loaded"]


@pytest.mark.parametrize("task", VARIANTS)
def test_contributions_add_up_to_the_served_probability(task):
    """base_probability + all contributions == late_probability (the number the user sees)."""
    if not _ready():
        pytest.skip("no model artifact")
    body = client.post(f"/explain?top_k={ALL}", json=task).json()
    total = body["base_probability"] + sum(c["contribution"] for c in body["top_contributions"])
    assert body["contribution_space"] == "calibrated_probability"
    assert total == pytest.approx(body["prediction"]["late_probability"], abs=2e-3)


def test_explanation_matches_predict():
    """/explain reports the same probability as /predict."""
    if not _ready():
        pytest.skip("no model artifact")
    p = client.post("/predict", json=SAMPLE).json()["late_probability"]
    e = client.post("/explain", json=SAMPLE).json()["prediction"]["late_probability"]
    assert e == p


def test_batch_equals_single_and_preserves_order():
    if not _ready():
        pytest.skip("no model artifact")
    batch = client.post("/explain/batch?top_k=3", json=VARIANTS).json()
    assert len(batch) == len(VARIANTS)
    for task, b in zip(VARIANTS, batch):
        single = client.post("/explain?top_k=3", json=task).json()
        assert b["prediction"] == single["prediction"]
        assert [c["feature"] for c in b["top_contributions"]] == \
               [c["feature"] for c in single["top_contributions"]]
        for cb, cs in zip(b["top_contributions"], single["top_contributions"]):
            assert cb["contribution"] == pytest.approx(cs["contribution"], abs=1e-4)


def test_batch_empty_and_limit(monkeypatch):
    assert client.post("/explain/batch", json=[]).json() == []
    monkeypatch.setattr(main, "MAX_EXPLAIN_BATCH", 2)
    r = client.post("/explain/batch", json=[SAMPLE, SAMPLE, SAMPLE])
    assert r.status_code == 413


def test_mapping_is_exact_on_synthetic_values():
    """Unit check of the raw -> calibrated mapping, independent of the artifact."""
    import numpy as np

    class Sigmoid:                       # same form as sklearn's _SigmoidCalibration
        a, b = -5.6, 3.5
        def predict(self, x):
            return 1 / (1 + np.exp(self.a * np.asarray(x) + self.b))

    cals = [Sigmoid()]
    raw = np.array([[0.10, -0.25, 0.05], [0.0, 0.0, 0.0]])   # second row: output == base
    base_raw = 0.5
    p_served = np.array([main._calibrated(cals, base_raw + raw[0].sum()),
                         main._calibrated(cals, base_raw)])
    out, base_cal = main._to_calibrated_space(raw, base_raw, p_served, cals)
    assert base_cal + out[0].sum() == pytest.approx(p_served[0], abs=1e-9)
    assert np.all(np.sign(out[0]) == np.sign(raw[0]))          # directions kept
    assert base_cal + out[1].sum() == pytest.approx(p_served[1], abs=1e-9)
