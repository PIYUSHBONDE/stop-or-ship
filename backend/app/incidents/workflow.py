"""Human-controlled decision and repair transitions, independent of HTTP transport."""

import time
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException

from app.contracts.models import CalculationRequest, RepairRequest
from app.incidents.decision_rules import refresh_constraints, replace_calculation
from app.incidents.economics import calculate
from app.incidents.engine import event, guard_incident, require_current_telemetry, require_incident
from app.plant.configuration import affected_capacities
from app.plant.profiles import affected_lines, session_profile
from app.plant.topology import catalog


@dataclass(frozen=True)
class CommittedConflict:
    status_code: int
    detail: str


def persist_decision_transition(store, sid, owner, expected_incident, operation, **access):
    """Commit newly observed constraints even when they invalidate the requested action."""

    def transition(session):
        changed = refresh_constraints(session)
        try:
            return operation(session)
        except HTTPException as error:
            if changed and error.status_code == 409:
                return CommittedConflict(error.status_code, error.detail)
            raise

    result = store.mutate(sid, owner, guard_incident(expected_incident, transition), **access)
    if isinstance(result, CommittedConflict):
        raise HTTPException(result.status_code, result.detail)
    return result


def recalculate_decision(session: dict, request: CalculationRequest) -> None:
    refresh_constraints(session)
    incident = require_incident(session, {"awaiting_approval", "approved"})
    calculation = calculate(
        request.risk_multiplier,
        incident.get("safety_stop", False),
        session_profile(session),
        affected_lines(incident["asset_id"], catalog(session)),
        affected_capacities(incident["asset_id"], catalog(session)),
    )
    replace_calculation(session, calculation, "Risk assumption changed; renewed human approval required")
    incident["state"] = "awaiting_approval"


def start_repair(session: dict) -> None:
    refresh_constraints(session)
    require_current_telemetry(session)
    incident = require_incident(session, {"approved"})
    order = incident["work_order"]
    if session.get("record_origin") == "plant_observation":
        if (
            not order
            or not order.get("eligible_at")
            or datetime.now(timezone.utc) < datetime.fromisoformat(order["eligible_at"])
        ):
            raise HTTPException(409, "The approved UTC maintenance eligibility time has not arrived")
    if (
        not order
        or order["status"] != "approved"
        or order["approval"]["calculation_version"] != incident["calculation_version"]
    ):
        raise HTTPException(409, "Review and approve the current decision before starting repair")
    delay = {"stop": 0, "derate": 180, "defer": 180, "continue": 480}[
        incident["work_order"]["approval"]["option_id"]
    ]
    if (
        session.get("_monitoring")
        and session.get("record_origin") != "plant_observation"
        and session["window"] < order.get("approved_tick", session["window"]) + delay
    ):
        raise HTTPException(409, "The approved maintenance window has not arrived on the shared plant clock")
    incident["state"] = "repairing"
    incident["work_order"]["status"] = "repairing"
    if not session.get("_monitoring"):
        session["window"] += delay
    session["last_tick"] = time.time()
    if delay and not session.get("_monitoring"):
        event(session, f"Simulation advanced to the approved maintenance window ({delay} minutes)")
    event(
        session,
        f"Authorized repair started for {incident['asset_id']}; physical isolation must be performed under the reviewed procedure",
    )


def finish_repair(session: dict, request: RepairRequest) -> None:
    incident = require_incident(session, {"repairing"})
    incident.update(repair=request.model_dump(), state="verifying", verification_windows=0)
    incident["repair_completed_at"] = datetime.now(timezone.utc).isoformat()
    incident["work_order"]["status"] = "completed_unverified"
    session.update(
        running=not bool(session.get("record_origin") == "plant_observation"), last_tick=time.time()
    )
    event(session, "Technician outcome captured; telemetry recovery verification started")


def reopen_repair(session: dict) -> None:
    incident = require_incident(session, {"verifying"})
    incident.setdefault("repair_attempts", []).append(incident["repair"])
    incident.update(state="repairing", verification_windows=0)
    incident.pop("verification_message", None)
    incident["work_order"]["status"] = "repairing"
    event(session, "Unverified outcome retained; technician continuing the approved intervention")
