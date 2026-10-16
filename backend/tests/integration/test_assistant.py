"""Assistant boundaries with isolated staff stores; provider doubles are not live proof."""

import base64
import io
import json
import struct
import time
import wave
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.ai import assistant, assistant_gate, speech
from app.ai.assistant import AssistantCache
from app.core import config
from tests.support.workspace import create_incident


def wav(seconds=1, amplitude=1000, rate=16000):
    data = io.BytesIO()
    with wave.open(data, "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(struct.pack("<h", amplitude) * int(seconds * rate))
    return base64.b64encode(data.getvalue()).decode()


def ask(client, plant, key="question-key", **extra):
    return client.post(
        f"/api/v1/plants/{plant}/assistant/questions",
        json={
            "question": "Which readings are missing?",
            "screen": "plant",
            "asset_id": "P-107",
            **extra,
        },
        headers={"Idempotency-Key": key},
    )


def test_question_auth_context_receipts_and_quota(shared):
    store, app, admin, plant, _ = shared
    with TestClient(app) as anonymous:
        assert ask(anonymous, plant).status_code == 401
    assert ask(admin, "other-plant").status_code == 404
    assert ask(admin, plant, asset_id="unknown").status_code == 404
    assert ask(admin, plant, incident_id="00000000-0000-0000-0000-000000000000").status_code == 404
    answer = ask(admin, plant)
    assert answer.status_code == 200, answer.text
    assert answer.json()["provider"].startswith("Scripted")
    assert ask(admin, plant).json() == answer.json()
    assert ask(admin, plant, question="Different input").status_code == 409
    for i in range(9):
        assert ask(admin, plant, key=f"question-{i}").status_code == 200
    assert ask(admin, plant, key="eleventh-key").status_code == 200
    with store.connection() as db:
        records = [json.loads(r[0]) for r in db.execute("SELECT data FROM ai_usage")]
    assert len(records) == 11
    assert all("staff_token" not in r for r in records)
    assert all("incident_id" not in r for r in records)


def test_question_preserves_global_call_allowance(shared, monkeypatch):
    store, _, admin, plant, _ = shared
    monkeypatch.setattr(config, "DAILY_LIMIT", 3)
    first = ask(admin, plant, key="first-request")
    assert first.status_code == 200
    assert ask(admin, plant, key="second-request").status_code == 200
    assert ask(admin, plant, key="third-request").status_code == 200
    blocked = ask(admin, plant, key="fourth-request")
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "Daily AI allowance reached"
    assert ask(admin, plant, key="first-request").json() == first.json()
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM ai_usage").fetchone()[0] == 3


def test_question_preserves_global_spending_allowance(shared, monkeypatch):
    store, _, admin, plant, _ = shared
    store.reserve_ai({"reserved_micro_usd": 1})
    monkeypatch.setattr(config, "DAILY_AI_SPEND_MICRO_USD", 0)
    blocked = ask(admin, plant, key="spend-blocked")
    assert blocked.status_code == 429
    assert blocked.json()["detail"] == "Daily AI spending allowance reached"
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM ai_usage").fetchone()[0] == 1


def test_bounded_history_and_exact_audio_route(shared):
    _, _, admin, plant, _ = shared
    assert ask(admin, plant, history=[{"question": "q", "answer": "a"}] * 7).status_code == 422
    assert ask(admin, plant, question=" ").status_code == 422
    prefix = f"/api/v1/plants/{plant}/assistant/"
    # Same body: transcription bypasses only the 64 KiB boundary, not contract validation.
    payload = {"audio_base64": "x" * 90000}
    assert admin.post(prefix + "questions", json=payload).status_code == 413
    assert (
        admin.post(
            prefix + "transcriptions", json=payload, headers={"Idempotency-Key": "audio-key"}
        ).status_code
        == 422
    )
    assert admin.post(prefix + "transcriptions", content=b" " * (1024 * 1024 + 1)).status_code == 413
    assert admin.post(prefix + "transcriptions/", content=b" " * 90000).status_code == 413


@pytest.mark.parametrize(
    "encoded",
    ["invalid-base64", wav(16), wav(rate=8000), wav(amplitude=0), wav(0.01)],
    ids=["base64", "duration", "rate", "silence", "short"],
)
def test_malformed_audio_is_rejected_before_provider(shared, encoded):
    _, _, admin, plant, _ = shared
    result = admin.post(
        f"/api/v1/plants/{plant}/assistant/transcriptions",
        json={"audio_base64": encoded},
        headers={"Idempotency-Key": "audio-key"},
    )
    assert result.status_code == 422


def test_voice_receipts_ownership_expiry_and_accounting(shared, monkeypatch):
    store, app, admin, plant, invite = shared
    answer = ask(admin, plant).json()
    monkeypatch.setattr(speech, "require_assistant_evaluation", lambda **_: None)
    calls = []
    payloads = []

    async def provider(url, payload):
        calls.append(url)
        payloads.append(payload)
        if "recognize" in url:
            return {"results": [{"alternatives": [{"transcript": "P-107 pressure 125 bar"}]}]}
        return {"audioContent": base64.b64encode(b"ID3fixture-only").decode()}

    monkeypatch.setattr(speech, "google_post", provider)
    prefix = f"/api/v1/plants/{plant}/assistant/"
    transcription = admin.post(
        prefix + "transcriptions",
        json={"audio_base64": wav(), "asset_id": "P-107"},
        headers={"Idempotency-Key": "transcribe-key"},
    )
    assert transcription.status_code == 200, transcription.text
    assert transcription.json()["usage"]["audio_seconds"] == 1
    assert transcription.json()["usage"]["charged_micro_usd"] == 267
    body = {"answer_reference": answer["answer_reference"], "asset_id": "P-107"}
    member, _, _ = invite("viewer")
    assert (
        member.post(prefix + "speech", json=body, headers={"Idempotency-Key": "speech-key"}).status_code
        == 404
    )
    playback = admin.post(prefix + "speech", json=body, headers={"Idempotency-Key": "speech-key"})
    assert playback.status_code == 200, playback.text
    assert payloads[-1]["input"]["ssml"].startswith("<speak><p>")
    assert "text" not in payloads[-1]["input"]
    assert payloads[-1]["audioConfig"]["speakingRate"] == 0.96
    assert playback.json()["usage"]["synthesis_characters"] == len(payloads[-1]["input"]["ssml"])
    assert (
        admin.post(prefix + "speech", json=body, headers={"Idempotency-Key": "different-key"}).json()
        == playback.json()
    )
    assert len(calls) == 2
    app.state.assistant_cache.entries[answer["answer_reference"]] = (time.monotonic() - 1, (), answer)
    assert (
        admin.post(prefix + "speech", json=body, headers={"Idempotency-Key": "speech-key"}).status_code == 404
    )
    app.state.assistant_cache = AssistantCache()
    assert ask(admin, plant).status_code == 409
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM ai_usage").fetchone()[0] == 3


def test_voice_failure_unknown_charge_no_retry(shared, monkeypatch):
    store, _, admin, plant, _ = shared
    monkeypatch.setattr(speech, "require_assistant_evaluation", lambda **_: None)
    calls = []

    async def fail(*args):
        calls.append(1)
        raise TimeoutError()

    monkeypatch.setattr(speech, "google_post", fail)
    admin._transport.raise_server_exceptions = False
    endpoint = f"/api/v1/plants/{plant}/assistant/transcriptions"
    args = {"json": {"audio_base64": wav()}, "headers": {"Idempotency-Key": "transcribe-key"}}
    assert admin.post(endpoint, **args).status_code == 503
    assert admin.post(endpoint, **args).status_code == 409
    assert len(calls) == 1
    with store.connection() as db:
        record = json.loads(db.execute("SELECT data FROM ai_usage").fetchone()[0])
    assert record["status"] == "unknown" and record["charged_micro_usd"] == 267


def test_saved_costs_are_server_owned_and_historical_blocked(shared):
    _, _, admin, plant, _ = shared
    incident = create_incident(admin, plant)
    answer = ask(admin, plant, incident_id=incident["id"]).json()
    assert answer["calculation_version"] == incident["calculation_version"]
    assert answer["costs"][0]["total_paise"] == incident["calculation"]["options"][0]["total_paise"]
    assert "cannot establish current health" in answer["answer"]
    other = next(
        a["id"]
        for a in admin.get(f"/api/v1/plants/{plant}/snapshot").json()["assets"]
        if a["id"] != incident["asset_id"]
    )
    assert (
        ask(admin, plant, key="wrong-context", incident_id=incident["id"], asset_id=other).status_code == 409
    )
    equipment_only = ask(admin, plant, key="equipment-only", asset_id=other).json()
    assert equipment_only["costs"] == [] and equipment_only["calculation_version"] is None


def test_assistant_gate_defaults_closed(shared, monkeypatch):
    _, _, admin, plant, _ = shared
    monkeypatch.setattr(config, "AI_PROVIDER", "vertex")
    admin._transport.raise_server_exceptions = False
    assert ask(admin, plant).status_code == 503


@pytest.mark.parametrize(
    "answer,citations",
    [
        ("Unsupported claim", ["invented-source"]),
        ("It costs INR 500", ["plant-state"]),
        ("It is safe to operate", ["plant-state"]),
    ],
)
def test_invalid_model_output_is_not_published(shared, monkeypatch, answer, citations):
    store, _, admin, plant, _ = shared
    monkeypatch.setattr(config, "AI_PROVIDER", "vertex")
    monkeypatch.setattr(assistant_gate, "require_assistant_evaluation", lambda **_: None)
    admin._transport.raise_server_exceptions = False

    class Model:
        def __init__(self):
            self.aio = self
            self.models = self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def generate_content(self, **kwargs):
            assert "untrusted" in kwargs["config"].system_instruction
            return SimpleNamespace(
                text=json.dumps({"answer": answer, "citations": citations}), usage_metadata=None
            )

        def close(self):
            pass

    monkeypatch.setattr(assistant, "client", lambda **_: Model())
    assert ask(admin, plant).status_code == 502
    assert ask(admin, plant).status_code == 409
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM ai_usage").fetchone()[0] == 1
