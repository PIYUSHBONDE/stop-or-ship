import json
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.core import config
from app.core.events import event as event
from app.core.events import now as now
from app.incidents.decision_rules import calc_version as calc_version
from app.incidents.decision_rules import refresh_constraints, temperature_triggers
from app.incidents.economics import calculate, rounded
from app.plant.configuration import affected_capacities, line_capacities
from app.plant.profiles import SCENARIOS, affected_lines, profile_for, session_profile
from app.plant.topology import PLANT, catalog, downstream
from app.telemetry.datasets import asset_signals, replay_data, sample


def fresh(owner, id=None, quotas=None):
    return {
        "id": id or str(uuid.uuid4()),
        "owner": owner,
        "generation": str(uuid.uuid4()),
        "created_at": now(),
        "scenario": None,
        "window": -1,
        "running": False,
        "last_tick": time.time(),
        "history": [],
        "incident": None,
        "incidents": [],
        "memory": [],
        "quotas": quotas or {"investigations": 0, "questions": 0},
        "idempotency": {},
        "events": [],
    }


def require_incident(s, states):
    i = s["incident"]
    if not i or i["state"] not in states:
        raise HTTPException(409, "Action is not valid in the current incident state")
    return i


def start_scenario(s, name):
    if s["incident"] and s["incident"]["state"] != "resolved":
        raise HTTPException(409, "Resolve the current incident or reset the plant first")
    if name == "memory_recurrence" and not s["memory"]:
        raise HTTPException(409, "Verify a repair before starting the memory recurrence")
    if s["quotas"]["investigations"] >= 3:
        raise HTTPException(429, "Three investigations per session; reset does not replenish quota")
    if s["incident"]:
        s.setdefault("incidents", []).append(json.loads(json.dumps(s["incident"])))
    s["incidents"] = s.get("incidents", [])[-20:]
    s.update(scenario=name, window=-1, history=[], incident=None, running=True, last_tick=time.time())
    event(s, "Scenario started: " + name.replace("_", " "))


def advance(s, step=False):
    profile = session_profile(s)
    existing = s["incident"]
    if existing and existing["state"] == "investigating" and existing["lease_until"] < time.time():
        existing.update(
            state="investigation_failed",
            lease_until=0,
            error="Investigation lease expired; collected evidence is retained.",
        )
        event(s, "Investigation interrupted; no diagnosis asserted")
    if (
        existing
        and existing["state"] == "detected"
        and time.time() - existing.get("queued_at", time.time()) > 90
    ):
        existing.update(
            state="investigation_failed", error="Investigation did not start; retry or inspect evidence."
        )
        event(s, "Investigation dispatch interrupted; retry remains available")
    elapsed = time.time() - s["last_tick"]
    count = 0 if s.get("_monitoring") else 1 if step else min(12, int(elapsed / 5)) if s["running"] else 0
    if not count:
        return None
    s["last_tick"] = time.time() if step else s["last_tick"] + count * 5
    job = None
    for _ in range(count):
        s["window"] += 1
        i = s["incident"]
        recovering = bool(i and i["state"] in {"verifying", "resolved"})
        failed = bool(i and i.get("repair", {}).get("recovery") == "failed")
        row = sample(
            s["window"],
            profile.id + "_degradation" if s["scenario"] == "memory_recurrence" else s["scenario"],
            recovering,
            failed,
        )
        # Map a measured test-rig record to configured equipment without changing its values or source IDs.
        for signal in row["signals"]:
            signal["asset_id"] = profile.asset_id
        job = ingest_window(s, row) or job
    return job


