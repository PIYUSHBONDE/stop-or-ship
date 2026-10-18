"""Thin authenticated transport for case coordination."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Query, Request

from app import notifications
from app.api.dependencies import Storage
from app.api.workspace import StaffToken, check_origin
from app.cases import service
from app.contracts.cases import (
    AutomationPolicy,
    CaseCancel,
    CaseCreate,
    CaseDetail,
    CaseLink,
    CaseMutation,
    CaseOutcome,
    CasePage,
    CaseView,
    HumanTask,
    PolicyUpdate,
    TaskAssignment,
    TaskCreate,
    TaskPage,
    TaskResponse,
)
from app.contracts.notifications import NotificationAcknowledgement, NotificationPage, NotificationRead
from app.core import config
from app.identity.staff_access import authorize


def require_enabled():
    if not config.CASES_ENABLED:
        raise HTTPException(404, "Case coordination is disabled; retained records are preserved")


def wake_jobs(request: Request, background: BackgroundTasks, store: Storage):
    if config.MODE == "cloud" and request.method == "POST" and "/notifications/" not in request.url.path:
        from app.runtime.case_dispatch import wake

        background.add_task(wake, store)


router = APIRouter(
    prefix="/api/v1/plants/{plant_id}",
    dependencies=[Depends(check_origin), Depends(require_enabled), Depends(wake_jobs)],
)
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=100)]
Cursor = Annotated[int, Query(ge=0, le=100000)]
Limit = Annotated[int, Query(ge=1, le=50)]


@router.get("/notifications", response_model=NotificationPage)
def notification_feed(
    plant_id: str,
    token: StaffToken,
    store: Storage,
    cursor: Cursor = 0,
    limit: Limit = 25,
    unread_only: bool = False,
):
    return notifications.list_notifications(store, token, plant_id, cursor, limit, unread_only)


@router.post("/notifications/read", response_model=NotificationAcknowledgement)
def read_notification(plant_id: str, body: NotificationRead, token: StaffToken, store: Storage, key: Key):
    return notifications.acknowledge(store, token, plant_id, body, key)


@router.get("/cases", response_model=CasePage)
def list_cases(plant_id: str, token: StaffToken, store: Storage, cursor: Cursor = 0, limit: Limit = 25):
    return service.list_cases(store, token, plant_id, cursor, limit)


@router.post("/cases", response_model=CaseView)
def create_case(plant_id: str, body: CaseCreate, token: StaffToken, store: Storage, key: Key):
    return service.create_case(store, token, plant_id, body, key)


@router.get("/cases/{case_id}", response_model=CaseDetail)
def case_detail(plant_id: str, case_id: str, token: StaffToken, store: Storage):
    return service.get_detail(store, token, plant_id, case_id)


@router.post("/cases/{case_id}/tasks", response_model=HumanTask)
def request_task(plant_id: str, case_id: str, body: TaskCreate, token: StaffToken, store: Storage, key: Key):
    return service.request_task(store, token, plant_id, case_id, body, key)


@router.get("/tasks", response_model=TaskPage)
def tasks(
    plant_id: str,
    token: StaffToken,
    store: Storage,
    cursor: Cursor = 0,
    limit: Limit = 25,
    assignment: TaskAssignment = "all",
):
    return service.list_tasks(store, token, plant_id, cursor, limit, assignment)


@router.post("/tasks/{task_id}/claim", response_model=HumanTask)
def claim_task(plant_id: str, task_id: str, body: CaseMutation, token: StaffToken, store: Storage, key: Key):
    return service.task_action(store, token, plant_id, task_id, body, key)


@router.post("/tasks/{task_id}/respond", response_model=HumanTask)
def respond_task(
    plant_id: str, task_id: str, body: TaskResponse, token: StaffToken, store: Storage, key: Key
):
    return service.task_action(store, token, plant_id, task_id, body, key, respond=True)


@router.post("/cases/{case_id}/resolve", response_model=CaseView)
def resolve_case(plant_id: str, case_id: str, body: CaseOutcome, token: StaffToken, store: Storage, key: Key):
    return service.change_case(store, token, plant_id, case_id, body, key, "resolve")


@router.post("/cases/{case_id}/cancel", response_model=CaseView)
def cancel_case(plant_id: str, case_id: str, body: CaseCancel, token: StaffToken, store: Storage, key: Key):
    return service.change_case(store, token, plant_id, case_id, body, key, "cancel")


@router.post("/cases/{case_id}/link-incident", response_model=CaseView)
def link_case(plant_id: str, case_id: str, body: CaseLink, token: StaffToken, store: Storage, key: Key):
    return service.change_case(store, token, plant_id, case_id, body, key, "link")


@router.post("/cases/{case_id}/analysis", response_model=CaseView)
def retry_case(plant_id: str, case_id: str, body: CaseMutation, token: StaffToken, store: Storage, key: Key):
    return service.change_case(store, token, plant_id, case_id, body, key, "analysis")


@router.get("/automation-policy", response_model=AutomationPolicy)
def get_policy(plant_id: str, token: StaffToken, store: Storage):
    with store.connection() as db:
        authorize(db, token, plant_id)
        return service.policy(db, plant_id)


@router.post("/automation-policy", response_model=AutomationPolicy)
def set_policy(plant_id: str, body: PolicyUpdate, token: StaffToken, store: Storage, key: Key):
    return service.update_policy(store, token, plant_id, body, key)
