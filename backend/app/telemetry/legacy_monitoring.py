"""Transactional plant clock, source mappings, ingestion and incident dispatch.

SQLite is the local coordinator. Clock and every source checkpoint commit together;
workers use the existing fenced investigator after this transaction is released.
"""

import json
import time
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.core.events import now
from app.identity.staff_access import audit, authorize, available
from app.incidents.engine import fresh, ingest_window, snapshot
from app.persistence.workspace_store import internal_owner, load_runtime, save_runtime
from app.plant.catalog import configuration_view
from app.plant.configuration import line_capacities
from app.telemetry.legacy_quality import health_view, source_frame

INTERVAL = 5


def load(db, plant_id, catalog):
    record = db.execute("SELECT data FROM plant_monitoring WHERE plant_id=?", (plant_id,)).fetchone()
    state = json.loads(record[0]) if record else None
    if state and state["plant_configuration_version"] == catalog["version"]:
        return state
    return {
        "version": state["version"] if state else 0,
        "plant_configuration_version": catalog["version"],
        "enabled": False,
        "running": False,
        "tick": -1,
        "origin": now(),
        "last_tick": time.time(),
        "sources": [
            dict(asset_id=asset["id"], mode="healthy", quality_mode="fresh")
            for asset in catalog["configuration"]["assets"]
        ],
        "frames": {},
        "histories": {},
        "workflows": {},
        "starts": {},
        "control_keys": {},
        "quota_date": state["quota_date"] if state else datetime.now(timezone.utc).date().isoformat(),
        "investigations": state["investigations"] if state else 0,
    }


def persist(db, plant_id, state):
    db.execute(
        "INSERT INTO plant_monitoring VALUES (?,?) ON CONFLICT(plant_id) DO UPDATE SET data=excluded.data",
        (plant_id, json.dumps(state)),
    )


def is_enabled(db, plant_id):
    row = db.execute("SELECT data FROM plant_monitoring WHERE plant_id=?", (plant_id,)).fetchone()
    return bool(row and json.loads(row[0])["enabled"])


def view(db, plant_id, catalog=None, rates=None):
    catalog = catalog or configuration_view(db, plant_id)
    state = load(db, plant_id, catalog)
    assets = {asset["id"]: asset for asset in catalog["configuration"]["assets"]}
    if rates is None:
        rates = line_capacities(catalog["configuration"])
        for record in db.execute(
            "SELECT id,plant_id,data FROM plant_workflows WHERE plant_id=?", (plant_id,)
        ).fetchall():
            workflow = load_runtime(db, record)
            if workflow["incident"] and workflow["incident"]["state"] != "resolved":
                impact = snapshot(workflow)["line_output_per_hour"]
                for line in workflow["incident"]["affected_lines"]:
                    rates[line] = min(rates[line], impact[line])
    health = []
    for binding in state["sources"]:
        workflow_id = state["workflows"].get(binding["asset_id"])
        record = (
            db.execute(
                "SELECT id,plant_id,data FROM plant_workflows WHERE id=? AND plant_id=?",
                (workflow_id, plant_id),
            ).fetchone()
            if workflow_id
            else None
        )
        workflow = load_runtime(db, record) if record else None
        frame = state["frames"].get(binding["asset_id"])
        if (
            frame
            and state["running"]
            and (datetime.now(timezone.utc) - datetime.fromisoformat(frame["received_at"])).total_seconds()
            > 15
        ):
            frame = {**frame, "quality": "stale"}
        health.append(health_view(assets[binding["asset_id"]], binding, frame, workflow))
        source = health[-1]
        asset = assets[binding["asset_id"]]
        if source["quality"] == "fresh" and asset["type"] in {"press", "goods"}:
            output = {
                "asset_id": asset["id"],
                "signal_id": "output",
                "unit": "parts/h",
                "value": sum(rates.values()) if asset["type"] == "goods" else rates.get(asset["area_id"], 0),
                "timestamp": source["observed_at"],
                "provenance": "synthetic",
                "source_cycle_id": None,
            }
            source["signals"] = [
                signal for signal in source["signals"] if signal["signal_id"] != "output"
            ] + [output]
    result = {
        key: state[key]
        for key in ("version", "plant_configuration_version", "enabled", "running", "tick", "sources")
    }
    result.update(
        observed_at=(datetime.fromisoformat(state["origin"]) + timedelta(minutes=state["tick"])).isoformat()
        if state["tick"] >= 0
        else None,
        health=health,
        quality_issue_count=sum(item["quality"] != "fresh" for item in health),
        investigations_remaining_today=max(0, 3 - state["investigations"])
        if state["quota_date"] == datetime.now(timezone.utc).date().isoformat()
        else 3,
    )
    return result


