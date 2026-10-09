"""Repair memory must not crowd reviewed procedures out of the evidence pack."""

import asyncio

from app.agent import investigate
from app.engine import advance, fresh, start_scenario
from app.knowledge import local_search
from app.store import Store


def test_many_verified_repairs_retain_equipment_procedure():
    cases = [
        dict(
            id=f"case-{index}",
            incident_id=f"incident-{index}",
            asset_id="P-107",
            provenance="Verified in simulated plant",
            observed_cause="Seal leakage",
            fix="Replace the pump seal",
            outcome="Healthy flow",
        )
        for index in range(12)
    ]
    docs = local_search("equipment:pump pump diagnostic checks independent sensor repair", cases)
    assert len(docs) == 5
    assert sum(doc["id"].startswith("case-") for doc in docs) == 3
    assert any(doc["id"] == "sop-pump-01" for doc in docs)


def test_investigation_with_many_confirmed_repairs_keeps_valid_citations(tmp_path):
    store = Store(str(tmp_path / "knowledge.db"), cloud=False)
    state = fresh("owner")
    state["memory"] = [
        dict(
            id=f"case-{index}",
            incident_id=f"incident-{index}",
            asset_id="P-107",
            provenance="Verified in simulated plant",
            observed_cause="Seal leakage",
            fix="Replace seal",
            parts="Seal kit",
            outcome="Healthy flow",
            verified_at="2026-10-09T00:00:00+00:00",
            original_diagnosis=None,
        )
        for index in range(12)
    ]
    start_scenario(state, "pump_degradation")
    job = None
    for _ in range(6):
        job = advance(state, step=True) or job
    store.create(state)
    asyncio.run(investigate(store, job))
    incident = store.read(state["id"], "owner")["incident"]
    assert incident["state"] == "awaiting_approval"
    evidence_ids = {doc["id"] for doc in incident["evidence"]}
    assert "sop-pump-01" in evidence_ids
    assert set(incident["diagnosis"]["citations"]).issubset(evidence_ids)
