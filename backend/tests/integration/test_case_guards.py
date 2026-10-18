"""Bounded execution, concurrent ownership and feature rollback proof."""

import asyncio
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.cases import jobs, service
from app.cases.agent import validate_output
from app.cases.tools import read_tool
from app.cases.worker import run_once
from app.contracts.cases import CaseMutation, EvidenceValue
from app.core import config
from app.plant.catalog import seed_catalog
from tests.integration.test_case_foundation import create, detail, enable, post, tenant


def test_case_and_organization_budgets_survive_retries_and_revocation(shared, monkeypatch):
    store, _, admin, plant, _ = shared
    enable(admin, plant)
    first = create(admin, plant)
    second = create(admin, plant)
    claimed = [jobs.claim(store), jobs.claim(store)]
    first_job = next(job for job in claimed if job["case_id"] == first["id"])
    second_job = next(job for job in claimed if job["case_id"] == second["id"])
    monkeypatch.setattr(config, "INVESTIGATION_AI_SPEND_MICRO_USD", 100)
    monkeypatch.setattr(config, "DAILY_AI_SPEND_MICRO_USD", 150)

    def reserve(job, amount):
        return store.reserve_ai(
            {
                "case_job_id": job["id"],
                "case_lease_token": job["lease_token"],
                "reserved_micro_usd": amount,
            }
        )

    reserve(first_job, 100)
    with pytest.raises(HTTPException, match="Case AI allowance") as denied:
        reserve(first_job, 1)
    assert denied.value.status_code == 429
    with pytest.raises(HTTPException, match="Organization AI allowance"):
        reserve(second_job, 60)
    with store.connection() as db:
        usage = json.loads(db.execute("SELECT data FROM ai_usage").fetchone()[0])
        assert usage["case_id"] == first["id"] and "case_lease_token" not in usage
    assert (
        post(admin, plant, "/automation-policy", {"expected_version": 1, "enabled": False}).status_code == 200
    )
    with pytest.raises(HTTPException) as revoked:
        reserve(second_job, 1)
    assert revoked.value.status_code == 403


def test_concurrent_claims_have_one_owner_and_immutable_response(shared):
    store, _, admin, plant, invite = shared
    clients = [invite("technician", f"race-{n}@example.test")[0] for n in range(2)]
    case = create(admin, plant)
    task = post(
        admin,
        plant,
        f"/cases/{case['id']}/tasks",
        {
            "expected_revision": case["revision"],
            "question": "Record availability of approved observations",
            "reason": "Missing evidence",
            "completion_requirements": "Explain availability",
            "target_role": "technician",
        },
    ).json()

    def claim(client):
        try:
            service.task_action(
                store,
                client.cookies.get("plantsense_staff"),
                plant,
                task["id"],
                CaseMutation(expected_revision=1),
                str(uuid.uuid4()),
            )
            return 200
        except HTTPException as error:
            return error.status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(claim, clients)) == [200, 409]
    assert detail(admin, plant, case["id"])["tasks"][0]["revision"] == 2


def test_invalid_proposals_and_nonfinite_reports_fail_closed():
    with pytest.raises(ValidationError):
        EvidenceValue(signal_id="pressure", value=float("inf"), unit="bar")
    with pytest.raises(ValidationError):
        validate_output(
            {"summary": "Approve", "citations": ["case-evidence"], "approve": True}, {"case-evidence"}
        )
    with pytest.raises(ValueError, match="unavailable evidence"):
        validate_output({"summary": "Unsupported source", "citations": ["other-plant"]}, {"case-evidence"})


