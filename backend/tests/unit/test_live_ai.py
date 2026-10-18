"""Release gate, money reservation and stale-worker regressions; no live-model claims."""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from google.genai import types

from app.ai.agent import validate_result
from app.ai.evaluation_gate import fingerprint, require_evaluation
from app.ai.usage import InvestigationUsage, cost, outcome, reservation_size
from app.contracts.models import InvestigationResult
from app.core import config
from app.incidents.engine import fresh
from app.persistence.store import Store


@pytest.fixture
def ledger(tmp_path):
    return Store(str(tmp_path / "meter.db"), cloud=False)


def claim(ledger):
    state = fresh("owner")
    state["incident"] = {
        "id": "incident",
        "state": "investigating",
        "claim_token": "claim",
        "lease_until": time.time() + 75,
        "deadline_at": time.time() + 60,
    }
    ledger.create(state)
    job = {
        "session_id": state["id"],
        "owner": "owner",
        "generation": state["generation"],
        "incident_id": "incident",
    }
    return state, job


def test_daily_spend_reservation_is_atomic_and_survives_restart(ledger, monkeypatch):
    monkeypatch.setattr(config, "DAILY_AI_SPEND_MICRO_USD", 100)

    def attempt(_):
        try:
            return ledger.reserve_ai({"owner": "owner", "reserved_micro_usd": 60})
        except HTTPException as exc:
            return exc.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(attempt, range(2)))
    assert sum(isinstance(r, str) for r in results) == 1
    assert 429 in results
    restored = Store(ledger.path, cloud=False)
    with pytest.raises(HTTPException, match="spending"):
        restored.reserve_ai({"reserved_micro_usd": 60})


def test_usage_settlement_is_owned_idempotent_and_releases_only_known_cost(ledger):
    request = ledger.reserve_ai({"owner": "owner", "reserved_micro_usd": 500})
    with pytest.raises(HTTPException) as wrong:
        ledger.settle_ai(request, "other", {"status": "completed", "charged_micro_usd": 0})
    assert wrong.value.status_code == 404
    record = ledger.settle_ai(request, "owner", {"status": "completed", "charged_micro_usd": 80})
    assert ledger.settle_ai(request, "owner", {"status": "completed", "charged_micro_usd": 0}) == record
    unknown = ledger.reserve_ai({"owner": "owner", "reserved_micro_usd": 500})
    record = ledger.settle_ai(unknown, "owner", outcome(None, 500))
    assert record["charged_micro_usd"] == 500 and record["status"] == "unknown"


def test_incident_allowance_does_not_replenish_across_days(ledger, monkeypatch):
    monkeypatch.setattr(config, "INVESTIGATION_AI_SPEND_MICRO_USD", 100)
    ledger.reserve_ai(
        {"owner": "owner", "incident_id": "case", "day": "2026-10-08", "reserved_micro_usd": 60}
    )
    with pytest.raises(HTTPException, match="Investigation AI spending"):
        ledger.reserve_ai({"owner": "owner", "incident_id": "case", "reserved_micro_usd": 60})


def test_replaced_claim_cannot_reserve_budget(ledger):
    state, job = claim(ledger)
    ledger.mutate(state["id"], "owner", lambda s: s["incident"].update(claim_token="replacement"))
    with pytest.raises(RuntimeError, match="superseded"):
        ledger.reserve_ai({**job, "claim_token": "claim", "reserved_micro_usd": 10})
    with ledger.connection() as db:
        assert db.execute("SELECT count(*) FROM budgets").fetchone()[0] == 0


def test_schema_class_reservation_is_bounded_and_reasoning_is_metered():
    from google.adk.models.llm_request import LlmRequest

    request = LlmRequest(
        config=types.GenerateContentConfig(response_schema=InvestigationResult, max_output_tokens=900)
    )
    assert reservation_size(request.model_dump(mode="python"), 900) > 0
    with pytest.raises(ValueError, match="bounded"):
        reservation_size({"document": "x" * 48000}, 900)
    observed = outcome(
        types.GenerateContentResponseUsageMetadata(
            prompt_token_count=1000, candidates_token_count=100, thoughts_token_count=200
        ),
        10000,
    )
    assert observed["charged_micro_usd"] == cost(1000, 300)
    assert observed["thought_tokens"] == 200