def ingest_window(s, row):
    """Apply one aligned, quality-labelled window to the incident lifecycle."""
    profile = session_profile(s)
    i = s["incident"]
    job = None
    s["history"] = (s["history"] + [row])[-80:]
    if (
        not i
        and s["scenario"]
        and len(s["history"]) >= 3
        and all(r["anomaly"] and r.get("quality", "fresh") == "fresh" for r in s["history"][-3:])
    ):
        s["quotas"]["investigations"] += 1
        i = {
            "record_origin": s.get("record_origin", "legacy_replay"),
            "source_id": row.get("source_id"),
            "source_version": row.get("source_version"),
            "triggering_windows": json.loads(json.dumps(s["history"][-3:])),
            "id": str(uuid.uuid4()),
            "asset_id": profile.asset_id,
            "profile_id": profile.id,
            "monitoring_version": row.get("monitoring_version"),
            "detection_tick": row.get("plant_tick"),
            "detection_observed_at": row.get("observed_at"),
            "affected_lines": affected_lines(profile.asset_id, catalog(s)),
            "plant_configuration_version": s.get("_configuration_version"),
            "plant_context": json.loads(json.dumps(catalog(s))),
            "state": "detected",
            "severity": "warning",
            "created_at": now(),
            "evidence": [],
            "diagnosis": None,
            "progress": [],
            "calculation": calculate(
                profile=profile,
                lines=affected_lines(profile.asset_id, catalog(s)),
                capacities=affected_capacities(profile.asset_id, catalog(s)),
            ),
            "safety_stop": False,
            "safety_evidence": [],
            "calculation_revision": 1,
            "work_order": None,
            "verification_windows": 0,
            "lease_until": 0,
            "attempts": 0,
            "queued_at": time.time(),
        }
        s["incident"] = i
        i["calculation_version"] = calc_version(s)
        event(s, f"Persistent anomaly detected on {profile.asset_id}; investigation queued")
        job = {
            "session_id": s["id"],
            "owner": s["owner"],
            "generation": s["generation"],
            "incident_id": i["id"],
        }
    refresh_constraints(s)
    if i and i["state"] == "verifying":
        eligible = True
        if s.get("record_origin") == "plant_observation":
            eligible = bool(
                row.get("analysis_available")
                and row.get("window_start")
                and row["window_start"] >= i.get("repair_completed_at", "")
            )
            prior = s["history"][-2] if len(s["history"]) >= 2 else None
            if prior and row.get("window_start") != prior.get("observed_at"):
                i["verification_windows"] = 0
        temperature_breach = bool(temperature_triggers(s, row))
        i["verification_windows"] = (
            0
            if not eligible or row["anomaly"] or temperature_breach or row.get("quality", "fresh") != "fresh"
            else i["verification_windows"] + 1
        )
        if i["verification_windows"] >= 3:
            i.pop("verification_message", None)
            i["state"] = "resolved"
            i["safety_stop"] = False
            i["work_order"]["status"] = "verified"
            repair = i["repair"]
            s["memory"].append(
                {
                    "id": "case-" + i["id"],
                    "asset_id": i["asset_id"],
                    "incident_id": i["id"],
                    "observed_cause": repair["observed_cause"],
                    "fix": repair["fix"],
                    "parts": repair["parts"],
                    "outcome": repair["outcome"],
                    "verified_at": now(),
                    "original_diagnosis": i["diagnosis"],
                    "provenance": "Verified from post-repair operational observations"
                    if s.get("record_origin") == "plant_observation"
                    else "Verified in simulated plant",
                    "record_origin": s.get("record_origin", "legacy_replay"),
                }
            )
            event(s, "Three healthy windows verified; confirmed repair stored in reliability memory")
        elif not eligible or row.get("quality", "fresh") != "fresh":
            i["verification_message"] = (
                "Recovery not established: complete valid observations starting after repair completion are required"
            )
        elif row["anomaly"]:
            i["verification_message"] = "Recovery not established: abnormal telemetry persists"
        elif temperature_breach:
            i["verification_message"] = (
                "Recovery not established: reviewed operating envelope remains breached"
                if s.get("record_origin") == "plant_observation"
                else "Recovery not established: temperature exceeds the configured demo limit"
            )
        else:
            i.pop("verification_message", None)
    return job


