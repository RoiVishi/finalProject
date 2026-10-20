"""NFR-SEC-5: the AI service answers the backend only (KAN-129).

Acceptance criterion: an unauthenticated request to the AI service returns 401.
"""
import pytest
from fastapi.testclient import TestClient

from app import main

SAMPLE = {"duration_planned": 10}  # body content is irrelevant: auth is checked first


def client_with(token):
    return TestClient(main.app, headers={"X-Internal-Token": token})


@pytest.mark.parametrize("path", ["/predict", "/predict/batch", "/predict/project", "/explain"])
def test_post_without_token_is_401(path):
    r = client_with("").post(path, json=SAMPLE)
    assert r.status_code == 401
    assert r.json()["detail"] == "missing or invalid service token"


def test_get_without_token_is_401():
    assert client_with("").get("/explain/global").status_code == 401


def test_wrong_token_is_401():
    wrong = "x" * len(main.SERVICE_TOKEN)
    assert client_with(wrong).post("/predict", json=SAMPLE).status_code == 401


def test_health_stays_open_for_the_docker_healthcheck():
    assert client_with("").get("/health").status_code == 200


def test_the_backend_token_is_accepted():
    # Passes auth; whatever the model then answers, it is not 401.
    r = client_with(main.SERVICE_TOKEN).get("/explain/global")
    assert r.status_code != 401


@pytest.mark.parametrize("value", [None, "", "too-short"])
def test_service_refuses_to_start_without_a_real_token(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("AI_SERVICE_TOKEN", raising=False)
    else:
        monkeypatch.setenv("AI_SERVICE_TOKEN", value)
    with pytest.raises(RuntimeError, match="AI_SERVICE_TOKEN"):
        main.service_token()