def test_release_change_blocks_old_checkpoints_and_keeps_policy_history(shared, monkeypatch):
    store, _, admin, plant, _ = shared
    enable(admin, plant)
    case = create(admin, plant)
    monkeypatch.setattr(config, "MODEL", "authored-incompatible-model")
    assert jobs.claim(store) is None
    saved = detail(admin, plant, case["id"])
    assert "implementation or model changed" in saved["runs"][0]["error"]
    retried = post(
        admin, plant, f"/cases/{case['id']}/analysis", {"expected_revision": saved["case"]["revision"]}
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["analysis_version"] == 2
    assert jobs.claim(store)["run_id"] != saved["runs"][0]["id"]
    assert (
        post(admin, plant, "/automation-policy", {"expected_version": 1, "enabled": False}).status_code == 200
    )
    with store.connection() as db:
        history = [
            json.loads(json.loads(r[0])["message"])
            for r in db.execute(
                "SELECT data FROM issue_events WHERE action='automation.policy' ORDER BY sequence"
            )
        ]
        assert [(r["version"], r["enabled"]) for r in history] == [(1, True), (2, False)]


def test_disabling_feature_retains_manual_records_and_stops_worker(shared, monkeypatch):
    store, _, admin, plant, _ = shared
    case = create(admin, plant)
    monkeypatch.setattr(config, "CASES_ENABLED", False)
    assert admin.get(f"/api/v1/plants/{plant}/cases").status_code == 404
    assert asyncio.run(run_once(store)) is False
    with store.connection() as db:
        assert db.execute("SELECT id FROM issue_cases").fetchone()[0] == case["id"]
    monkeypatch.setattr(config, "CASES_ENABLED", True)
    assert detail(admin, plant, case["id"])["case"]["id"] == case["id"]


def test_two_organizations_with_two_plants_scope_tasks_evidence_jobs_and_retrieval(shared):
    store, application, admin, plant, _ = shared
    other_plant, other_user, token = tenant(store)
    admin_user = admin.get("/api/v1/access/state").json()["user"]["id"]
    extra = []
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        for first, user in ((plant, admin_user), (other_plant, other_user)):
            identity = str(uuid.uuid4())
            organization = db.execute("SELECT organization_id FROM plants WHERE id=?", (first,)).fetchone()[0]
            db.execute("INSERT INTO plants VALUES (?,?,?)", (identity, organization, "Second fixture plant"))
            seed_catalog(db, identity)
            db.execute("INSERT INTO memberships VALUES (?,?,?,1)", (identity, user, "admin"))
            extra.append(identity)
    with TestClient(application) as other:
        other.cookies.set("plantsense_staff", token)
        fixtures = [(plant, admin), (extra[0], admin), (other_plant, other), (extra[1], other)]
        records = {}
        for identity, client in fixtures:
            enable(client, identity)
            records[identity] = create(client, identity, description="PRIVATE_" + identity)
            assert (
                post(
                    client,
                    identity,
                    f"/cases/{records[identity]['id']}/tasks",
                    {
                        "expected_revision": records[identity]["revision"],
                        "question": "Review " + identity,
                        "reason": "Plant-specific evidence needed",
                        "completion_requirements": "Record a finding",
                        "target_role": "manager",
                    },
                ).status_code
                == 200
            )
            with store.connection() as db:
                db.execute(
                    "INSERT INTO plant_cases VALUES (?,?,?,?)",
                    (
                        "repair-" + identity,
                        identity,
                        "2026-10-15T00:00:00+00:00",
                        json.dumps(
                            {
                                "record_origin": "plant_observation",
                                "asset_id": "P-107",
                                "outcome": "PRIVATE_" + identity,
                            }
                        ),
                    ),
                )
        for identity, client in fixtures:
            base = f"/api/v1/plants/{identity}"
            assert [item["id"] for item in client.get(base + "/cases").json()["items"]] == [
                records[identity]["id"]
            ]
            assert {item["case_id"] for item in client.get(base + "/tasks").json()["items"]} == {
                records[identity]["id"]
            }
            for foreign, record in records.items():
                if foreign != identity:
                    assert client.get(base + "/cases/" + record["id"]).status_code == 404
            job = jobs.claim(store)
            capability = jobs.mint_capability(store, job)
            payload = json.dumps(read_tool(store.path, capability, "case_evidence"))
            knowledge = json.dumps(read_tool(store.path, capability, "search_knowledge", "PRIVATE_"))
            assert "PRIVATE_" + job["plant_id"] in payload
            assert "PRIVATE_" + job["plant_id"] in knowledge
            for foreign in records:
                if foreign != job["plant_id"]:
                    assert "PRIVATE_" + foreign not in payload + knowledge
