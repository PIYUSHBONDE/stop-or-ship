"""Recurrence is recorded context, never inferred physical failure or repair evidence."""

import asyncio
import json
import sqlite3
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.cases import jobs
from app.cases.agent import scripted
from app.cases.history import equipment_history
from app.cases.tools import read_tool
from app.cases.worker import process
from tests.integration.test_case_foundation import create, detail, enable, tenant


def test_history_is_scoped_and_persisted_as_separate_agent_evidence(shared):
    store, app, admin, plant, _ = shared
    create(admin, plant, "equipment", description="Earlier pressure report")
    create(admin, plant, "equipment", description="Second pressure report")
    create(admin, plant, "equipment", asset_id="P-207", description="PRIVATE_OTHER_ASSET")
    old = create(admin, plant, "equipment", description="OLD_OUTSIDE_WINDOW")
    cancelled = create(admin, plant, "equipment", description="CANCELLED_REPORT")
    create(admin, plant, "production", description="DIFFERENT_CATEGORY")
    foreign_plant, _, token = tenant(store)
    with TestClient(app) as other:
        other.cookies.set("plantsense_staff", token)
        create(other, foreign_plant, "equipment", description="PRIVATE_OTHER_TENANT")
    with store.connection() as db:
        db.execute("UPDATE issue_cases SET created_at='2000-01-01T00:00:00+00:00' WHERE id=?", (old["id"],))
        db.execute("UPDATE issue_cases SET phase='cancelled' WHERE id=?", (cancelled["id"],))
    enable(admin, plant)
    case = create(admin, plant, "equipment")
    job = jobs.claim(store)
    capability = jobs.mint_capability(store, job)
    history = read_tool(store.path, capability, "equipment_history")
    assert history["recorded_issues"] == 3 and len(history["cases"]) == 3
    assert history["origin"] == "recorded_case_history"
    assert "PRIVATE_" not in json.dumps(history) and "OUTSIDE" not in json.dumps(history)
    assert "not confirmed failures" in history["note"]
    stages = []

    async def provider(stage, payload):
        stages.append(stage)
        assert payload["sources"]["equipment_history"]["recorded_issues"] == 3
        output = scripted(stage, payload["sources"])
        if stage == "investigator":
            output["hypotheses"] = [
                {
                    "cause": "Repeated reports need independent comparison",
                    "confidence": "low",
                    "supporting_evidence": ["equipment-history"],
                    "conflicting_evidence": [],
                }
            ]
        return output

    asyncio.run(process(store, job, provider=provider))
    state = detail(admin, plant, case["id"])
    source = next(source for source in state["runs"][0]["sources"] if source["id"] == "equipment-history")
    assert json.loads(source["text"])["recorded_issues"] == 3
    assert stages == ["investigator", "reviewer", "Reliability", "Production"]
    create(admin, plant, "equipment")
    # New reports do not mutate a historical captured analysis.
    assert (
        next(
            source
            for source in detail(admin, plant, case["id"])["runs"][0]["sources"]
            if source["id"] == "equipment-history"
        )
        == source
    )
    with store.connection() as db:
        db.execute(
            "UPDATE memberships SET active=0 WHERE user_id=? AND plant_id=?", (case["created_by"], plant)
        )
    # Completed/revoked capabilities cannot retrieve later private evidence.
    with pytest.raises(HTTPException):
        read_tool(store.path, capability, "equipment_history")


def test_linked_duplicate_incidents_count_once_and_plantless_history_is_unknown():
    with sqlite3.connect(":memory:") as db:
        db.execute(
            "CREATE TABLE issue_cases (id TEXT,organization_id TEXT,plant_id TEXT,category TEXT,asset_id TEXT,incident_id TEXT,phase TEXT,created_at TEXT,data TEXT)"
        )
        stamp = datetime.now(timezone.utc).isoformat()
        for identity, incident in (("one", "incident"), ("two", "incident"), ("three", None)):
            db.execute(
                "INSERT INTO issue_cases VALUES (?,?,?,?,?,?,?,?,?)",
                (identity, "org", "plant", "equipment", "P-107", incident, "triage", stamp, "{}"),
            )
        case = {"organization_id": "org", "plant_id": "plant", "asset_id": "P-107"}
        assert equipment_history(db, case)["recorded_issues"] == 2
        assert equipment_history(db, {**case, "asset_id": None})["recorded_issues"] == 0
