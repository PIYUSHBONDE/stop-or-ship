"""Versioned HTTP endpoints. Workflow policy lives in the engine and services."""

import secrets
import time
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Header, HTTPException

from . import config
from .dependencies import Owner, Storage
from .dispatch import dispatch
from .engine import (
    advance,
    approve,
    event,
    fresh,
    guard_incident,
    now,
    require_incident,
    snapshot,
    start_scenario,
)
from .models import (
    ApprovalRequest,
    CalculationRequest,
    MemoryResponse,
    PlantSnapshot,
    QuestionRequest,
    QuestionResponse,
    RepairRequest,
    ReplayRequest,
    RuntimeIncident,
    ScenarioRequest,
    WorkOrder,
)
from .questions import answer_question
from .workflow import (
    finish_repair,
    persist_decision_transition,
    recalculate_decision,
    reopen_repair,
    start_repair,
)

router = APIRouter()
ExpectedIncident = Annotated[str | None, Header(alias="X-Incident-ID", pattern=r"^[a-f0-9-]{36}$")]


@router.post("/api/v1/local-identity")
def local_identity():
    if config.MODE != "local" or config.SERVICE_ROLE != "api":
        raise HTTPException(404)
    return {"token": secrets.token_urlsafe(32)}


@router.post("/api/v1/sessions")
def create_session(uid: Owner, store: Storage) -> PlantSnapshot:
    s = fresh(uid)
    store.create(s)
    return snapshot(s)


@router.get("/api/v1/sessions/{sid}")
def get_session(sid: str, uid: Owner, store: Storage) -> PlantSnapshot:
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/advance")
def tick(sid: str, uid: Owner, store: Storage, background: BackgroundTasks) -> PlantSnapshot:
    job = store.mutate(sid, uid, lambda s: advance(s))
    dispatch(store, job, background)
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/reset")
def reset(sid: str, uid: Owner, store: Storage) -> PlantSnapshot:
    def update(s):
        replacement = fresh(uid, sid, s["quotas"])
        s.clear()
        s.update(replacement)

    store.mutate(sid, uid, update)
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/scenarios")
def scenario(sid: str, request: ScenarioRequest, uid: Owner, store: Storage) -> PlantSnapshot:
    store.mutate(sid, uid, lambda s: start_scenario(s, request.scenario))
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/replay")
def replay(
    sid: str, request: ReplayRequest, uid: Owner, store: Storage, background: BackgroundTasks
) -> PlantSnapshot:
    def update(s):
        if request.action == "step":
            return advance(s, step=True)
        s["running"] = request.action == "play"
        s["last_tick"] = time.time()

    job = store.mutate(sid, uid, update)
    dispatch(store, job, background)
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/investigation/retry")
def retry(
    sid: str,
    uid: Owner,
    store: Storage,
    background: BackgroundTasks,
    expected_incident: ExpectedIncident = None,
) -> PlantSnapshot:
    def update(s):
        i = require_incident(s, {"investigation_failed"})
        if i["attempts"] >= 2:
            raise HTTPException(409, "Retry allowance exhausted; collected evidence remains available")
        i["state"] = "detected"
        i["queued_at"] = time.time()
        return {"session_id": sid, "owner": uid, "generation": s["generation"], "incident_id": i["id"]}

    dispatch(store, store.mutate(sid, uid, guard_incident(expected_incident, update)), background)
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/calculate")
def recalculate(
    sid: str,
    request: CalculationRequest,
    uid: Owner,
    store: Storage,
    expected_incident: ExpectedIncident = None,
) -> PlantSnapshot:
    persist_decision_transition(
        store, sid, uid, expected_incident, lambda s: recalculate_decision(s, request)
    )
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/approve")
def approval(
    sid: str,
    request: ApprovalRequest,
    uid: Owner,
    store: Storage,
    idempotency_key: Annotated[str, Header(min_length=8, max_length=100)],
    expected_incident: ExpectedIncident = None,
) -> WorkOrder:
    return persist_decision_transition(
        store, sid, uid, expected_incident, lambda s: approve(s, request, idempotency_key)
    )


@router.post("/api/v1/sessions/{sid}/reject")
def reject(sid: str, uid: Owner, store: Storage, expected_incident: ExpectedIncident = None) -> PlantSnapshot:
    def update(s):
        i = require_incident(s, {"awaiting_approval"})
        i["rejected_at"] = now()
        i["state"] = "proposal_rejected"
        event(s, "Human rejected proposed intervention; no work order created")

    store.mutate(sid, uid, guard_incident(expected_incident, update))
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/reopen")
def reopen(sid: str, uid: Owner, store: Storage, expected_incident: ExpectedIncident = None) -> PlantSnapshot:
    def update(s):
        i = require_incident(s, {"proposal_rejected"})
        i["state"] = "awaiting_approval"
        event(s, "Rejected proposal reopened for review")

    store.mutate(sid, uid, guard_incident(expected_incident, update))
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/repair/start")
def begin_repair(
    sid: str, uid: Owner, store: Storage, expected_incident: ExpectedIncident = None
) -> PlantSnapshot:
    persist_decision_transition(store, sid, uid, expected_incident, start_repair)
    return snapshot(store.read(sid, uid))


@router.post("/api/v1/sessions/{sid}/repair/complete")
def complete_repair(
    sid: str, request: RepairRequest, uid: Owner, store: Storage, expected_incident: ExpectedIncident = None
) -> PlantSnapshot:
    store.mutate(sid, uid, guard_incident(expected_incident, lambda s: finish_repair(s, request)))
    return snapshot(store.read(sid, uid))


@router.get("/api/v1/sessions/{sid}/memory")
def memory(sid: str, uid: Owner, store: Storage) -> MemoryResponse:
    return {"cases": store.read(sid, uid)["memory"]}


@router.post("/api/v1/sessions/{sid}/questions")
async def question(sid: str, request: QuestionRequest, uid: Owner, store: Storage) -> QuestionResponse:
    return await answer_question(store, sid, uid, request.question)


@router.get("/api/v1/sessions/{sid}/incidents/{incident_id}")
def read_incident(sid: str, incident_id: str, uid: Owner, store: Storage) -> RuntimeIncident:
    session = store.read(sid, uid)
    for incident in [session["incident"], *session.get("incidents", [])]:
        if incident and incident["id"] == incident_id:
            return incident
    raise HTTPException(404, "Incident not found")


@router.post("/api/v1/sessions/{sid}/repair/reopen")
def continue_repair(
    sid: str, uid: Owner, store: Storage, expected_incident: ExpectedIncident = None
) -> PlantSnapshot:
    store.mutate(sid, uid, guard_incident(expected_incident, reopen_repair))
    return snapshot(store.read(sid, uid))
