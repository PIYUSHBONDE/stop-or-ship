"""Shared plant HTTP layer. Authorization is rechecked inside workflow writes."""

import time
from typing import Annotated

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Cookie,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
)

from app.api.dependencies import Storage
from app.contracts.models import ApprovalRequest, CalculationRequest, RepairRequest, ReplayRequest, WorkOrder
from app.contracts.sources import OperationalRepair
from app.contracts.workspace import (
    AcceptInvitation,
    AccessState,
    AuditPage,
    Credentials,
    InvitationReceipt,
    InviteRequest,
    Member,
    MembershipUpdate,
    SetupRequest,
    SharedPlantSnapshot,
    WorkspaceApproval,
    WorkspaceSourceRequest,
)
from app.core import config
from app.identity import staff_access
from app.identity.staff_security import COOKIE, SESSION_SECONDS
from app.incidents.engine import advance, approve, event, guard_incident, require_incident
from app.incidents.workflow import (
    finish_repair,
    persist_decision_transition,
    recalculate_decision,
    reopen_repair,
    start_repair,
)
from app.persistence import workspace_store
from app.plant import catalog as workspace_catalog
from app.plant.configuration import (
    ConfigurationUpdate,
    ConfigurationView,
    PlantConfiguration,
    TemplateRequest,
    hydraulic_template,
)
from app.runtime.dispatch import dispatch


def check_origin(request: Request):
    origin = request.headers.get("origin")
    if request.method != "GET" and origin and origin not in config.STAFF_WEB_ORIGINS:
        raise HTTPException(403, "Cross-origin staff requests are not allowed")


router = APIRouter(dependencies=[Depends(check_origin)])
StaffToken = Annotated[str | None, Cookie(alias=COOKIE)]
IncidentHeader = Annotated[str, Header(alias="X-Incident-ID", pattern=r"^[a-f0-9-]{36}$")]
OptionalIncident = Annotated[str | None, Header(alias="X-Incident-ID", pattern=r"^[a-f0-9-]{36}$")]


def set_session(response, request, token):
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=config.MODE == "cloud" or request.url.scheme == "https",
        samesite="strict",
        path="/",
    )


@router.get("/api/v1/access/state")
def access(store: Storage, token: StaffToken = None) -> AccessState:
    return staff_access.access_state(store, token)


@router.post("/api/v1/access/setup")
def setup(body: SetupRequest, request: Request, response: Response, store: Storage) -> AccessState:
    token = staff_access.setup(store, body)
    set_session(response, request, token)
    return staff_access.access_state(store, token)


@router.post("/api/v1/access/sign-in")
def sign_in(body: Credentials, request: Request, response: Response, store: Storage) -> AccessState:
    token = staff_access.sign_in(store, body)
    set_session(response, request, token)
    return staff_access.access_state(store, token)


@router.post("/api/v1/access/sign-out")
def sign_out(response: Response, store: Storage, token: StaffToken = None):
    staff_access.sign_out(store, token)
    response.delete_cookie(COOKIE, httponly=True, samesite="strict", path="/")
    return {"status": "signed_out"}


@router.post("/api/v1/access/accept-invitation")
def accept_invitation(
    body: AcceptInvitation, request: Request, response: Response, store: Storage, token: StaffToken = None
) -> AccessState:
    new_token = staff_access.accept_invitation(store, token, body)
    set_session(response, request, new_token)
    return staff_access.access_state(store, new_token)


@router.post("/api/v1/plants/{plant_id}/invitations")
def invite(plant_id: str, body: InviteRequest, store: Storage, token: StaffToken = None) -> InvitationReceipt:
    return staff_access.invite(store, token, plant_id, body)


@router.get("/api/v1/plants/{plant_id}/members")
def members(plant_id: str, store: Storage, token: StaffToken = None) -> list[Member]:
    return staff_access.members(store, token, plant_id)


@router.post("/api/v1/plants/{plant_id}/members/{user_id}")
def update_member(
    plant_id: str, user_id: str, body: MembershipUpdate, store: Storage, token: StaffToken = None
) -> AccessState:
    staff_access.update_member(store, token, plant_id, user_id, body)
    return staff_access.access_state(store, token)