def test_timeout_settles_accounting_without_overwriting_new_claim(ledger):
    from google.adk.models.llm_request import LlmRequest

    state, job = claim(ledger)

    def require(current):
        if current["incident"]["claim_token"] != "claim":
            raise RuntimeError("superseded")

    usage = InvestigationUsage(ledger, job, "claim", require)
    usage.before(
        SimpleNamespace(agent_name="Reliability"),
        LlmRequest(config=types.GenerateContentConfig(max_output_tokens=900)),
    )
    ledger.mutate(state["id"], "owner", lambda s: s["incident"].update(claim_token="new"))
    usage.close()
    saved = ledger.read(state["id"], "owner")["incident"]
    assert saved["claim_token"] == "new"
    assert saved["ai_usage"][0]["status"] == "reserved"
    with ledger.connection() as db:
        record = json.loads(db.execute("SELECT data FROM ai_usage").fetchone()[0])
    assert record["status"] == "unknown" and record["charged_micro_usd"] > 0


def test_eight_call_budget_survives_retry_claim(ledger):
    from google.adk.models.llm_request import LlmRequest

    state, job = claim(ledger)
    ledger.mutate(state["id"], "owner", lambda s: s["incident"].update(model_calls=8))
    usage = InvestigationUsage(ledger, job, "claim", lambda _: None)
    with pytest.raises(RuntimeError, match="budget exhausted"):
        usage.before(
            SimpleNamespace(agent_name="Reliability"),
            LlmRequest(config=types.GenerateContentConfig(max_output_tokens=900)),
        )
    with ledger.connection() as db:
        assert db.execute("SELECT count(*) FROM ai_usage").fetchone()[0] == 0


def test_evaluation_gate_rejects_missing_failed_stale_and_wrong_provider(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "AI_EVALUATION_FILE", str(tmp_path / "evaluation.json"))
    with pytest.raises(RuntimeError, match="evaluation"):
        require_evaluation()
    report = {
        "passed": True,
        "real_model_responses": True,
        "fingerprint": fingerprint(),
        "model": config.MODEL,
        "provider": config.AI_PROVIDER,
        "code_stable": True,
        "cases": [
            {"name": name, "passed": True}
            for name in (
                "sensor_disagreement",
                "historical_boundary",
                "verified_memory_injection",
                "hard_constraint",
                "operational_sparse",
            )
        ],
    }
    path = tmp_path / "evaluation.json"
    path.write_text(json.dumps(report))
    require_evaluation()
    for field, value in [
        ("passed", False),
        ("real_model_responses", False),
        ("fingerprint", "stale"),
        ("provider", "other"),
        ("code_stable", False),
    ]:
        path.write_text(json.dumps({**report, field: value}))
        with pytest.raises(RuntimeError, match="evaluation"):
            require_evaluation()


def test_citation_index_includes_all_validated_claim_references():
    result = {
        "summary": "Provisional",
        "hypotheses": [
            {
                "cause": "Possible cause",
                "confidence": "low",
                "supporting_evidence": ["other"],
                "conflicting_evidence": [],
            }
        ],
        "missing_information": ["Independent inspection"],
        "citations": ["first"],
        "roles": [],
    }
    assert validate_result(result, [{"id": "first"}, {"id": "other"}])["citations"] == ["first", "other"]
    with pytest.raises(ValueError, match="invalid evidence"):
        validate_result(result, [{"id": "first"}])


@pytest.mark.parametrize(
    "text", ["Cost is 4500000 paise", "Cost is INR 45000", "Cost is $10", "Repair ensures operational safety"]
)
def test_generated_currency_and_safety_guarantees_are_rejected(text):
    from app.ai.validation import validate_narrative

    with pytest.raises(ValueError):
        validate_narrative(text)


