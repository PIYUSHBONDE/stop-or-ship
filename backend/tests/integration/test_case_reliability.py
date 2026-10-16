"""Crash/retry fences, tenant retrieval, escalation and authoritative lifecycle linkage."""

import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.cases import jobs
from app.cases.agent import scripted
from app.cases.tools import read_tool
from app.cases.worker import process, run_once
from app.core import config
from app.persistence.store import Store
from tests.integration.test_case_foundation import create, detail, enable, post, tenant
from tests.support.telemetry import create as source_create
from tests.support.telemetry import submit, window
from tests.support.workspace import approval


def test_restart_reuses_completed_stages_and_fences_stale_worker(shared):
    store, _, admin, plant, _ = shared
    enable(admin, plant)
    case = create(admin, plant)
    calls = []

    async def provider(stage, payload):
        calls.append(stage)
        if stage == "reviewer" and calls.count(stage) == 1:
            raise TimeoutError("Authored provider outage")
        return scripted(stage, payload["sources"])

    asyncio.run(run_once(store, provider=provider))
    state = detail(admin, plant, case["id"])
    assert state["case"]["phase"] == "blocked"
    assert {s["stage"] for s in state["runs"][0]["steps"]} == {"context", "investigator"}
    assert (
        post(
            admin, plant, f"/cases/{case['id']}/analysis", {"expected_revision": state["case"]["revision"]}
        ).status_code
        == 200
    )
    stale = jobs.claim(store)
    with store.connection() as db:
        db.execute("UPDATE issue_jobs SET lease_until=0,attempts=1 WHERE id=?", (stale["id"],))
    fresh = jobs.claim(store)
    assert fresh["id"] == stale["id"] and fresh["lease_token"] != stale["lease_token"]
    with pytest.raises(HTTPException):
        jobs.step(store, stale, "Production", "old", {"summary": "stale"})
    jobs.finish(store, stale, "awaiting_decision")
    with store.connection() as db:
        assert (
            db.execute("SELECT state FROM issue_runs WHERE id=?", (fresh["run_id"],)).fetchone()[0]
            == "running"
        )
    asyncio.run(process(store, fresh, provider=provider))
    assert calls.count("investigator") == 1 and calls.count("reviewer") == 2
    assert detail(admin, plant, case["id"])["case"]["phase"] == "waiting_for_input"


def test_private_retrieval_and_revocation_are_checked_on_every_call(shared):
    store, app, admin, plant, _ = shared
    enable(admin, plant)
    case = create(admin, plant, description="First tenant report")
    other_plant, other_user, token = tenant(store)
    with TestClient(app) as other:
        other.cookies.set("plantsense_staff", token)
        enable(other, other_plant)
        foreign = create(other, other_plant, description="PRIVATE_OTHER_TENANT")
        with store.connection() as db:
            db.execute(
                "INSERT INTO plant_cases VALUES (?,?,?,?)",
                (
                    "private-repair",
                    other_plant,
                    datetime.now(timezone.utc).isoformat(),
                    json.dumps(
                        {
                            "record_origin": "plant_observation",
                            "asset_id": "P-107",
                            "observed_cause": "PRIVATE_OTHER_REPAIR",
                            "fix": "Fixture",
                            "outcome": "Fixture",
                        }
                    ),
                ),
            )
        first = jobs.claim(store)
        # Claim order is stable by ID, not assumed to match creation order.
        second = jobs.claim(store)
        selected = next(job for job in (first, second) if job["plant_id"] == plant)
        capability = jobs.mint_capability(store, selected)
        knowledge = read_tool(store.path, capability, "search_knowledge", "PRIVATE_OTHER_REPAIR")
        assert "PRIVATE_OTHER" not in json.dumps(knowledge)
        facts = read_tool(store.path, capability, "case_evidence")
        assert facts["case"]["id"] == case["id"] and "PRIVATE_OTHER_TENANT" not in json.dumps(facts)
        assert other.get(f"/api/v1/plants/{other_plant}/cases/{case['id']}").status_code == 404
        assert admin.get(f"/api/v1/plants/{plant}/cases/{foreign['id']}").status_code == 404
        with store.connection() as db:
            creator = db.execute(
                "SELECT initiated_by FROM issue_runs WHERE id=?", (selected["run_id"],)
            ).fetchone()[0]
            db.execute("UPDATE memberships SET active=0 WHERE user_id=? AND plant_id=?", (creator, plant))
        with pytest.raises(HTTPException):
            read_tool(store.path, capability, "equipment_context")
        with pytest.raises(HTTPException):
            jobs.step(store, selected, "Production", "revoked", {"summary": "Denied"})
        assert other_user != creator


