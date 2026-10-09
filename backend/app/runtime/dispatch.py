"""Dispatch investigations through local tasks or authenticated Cloud Tasks."""

import logging

from fastapi import HTTPException

from app.ai.agent import investigate
from app.core import config

log = logging.getLogger("plantsense.dispatch")


def dispatch(store, job, background):
    if not job:
        return
    if config.MODE == "local":

        async def run_local():
            try:
                await investigate(store, job)
            except Exception as exc:
                log.warning(
                    "local_investigation_failed",
                    extra={"incident_id": job["incident_id"], "error_type": type(exc).__name__},
                )

        background.add_task(run_local)
        return
    import json

    from google.cloud import tasks_v2
    from google.protobuf import duration_pb2

    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(config.PROJECT, config.TASK_REGION, config.TASK_QUEUE)
    task = {
        "http_request": {
            "http_method": tasks_v2.HttpMethod.POST,
            "url": config.WORKER_URL + "/internal/investigate",
            "headers": {"Content-Type": "application/json"},
            "body": json.dumps(job).encode(),
            "oidc_token": {"service_account_email": config.TASK_ACCOUNT, "audience": config.WORKER_URL},
        },
        "dispatch_deadline": duration_pb2.Duration(seconds=90),
    }
    try:
        client.create_task(parent=parent, task=task, timeout=10, retry=None)
    except Exception:

        def failed(s):
            if (
                s["generation"] == job["generation"]
                and s["incident"]
                and s["incident"]["id"] == job["incident_id"]
                and s["incident"]["state"] == "detected"
            ):
                s["incident"].update(
                    state="investigation_failed", error="Dispatch failed. Retry investigation."
                )

        store.mutate(job["session_id"], job["owner"], failed)
        raise HTTPException(503, "Investigation could not be queued") from None
