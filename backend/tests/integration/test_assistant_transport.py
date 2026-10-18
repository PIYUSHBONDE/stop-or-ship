"""Provider doubles verify lifecycle, supported settings and duplicate-safe recovery."""

import json
from types import SimpleNamespace

import pytest

from app.ai import assistant, assistant_gate
from app.ai.ai_client import thinking_config
from app.core import config
from app.main import create_app
from tests.integration.test_assistant import ask


@pytest.mark.parametrize("model,expected", [("gemini-3.5-flash", "MINIMAL"), ("gemini-3.8-flash", "LOW")])
def test_model_uses_supported_thinking_level(monkeypatch, model, expected):
    monkeypatch.setattr(config, "MODEL", model)
    assert thinking_config().thinking_level.value == expected


def test_timeout_reuses_transport_but_requires_new_request_identity(shared, monkeypatch):
    store, app, admin, plant, _ = shared
    monkeypatch.setattr(config, "AI_PROVIDER", "vertex")
    monkeypatch.setattr(config, "MODEL", "gemini-3.8-flash")
    monkeypatch.setattr(assistant_gate, "require_assistant_evaluation", lambda **_: None)
    counts = {"created": 0, "entered": 0, "closed": 0, "calls": 0}

    class Model:
        def __init__(self):
            counts["created"] += 1
            self.aio = self.models = self

        async def __aenter__(self):
            counts["entered"] += 1
            return self

        async def __aexit__(self, *args):
            pass

        async def generate_content(self, **kwargs):
            counts["calls"] += 1
            assert kwargs["model"] == "gemini-3.8-flash"
            assert kwargs["config"].thinking_config.thinking_level.value == "LOW"
            if counts["calls"] == 1:
                raise TimeoutError()
            return SimpleNamespace(
                text=json.dumps(
                    {"answer": "Current measurements are missing.", "citations": ["plant-state"]}
                ),
                usage_metadata=None,
            )

        def close(self):
            counts["closed"] += 1

    monkeypatch.setattr(assistant, "client", lambda **_: Model())
    failed = ask(admin, plant, key="timeout-intent")
    assert failed.status_code == 504
    assert failed.json()["detail"].startswith("AI response timed out")
    assert ask(admin, plant, key="timeout-intent").status_code == 409
    answer = ask(admin, plant, key="new-user-intent")
    assert answer.status_code == 200
    assert ask(admin, plant, key="new-user-intent").json() == answer.json()
    assert counts == {"created": 1, "entered": 1, "closed": 0, "calls": 2}
    with store.connection() as db:
        rows = [json.loads(r[0]) for r in db.execute("SELECT data FROM ai_usage")]
    assert len(rows) == 2 and rows[0]["status"] == "unknown"
    admin.portal.call(app.state.assistant_cache.close)
    assert counts["closed"] == 1


@pytest.mark.parametrize(
    "text,citations",
    [
        ("Costs are in INR.", ["plant-state"]),
        ("It is safe to operate.", ["plant-state"]),
        ("Pressure is unknown.", ["invented-source"]),
    ],
)
def test_rejected_output_is_explicit_and_never_cached(shared, monkeypatch, text, citations):
    _, _, admin, plant, _ = shared
    monkeypatch.setattr(config, "AI_PROVIDER", "vertex")
    monkeypatch.setattr(assistant_gate, "require_assistant_evaluation", lambda **_: None)
    calls = []

    class Model:
        def __init__(self):
            self.aio = self.models = self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def generate_content(self, **kwargs):
            calls.append(kwargs)
            return SimpleNamespace(
                text=json.dumps({"answer": text, "citations": citations}), usage_metadata=None
            )

        def close(self):
            pass

    monkeypatch.setattr(assistant, "client", lambda **_: Model())
    response = ask(admin, plant, key="rejected-answer")
    assert response.status_code == 502
    assert response.json()["detail"].startswith("AI response")
    assert text not in response.json()["detail"]
    assert ask(admin, plant, key="rejected-answer").status_code == 409
    assert len(calls) == 1


def test_normal_server_rejects_scripted_provider(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(config, "AI_PROVIDER", "scripted")
    monkeypatch.setattr(config, "INTERNAL_TEST_MODE", False)
    with pytest.raises(RuntimeError, match="Scripted AI is test-only"), TestClient(create_app()):
        pass


def test_normal_worker_rejects_scripted_provider(monkeypatch):
    import asyncio

    from app.cases.worker import main

    monkeypatch.setattr(config, "AI_PROVIDER", "scripted")
    monkeypatch.setattr(config, "INTERNAL_TEST_MODE", False)
    with pytest.raises(RuntimeError, match="Scripted AI is test-only"):
        asyncio.run(main(once=True))
