"""Atomic call/spend reservations; failed calls retain their conservative charge."""

import json
import time
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core import config


def check_claim(state, record):
    if not record.get("claim_token"):
        return
    incident = state and state.get("incident")
    if not (
        state
        and state["owner"] == record["owner"]
        and state["generation"] == record["generation"]
        and incident
        and incident["id"] == record["incident_id"]
        and incident["state"] == "investigating"
        and incident.get("claim_token") == record["claim_token"]
        and incident["lease_until"] > time.time()
        and incident["deadline_at"] > time.time()
    ):
        raise RuntimeError("Investigation claim expired or superseded")


def check_limits(calls, spend, incident_spend, record):
    if calls >= config.DAILY_LIMIT:
        raise HTTPException(429, "Daily AI allowance reached")
    if spend + record["charged_micro_usd"] > config.DAILY_AI_SPEND_MICRO_USD:
        raise HTTPException(429, "Daily AI spending allowance reached")
    if record.get("incident_id") and (
        incident_spend + record["charged_micro_usd"] > config.INVESTIGATION_AI_SPEND_MICRO_USD
    ):
        raise HTTPException(429, "Investigation AI spending allowance reached")


def reserve(store, reservation=None):
    record = {
        "request_id": uuid.uuid4().hex,
        "day": datetime.now(timezone.utc).date().isoformat(),
        "stage": "retrieval",
        "provider": config.AI_PROVIDER,
        "model": config.MODEL,
        "status": "reserved",
        "reserved_micro_usd": 10000,
        **(reservation or {}),
    }
    record["charged_micro_usd"] = record["reserved_micro_usd"]
    if record["reserved_micro_usd"] < 0:
        raise ValueError("AI reservation must be non-negative")
    if store.cloud:
        from google.cloud import firestore

        bucket = store.client.collection("ai_budgets").document(record["day"])
        usage = store.client.collection("ai_usage").document(record["request_id"])

        @firestore.transactional
        def apply(tx):
            data = bucket.get(transaction=tx, timeout=8, retry=None).to_dict() or {}
            if record.get("claim_token"):
                state = (
                    store.client.collection("sessions")
                    .document(record["session_id"])
                    .get(transaction=tx, timeout=8, retry=None)
                    .to_dict()
                )
                check_claim(state, record)
            incident_key = record.get("incident_id", "")
            incidents = data.get("incidents", {})
            check_limits(data.get("calls", 0), data.get("spend", 0), incidents.get(incident_key, 0), record)
            if incident_key:
                incidents[incident_key] = incidents.get(incident_key, 0) + record["charged_micro_usd"]
            tx.set(
                bucket,
                {
                    "calls": data.get("calls", 0) + 1,
                    "spend": data.get("spend", 0) + record["charged_micro_usd"],
                    "incidents": incidents,
                },
            )
            tx.create(usage, record)

        apply(store.client.transaction())
    else:
        with store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            if record.get("claim_token"):
                row = db.execute(
                    "SELECT data FROM plant_workflows WHERE id=?", (record["session_id"],)
                ).fetchone()
                if not row:
                    row = db.execute(
                        "SELECT data FROM sessions WHERE id=?", (record["session_id"],)
                    ).fetchone()
                check_claim(json.loads(row[0]) if row else None, record)
            row = db.execute("SELECT calls FROM budgets WHERE day=?", (record["day"],)).fetchone()
            records = [
                json.loads(row[0])
                for row in db.execute("SELECT data FROM ai_usage WHERE day=?", (record["day"],))
            ]
            spend = sum(r["charged_micro_usd"] for r in records)
            # Incident quota survives retries, restarts and UTC day boundaries.
            incident_spend = sum(
                json.loads(row[0])["charged_micro_usd"]
                for row in db.execute(
                    "SELECT data FROM ai_usage WHERE json_extract(data,'$.incident_id')=? AND json_extract(data,'$.owner')=?",
                    (record.get("incident_id"), record.get("owner")),
                )
            )
            check_limits(row[0] if row else 0, spend, incident_spend, record)
            calls = db.execute("SELECT calls FROM budgets WHERE day=?", (record["day"],)).fetchone()
            db.execute(
                "INSERT OR REPLACE INTO budgets VALUES (?,?)", (record["day"], (calls[0] if calls else 0) + 1)
            )
            db.execute(
                "INSERT INTO ai_usage VALUES (?,?,?)",
                (record["request_id"], record["day"], json.dumps(record)),
            )
    return record["request_id"]


def settle(store, request_id, owner, outcome):
    """Meter an already issued request even after claim expiry; never write workflow state here."""

    def update(record):
        if not record or record.get("owner") != owner:
            raise HTTPException(404, "AI request not found")
        if record["status"] != "reserved":
            return record
        record.update(outcome)
        return record

    if store.cloud:
        from google.cloud import firestore

        ref = store.client.collection("ai_usage").document(request_id)

        @firestore.transactional
        def apply(tx):
            original = ref.get(transaction=tx, timeout=8, retry=None).to_dict()
            record = update(dict(original) if original else None)
            bucket = store.client.collection("ai_budgets").document(record["day"])
            data = bucket.get(transaction=tx, timeout=8, retry=None).to_dict()
            delta = record["charged_micro_usd"] - original["charged_micro_usd"]
            data["spend"] += delta
            if record.get("incident_id"):
                data["incidents"][record["incident_id"]] += delta
            tx.set(bucket, data)
            tx.set(ref, record)
            return record

        return apply(store.client.transaction())
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT data FROM ai_usage WHERE id=?", (request_id,)).fetchone()
        record = update(json.loads(row[0]) if row else None)
        db.execute("UPDATE ai_usage SET data=? WHERE id=?", (json.dumps(record), request_id))
        return record
