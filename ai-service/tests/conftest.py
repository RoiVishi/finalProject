"""
Shared test setup.

NFR-SEC-5: the service refuses to start without AI_SERVICE_TOKEN and answers
401 without the X-Internal-Token header. Here a test token is set before any
test module imports app.main, and every TestClient sends the header by
default, so the existing tests run unchanged. A test that needs a request
without the token passes headers={"X-Internal-Token": ""} or its own value
(see test_service_token.py).
"""
import os

os.environ.setdefault("AI_SERVICE_TOKEN", "test-token-" + "0" * 32)

from fastapi.testclient import TestClient  # noqa: E402

_original_init = TestClient.__init__


def _init_with_token(self, *args, headers=None, **kwargs):
    merged = {"X-Internal-Token": os.environ["AI_SERVICE_TOKEN"]}
    merged.update(headers or {})
    _original_init(self, *args, headers=merged, **kwargs)


TestClient.__init__ = _init_with_token