def read(store, token, plant_id):
    available(store)
    with store.connection() as db:
        db.execute("BEGIN")
        authorize(db, token, plant_id)
        return view(db, plant_id)


def configure(store, token, plant_id, request):
    available(store)
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        actor = authorize(db, token, plant_id, "plant.configure")["user"]
        catalog = configuration_view(db, plant_id)
        state = load(db, plant_id, catalog)
        if (
            request.expected_version != state["version"]
            or request.plant_configuration_version != catalog["version"]
        ):
            raise HTTPException(409, "Monitoring or plant configuration changed; reload the source mappings")
        assets = {asset["id"]: asset for asset in catalog["configuration"]["assets"]}
        bindings = {binding.asset_id: binding for binding in request.sources}
        if len(bindings) != len(request.sources) or set(bindings) != set(assets):
            raise HTTPException(422, "Provide exactly one source mapping for every configured asset")
        if any(
            binding.mode == "degradation" and not assets[key].get("diagnostic_profile")
            for key, binding in bindings.items()
        ):
            raise HTTPException(422, "Fault replay requires a supported diagnostic profile")
        previous = {binding["asset_id"]: binding for binding in state["sources"]}
        for record in db.execute(
            "SELECT id,plant_id,data FROM plant_workflows WHERE plant_id=?", (plant_id,)
        ).fetchall():
            workflow = load_runtime(db, record)
            incident = workflow["incident"]
            opened = incident and incident["state"] != "resolved"
            if not workflow.get("_monitoring") and (not incident or opened):
                raise HTTPException(
                    409, "Resolve independent diagnostic sources before enabling plant monitoring"
                )
            if opened and (
                not request.enabled
                or bindings[incident["asset_id"]].mode != previous[incident["asset_id"]]["mode"]
            ):
                raise HTTPException(
                    409,
                    "Resolve active incidents before disabling monitoring or changing their fault mapping",
                )
        sources = [bindings[asset["id"]].model_dump() for asset in catalog["configuration"]["assets"]]
        if state["version"] and sources == state["sources"] and request.enabled == state["enabled"]:
            return view(db, plant_id, catalog)
        for binding in sources:
            key = binding["asset_id"]
            if binding["mode"] != previous[key]["mode"]:
                state["workflows"].pop(key, None)
                state["histories"].pop(key, None)
                state["starts"][key] = state["tick"] + 1
        state.update(
            version=state["version"] + 1,
            enabled=request.enabled,
            running=False,
            sources=sources,
            last_tick=time.time(),
        )
        # Configuration changes invalidate current evidence immediately, before another tick.
        for binding in sources:
            key = binding["asset_id"]
            if binding != previous[key]:
                state["frames"].pop(key, None)
                workflow_id = state["workflows"].get(key)
                if workflow_id:
                    record = db.execute(
                        "SELECT id,plant_id,data FROM plant_workflows WHERE id=?", (workflow_id,)
                    ).fetchone()
                    workflow = load_runtime(db, record)
                    workflow["_monitoring_quality"] = "not_started"
                    save_runtime(db, workflow, actor, "monitoring.mapping_changed")
        persist(db, plant_id, state)
        db.execute(
            "INSERT INTO monitoring_revisions VALUES (?,?,?,?)",
            (plant_id, state["version"], now(), request.model_dump_json()),
        )
        audit(
            db,
            plant_id,
            actor,
            "monitoring.configured",
            f"Monitoring mappings v{state['version']} saved; coordinated replay {'enabled' if request.enabled else 'disabled'}",
        )
        return view(db, plant_id, catalog)


