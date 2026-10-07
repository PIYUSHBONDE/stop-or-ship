import json
import time
import uuid

from fastapi import HTTPException

from .decision_rules import calc_version as calc_version
from .decision_rules import refresh_constraints, temperature_triggers
from .economics import calculate
from .events import event as event
from .events import now as now
from .plant import AREAS, ASSETS, DEPENDENCIES, PLANT, downstream
from .profiles import SCENARIOS, affected_lines, profile_for, session_profile
from .telemetry import asset_signals, replay_data, sample


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
    count = 1 if step else min(12, int(elapsed / 5)) if s["running"] else 0
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
        s["history"] = (s["history"] + [row])[-80:]
        if (
            not i
            and s["scenario"]
            and len(s["history"]) >= 3
            and all(r["anomaly"] for r in s["history"][-3:])
        ):
            s["quotas"]["investigations"] += 1
            i = {
                "id": str(uuid.uuid4()),
                "asset_id": profile.asset_id,
                "profile_id": profile.id,
                "affected_lines": affected_lines(profile.asset_id),
                "state": "detected",
                "severity": "warning",
                "created_at": now(),
                "evidence": [],
                "diagnosis": None,
                "progress": [],
                "calculation": calculate(profile=profile, lines=affected_lines(profile.asset_id)),
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
            temperature_breach = bool(temperature_triggers(s, row))
            i["verification_windows"] = (
                0 if row["anomaly"] or temperature_breach else i["verification_windows"] + 1
            )
            if i["verification_windows"] >= 3:
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
                        "provenance": "Verified in simulated plant",
                    }
                )
                event(s, "Three healthy windows verified; confirmed repair stored in reliability memory")
            elif row["anomaly"]:
                i["verification_message"] = "Recovery not established: abnormal telemetry persists"
            elif temperature_breach:
                i["verification_message"] = (
                    "Recovery not established: temperature exceeds the configured demo limit"
                )
    return job


def approve(s, request, key):
    refresh_constraints(s)
    if key in s["idempotency"]:
        prior = s["idempotency"][key]
        if prior["request"] != request.model_dump():
            raise HTTPException(409, "Idempotency key was already used for a different approval")
        return prior["response"]
    i = require_incident(s, {"awaiting_approval"})
    if request.calculation_version != i["calculation_version"]:
        raise HTTPException(409, "Decision changed; review the current calculation before approving")
    option = next(o for o in i["calculation"]["options"] if o["id"] == request.option_id)
    if not option["feasible"]:
        raise HTTPException(409, option["constraint"])
    approval = {**request.model_dump(), "timestamp": now()}
    i["state"] = "approved"
    i["work_order"] = {
        "id": "WO-" + i["id"][:8].upper(),
        "incident_id": i["id"],
        "approval": approval,
        "status": "approved",
        "procedure": session_profile(s).procedure,
        "option": option,
        "calculation_snapshot": i["calculation"],
    }
    s["idempotency"][key] = {"request": request.model_dump(), "response": i["work_order"]}
    event(s, "Human approved " + option["name"] + "; work order issued")
    return i["work_order"]


def snapshot(s):
    i = s["incident"]
    profile = session_profile(s)
    active = bool(i and i["state"] != "resolved")
    affected = downstream(i["asset_id"]) if active else []
    lines = affected_lines(i["asset_id"]) if active else []
    stopped = bool(
        i
        and (
            i["state"] == "repairing"
            or (active and i.get("safety_stop", False))
            or (i["state"] == "approved" and i["work_order"]["approval"]["option_id"] == "stop")
        )
    )
    assets = [a.model_dump() for a in ASSETS]
    for a in assets:
        if a["id"] in affected:
            a["status"] = "stopped" if stopped and a["id"] != "FG-001" else "affected"
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
    output = 200 - len(lines) * (100 - rate)
    signals = {
        a["id"]: row["signals"] if a["id"] == profile.asset_id else asset_signals(a, s["window"])
        for a in assets
    }
    for asset in assets:
        if asset["type"] == "goods":
            signals[asset["id"]][0]["value"] = output
        elif asset["type"] == "press" and asset["id"] != profile.asset_id:
            signals[asset["id"]][0]["value"] = rate if asset["area_id"] in lines else 100
    return {
        "id": s["id"],
        "generation": s["generation"],
        "plant": PLANT.model_dump(),
        "areas": [a.model_dump() for a in AREAS],
        "assets": assets,
        "dependencies": [d.model_dump() for d in DEPENDENCIES],
        "signals": signals,
        "scenario": s["scenario"],
        "window": s["window"],
        "running": s["running"],
        "incident": i,
        "incidents": s.get("incidents", []) + ([i] if i else []),
        "scenarios": scenario_catalog(s),
        "affected": affected,
        "history": s["history"][-30:],
        "memory": s["memory"],
        "events": s["events"],
        "quotas": s["quotas"],
        "output_per_hour": output,
        "nominal_output_per_hour": 200,
        "data_mode": ("IMS measured bearing replay" if profile.id == "bearing" else "UCI measured replay")
        if row["provenance"] == "measured_replay"
        else "Synthetic fallback · dataset not prepared",
        "simulated_minutes": max(0, s["window"] + 1),
    }


def scenario_catalog(session=None):
    from .telemetry import bearing_data

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