@router.get("/api/v1/plants/{plant_id}/snapshot")
def snapshot(
    plant_id: str, store: Storage, incident: str | None = None, token: StaffToken = None
) -> SharedPlantSnapshot:
    return workspace_store.plant_snapshot(store, token, plant_id, incident)


@router.get("/api/v1/plants/{plant_id}/audit")
def audit(
    plant_id: str,
    store: Storage,
    cursor: Annotated[int | None, Query(ge=1)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    token: StaffToken = None,
) -> AuditPage:
    return workspace_store.audit_page(store, token, plant_id, cursor, limit)


@router.post("/api/v1/plants/{plant_id}/scenarios")
def source(
    plant_id: str, body: WorkspaceSourceRequest, store: Storage, token: StaffToken = None
) -> SharedPlantSnapshot:
    if not config.INTERNAL_TEST_MODE:
        raise HTTPException(404, "Scenario endpoints are disabled in the product")
    workspace_store.start_source(store, token, plant_id, body.scenario, body.asset_id)
    return workspace_store.plant_snapshot(store, token, plant_id)


@router.get("/api/v1/plants/{plant_id}/configuration")
def configuration(plant_id: str, store: Storage, token: StaffToken = None) -> ConfigurationView:
    return workspace_catalog.read_configuration(store, token, plant_id)


@router.post("/api/v1/plants/{plant_id}/configuration/template")
def template(
    plant_id: str, body: TemplateRequest, store: Storage, token: StaffToken = None
) -> PlantConfiguration:
    workspace_catalog.read_configuration(store, token, plant_id)
    return hydraulic_template(body.lines, body.name)


@router.post("/api/v1/plants/{plant_id}/configuration")
def update_configuration(
    plant_id: str, body: ConfigurationUpdate, store: Storage, token: StaffToken = None
) -> ConfigurationView:
    return workspace_catalog.activate_configuration(store, token, plant_id, body)


@router.post("/api/v1/plants/{plant_id}/configuration/validate")
def validate_configuration(
    plant_id: str, body: PlantConfiguration, store: Storage, token: StaffToken = None
) -> PlantConfiguration:
    workspace_catalog.read_configuration(store, token, plant_id)
    return body


@router.post("/api/v1/plants/{plant_id}/replay")
def replay(
    plant_id: str,
    body: ReplayRequest,
    store: Storage,
    background: BackgroundTasks,
    token: StaffToken = None,
    incident: OptionalIncident = None,
) -> SharedPlantSnapshot:
    if not config.INTERNAL_TEST_MODE:
        raise HTTPException(404, "Replay endpoints are disabled in the product")
    workflow, _ = workspace_store.workflow_for(store, token, plant_id, incident, "plant.manage")

    def transition(state):
        if state.get("_monitoring"):
            raise HTTPException(409, "Use the shared plant clock in Monitoring")
        if state["incident"] and state["incident"]["state"] == "resolved":
            raise HTTPException(
                409, "This diagnostic replay is complete; start a new source or verified recurrence"
            )
        if body.action == "step":
            return advance(state, step=True)
        state.update(running=body.action == "play", last_tick=time.time())
        event(state, "Replay " + body.action + " requested by staff")

    job = store.mutate(
        workflow,
        workspace_store.internal_owner(plant_id),
        guard_incident(incident, transition),
        token=token,
        permission="plant.manage",
        action="source." + body.action,
    )
    dispatch(store, job, background)
    return workspace_store.plant_snapshot(store, token, plant_id, incident)


@router.post("/api/v1/plants/{plant_id}/calculate")
def calculate(
    plant_id: str,
    body: CalculationRequest,
    store: Storage,
    incident: IncidentHeader,
    token: StaffToken = None,
) -> SharedPlantSnapshot:
    workflow, _ = workspace_store.workflow_for(store, token, plant_id, incident, "incident.review")
    persist_decision_transition(
        store,
        workflow,
        workspace_store.internal_owner(plant_id),
        incident,
        lambda state: recalculate_decision(state, body),
        token=token,
        permission="incident.review",
        action="decision.recalculated",
    )
    return workspace_store.plant_snapshot(store, token, plant_id, incident)


@router.post("/api/v1/plants/{plant_id}/approve")
def approval(
    plant_id: str,
    body: WorkspaceApproval,
    store: Storage,
    incident: IncidentHeader,
    idempotency_key: Annotated[str, Header(min_length=8, max_length=100)],
    token: StaffToken = None,
) -> WorkOrder:
    workflow, _ = workspace_store.workflow_for(store, token, plant_id, incident, "incident.approve")

    def transition(state):
        actor = state["_actor"]
        request = ApprovalRequest(**body.model_dump(), approver=actor["display_name"])
        return approve(state, request, actor["id"] + ":" + idempotency_key)

    return persist_decision_transition(
        store,
        workflow,
        workspace_store.internal_owner(plant_id),
        incident,
        transition,
        token=token,
        permission="incident.approve",
        action="decision.approved",
    )


def change_state(store, token, plant_id, incident, action, operation, permission):
    workflow, _ = workspace_store.workflow_for(store, token, plant_id, incident, permission)
    persist_decision_transition(
        store,
        workflow,
        workspace_store.internal_owner(plant_id),
        incident,
        operation,
        token=token,
        permission=permission,
        action=action,
    )
    return workspace_store.plant_snapshot(store, token, plant_id, incident)


@router.post("/api/v1/plants/{plant_id}/reject")
def reject(
    plant_id: str, store: Storage, incident: IncidentHeader, token: StaffToken = None
) -> SharedPlantSnapshot:
    def transition(state):
        require_incident(state, {"awaiting_approval"}).update(state="proposal_rejected")
        event(state, "Proposal rejected by authenticated staff")

    return change_state(store, token, plant_id, incident, "decision.rejected", transition, "incident.approve")


@router.post("/api/v1/plants/{plant_id}/reopen")
def reopen(
    plant_id: str, store: Storage, incident: IncidentHeader, token: StaffToken = None
) -> SharedPlantSnapshot:
    def transition(state):
        require_incident(state, {"proposal_rejected"}).update(state="awaiting_approval")
        event(state, "Rejected proposal reopened by authenticated staff")

    return change_state(store, token, plant_id, incident, "decision.reopened", transition, "incident.approve")


@router.post("/api/v1/plants/{plant_id}/repair/start")
def begin_repair(
    plant_id: str, store: Storage, incident: IncidentHeader, token: StaffToken = None
) -> SharedPlantSnapshot:
    return change_state(store, token, plant_id, incident, "repair.started", start_repair, "repair.write")


@router.post("/api/v1/plants/{plant_id}/repair/complete")
def complete_repair(
    plant_id: str,
    body: OperationalRepair | RepairRequest,
    store: Storage,
    incident: IncidentHeader,
    token: StaffToken = None,
) -> SharedPlantSnapshot:
    if not config.INTERNAL_TEST_MODE and isinstance(body, RepairRequest):
        raise HTTPException(422, "Recovery cannot be selected; verification requires incoming observations")
    return change_state(
        store,
        token,
        plant_id,
        incident,
        "repair.completed",
        lambda state: finish_repair(state, body),
        "repair.write",
    )


@router.post("/api/v1/plants/{plant_id}/repair/reopen")
def continue_repair(
    plant_id: str, store: Storage, incident: IncidentHeader, token: StaffToken = None
) -> SharedPlantSnapshot:
    return change_state(store, token, plant_id, incident, "repair.reopened", reopen_repair, "repair.write")


@router.post("/api/v1/plants/{plant_id}/investigation/retry")
def retry(
    plant_id: str,
    store: Storage,
    background: BackgroundTasks,
    incident: IncidentHeader,
    token: StaffToken = None,
) -> SharedPlantSnapshot:
    workflow, _ = workspace_store.workflow_for(store, token, plant_id, incident, "incident.review")

    def transition(state):
        current = require_incident(state, {"investigation_failed"})
        if current["attempts"] >= 2:
            raise HTTPException(409, "Retry allowance exhausted; inspect collected evidence")
        current.update(state="detected", queued_at=time.time())
        event(state, "Investigation retry requested by staff")
        return {
            "session_id": workflow,
            "owner": state["owner"],
            "generation": state["generation"],
            "incident_id": incident,
        }

    job = store.mutate(
        workflow,
        workspace_store.internal_owner(plant_id),
        guard_incident(incident, transition),
        token=token,
        permission="incident.review",
        action="investigation.retried",
    )
    dispatch(store, job, background)
    return workspace_store.plant_snapshot(store, token, plant_id, incident)