def require_current_telemetry(s):
    if s.get("record_origin") == "plant_observation":
        latest = s["history"][-1] if s["history"] else None
        if (
            not latest
            or latest.get("source_version") != s.get("_source_version")
            or not latest.get("analysis_available")
            or not latest.get("observed_at")
            or (datetime.now(timezone.utc) - datetime.fromisoformat(latest["observed_at"])).total_seconds()
            > 180
        ):
            raise HTTPException(409, "Current complete telemetry and reviewed diagnostic rules are required")
    if s.get("_monitoring") and (
        not s["history"] or s.get("_monitoring_quality", s["history"][-1].get("quality")) != "fresh"
    ):
        raise HTTPException(
            409, "Fresh, consistent monitoring evidence is required before authorization or repair"
        )


def approve(s, request, key):
    if s.get("_plant_id") and not config.INTERNAL_TEST_MODE and s.get("record_origin") != "plant_observation":
        raise HTTPException(409, "Historical and legacy records cannot authorize operational work")
    refresh_constraints(s)
    if key in s["idempotency"]:
        prior = s["idempotency"][key]
        if prior["request"] != request.model_dump():
            raise HTTPException(409, "Idempotency key was already used for a different approval")
        return prior["response"]
    require_current_telemetry(s)
    if s.get("record_origin") == "plant_observation" and not s.get("_procedure", "").strip():
        raise HTTPException(409, "An administrator-reviewed procedure is required before approval")
    i = require_incident(s, {"awaiting_approval"})
    if request.calculation_version != i["calculation_version"]:
        raise HTTPException(409, "Decision changed; review the current calculation before approving")
    option = next(o for o in i["calculation"]["options"] if o["id"] == request.option_id)
    if not option["feasible"]:
        raise HTTPException(409, option["constraint"])
    approval = {**request.model_dump(), "timestamp": now()}
    if s.get("_actor"):
        approval.update(actor_id=s["_actor"]["id"], approver=s["_actor"]["display_name"])
    i["state"] = "approved"
    i["work_order"] = {
        "id": "WO-" + (i["id"] if s.get("_plant_id") else i["id"][:8]).upper(),
        "incident_id": i["id"],
        "approved_tick": s["window"],
        "approval": approval,
        "status": "approved",
        "procedure": s["_procedure"]
        if s.get("record_origin") == "plant_observation"
        else session_profile(s).procedure,
        "record_origin": s.get("record_origin", "legacy_replay"),
        "eligible_at": (
            datetime.now(timezone.utc)
            + timedelta(minutes={"stop": 0, "derate": 180, "defer": 180, "continue": 480}[request.option_id])
        ).isoformat(),
        "option": option,
        "calculation_snapshot": i["calculation"],
    }
    s["idempotency"][key] = {"request": request.model_dump(), "response": i["work_order"]}
    event(s, "Human approved " + option["name"] + "; work order issued")
    return i["work_order"]


