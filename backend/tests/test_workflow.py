import asyncio
import tempfile
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.agent import investigate, validate_result
from app.economics import calculate
from app.engine import advance, approve, calc_version, fresh, start_scenario
from app.models import ApprovalRequest
from app.store import Store


@pytest.fixture
def store():
    with tempfile.TemporaryDirectory() as d:
        yield Store(str(Path(d) / "test.db"), cloud=False)


def incident_session(store, scenario="pump_degradation"):
    s = fresh("owner")
    start_scenario(s, scenario)
    job = None
    for _ in range(6):
        job = advance(s, step=True) or job
    assert job and s["incident"]["state"] == "detected"
    store.create(s)
    asyncio.run(investigate(store, job))
    return store.read(s["id"], "owner"), job


def test_costs_and_constraints():
    result = calculate()
    assert result["recommended"] in {"stop", "defer", "derate", "continue"}
    for o in result["options"]:
        assert o["total_paise"] == sum(
            o[k]
            for k in ["repair_cost_paise", "lost_margin_paise", "penalty_paise", "failure_exposure_paise"]
        )
        assert isinstance(o["total_paise"], int)
    stop = next(o for o in result["options"] if o["id"] == "stop")
    assert stop["lost_units"] == 100
    assert stop["lost_margin_paise"] == 2500000
    assert stop["total_paise"] == 4500000
    assert next(o for o in result["options"] if o["id"] == "continue")["lost_units"] == 320
    assert calculate(safety_stop=True)["recommended"] == "stop"
    assert not next(o for o in calculate(safety_stop=True)["options"] if o["id"] == "continue")["feasible"]


def test_isolation(store):
    s = fresh("owner")
    store.create(s)
    with pytest.raises(HTTPException) as e:
        store.read(s["id"], "other")
    assert e.value.status_code == 404
    with pytest.raises(HTTPException):
        store.mutate(s["id"], "other", lambda s: s.update(memory=[]))


def test_approval_guards(store):
    s, job = incident_session(store)
    assert s["incident"]["state"] == "awaiting_approval"
    assert s["incident"]["work_order"] is None
    with pytest.raises(HTTPException):
        approve(
            s,
            ApprovalRequest(option_id="stop", calculation_version="0000000000000000", approver="Judge"),
            "key-one",
        )
    req = ApprovalRequest(
        option_id="stop", calculation_version=s["incident"]["calculation_version"], approver="Judge"
    )
    wo = approve(s, req, "key-one")
    assert approve(s, req, "key-one") == wo
    with pytest.raises(HTTPException):
        approve(s, req.model_copy(update={"option_id": "continue"}), "key-one")
    assert s["incident"]["state"] == "approved"


@pytest.mark.parametrize("run", range(5))
def test_complete_loop_and_memory(store, run):
    s, job = incident_session(store)
    req = ApprovalRequest(
        option_id=s["incident"]["calculation"]["recommended"],
        calculation_version=s["incident"]["calculation_version"],
        approver="Maintenance manager",
    )
    approve(s, req, f"approval-{run}")
    i = s["incident"]
    i["state"] = "verifying"
    i["repair"] = {
        "observed_cause": "Valve bypass",
        "fix": "Reseated valve",
        "parts": "Valve seal",
        "outcome": "Flow recovered",
        "recovery": "healthy",
    }
    assert not s["memory"]
    for _ in range(2):
        advance(s, step=True)
        assert not s["memory"]
    advance(s, step=True)
    assert i["state"] == "resolved"
    assert s["memory"][0]["observed_cause"] == "Valve bypass"
    assert s["memory"][0]["original_diagnosis"]["hypotheses"][0]["cause"] == "Internal pump leakage"
    start_scenario(s, "memory_recurrence")
    for _ in range(6):
        next_job = advance(s, step=True)
    store.mutate(s["id"], "owner", lambda current: (current.clear(), current.update(s)))
    asyncio.run(investigate(store, next_job))
    second = store.read(s["id"], "owner")["incident"]
    assert any(e["id"].startswith("case-") for e in second["evidence"])


def test_failed_recovery_never_becomes_memory(store):
    s, _ = incident_session(store)
    s["incident"].update(
        state="verifying", work_order={"status": "completed_unverified"}, repair={"recovery": "failed"}
    )
    for _ in range(6):
        advance(s, step=True)
    assert s["incident"]["state"] == "verifying"
    assert s["memory"] == []