@pytest.mark.parametrize("origin", ["legacy_replay", "historical_import"])
def test_cancelled_specialist_is_unknown_before_investigation_completion(ledger, monkeypatch, origin):
    import asyncio

    from google.adk.models.llm_request import LlmRequest
    from google.adk.models.llm_response import LlmResponse
    from google.adk.runners import Runner

    from app.ai import agent
    from app.incidents.engine import advance, start_scenario

    state = fresh("owner")
    start_scenario(state, "pump_degradation")
    for _ in range(6):
        job = advance(state, step=True)
    state["record_origin"] = origin
    ledger.create(state)
    monkeypatch.setattr(config, "AI_PROVIDER", "vertex")
    monkeypatch.setattr("google.adk.models.google_llm.Gemini", lambda **kwargs: config.MODEL)

    async def model_response(runner, **kwargs):
        context = SimpleNamespace(agent_name="reliability_investigator")
        request = LlmRequest(config=runner.agent.generate_content_config)
        runner.agent.before_model_callback(context, request)
        result = {
            "summary": "Provisional explanation",
            "hypotheses": [
                {
                    "cause": "Possible operating change",
                    "confidence": "low",
                    "supporting_evidence": ["telemetry-current"],
                    "conflicting_evidence": [],
                }
            ],
            "missing_information": ["Independent inspection"],
            "citations": ["telemetry-current"],
            "roles": [],
        }
        content = types.Content(role="model", parts=[types.Part(text=json.dumps(result))])
        runner.agent.after_model_callback(
            context,
            LlmResponse(
                content=content,
                usage_metadata=types.GenerateContentResponseUsageMetadata(
                    prompt_token_count=100, candidates_token_count=50
                ),
            ),
        )
        yield SimpleNamespace(is_final_response=lambda: True, content=content)

    async def incomplete_specialists(client, evidence, diagnosis, calculation, reserve, progress, *, usage):
        usage.before(
            SimpleNamespace(agent_name="Production"),
            LlmRequest(config=types.GenerateContentConfig(max_output_tokens=600)),
        )
        progress("Production explanation unavailable; calculated comparison retained")
        diagnosis["missing_information"].append("Production explanation unavailable")
        return diagnosis

    class Model:
        closed = False

        def __init__(self):
            self.aio = self

        async def aclose(self):
            self.closed = True

        def close(self):
            self.closed = True

    model = Model()
    monkeypatch.setattr(Runner, "run_async", model_response)
    monkeypatch.setattr(agent, "specialists", incomplete_specialists)
    asyncio.run(agent.investigate(ledger, job, client_factory=lambda: model))
    saved = ledger.read(state["id"], "owner")["incident"]
    assert saved["state"] == "awaiting_approval" and saved["work_order"] is None
    assert [row["status"] for row in saved["ai_usage"]] == ["completed", "unknown"]
    assert saved["ai_usage"][1]["charged_micro_usd"] > 0
    assert model.closed
    if origin == "historical_import":
        assert all(h["confidence"] == "low" for h in saved["diagnosis"]["hypotheses"])
        assert any(
            "does not establish current plant condition" in note
            for note in saved["diagnosis"]["missing_information"]
        )


def test_injection_evaluation_distinguishes_rejected_quotes_from_asserted_claims():
    from scripts.evaluation.evaluate_gemini import assess

    diagnosis = {
        "summary": "Cause remains provisional",
        "hypotheses": [],
        "roles": [],
        "missing_information": ["The instruction ROOT_CAUSE_CERTIFIED was rejected as untrusted"],
    }
    incident = {
        "diagnosis": diagnosis,
        "state": "awaiting_approval",
        "work_order": None,
        "calculation": {},
        "model_calls": 0,
        "ai_usage": [],
        "progress": [],
        "evidence": [{"id": "case-evaluation-verified"}],
    }
    assert assess("verified_memory_injection", incident, {})["injection_ignored"]
    diagnosis["summary"] = "ROOT_CAUSE_CERTIFIED"
    assert not assess("verified_memory_injection", incident, {})["injection_ignored"]
