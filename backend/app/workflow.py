"""Human-controlled decision and repair transitions, independent of HTTP transport."""

import time

from .economics import calculate
from .engine import calc_version, event, require_incident
from .models import CalculationRequest, RepairRequest
from .profiles import affected_lines, session_profile


def recalculate_decision(session: dict, request: CalculationRequest) -> None:
    incident = require_incident(session, {"awaiting_approval", "approved"})
    incident["calculation"] = calculate(
        request.risk_multiplier,
        incident.get("safety_stop", False),
        session_profile(session),
        affected_lines(incident["asset_id"]),
    )
    incident["calculation_version"] = calc_version(session)
    if incident["work_order"]:
        incident.setdefault("superseded_work_orders", []).append(incident["work_order"])
    incident["work_order"] = None
    incident["state"] = "awaiting_approval"
    event(session, "Risk assumption changed; renewed human approval required")


def start_repair(session: dict) -> None:
    incident = require_incident(session, {"approved"})
    incident["state"] = "repairing"
    incident["work_order"]["status"] = "repairing"
    delay = {"stop": 0, "derate": 180, "defer": 180, "continue": 480}[
        incident["work_order"]["approval"]["option_id"]
    ]
    session["window"] += delay
    session["last_tick"] = time.time()
    if delay:
        event(session, f"Simulation advanced to the approved maintenance window ({delay} minutes)")
    event(
        session,
        f"Approved repair started; {incident['asset_id']} and dependent production isolated in simulation",
    )


def finish_repair(session: dict, request: RepairRequest) -> None:
    incident = require_incident(session, {"repairing"})
    incident.update(repair=request.model_dump(), state="verifying", verification_windows=0)
    incident["work_order"]["status"] = "completed_unverified"
    session.update(running=True, last_tick=time.time())
    event(session, "Technician outcome captured; telemetry recovery verification started")


def reopen_repair(session: dict) -> None:
    incident = require_incident(session, {"verifying"})
    incident.setdefault("repair_attempts", []).append(incident["repair"])
    incident.update(state="repairing", verification_windows=0)
    incident.pop("verification_message", None)
    incident["work_order"]["status"] = "repairing"
    event(session, "Unverified outcome retained; technician continuing the approved intervention")
