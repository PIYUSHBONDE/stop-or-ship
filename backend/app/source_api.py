"""Authenticated source and bounded import HTTP interfaces."""

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query

from . import source_imports, sources
from .dependencies import Storage
from .dispatch import dispatch
from .monitoring_api import CommandKey
from .source_models import (
    ImportPreview,
    ImportRequest,
    IngestionResult,
    ObservationBatch,
    SourceConfiguration,
    SourceView,
)
from .staff_access import authorize
from .workspace_api import StaffToken, check_origin

router = APIRouter(prefix="/api/v1/plants/{plant_id}/sources", dependencies=[Depends(check_origin)])


@router.get("", response_model=list[SourceView])
def read(plant_id: str, store: Storage, token: StaffToken = None):
    return sources.read(store, token, plant_id)


@router.post("", response_model=SourceView)
def create(plant_id: str, body: SourceConfiguration, store: Storage, token: StaffToken = None):
    return sources.configure(store, token, plant_id, body)


@router.post("/{source_id}", response_model=SourceView)
def configure(
    plant_id: str, source_id: str, body: SourceConfiguration, store: Storage, token: StaffToken = None
):
    return sources.configure(store, token, plant_id, body, source_id)


@router.get("/{source_id}/records")
def records(
    plant_id: str,
    source_id: str,
    store: Storage,
    before: int | None = Query(default=None, ge=1, le=2**63 - 1),
    limit: int = Query(default=10, ge=1, le=10),
    token: StaffToken = None,
):
    import json

    with store.connection() as db:
        authorize(db, token, plant_id)
        sources.source_record(db, plant_id, source_id)
        rows = db.execute(
            "SELECT rowid,data,checksum,received_at FROM telemetry_records WHERE source_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?",
            (source_id, before if before is not None else 2**63 - 1, limit + 1),
        ).fetchall()
        return dict(
            items=[dict(id=r[0], **json.loads(r[1]), checksum=r[2], received_at=r[3]) for r in rows[:limit]],
            next_cursor=rows[limit - 1][0] if len(rows) > limit else None,
        )


@router.post("/{source_id}/observations", response_model=IngestionResult)
def observations(
    plant_id: str,
    source_id: str,
    body: ObservationBatch,
    tasks: BackgroundTasks,
    store: Storage,
    key: CommandKey,
    token: StaffToken = None,
):
    # This interface represents submitted operational observations, not a live hardware connector.
    with store.connection() as db:
        authorize(db, token, plant_id, "plant.manage")
        if sources.source_record(db, plant_id, source_id)["configuration"]["kind"] != "operational":
            raise HTTPException(422, "Historical sources use the import preview/commit interfaces")
    result, jobs = sources.ingest(store, token, plant_id, source_id, body.expected_version, body.windows, key)
    for job in jobs:
        dispatch(store, job, tasks)
    return result


@router.post("/{source_id}/imports/preview", response_model=ImportPreview)
def preview(plant_id: str, source_id: str, body: ImportRequest, store: Storage, token: StaffToken = None):
    return source_imports.preview(store, token, plant_id, source_id, body)


@router.post("/{source_id}/imports/commit", response_model=IngestionResult)
def commit(
    plant_id: str,
    source_id: str,
    body: ImportRequest,
    tasks: BackgroundTasks,
    store: Storage,
    key: CommandKey,
    token: StaffToken = None,
):
    if not body.preview_checksum:
        raise HTTPException(422, "Preview checksum is required before committing an import")
    checked = source_imports.preview(store, token, plant_id, source_id, body)
    result, jobs = sources.ingest(
        store,
        token,
        plant_id,
        source_id,
        body.expected_version,
        checked["windows"],
        key,
        body.preview_checksum,
    )
    for job in jobs:
        dispatch(store, job, tasks)
    return result