def tick(db, plant_id, state, catalog):
    state["tick"] += 1
    observed_at = (datetime.fromisoformat(state["origin"]) + timedelta(minutes=state["tick"])).isoformat()
    assets = {asset["id"]: asset for asset in catalog["configuration"]["assets"]}
    jobs = []
    date = datetime.now(timezone.utc).date().isoformat()
    if state["quota_date"] != date:
        state.update(quota_date=date, investigations=0)
    for binding in state["sources"]:
        key = binding["asset_id"]
        workflow_id = state["workflows"].get(key)
        record = (
            db.execute(
                "SELECT id,plant_id,data FROM plant_workflows WHERE id=? AND plant_id=?",
                (workflow_id, plant_id),
            ).fetchone()
            if workflow_id
            else None
        )
        workflow = load_runtime(db, record) if record else None
        row = source_frame(
            assets[key],
            binding,
            state["tick"],
            state["version"],
            observed_at,
            workflow["incident"] if workflow else None,
            state["tick"] - state["starts"].get(key, 0),
        )
        state["frames"][key] = row
        history = state["histories"][key] = (state["histories"].get(key, []) + [row])[-6:]
        # Healthy sources have no workflow. Three valid persistent windows create one event.
        if (
            not workflow
            and assets[key].get("diagnostic_profile")
            and len(history) >= 3
            and all(frame["anomaly"] and frame["quality"] == "fresh" for frame in history[-3:])
        ):
            workflow = fresh(internal_owner(plant_id))
            workflow.update(
                _plant_id=plant_id,
                _catalog=catalog["configuration"],
                _configuration_version=catalog["version"],
                _asset_id=key,
                _profile_id=assets[key]["diagnostic_profile"],
                _monitoring=True,
                scenario=assets[key]["diagnostic_profile"] + "_degradation",
                history=history[-3:-1],
            )
            state["workflows"][key] = workflow["id"]
            db.execute(
                "INSERT INTO plant_workflows VALUES (?,?,?,?,?,?)",
                (workflow["id"], plant_id, key, now(), 1, json.dumps(workflow)),
            )
        if workflow and (not workflow["incident"] or workflow["incident"]["state"] != "resolved"):
            workflow["window"] = state["tick"]
            workflow["_monitoring_quality"] = row["quality"]
            job = ingest_window(workflow, row)
            if job:
                state["investigations"] += 1
                if state["investigations"] <= 3:
                    jobs.append(job)
                else:
                    workflow["incident"].update(
                        state="investigation_failed",
                        error="Plant monitoring daily investigation allowance reached; evidence retained",
                        attempts=2,
                    )
            save_runtime(db, workflow, action="monitoring.window")
    return jobs


def control(store, token, plant_id, request, key):
    available(store)
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        actor = authorize(db, token, plant_id, "plant.manage")["user"]
        catalog = configuration_view(db, plant_id)
        state = load(db, plant_id, catalog)
        if not state["enabled"]:
            raise HTTPException(409, "Enable coordinated monitoring first")
        prior = state["control_keys"].get(key)
        if prior:
            if prior != request.model_dump():
                raise HTTPException(409, "Idempotency key already used for a different clock command")
            return view(db, plant_id, catalog), []
        if request.expected_version != state["version"]:
            raise HTTPException(409, "Source mappings changed; review the saved configuration")
        if request.expected_tick != state["tick"]:
            raise HTTPException(409, "Plant clock advanced; review the current tick and retry")
        jobs = []
        if request.action == "step":
            state["running"] = False
            jobs = tick(db, plant_id, state, catalog)
        else:
            state["running"] = request.action == "play"
        state["last_tick"] = time.time()
        state["control_keys"][key] = request.model_dump()
        state["control_keys"] = dict(list(state["control_keys"].items())[-128:])
        persist(db, plant_id, state)
        audit(
            db,
            plant_id,
            actor,
            "monitoring.clock",
            f"Coordinated replay {request.action}; plant tick {state['tick']}",
        )
        return view(db, plant_id, catalog), jobs


def advance_plants(store):
    if store.cloud:
        return []
    jobs = []
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        for plant_id, payload in db.execute("SELECT plant_id,data FROM plant_monitoring").fetchall():
            state = json.loads(payload)
            if not state["enabled"] or not state["running"]:
                continue
            count = min(12, int((time.time() - state["last_tick"]) / INTERVAL))
            if not count:
                continue
            catalog = configuration_view(db, plant_id)
            for _ in range(count):
                jobs.extend(tick(db, plant_id, state, catalog))
            state["last_tick"] += count * INTERVAL
            persist(db, plant_id, state)
    return jobs
