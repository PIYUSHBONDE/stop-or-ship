"""Private cloud delivery retains database identity, leases and release boundaries."""

import json
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.api_core.exceptions import AlreadyExists

from app.cases import jobs
from app.core import config
from app.main import create_app
from app.persistence.store import create_store
from app.runtime.case_dispatch import enqueue_due
from tests.integration.test_case_foundation import create, enable, post


def queued_cases(shared):
    store, _, admin, plant, _ = shared
    cases = [create(admin, plant) for _ in range(2)]
    enable(admin, plant)
    identities = []
    for case in cases:
        result = post(admin, plant, f"/cases/{case['id']}/analysis", {"expected_revision": case["revision"]})
        assert result.status_code == 200, result.text
        with store.connection() as db:
            identities.append(
                db.execute("SELECT id FROM issue_jobs WHERE case_id=?", (case["id"],)).fetchone()[0]
            )
    return store, identities


def test_targeted_claim_duplicate_and_expired_delivery(shared):
    store, identities = queued_cases(shared)
    claimed = jobs.claim(store, identities[1])
    assert claimed["id"] == identities[1]
    assert jobs.claim(store, identities[1]) is None
    with store.connection() as db:
        assert db.execute("SELECT state FROM issue_jobs WHERE id=?", (identities[0],)).fetchone() == (
            "queued",
        )
        db.execute("UPDATE issue_jobs SET lease_until=0 WHERE id=?", (identities[1],))
    reclaimed = jobs.claim(store, identities[1])
    assert reclaimed["lease_token"] != claimed["lease_token"]
    with store.connection() as db, pytest.raises(HTTPException) as error:
        jobs.validate(db, claimed["id"], claimed["lease_token"])
    assert error.value.status_code == 409


def test_queue_identity_and_reconciliation_window(shared, monkeypatch):
    from google.cloud import tasks_v2

    store, identities = queued_cases(shared)
    monkeypatch.setattr(config, "MODE", "cloud")
    monkeypatch.setattr(config, "WORKER_URL", "https://private-worker.example")
    monkeypatch.setattr(config, "TASK_ACCOUNT", "delivery@example.iam.gserviceaccount.com")
    monkeypatch.setattr(config, "PROJECT", "isolated-fixture")
    captured = []
    seen = set()

    class Client:
        queue_path = staticmethod(lambda *values: "/".join(values))
        task_path = staticmethod(lambda *values: "/".join(values))

        def create_task(self, *, parent, task, timeout, retry):
            assert timeout == 5 and retry is None
            if task["name"] in seen:
                raise AlreadyExists("Duplicate delivery")
            seen.add(task["name"])
            captured.append(task)

    monkeypatch.setattr(tasks_v2, "CloudTasksClient", Client)
    monkeypatch.setattr("app.runtime.case_dispatch.time.time", lambda: 1800000000)
    assert enqueue_due(store) == 2
    assert enqueue_due(store) == 0
    assert {json.loads(task["http_request"]["body"])["job_id"] for task in captured} == set(identities)
    assert all(task["http_request"]["oidc_token"]["audience"] == config.WORKER_URL for task in captured)
    monkeypatch.setattr("app.runtime.case_dispatch.time.time", lambda: 1800000300)
    assert enqueue_due(store) == 2
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM issue_jobs").fetchone() == (2,)


def test_private_routes_and_queued_response(shared, monkeypatch):
    store, identities = queued_cases(shared)
    with TestClient(create_app(store, shared_runtime=False)) as client:
        assert client.post("/internal/cases/process", json={"job_id": identities[0]}).status_code == 404
    monkeypatch.setattr(config, "MODE", "cloud")
    monkeypatch.setattr(config, "SERVICE_ROLE", "worker")
    monkeypatch.setattr("app.api.worker.run_once", AsyncMock(return_value=False))
    with TestClient(create_app(store, shared_runtime=False)) as client:
        assert "/internal/cases/process" not in client.get("/openapi.json").json()["paths"]
        assert client.post("/internal/cases/process", json={"job_id": identities[0]}).status_code == 409
        assert client.post("/internal/cases/process", json={"job_id": "not-a-job"}).status_code == 422
        with store.connection() as db:
            db.execute("UPDATE issue_jobs SET state='completed' WHERE id=?", (identities[0],))
        assert client.post("/internal/cases/process", json={"job_id": identities[0]}).json() == {
            "status": "already_handled"
        }


def test_cloud_store_rejects_sqlite_and_missing_readonly_identity(monkeypatch):
    monkeypatch.setattr(config, "MODE", "cloud")
    monkeypatch.setattr(config, "STORAGE", "sqlite")
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        create_store()
    monkeypatch.setattr(config, "STORAGE", "postgres")
    monkeypatch.setattr(config, "POSTGRES_EVIDENCE_DSN", "")
    with pytest.raises(RuntimeError, match="evidence"):
        create_store()
