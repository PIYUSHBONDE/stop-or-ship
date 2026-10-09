import asyncio
import copy

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.ai.agent import investigate
from app.contracts.models import ApprovalRequest, CalculationRequest, RepairRequest
from app.incidents.decision_rules import refresh_constraints
from app.incidents.engine import advance, approve, fresh, snapshot, start_scenario
from app.incidents.workflow import (
    finish_repair,
    persist_decision_transition,
    recalculate_decision,
    start_repair,
)
from app.main import create_app
from app.persistence.store import Store


@pytest.fixture
def ready(tmp_path):
    store = Store(str(tmp_path / "decisions.db"), cloud=False)
    state = fresh("owner")
    start_scenario(state, "pump_degradation")
    for _ in range(6):
        job = advance(state, step=True)
    store.create(state)
    asyncio.run(investigate(store, job))
    return store, store.read(state["id"], "owner")


def request_for(state, option="continue"):
    return ApprovalRequest(
        option_id=option,
        calculation_version=state["incident"]["calculation_version"],
        approver="Maintenance manager",
    )


def hot_window(state, temperature=100, unit="°C"):
    row = copy.deepcopy(state["history"][-1])
    row["window"] += 1
    signal = next(s for s in row["signals"] if s["signal_id"] == "temperature")
    signal.update(value=temperature, unit=unit)
    state["history"].append(row)


def test_later_breach_latches_and_preserves_original_authorization(ready):
    _, state = ready
    request = request_for(state)
    receipt = copy.deepcopy(approve(state, request, "first-approval"))
    hot_window(state)
    assert refresh_constraints(state)
    incident = state["incident"]
    assert incident["state"] == "awaiting_approval"
    assert incident["work_order"] is None
    assert incident["calculation_version"] != request.calculation_version
    assert incident["roles_calculation_version"] == request.calculation_version
    assert incident["safety_evidence"][0]["value"] == 100
    retired = incident["superseded_work_orders"][0]
    assert retired["status"] == "superseded" and retired["approval"] == receipt["approval"]
    assert retired["superseded_reason"]
    assert [o["id"] for o in incident["calculation"]["options"] if o["feasible"]] == ["stop"]
    hot_window(state, temperature=40)
    assert not refresh_constraints(state)
    assert incident["safety_stop"] and incident["safety_evidence"][0]["value"] == 100
    assert len(incident["decision_changes"]) == 1
    # A repeated receipt cannot reactivate the superseded work order.
    assert approve(state, request, "first-approval") == receipt
    assert incident["work_order"] is None


@pytest.mark.parametrize("operation", ["approve", "repair"])
def test_conflict_commits_constraint_before_returning_to_caller(ready, operation):
    store, state = ready
    request = request_for(state)
    if operation == "repair":
        approve(state, request, "original-approval")
    hot_window(state)
    store.mutate(state["id"], "owner", lambda current: (current.clear(), current.update(state)))
    command = (
        (lambda current: approve(current, request, "late-approval"))
        if operation == "approve"
        else start_repair
    )
    with pytest.raises(HTTPException) as error:
        persist_decision_transition(store, state["id"], "owner", state["incident"]["id"], command)
    assert error.value.status_code == 409
    saved = store.read(state["id"], "owner")["incident"]
    assert saved["safety_stop"] and saved["severity"] == "critical"
    assert saved["calculation_version"] != request.calculation_version
    assert saved["work_order"] is None
    assert saved["state"] == "awaiting_approval"


def test_window_evaluation_enforces_new_constraint(ready, monkeypatch):
    from app.incidents import engine

    _, state = ready
    row = copy.deepcopy(state["history"][-1])
    next(s for s in row["signals"] if s["signal_id"] == "temperature")["value"] = 100
    monkeypatch.setattr(engine, "sample", lambda *args: copy.deepcopy(row))
    advance(state, step=True)
    assert state["incident"]["safety_stop"]
    assert state["incident"]["calculation"]["recommended"] == "stop"


def test_wrong_units_do_not_create_celsius_breach(ready):
    _, state = ready
    hot_window(state, temperature=100, unit="K")
    assert not refresh_constraints(state)
    assert not state["incident"]["safety_stop"]


