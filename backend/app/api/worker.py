"""Private Cloud Run endpoints; IAM validates invokers before application routing."""

import time
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from app.api.dependencies import Storage
from app.cases import jobs
from app.cases.worker import run_once
from app.runtime.case_dispatch import enqueue_due

router = APIRouter(prefix="/internal/cases", include_in_schema=False)


class Delivery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    job_id: UUID


@router.post("/process")
async def process(delivery: Delivery, store: Storage):
    identity = str(delivery.job_id)
    worked = await run_once(store, job_id=identity)
    with store.connection() as db:
        row = db.execute("SELECT state,lease_until FROM issue_jobs WHERE id=?", (identity,)).fetchone()
    if row and row[0] in {"queued", "running"} and not worked:
        raise HTTPException(409, "Job is queued or owned by an active lease")
    return {"status": "processed" if worked else "already_handled"}


@router.post("/reconcile")
def reconcile(store: Storage):
    jobs.escalate_overdue(store)
    return {"queued": enqueue_due(store), "checked_at": int(time.time())}