def snapshot(s):
    product = bool(s.get("_plant_id") and not config.INTERNAL_TEST_MODE)
    i = s["incident"]
    profile = session_profile(s)
    active = bool(i and i["state"] != "resolved")
    configuration = catalog(s)
    capacities = line_capacities(configuration)
    affected = downstream(i["asset_id"], configuration) if active else []
    lines = affected_lines(i["asset_id"], configuration) if active else []
    stopped = bool(
        i
        and (
            i["state"] == "repairing"
            or (active and i.get("safety_stop", False))
            or (i["state"] == "approved" and i["work_order"]["approval"]["option_id"] == "stop")
        )
    )
    assets = [dict(asset, status="healthy") for asset in configuration["assets"]]
    for a in assets:
        if a["id"] in affected:
            a["status"] = "stopped" if stopped and a["type"] != "goods" else "affected"
        if i and a["id"] == i["asset_id"]:
            a["status"] = {
                "detected": "degrading",
                "investigating": "investigating",
                "investigation_failed": "degrading",
                "awaiting_approval": "degrading",
                "approved": "degrading",
                "repairing": "stopped",
                "verifying": "verifying",
                "resolved": "healthy",
            }.get(i["state"], "degrading")
            if stopped:
                a["status"] = "stopped"
            elif i["severity"] == "critical" and a["status"] == "degrading":
                a["status"] = "critical"
    row = (
        s["history"][-1]
        if s["history"]
        else {"signals": [], "provenance": "No data connected"}
        if product
        else sample(0, profile.id + "_degradation" if s["scenario"] == "memory_recurrence" else s["scenario"])
    )
    rate = profile.degraded_rate if active else 100
    if stopped:
        rate = 0
    elif (
        active
        and i.get("work_order")
        and i["state"] == "approved"
        and i["work_order"]["approval"]["option_id"] == "derate"
    ):
        rate = profile.derated_rate
    rates = {
        line: rounded(capacity * (rate if line in lines else 100) / 100)
        for line, capacity in capacities.items()
    }
    output = sum(rates.values())
    for signal in row["signals"]:
        signal["asset_id"] = profile.asset_id
    signals = {
        a["id"]: row["signals"]
        if a["id"] == profile.asset_id
        else []
        if product
        else asset_signals(a, s["window"])
        for a in assets
    }
    for asset in assets:
        if product:
            continue
        if asset["type"] == "goods":
            signals[asset["id"]][0]["value"] = output
        elif asset["type"] == "press" and asset["id"] != profile.asset_id:
            signals[asset["id"]][0]["value"] = rates.get(asset["area_id"], 0)
    return {
        "id": s["id"],
        "generation": s["generation"],
        "plant": PLANT.model_dump(),
        "areas": configuration["areas"],
        "assets": assets,
        "dependencies": configuration["dependencies"],
        "configuration_version": s.get("_configuration_version"),
        "signals": signals,
        "scenario": s["scenario"],
        "window": s["window"],
        "running": s["running"],
        "incident": i,
        "incidents": s.get("incidents", []) + ([i] if i else []),
        "scenarios": [] if product else scenario_catalog(s),
        "affected": affected,
        "history": s["history"][-30:],
        "memory": s["memory"],
        "events": s["events"],
        "quotas": s["quotas"],
        "output_per_hour": output,
        "line_output_per_hour": rates,
        "nominal_output_per_hour": sum(capacities.values()),
        "data_mode": row["provenance"]
        if product
        else ("IMS measured bearing replay" if profile.id == "bearing" else "UCI measured replay")
        if row["provenance"] == "measured_replay"
        else "Synthetic fallback · dataset not prepared",
        "simulated_minutes": max(0, s["window"] + 1),
    }


def scenario_catalog(session=None):
    from app.telemetry.datasets import bearing_data

    data = replay_data()
    result = []
    for name in SCENARIOS:
        p = (
            session_profile(session)
            if name == "memory_recurrence" and session and session["scenario"] == name
            else profile_for(name)
        )
        available = (
            bool(bearing_data())
            if p.id == "bearing"
            else bool(data and (p.id == "pump" or p.id in data.get("profiles", {})))
        )
        result.append(
            {
                "id": name,
                "name": {
                    "sensor_uncertainty": "Sensor disagreement",
                    "memory_recurrence": "Verified repair recurrence",
                }.get(name, p.title),
                "asset_id": p.asset_id,
                "profile_id": p.id,
                "measured_available": available,
                "provenance": "Measured test-rig replay; fictional plant mapping"
                if available
                else "Synthetic demonstration; measured dataset unavailable",
                "requires_memory": name == "memory_recurrence",
            }
        )
    return result


def guard_incident(expected_id, operation):
    """Check identity inside the same persistence transaction as the transition."""

    def guarded(session):
        if expected_id and (not session["incident"] or session["incident"]["id"] != expected_id):
            raise HTTPException(409, "Incident changed; reopen the current incident before acting")
        return operation(session)

    return guarded
