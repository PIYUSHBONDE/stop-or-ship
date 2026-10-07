"""Human-controlled decision and repair transitions, independent of HTTP transport."""

import time
from dataclasses import dataclass

from fastapi import HTTPException

from .decision_rules import refresh_constraints, replace_calculation
from .economics import calculate
from .engine import event, guard_incident, require_incident
from .models import CalculationRequest, RepairRequest
from .profiles import affected_lines, session_profile


@dataclass(frozen=True)
class CommittedConflict:
    status_code: int
    detail: str


def persist_decision_transition(store, sid, owner, expected_incident, operation):
    """Commit newly observed constraints even when they invalidate the requested action."""

    def transition(session):
        changed = refresh_constraints(session)
        try:
            return operation(session)
        except HTTPException as error:
            if changed and error.status_code == 409:
                return CommittedConflict(error.status_code, error.detail)
            raise

    result = store.mutate(sid, owner, guard_incident(expected_incident, transition))
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
        affected_lines(incident["asset_id"]),
    )
    replace_calculation(session, calculation, "Risk assumption changed; renewed human approval required")
    incident["state"] = "awaiting_approval"


def start_repair(session: dict) -> None:
    refresh_constraints(session)
    incident = require_incident(session, {"approved"})
    order = incident["work_order"]
    if (
        not order
        or order["status"] != "approved"
        or order["approval"]["calculation_version"] != incident["calculation_version"]
    ):
        raise HTTPException(409, "Review and approve the current decision before starting repair")
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
