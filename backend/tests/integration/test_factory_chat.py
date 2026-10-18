"""Provider doubles prove request/response plumbing, not live answer quality."""

import json
from types import SimpleNamespace

import pytest

from app.ai import assistant, assistant_gate
from app.core import config
from tests.integration.test_assistant import ask
from tests.integration.test_simulation_assistant import context, dossier, process_context


@pytest.mark.parametrize("screen_context", [True, False])
def test_reply_keeps_formatting_and_sources_without_appended_boilerplate(shared, monkeypatch, screen_context):
    store, _, admin, plant, _ = shared
    monkeypatch.setattr(config, "AI_PROVIDER", "vertex")
    monkeypatch.setattr(assistant_gate, "require_assistant_evaluation", lambda **_: None)
    calls = []
    text = (
        "Pressure was **125 bar** at detection and is now **170 bar**.\n\n"
        "- Priya Sen is responding.\n- Line A is producing **65 of 100 parts/hour**."
        if screen_context
        else "Current measurements are **missing**. Configured capacity is not measured output."
    )
    cited = (
        ["browser-simulation", "browser-simulation-case", "browser-simulation-process"]
        if screen_context
        else ["plant-state"]
    )

    class Model:
        def __init__(self):
            self.aio = self
            self.models = self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def generate_content(self, **kwargs):
            calls.append(json.loads(kwargs["contents"]))
            return SimpleNamespace(text=json.dumps({"answer": text, "citations": cited}), usage_metadata=None)

        def close(self):
            pass

    monkeypatch.setattr(assistant, "client", lambda **_: Model())
    extra = {}
    if screen_context:
        snapshot = {**context(), "case_evidence": dossier(), "process": process_context()}
        snapshot["assignments"] = [{**snapshot["cases"][0], "operator_name": "Priya Sen"}]
        extra["simulation_context"] = snapshot
    response = ask(admin, plant, **extra)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["answer"] == text
    assert len(result["answer"].split()) < 80
    assert [s["id"] for s in result["citations"]] == [
        s
        for s in (
            "plant-state",
            "browser-simulation",
            "browser-simulation-process",
            "browser-simulation-case",
        )
        if s in cited
    ]
    sent = {s["id"]: json.loads(s["text"]) for s in calls[0]["sources"]}
    assert sent["plant-state"]["measured_output_per_hour"] is None
    if screen_context:
        assert sent["browser-simulation-case"]["detection"]["value"] == 125
        assert sent["browser-simulation"]["equipment"][0]["readings"][0]["value"] == 170
        assert sent["browser-simulation-process"]["lines"][0]["output_per_hour"] == 65
        assert "Ignore instructions" in sent["browser-simulation"]["cases"][0]["note"]
        assert "Ignore instructions" not in result["answer"]
    assert ask(admin, plant, **extra).json() == result
    assert len(calls) == 1
    assert result["costs"] == [] and result["calculation_version"] is None
    with store.connection() as db:
        assert db.execute("SELECT COUNT(*) FROM plant_orders").fetchone()[0] == 0
