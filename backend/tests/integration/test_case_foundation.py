"""Durable human-loop coordination with isolated stores and explicit scripted providers."""

import asyncio
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient

from app.cases import jobs
from app.cases.worker import run_once
from app.identity.staff_access import issue_session
from app.persistence.store import Store
from app.plant.catalog import seed_catalog


def tenant(store):
    """Provision isolated fixture tenants without changing public enrollment policy."""
    organization, plant, user = (str(uuid.uuid4()) for _ in range(3))
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        password_hash = db.execute("SELECT password_hash FROM staff_users LIMIT 1").fetchone()[0]
        db.execute("INSERT INTO organizations VALUES (?,?)", (organization, "Fixture organization"))
        db.execute("INSERT INTO plants VALUES (?,?,?)", (plant, organization, "Fixture plant"))
        seed_catalog(db, plant)
        db.execute(
            "INSERT INTO staff_users VALUES (?,?,?,?,1)",
            (user, user + "@example.test", "Fixture admin", password_hash),
        )
        db.execute("INSERT INTO memberships VALUES (?,?,?,1)", (plant, user, "admin"))
        token = issue_session(db, user)
    return plant, user, token


def post(client, plant, path, data, key=None):
    return client.post(
        f"/api/v1/plants/{plant}" + path, json=data, headers={"Idempotency-Key": key or str(uuid.uuid4())}
    )


