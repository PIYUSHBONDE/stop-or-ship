"""Durable case-job delivery. The database owns identity; Cloud Tasks only delivers."""

import json
import logging
import time

from app.core import config


def enqueue_due(store):
    if config.MODE != "cloud" or not config.CASES_ENABLED:
        return 0
    if not config.WORKER_URL or not config.TASK_ACCOUNT:
        raise RuntimeError("Private worker delivery is not configured")
    from google.api_core.exceptions import AlreadyExists
    from google.cloud import tasks_v2
    from google.protobuf.duration_pb2 import Duration

    stamp = time.time()
    with store.connection() as db:
        due = db.execute(
            "SELECT id,attempts FROM issue_jobs WHERE (state='queued' AND available_at<=?) "
            "OR (state='running' AND lease_until<=?) ORDER BY available_at,id LIMIT 100",
            (stamp, stamp),
        ).fetchall()
    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(config.PROJECT, config.TASK_REGION, config.TASK_QUEUE)
    count = 0
    for job_id, attempts in due:
        # A later reconciliation window can recover a lost/exhausted delivery.
        # The stable database job ID and lease still fence every state transition.
        name = client.task_path(
            config.PROJECT,
            config.TASK_REGION,
            config.TASK_QUEUE,
            f"case-{job_id}-a{attempts}-r{int(stamp // 300)}",
        )
        task = {
            "name": name,
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": config.WORKER_URL + "/internal/cases/process",
                "headers": {"Content-Type": "application/json"},
                "body": json.dumps({"job_id": job_id}).encode(),
                "oidc_token": {"service_account_email": config.TASK_ACCOUNT, "audience": config.WORKER_URL},
            },
            "dispatch_deadline": Duration(seconds=600),
        }
        try:
            client.create_task(parent=parent, task=task, timeout=5, retry=None)
            count += 1
        except AlreadyExists:
            continue
    return count


def wake(store):
    try:
        enqueue_due(store)
    except Exception as error:
        # Durable jobs remain queued for the authenticated scheduler reconciliation.
        logging.getLogger(__name__).warning("case_dispatch_pending error_type=%s", type(error).__name__)
