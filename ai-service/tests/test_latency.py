"""NFR-PERF-1 (KAN-60): single prediction <= 500 ms; a 1,000-activity batch <= 10 s.

Timed in-process through the FastAPI test client, so the numbers include request
validation (pydantic + KAN-103 ranges), the calibrated pipeline and serialisation —
everything except the network hop. Budgets come from the requirement; CI runners are
slower than the deployment server, so passing here is conservative.
"""
import os
import statistics
import time

import pytest
from app import main
from fastapi.testclient import TestClient

client = TestClient(main.app)

SINGLE_BUDGET_S = float(os.environ.get("PERF_SINGLE_BUDGET_S", "0.5"))
BATCH_BUDGET_S = float(os.environ.get("PERF_BATCH_BUDGET_S", "10"))
BATCH_SIZE = 1000


def _task(i: int) -> dict:
    return {
        "planned_duration_days": 5 + i % 60, "total_float_hr": None, "free_float_hr": None,
        "rel_position": (i % 100) / 100, "proj_n_tasks": 1000, "proj_span_days": 540,
        "n_pred": i % 4, "n_succ": (i * 7) % 5, "upstream_cnt": i % 40, "downstream_cnt": (i * 3) % 60,
        "task_type": "TT_Task" if i % 10 else "TT_Mile",
    }


def _model_loaded() -> bool:
    return client.get("/health").json().get("model_loaded", False)


pytestmark = pytest.mark.skipif(not _model_loaded() and os.environ.get("REQUIRE_MODEL") != "1",
                                reason="no model artifact; CI sets REQUIRE_MODEL=1")


def test_single_prediction_within_500ms():
    for i in range(3):                                     # warm-up: first call pays imports / caches
        assert client.post("/predict", json=_task(i)).status_code == 200
    times = []
    for i in range(30):
        t0 = time.perf_counter()
        r = client.post("/predict", json=_task(i))
        times.append(time.perf_counter() - t0)
        assert r.status_code == 200
    p95 = sorted(times)[int(0.95 * len(times)) - 1]
    print(f"\n/predict median={statistics.median(times)*1000:.1f} ms p95={p95*1000:.1f} ms")
    assert p95 <= SINGLE_BUDGET_S, f"p95 {p95:.3f}s > {SINGLE_BUDGET_S}s"


def test_batch_of_1000_within_10s():
    payload = [_task(i) for i in range(BATCH_SIZE)]
    client.post("/predict/batch", json=payload[:10])       # warm-up
    t0 = time.perf_counter()
    r = client.post("/predict/batch", json=payload)
    elapsed = time.perf_counter() - t0
    print(f"\n/predict/batch n={BATCH_SIZE}: {elapsed:.2f} s")
    assert r.status_code == 200 and len(r.json()) == BATCH_SIZE
    assert elapsed <= BATCH_BUDGET_S, f"{elapsed:.2f}s > {BATCH_BUDGET_S}s for {BATCH_SIZE} activities"
