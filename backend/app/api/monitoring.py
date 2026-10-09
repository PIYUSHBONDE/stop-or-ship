"""Staff-only HTTP contracts for plant monitoring."""

from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException

from app.api.dependencies import Storage
from app.api.workspace import StaffToken, check_origin
from app.contracts.monitoring import MonitoringControl, MonitoringUpdate, MonitoringView
from app.core import config
from app.runtime.dispatch import dispatch
from app.telemetry import legacy_monitoring as monitoring


def internal_only():
    if not config.INTERNAL_TEST_MODE:
        raise HTTPException(404, "Replay monitoring is disabled in the product")


router = APIRouter(dependencies=[Depends(check_origin), Depends(internal_only)])
CommandKey = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=100)]


@router.get("/api/v1/plants/{plant_id}/monitoring", response_model=MonitoringView)
def read(plant_id: str, store: Storage, token: StaffToken = None):
    return monitoring.read(store, token, plant_id)


@router.post("/api/v1/plants/{plant_id}/monitoring", response_model=MonitoringView)
def configure(plant_id: str, body: MonitoringUpdate, store: Storage, token: StaffToken = None):
    return monitoring.configure(store, token, plant_id, body)


@router.post("/api/v1/plants/{plant_id}/monitoring/clock", response_model=MonitoringView)
def control(
    plant_id: str,
    body: MonitoringControl,
    tasks: BackgroundTasks,
    store: Storage,
    key: CommandKey,
    token: StaffToken = None,
):
    result, jobs = monitoring.control(store, token, plant_id, body, key)
    for job in jobs:
        dispatch(store, job, tasks)
    return result
