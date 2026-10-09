"""Normalized plant records and private per-incident replay execution state.

The existing replay engine is adapted per workflow. Public plant access is always
checked separately from the internal worker owner; browser demo tokens cannot
authorize these records. All projections and audit writes share one transaction.
"""

import json
import time
from datetime import datetime, timezone

from fastapi import HTTPException

from . import config
from .engine import advance, fresh, snapshot, start_scenario
from .events import event, now
from .plant_configuration import line_capacities
from .profiles import profile_for, session_profile
from .staff_access import audit, authorize, available
from .telemetry import asset_signals
from .workspace_catalog import configuration_view


def internal_owner(plant_id):
    return "plant:" + plant_id


def load_runtime(db, row):
    state = json.loads(row[2])
    state["_plant_id"] = row[1]
    if "_catalog" not in state:
        original = db.execute(
            "SELECT data FROM plant_configurations WHERE plant_id=? AND version=1", (row[1],)
        ).fetchone()
        state["_catalog"] = json.loads(original[0])
        state["_configuration_version"] = 1
    if state["incident"]:
        state["incident"].setdefault("plant_context", state["_catalog"])
        state["incident"].setdefault("plant_configuration_version", state["_configuration_version"])
    state["memory"] = [
        json.loads(case[0])
        for case in db.execute(
            "SELECT data FROM plant_cases WHERE plant_id=? ORDER BY verified_at,id", (row[1],)
        )
    ]
    if not config.INTERNAL_TEST_MODE:
        state["memory"] = [
            case for case in state["memory"] if case.get("record_origin") == "plant_observation"
        ]
    if state.get("_source_id") and state["history"]:
        stamp = state["history"][-1].get("observed_at")
        if state.get("record_origin") == "plant_observation" and (
            not stamp or (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds() > 180
        ):
            state["_monitoring_quality"] = "stale"
    if state.get("_monitoring") and state["history"]:
        monitor = db.execute("SELECT data FROM plant_monitoring WHERE plant_id=?", (row[1],)).fetchone()
        if monitor and json.loads(monitor[0])["running"]:
            received = state["history"][-1].get("received_at")
            if (
                received
                and (datetime.now(timezone.utc) - datetime.fromisoformat(received)).total_seconds() > 15
            ):
                state["_monitoring_quality"] = "stale"
    return state


def save_runtime(db, state, actor=None, action="investigation.update"):
    plant_id = state["_plant_id"]
    incident = state["incident"]
    for entry in state["events"]:
        audit(
            db,
            plant_id,
            entry.get("actor") or actor,
            action,
            entry["message"],
            incident,
            entry.get("id"),
            entry["at"],
        )
    if incident:
        db.execute(
            "INSERT INTO plant_incidents VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
            "state=excluded.state,calculation_version=excluded.calculation_version,data=excluded.data",
            (
                incident["id"],
                state["id"],
                plant_id,
                incident["asset_id"],
                incident["state"],
                incident["calculation_version"],
                json.dumps(incident),
            ),
        )
        orders = incident.get("superseded_work_orders", []) + (
            [incident["work_order"]] if incident.get("work_order") else []
        )
        for order in orders:
            db.execute(
                "INSERT INTO plant_orders VALUES (?,?,?,?,?,?) ON CONFLICT(id,calculation_version) DO UPDATE SET "
                "status=excluded.status,data=excluded.data",
                (
                    order["id"],
                    order["approval"]["calculation_version"],
                    incident["id"],
                    plant_id,
                    order["status"],
                    json.dumps(order),
                ),
            )
    for case in state["memory"]:
        db.execute(
            "INSERT OR IGNORE INTO plant_cases VALUES (?,?,?,?)",
            (case["id"], plant_id, case["verified_at"], json.dumps(case)),
        )
    # Shared memory belongs to the plant, rather than being copied into every workflow.
    payload = {key: value for key, value in state.items() if key not in {"_actor", "memory"}}
    payload["memory"] = []
    db.execute(
        "UPDATE plant_workflows SET data=?,revision=revision+1 WHERE id=?", (json.dumps(payload), state["id"])
    )


def read_runtime(store, workflow_id, owner):
    with store.connection() as db:
        row = db.execute("SELECT id,plant_id,data FROM plant_workflows WHERE id=?", (workflow_id,)).fetchone()
        if not row:
            return None
        if owner != internal_owner(row[1]):
            raise HTTPException(404, "Session not found")
        return load_runtime(db, row)


def mutate_runtime(
    store, workflow_id, owner, operation, token=None, permission="plant.read", action="investigation.update"
):
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT id,plant_id,data FROM plant_workflows WHERE id=?", (workflow_id,)).fetchone()
        if not row:
            return False, None
        if owner != internal_owner(row[1]):
            raise HTTPException(404, "Session not found")
        actor = authorize(db, token, row[1], permission)["user"] if token is not None else None
        state = load_runtime(db, row)
        if not config.INTERNAL_TEST_MODE and state.get("record_origin", "legacy_replay") == "legacy_replay":
            raise HTTPException(409, "Legacy replay workflows are read-only")
        if not config.INTERNAL_TEST_MODE and token is not None:
            origin = state.get("record_origin", "legacy_replay")
            if origin == "legacy_replay" or (
                origin == "historical_import" and permission != "incident.review"
            ):
                raise HTTPException(
                    409, "Historical and legacy records are read-only for operational actions"
                )
        state["_actor"] = actor
        result = operation(state)
        if getattr(result, "status_code", None) == 409:
            action = "decision.constraint_changed"
        save_runtime(db, state, actor, action)
        return True, result


def start_source(store, token, plant_id, scenario, asset_id=None):
    from .monitoring import is_enabled

    available(store)
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        actor = authorize(db, token, plant_id, "plant.manage")["user"]
        if is_enabled(db, plant_id):
            raise HTTPException(409, "Use coordinated monitoring controls while plant monitoring is enabled")
        state = fresh(internal_owner(plant_id))
        state["_plant_id"] = plant_id
        state["_actor"] = actor
        state["memory"] = [
            json.loads(row[0])
            for row in db.execute(
                "SELECT data FROM plant_cases WHERE plant_id=? ORDER BY verified_at,id", (plant_id,)
            )
        ]
        configuration = configuration_view(db, plant_id)
        state["_catalog"] = configuration["configuration"]
        state["_configuration_version"] = configuration["version"]
        profile = profile_for(scenario)
        if scenario == "memory_recurrence":
            cases = [case for case in state["memory"] if not asset_id or case["asset_id"] == asset_id]
            if not cases:
                raise HTTPException(409, "Verify a repair for this equipment before starting recurrence")
            asset_id = cases[-1]["asset_id"]
        asset_id = asset_id or profile.asset_id
        asset = next((asset for asset in state["_catalog"]["assets"] if asset["id"] == asset_id), None)
        if (
            not asset
            or not asset["diagnostic_profile"]
            or (scenario != "memory_recurrence" and asset["diagnostic_profile"] != profile.id)
        ):
            raise HTTPException(422, "Select configured equipment compatible with this diagnostic source")
        state["_profile_id"] = asset["diagnostic_profile"]
        state["_asset_id"] = asset_id
        start_scenario(state, scenario)
        profile = session_profile(state)
        state["_profile_id"] = profile.id
        if not db.execute(
            "SELECT 1 FROM plant_assets WHERE plant_id=? AND id=?", (plant_id, profile.asset_id)
        ).fetchone():
            raise HTTPException(409, "The telemetry source is not configured for this plant")
        for (data,) in db.execute(
            "SELECT data FROM plant_workflows WHERE plant_id=? AND asset_id=?", (plant_id, profile.asset_id)
        ):
            prior = json.loads(data)
            if not prior["incident"] or prior["incident"]["state"] != "resolved":
                raise HTTPException(409, "This asset already has an open source or incident")
        db.execute(
            "INSERT INTO plant_workflows VALUES (?,?,?,?,1,?)",
            (state["id"], plant_id, profile.asset_id, now(), "{}"),
        )
        save_runtime(db, state, actor, "source.started")
        return state["id"]


def workflow_for(store, token, plant_id, incident_id, permission="plant.read"):
    available(store)
    with store.connection() as db:
        context = authorize(db, token, plant_id, permission)
        if incident_id:
            row = db.execute(
                "SELECT workflow_id FROM plant_incidents WHERE plant_id=? AND id=?", (plant_id, incident_id)
            ).fetchone()
        else:
            row = db.execute(
                "SELECT id FROM plant_workflows WHERE plant_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
                (plant_id,),
            ).fetchone()
        if not row:
            raise HTTPException(404, "Incident or telemetry source not found")
        return row[0], context


def plant_snapshot(store, token, plant_id, incident_id=None):
    available(store)
    with store.connection() as db:
        db.execute("BEGIN")
        context = authorize(db, token, plant_id)
        rows = db.execute(
            "SELECT id,plant_id,data FROM plant_workflows WHERE plant_id=? ORDER BY created_at,id",
            (plant_id,),
        ).fetchall()
        states = [load_runtime(db, row) for row in rows]
        selected = next(
            (state for state in states if state["incident"] and state["incident"]["id"] == incident_id), None
        )
        if incident_id and selected is None:
            raise HTTPException(404, "Incident not found")
        if selected is None:
            selected = states[-1] if states else fresh(internal_owner(plant_id), plant_id)
        configuration = configuration_view(db, plant_id)
        catalog = configuration["configuration"]
        if not states:
            selected["_plant_id"] = plant_id
            selected["_catalog"] = catalog
            selected["_configuration_version"] = configuration["version"]
        result = snapshot(selected)
        result["id"] = plant_id
        result["plant"].update(id=plant_id, name=context["name"])
        result.update({key: catalog[key] for key in ("areas", "dependencies")})
        result["configuration_version"] = configuration["version"]
        result["assets"] = [dict(asset, status="healthy") for asset in catalog["assets"]]
        # Generate supporting context for every configured asset; measured sources override only their mapped asset.
        result["signals"] = {
            asset["id"]: asset_signals(asset, result["window"]) if config.INTERNAL_TEST_MODE else []
            for asset in result["assets"]
        }
        result["workspace"] = context
        result["active_source_count"] = sum(
            not state["incident"] or state["incident"]["state"] != "resolved" for state in states
        )
        result["incidents"] = [state["incident"] for state in states if state["incident"]]
        result["memory"] = [
            json.loads(row[0])
            for row in db.execute(
                "SELECT data FROM plant_cases WHERE plant_id=? ORDER BY verified_at,id", (plant_id,)
            )
        ]
        result["events"] = [
            dict(zip(("at", "message"), row))
            for row in reversed(
                db.execute(
                    "SELECT at,message FROM plant_audit WHERE plant_id=? ORDER BY sequence DESC LIMIT 40",
                    (plant_id,),
                ).fetchall()
            )
        ]
        # Use canonical area IDs rather than naming assumptions.
        capacities = line_capacities(catalog)
        rates = dict(capacities)
        result["nominal_output_per_hour"] = sum(capacities.values())
        priorities = {
            "healthy": 0,
            "affected": 1,
            "verifying": 2,
            "degrading": 3,
            "investigating": 4,
            "critical": 5,
            "stopped": 6,
        }
        assets = {asset["id"]: asset for asset in result["assets"]}
        affected = set()
        for state in states:
            view = snapshot(state)
            if state["history"]:
                profile = session_profile(state)
                if profile.asset_id in result["signals"]:
                    result["signals"][profile.asset_id] = view["signals"][profile.asset_id]
            current = state["incident"]
            if not config.INTERNAL_TEST_MODE and state.get("record_origin") != "plant_observation":
                continue
            if not current or current["state"] == "resolved":
                continue
            affected.update(view["affected"])
            for asset in view["assets"]:
                if (
                    asset["id"] in assets
                    and priorities[asset["status"]] > priorities[assets[asset["id"]]["status"]]
                ):
                    assets[asset["id"]]["status"] = asset["status"]
            for line in current["affected_lines"]:
                rates[line] = min(rates[line], view["line_output_per_hour"][line])
        result["affected"] = sorted(affected)
        result["output_per_hour"] = sum(rates.values())
        result["line_output_per_hour"] = rates
        if not config.INTERNAL_TEST_MODE:
            from .product_snapshot import project

            return project(db, plant_id, result, states, catalog)
        for asset in result["assets"]:
            if asset["id"] not in {session_profile(state).asset_id for state in states if state["history"]}:
                result["signals"][asset["id"]] = asset_signals(asset, result["window"])
        for asset in result["assets"]:
            if asset["type"] == "goods":
                result["signals"][asset["id"]][0]["value"] = result["output_per_hour"]
            elif asset["type"] == "press":
                output = next(
                    (signal for signal in result["signals"][asset["id"]] if signal["signal_id"] == "output"),
                    None,
                )
                if output is None:
                    output = asset_signals(asset, result["window"])[0]
                    result["signals"][asset["id"]].append(output)
                output["value"] = rates.get(asset["area_id"], 0)
        from .monitoring import view as monitoring_view

        monitoring = monitoring_view(db, plant_id, configuration, rates)
        result["monitoring"] = monitoring
        if monitoring["enabled"]:
            result.update(
                window=monitoring["tick"],
                running=monitoring["running"],
                simulated_minutes=max(0, monitoring["tick"] + 1),
                active_source_count=len(monitoring["sources"]),
            )
            for source in monitoring["health"]:
                result["signals"][source["asset_id"]] = source["signals"]
                if source["quality"] != "fresh" and assets[source["asset_id"]]["status"] == "healthy":
                    assets[source["asset_id"]]["status"] = "unknown"
        return result


def audit_page(store, token, plant_id, cursor=None, limit=50):
    available(store)
    with store.connection() as db:
        authorize(db, token, plant_id)
        query = "SELECT sequence,id,at,plant_id,actor_id,actor_name,action,incident_id,calculation_version,message FROM plant_audit WHERE plant_id=?"
        values = [plant_id]
        if cursor is not None:
            query += " AND sequence<?"
            values.append(cursor)
        rows = db.execute(query + " ORDER BY sequence DESC LIMIT ?", (*values, limit + 1)).fetchall()
        keys = (
            "sequence",
            "id",
            "at",
            "plant_id",
            "actor_id",
            "actor_name",
            "action",
            "incident_id",
            "calculation_version",
            "message",
        )
        return {
            "items": [dict(zip(keys, row)) for row in rows[:limit]],
            "next_cursor": rows[limit - 1][0] if len(rows) > limit else None,
        }


def advance_all(store):
    if store.cloud:
        return []
    with store.connection() as db:
        rows = db.execute("SELECT id,plant_id FROM plant_workflows").fetchall()
    jobs = []
    for workflow_id, plant_id in rows:
        state = store.read(workflow_id, internal_owner(plant_id))
        if not config.INTERNAL_TEST_MODE and state.get("record_origin", "legacy_replay") == "legacy_replay":
            continue
        incident = state["incident"]
        if incident and incident["state"] == "resolved":
            if state["running"]:

                def close_completed(current):
                    if (
                        current["incident"]
                        and current["incident"]["state"] == "resolved"
                        and current["running"]
                    ):
                        current["running"] = False
                        event(current, "Diagnostic replay closed after verified recovery")

                store.mutate(workflow_id, internal_owner(plant_id), close_completed, action="source.closed")
            continue
        timestamp = time.time()
        due = not state.get("_monitoring") and state["running"] and timestamp - state["last_tick"] >= 5
        expired = incident and (
            (incident["state"] == "investigating" and incident["lease_until"] < timestamp)
            or (incident["state"] == "detected" and timestamp - incident.get("queued_at", timestamp) > 90)
        )
        job = None
        if due or expired:
            job = store.mutate(workflow_id, internal_owner(plant_id), advance)
        if job:
            jobs.append(job)
        elif incident and incident["state"] == "detected" and not expired:
            # Recover dispatch interrupted between committed detection and execution.
            jobs.append(
                {
                    "session_id": workflow_id,
                    "owner": internal_owner(plant_id),
                    "generation": state["generation"],
                    "incident_id": incident["id"],
                }
            )
    return jobs