def test_overdue_requests_escalate_once_and_missing_due_date_never_does(shared):
    store, _, admin, plant, invite = shared
    manager, _, _ = invite("manager")
    enable(admin, plant)
    case = create(admin, plant, "general")
    for index in range(5):
        current = detail(admin, plant, case["id"])["case"]
        response = post(
            admin,
            plant,
            f"/cases/{case['id']}/tasks",
            {
                "expected_revision": current["revision"],
                "question": "Check recorded evidence " + str(index),
                "reason": "Human input needed",
                "completion_requirements": "Record finding or unavailable",
                "target_role": "technician",
                "due_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
                if index == 0
                else None,
            },
        )
        assert response.status_code == 200, response.text
    assert jobs.escalate_overdue(store) == 1
    assert jobs.escalate_overdue(store) == 0
    tasks = manager.get(f"/api/v1/plants/{plant}/tasks").json()["items"]
    assert len(tasks) == 1 and tasks[0]["target_role"] == "manager"
    assert len(detail(admin, plant, case["id"])["tasks"]) == 6
    assert detail(admin, plant, case["id"])["case"]["phase"] != "resolved"


@pytest.mark.operational
def test_observation_case_uses_durable_domain_pipeline_and_verification(shared, clock, monkeypatch):
    store, _, admin, plant, _ = shared
    enable(admin, plant)
    report = create(admin, plant, "equipment")
    source = source_create(admin, plant)
    assert (
        submit(
            admin,
            plant,
            source,
            [window(clock, f"case-fault-{i}", seconds=60 * (i - 2)) for i in range(3)],
            "case-fault-batch",
        ).status_code
        == 200
    )
    observed = admin.get(f"/api/v1/plants/{plant}/snapshot").json()["incident"]
    assert observed["state"] == "detected"  # Request thread did not run the investigator.
    assert jobs.managed_incident(store, observed["id"])
    monkeypatch.setattr(config, "CASES_ENABLED", False)
    assert not jobs.managed_incident(store, observed["id"])
    monkeypatch.setattr(config, "CASES_ENABLED", True)
    with store.connection() as db:
        db.execute("UPDATE issue_policies SET enabled=0 WHERE plant_id=?", (plant,))
    assert not jobs.managed_incident(store, observed["id"])
    with store.connection() as db:
        db.execute("UPDATE issue_policies SET enabled=1 WHERE plant_id=?", (plant,))
    cases = admin.get(f"/api/v1/plants/{plant}/cases").json()["items"]
    linked = next(c for c in cases if c["incident_id"] == observed["id"])
    linked_report = post(
        admin,
        plant,
        f"/cases/{report['id']}/link-incident",
        {"expected_revision": report["revision"], "incident_id": observed["id"]},
    )
    assert linked_report.status_code == 200, linked_report.text
    # Drain the independently persisted report and observation jobs.
    for _ in range(5):
        if not asyncio.run(run_once(store)):
            break
    incident = admin.get(f"/api/v1/plants/{plant}/snapshot").json()["incident"]
    assert incident["state"] == "awaiting_approval", incident
    assert approval(admin, plant, incident).status_code == 200
    assert detail(admin, plant, linked["id"])["case"]["phase"] == "in_progress"
    assert (
        admin.post(
            f"/api/v1/plants/{plant}/repair/start", json={}, headers={"X-Incident-ID": incident["id"]}
        ).status_code
        == 200
    )
    complete = admin.post(
        f"/api/v1/plants/{plant}/repair/complete",
        json={
            "observed_cause": "Technician confirmed a fixture issue",
            "fix": "Reviewed fixture repair",
            "parts": "Fixture parts",
            "outcome": "Fixture repair recorded; awaiting measurements",
        },
        headers={"X-Incident-ID": incident["id"]},
    )
    assert complete.status_code == 200, complete.text
    assert detail(admin, plant, report["id"])["case"]["phase"] == "verifying"
    for index in range(3):
        clock.value += timedelta(seconds=60)
        response = submit(
            admin,
            plant,
            source,
            [window(clock, f"case-healthy-{index}", value=150)],
            f"case-healthy-batch-{index}",
        )
        assert response.status_code == 200, response.text
    assert detail(admin, plant, report["id"])["case"]["phase"] == "resolved"
    assert detail(admin, plant, linked["id"])["case"]["phase"] == "resolved"
    assert all(t["state"] == "cancelled" for t in detail(admin, plant, linked["id"])["tasks"])
    before = {}
    with store.connection() as db:
        for table in ("staff_users", "plant_incidents", "plant_orders", "plant_cases", "telemetry_records"):
            before[table] = db.execute(f"SELECT * FROM {table}").fetchall()
        db.execute("DELETE FROM workspace_migrations WHERE version=7")
    Store(store.path, cloud=False)
    with store.connection() as db:
        for table, records in before.items():
            assert db.execute(f"SELECT * FROM {table}").fetchall() == records
        assert (
            db.execute("SELECT count(*) FROM issue_cases WHERE incident_id=?", (incident["id"],)).fetchone()[
                0
            ]
            == 2
        )
