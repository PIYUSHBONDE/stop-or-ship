"""Read-only, capability-scoped evidence services shared by MCP and coordinator."""

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app.cases.jobs import authorize_capability
from app.cases.service import rows
from app.core import config


@contextmanager
def evidence_scope(path, capability):
    # The MCP process cannot mutate its database, even if a handler regresses.
    if config.STORAGE == "postgres":
        from app.persistence.postgres import PostgresStore

        store = PostgresStore(config.POSTGRES_DSN, schema=config.POSTGRES_SCHEMA)
        with store.evidence_scope(capability) as context:
            yield context
        return
    db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True, timeout=10)
    try:
        _, run, case, _ = authorize_capability(db, capability)
        yield db, run, case
    finally:
        db.close()


def read_tool(path, capability, name, query=""):
    if len(query) > 300:
        raise ValueError("Knowledge query exceeds allowance")
    with evidence_scope(path, capability) as (db, run, case):
        plant, asset = case["plant_id"], case["asset_id"]
        if name == "equipment_context":
            assets = rows(
                db,
                "SELECT id,data FROM plant_assets WHERE plant_id=? AND (? IS NULL OR id=?) ORDER BY id LIMIT 36",
                (plant, asset, asset),
            )
            return {
                "id": "equipment-context",
                "origin": "reviewed_configuration",
                "assets": [json.loads(a["data"]) for a in assets],
            }
        if name == "equipment_trends":
            records = rows(
                db,
                "SELECT r.source_id,r.record_id,r.data,r.received_at,s.version FROM telemetry_records r JOIN telemetry_sources s ON s.id=r.source_id WHERE s.plant_id=? AND s.kind='operational' AND (? IS NULL OR s.asset_id=?) ORDER BY r.received_at DESC,r.record_id DESC LIMIT 8",
                (plant, asset, asset),
            )
            readings = []
            for record in records:
                saved = json.loads(record["data"])
                observation = saved["observation"]
                stamp = observation.get("observed_at")
                fresh = (
                    bool(stamp)
                    and -30
                    <= (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds()
                    <= 180
                )
                readings.append(
                    {
                        "id": record["record_id"],
                        "source_id": record["source_id"],
                        "observed_at": stamp,
                        "source_version": saved.get("source_version"),
                        "received_at": record["received_at"],
                        "quality": saved["frame"].get("quality", "unknown")
                        if fresh and saved.get("source_version") == record["version"]
                        else "stale_or_superseded",
                        "values": observation.get("values", [])[:16],
                    }
                )
            return {
                "id": "equipment-trends",
                "origin": "accepted_observations",
                "readings": readings,
                "note": "Source acquisition is not independently attested; inspect observation time and quality. Missing readings remain unknown.",
            }
        if name == "production_context":
            areas = rows(db, "SELECT data FROM plant_areas WHERE plant_id=? ORDER BY id LIMIT 20", (plant,))
            edges = rows(
                db,
                "SELECT data FROM plant_dependencies WHERE plant_id=? ORDER BY source,target LIMIT 100",
                (plant,),
            )
            return {
                "id": "production-context",
                "origin": "reviewed_configuration",
                "areas": [json.loads(r["data"]) for r in areas],
                "dependencies": [json.loads(r["data"]) for r in edges],
                "note": "Rated capacity is not measured output. No inventory or order-feed connector is active.",
            }
        if name == "case_evidence":
            evidence = rows(
                db,
                "SELECT id,actor_id,created_at,origin,data FROM issue_evidence WHERE case_id=? AND organization_id=? AND plant_id=? ORDER BY created_at DESC,id DESC LIMIT 10",
                (case["id"], case["organization_id"], plant),
            )
            pending = rows(
                db,
                "SELECT id,target_role,data FROM issue_tasks WHERE case_id=? AND state IN ('open','claimed') ORDER BY created_at LIMIT 5",
                (case["id"],),
            )
            return {
                "id": "case-evidence",
                "open_requests": [
                    {
                        "id": item["id"],
                        "target_role": item["target_role"],
                        "question": json.loads(item["data"])["question"][:600],
                    }
                    for item in pending
                ],
                "case": {
                    k: case[k]
                    for k in ("id", "title", "description", "category", "analysis_version", "origin")
                },
                "submissions": [
                    {
                        **{k: r[k] for k in ("id", "actor_id", "created_at", "origin")},
                        **json.loads(r["data"]),
                        "text": json.loads(r["data"])["text"][:1000],
                    }
                    for r in evidence
                ],
            }
        if name == "search_knowledge":
            # Shared references are a reviewed application library. Private outcomes are filtered BEFORE retrieval.
            references = json.loads((config.DATA / "knowledge.json").read_text(encoding="utf-8"))
            words = set(re.findall(r"[a-z0-9]+", query.lower()))
            references.sort(
                key=lambda item: len(words & set(re.findall(r"[a-z0-9]+", item["text"].lower()))),
                reverse=True,
            )
            references = references[:3]
            cases = rows(
                db,
                "SELECT id,data FROM plant_cases WHERE plant_id=? AND json_extract(data,'$.record_origin')='plant_observation' AND (? IS NULL OR json_extract(data,'$.asset_id')=?) ORDER BY verified_at DESC LIMIT 3",
                (plant, asset, asset),
            )
            verified = []
            for item in cases:
                saved = json.loads(item["data"])
                if saved.get("record_origin") == "plant_observation" and (
                    not asset or saved.get("asset_id") == asset
                ):
                    verified.append(
                        {
                            "id": item["id"],
                            "origin": "verified_repair",
                            "text": json.dumps(
                                {
                                    k: saved.get(k)
                                    for k in ("asset_id", "observed_cause", "fix", "outcome", "verified_at")
                                }
                            ),
                        }
                    )
            return {
                "id": "scoped-knowledge",
                "shared_references": [
                    {"id": r["id"], "origin": "reviewed_shared_reference", "text": r["text"][:1500]}
                    for r in references
                ],
                "verified_repairs": verified,
            }
        if name == "intervention_comparison":
            result = (
                db.execute(
                    "SELECT data FROM plant_incidents WHERE id=? AND plant_id=?", (case["incident_id"], plant)
                ).fetchone()
                if case["incident_id"]
                else None
            )
            incident = json.loads(result[0]) if result else None
            return {
                "id": "intervention-comparison",
                "origin": "deterministic_calculation",
                "incident_id": case["incident_id"],
                "calculation_version": incident.get("calculation_version") if incident else None,
                "calculation": incident.get("calculation") if incident else None,
                "note": "Configured planning assumptions; no approval or physical work is performed by this tool.",
            }
        raise ValueError("Unknown read-only tool")


TOOL_NAMES = (
    "equipment_context",
    "equipment_trends",
    "production_context",
    "search_knowledge",
    "case_evidence",
    "intervention_comparison",
)