def test_recalculation_retires_order_and_retry_stays_inactive(ready):
    _, state = ready
    request = request_for(state, "stop")
    receipt = copy.deepcopy(approve(state, request, "approved-once"))
    recalculate_decision(state, CalculationRequest(risk_multiplier=2))
    incident = state["incident"]
    assert incident["calculation"]["risk_multiplier"] == 2
    assert incident["superseded_work_orders"][0]["status"] == "superseded"
    assert approve(state, request, "approved-once") == receipt
    assert incident["work_order"] is None
    with pytest.raises(HTTPException):
        start_repair(state)


def test_executed_repair_preserves_its_authorization_snapshot(ready):
    _, state = ready
    approve(state, request_for(state, "stop"), "approved-repair")
    start_repair(state)
    original = copy.deepcopy(state["incident"]["work_order"])
    hot_window(state)
    assert refresh_constraints(state)
    assert state["incident"]["state"] == "repairing"
    assert state["incident"]["work_order"] == original
    assert state["incident"]["safety_stop"]


def test_http_stale_approval_persists_breach_and_exposes_typed_evidence(ready):
    store, state = ready
    # Override identity only in this isolated test; production requests still verify their owner.
    from app.api.dependencies import session_owner

    app = create_app(store)
    app.dependency_overrides[session_owner] = lambda: "owner"
    with TestClient(app) as client:
        request = request_for(state)
        hot_window(state)
        store.mutate(state["id"], "owner", lambda current: (current.clear(), current.update(state)))
        base = f"/api/v1/sessions/{state['id']}"
        headers = {"X-Incident-ID": state["incident"]["id"], "Idempotency-Key": "http-late-approval"}
        response = client.post(base + "/approve", json=request.model_dump(), headers=headers)
        assert response.status_code == 409
        saved = client.get(base).json()["incident"]
        assert saved["safety_stop"] and saved["safety_evidence"][0]["unit"] == "°C"
        assert saved["decision_changes"][0]["previous_version"] == request.calculation_version
        new = {
            **request.model_dump(),
            "option_id": "continue",
            "calculation_version": saved["calculation_version"],
        }
        assert client.post(base + "/approve", json=new, headers=headers).status_code == 409
        assert client.get(base).json()["incident"]["work_order"] is None


def test_wrong_incident_guard_does_not_mutate_current_case(ready):
    store, state = ready
    hot_window(state)
    store.mutate(state["id"], "owner", lambda current: (current.clear(), current.update(state)))
    with pytest.raises(HTTPException):
        persist_decision_transition(store, state["id"], "owner", "different-incident", start_repair)
    assert not store.read(state["id"], "owner")["incident"]["safety_stop"]


def test_recovery_requires_temperature_within_limit_and_clears_latch(ready, monkeypatch):
    from app.incidents import engine

    _, state = ready
    approve(state, request_for(state, "stop"), "temperature-recovery")
    start_repair(state)
    finish_repair(
        state,
        RepairRequest(
            observed_cause="Valve bypass", fix="Replaced seal", parts="Seal", outcome="Awaiting verification"
        ),
    )
    row = copy.deepcopy(state["history"][-1])
    row["anomaly"] = False
    temperature = next(signal for signal in row["signals"] if signal["signal_id"] == "temperature")
    temperature["value"] = 100
    monkeypatch.setattr(engine, "sample", lambda *args: copy.deepcopy(row))
    for _ in range(3):
        advance(state, step=True)
    assert state["incident"]["state"] == "verifying" and not state["memory"]
    assert state["incident"]["verification_windows"] == 0
    assert snapshot(state)["output_per_hour"] == 100
    assert "temperature" in state["incident"]["verification_message"]
    temperature["value"] = 40
    for _ in range(3):
        advance(state, step=True)
    assert state["incident"]["state"] == "resolved"
    assert not state["incident"]["safety_stop"]
    assert state["incident"]["safety_evidence"][0]["value"] == 100
    assert len(state["memory"]) == 1
    assert snapshot(state)["output_per_hour"] == 200