def test_ambiguous_sensor_and_invalid_citations(store):
    s, _ = incident_session(store, "sensor_uncertainty")
    d = s["incident"]["diagnosis"]
    assert "disagree" in d["summary"]
    assert all(h["confidence"] == "low" for h in d["hypotheses"])
    d["citations"].append("invented-manual")
    with pytest.raises(ValueError):
        validate_result(d, s["incident"]["evidence"])


def test_reset_invalidates_worker(store):
    s, job = incident_session(store)
    replacement = fresh("owner", s["id"], s["quotas"])
    store.mutate(s["id"], "owner", lambda current: (current.clear(), current.update(replacement)))
    asyncio.run(investigate(store, job))
    assert store.read(s["id"], "owner")["incident"] is None


def test_worker_duplicate_and_recalculation(store):
    s, job = incident_session(store)
    asyncio.run(investigate(store, job))
    assert store.read(s["id"], "owner")["incident"]["attempts"] == 1
    before = s["incident"]["calculation_version"]
    s["incident"]["calculation"] = calculate(2)
    assert calc_version(s) != before


def test_incident_deduplication_and_quota():
    s = fresh("owner")
    start_scenario(s, "pump_degradation")
    jobs = [advance(s, step=True) for _ in range(20)]
    assert sum(j is not None for j in jobs) == 1
    assert s["quotas"]["investigations"] == 1
    replacement = fresh("owner", s["id"], {"investigations": 3, "questions": 0})
    with pytest.raises(HTTPException):
        start_scenario(replacement, "pump_degradation")


def test_missing_knowledge_retains_evidence_and_retry_is_bounded(store, monkeypatch):
    from app import agent

    s = fresh("owner")
    start_scenario(s, "pump_degradation")
    for _ in range(6):
        job = advance(s, step=True)
    store.create(s)
    monkeypatch.setattr(agent, "search", lambda query, memory: [])
    for _ in range(2):
        with pytest.raises(ValueError):
            asyncio.run(investigate(store, job))
    saved = store.read(s["id"], "owner")
    assert saved["incident"]["state"] == "investigation_failed"
    assert saved["incident"]["evidence"]
    assert saved["incident"]["work_order"] is None
    asyncio.run(investigate(store, job))
    assert store.read(s["id"], "owner")["incident"]["attempts"] == 2


def test_expired_worker_becomes_explicit_failure_while_paused(store):
    s, _ = incident_session(store)
    s["running"] = False
    s["incident"].update(state="investigating", lease_until=1)
    advance(s)
    assert s["incident"]["state"] == "investigation_failed"
    assert "expired" in s["incident"]["error"]


def test_superseded_claim_cannot_write_progress_or_failure(store, monkeypatch):
    from app import agent

    s = fresh("owner")
    start_scenario(s, "pump_degradation")
    for _ in range(6):
        job = advance(s, step=True)
    store.create(s)
    original_search = agent.search

    def supersede(query, memory):
        store.mutate(s["id"], "owner", lambda current: current["incident"].update(claim_token="newer-worker"))
        return original_search(query, memory)

    monkeypatch.setattr(agent, "search", supersede)
    with pytest.raises(RuntimeError, match="expired or superseded"):
        asyncio.run(investigate(store, job))
    saved = store.read(s["id"], "owner")["incident"]
    assert saved["claim_token"] == "newer-worker"
    assert saved["state"] == "investigating"
    assert saved["diagnosis"] is None
    assert not any("retrieved" in progress["message"] for progress in saved["progress"])


def test_duplicate_approval_is_atomic_under_concurrent_requests(store):
    from concurrent.futures import ThreadPoolExecutor

    s, _ = incident_session(store)
    request = ApprovalRequest(
        option_id="stop", calculation_version=s["incident"]["calculation_version"], approver="Judge"
    )

    def submit():
        return store.mutate(
            s["id"], "owner", lambda current: approve(current, request, "same-concurrent-intent")
        )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: submit(), range(2)))
    assert results[0]["id"] == results[1]["id"]
    saved = store.read(s["id"], "owner")
    assert saved["incident"]["state"] == "approved"
    assert len([e for e in saved["events"] if "Human approved" in e["message"]]) == 1


def test_queued_job_timeout_is_recoverable_without_replay(store):
    s = fresh("owner")
    start_scenario(s, "pump_degradation")
    for _ in range(6):
        advance(s, step=True)
    s["running"] = False
    s["incident"]["queued_at"] = 1
    advance(s)
    assert s["incident"]["state"] == "investigation_failed"
    assert s["incident"]["attempts"] == 0
    assert s["incident"]["work_order"] is None