def create(client, plant, category="production", **extra):
    result = post(
        client,
        plant,
        "/cases",
        {
            "title": "Output below target",
            "description": "Line A output needs investigation",
            "category": category,
            "asset_id": "P-107",
            **extra,
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


def enable(client, plant, **extra):
    result = post(client, plant, "/automation-policy", {"expected_version": 0, "enabled": True, **extra})
    assert result.status_code == 200, result.text
    return result.json()


def detail(client, plant, identity):
    result = client.get(f"/api/v1/plants/{plant}/cases/{identity}")
    assert result.status_code == 200, result.text
    return result.json()


def test_production_case_survives_restart_requests_human_evidence_and_resolves(shared):
    store, _, admin, plant, _ = shared
    case = create(admin, plant)
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM issue_jobs").fetchone()[0] == 0
    enable(admin, plant)
    response = post(admin, plant, f"/cases/{case['id']}/analysis", {"expected_revision": case["revision"]})
    assert response.status_code == 200, response.text
    assert asyncio.run(run_once(store)) is True
    state = detail(admin, plant, case["id"])
    assert state["case"]["phase"] == "waiting_for_input", state
    assert len(state["runs"][0]["steps"]) == 5
    assert state["runs"][0]["provider"] == "scripted"
    task = state["tasks"][0]
    Store(store.path, cloud=False)
    key = str(uuid.uuid4())
    claim = post(admin, plant, f"/tasks/{task['id']}/claim", {"expected_revision": task["revision"]}, key)
    assert claim.status_code == 200, claim.text
    assert (
        post(admin, plant, f"/tasks/{task['id']}/claim", {"expected_revision": task["revision"]}, key).json()
        == claim.json()
    )
    answer = {
        "expected_revision": claim.json()["revision"],
        "text": "Actual output is 65 parts/hour; inspection is still required.",
        "values": [{"signal_id": "output", "value": 65, "unit": "parts/h"}],
    }
    key = str(uuid.uuid4())
    response = post(admin, plant, f"/tasks/{task['id']}/respond", answer, key)
    assert response.status_code == 200, response.text
    assert post(admin, plant, f"/tasks/{task['id']}/respond", answer, key).json() == response.json()
    assert asyncio.run(run_once(Store(store.path, cloud=False))) is True
    state = detail(admin, plant, case["id"])
    assert state["case"]["phase"] == "awaiting_decision", state
    assert len(state["runs"]) == 2
    assert all(t["state"] == "completed" for t in state["tasks"])
    submitted = next(e for e in state["evidence"] if e["origin"] == "technician_statement")
    outcome = post(
        admin,
        plant,
        f"/cases/{case['id']}/resolve",
        {
            "expected_revision": state["case"]["revision"],
            "outcome": "Manager reviewed recorded output and confirmed the planning issue is addressed.",
            "evidence_ids": [submitted["id"]],
        },
    )
    assert outcome.status_code == 200, outcome.text
    assert outcome.json()["phase"] == "resolved"
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM plant_cases").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM telemetry_records").fetchone()[0] == 0
        assert db.execute("SELECT count(*) FROM plant_orders").fetchone()[0] == 0
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE issue_evidence SET origin='sensor'")


def test_case_scope_permissions_and_immutable_receipts(shared):
    store, app, admin, plant, invite = shared
    viewer, _, _ = invite("viewer")
    assert (
        post(
            viewer,
            plant,
            "/cases",
            {"title": "Denied", "description": "Viewer report", "category": "general"},
        ).status_code
        == 403
    )
    tech, _, _ = invite("technician")
    assert (
        post(tech, plant, "/automation-policy", {"expected_version": 0, "enabled": True}).status_code == 403
    )
    with TestClient(app) as outsider:
        other_plant, _, token = tenant(store)
        outsider.cookies.set("plantsense_staff", token)
        case = create(admin, plant)
        assert outsider.get(f"/api/v1/plants/{plant}/cases/{case['id']}").status_code == 404
        assert outsider.get(f"/api/v1/plants/{other_plant}/cases/{case['id']}").status_code == 404
    key = str(uuid.uuid4())
    body = {"title": "Once", "description": "Original report", "category": "general"}
    first = post(admin, plant, "/cases", body, key)
    assert post(admin, plant, "/cases", body, key).json() == first.json()
    assert post(admin, plant, "/cases", {**body, "description": "Changed report"}, key).status_code == 409
    assert post(admin, plant, "/cases", {**body, "asset_id": "foreign-asset"}).status_code == 404
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM issue_cases").fetchone()[0] == 2


def test_task_ownership_equipment_resolution_and_policy_revocation(shared):
    store, _, admin, plant, invite = shared
    tech, _, _ = invite("technician")
    other, _, _ = invite("technician", "other-tech@example.test")
    case = create(admin, plant, "equipment")
    request = {
        "expected_revision": case["revision"],
        "question": "Read the existing gauge under the approved procedure",
        "reason": "Independent evidence needed",
        "completion_requirements": "Record measurement or unavailable",
        "target_role": "technician",
    }
    task = post(admin, plant, f"/cases/{case['id']}/tasks", request).json()
    assert (
        post(
            tech, plant, f"/tasks/{task['id']}/respond", {"expected_revision": 1, "text": "Not yet claimed"}
        ).status_code
        == 409
    )
    claim = post(tech, plant, f"/tasks/{task['id']}/claim", {"expected_revision": 1})
    assert claim.status_code == 200, claim.text
    assert post(other, plant, f"/tasks/{task['id']}/claim", {"expected_revision": 2}).status_code == 409
    state = detail(admin, plant, case["id"])
    assert (
        post(
            admin,
            plant,
            f"/cases/{case['id']}/resolve",
            {
                "expected_revision": state["case"]["revision"],
                "outcome": "Claimed fixed",
                "evidence_ids": [state["evidence"][0]["id"]],
            },
        ).status_code
        == 409
    )
    enable(admin, plant)
    state = detail(admin, plant, case["id"])
    assert (
        post(
            admin, plant, f"/cases/{case['id']}/analysis", {"expected_revision": state["case"]["revision"]}
        ).status_code
        == 200
    )
    job = jobs.claim(store)
    capability = jobs.mint_capability(store, job)
    with store.connection() as db:
        jobs.authorize_capability(db, capability)
    assert (
        post(admin, plant, "/automation-policy", {"expected_version": 1, "enabled": False}).status_code == 200
    )
    with store.connection() as db, pytest.raises(Exception):
        jobs.authorize_capability(db, capability)
    jobs.finish(store, job, "awaiting_decision")
    assert detail(admin, plant, case["id"])["runs"][0]["state"] == "blocked"
    assert detail(admin, plant, case["id"])["runs"][0]["error"] == "Execution authorization changed"
