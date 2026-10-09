"""Server-owned calculation revisions and latched demonstration constraints."""

import copy
import hashlib
import json

from .economics import ASSUMPTIONS, calculate
from .events import event, now
from .models import Signal
from .plant import catalog
from .plant_configuration import affected_capacities
from .profiles import affected_lines, session_profile


def calc_version(session):
    incident = session["incident"]
    content = json.dumps(
        {
            "generation": session["generation"],
            "incident": incident["id"],
            "revision": incident.get("calculation_revision", 1),
            "calculation": incident["calculation"],
        },
        sort_keys=True,
    )
    return hashlib.sha256(content.encode()).hexdigest()[:16]


def supersede_work_order(incident, reason):
    if not incident.get("work_order"):
        return
    retired = copy.deepcopy(incident["work_order"])
    retired.update(status="superseded", superseded_at=now(), superseded_reason=reason)
    incident.setdefault("superseded_work_orders", []).append(retired)
    incident["work_order"] = None


def replace_calculation(session, calculation, reason):
    incident = session["incident"]
    previous = incident["calculation_version"]
    supersede_work_order(incident, reason)
    incident["calculation"] = calculation
    incident["calculation_revision"] = incident.get("calculation_revision", 1) + 1
    incident["calculation_version"] = calc_version(session)
    incident["decision_changed_reason"] = reason
    incident.setdefault("decision_changes", []).append(
        {
            "at": now(),
            "reason": reason,
            "previous_version": previous,
            "calculation_version": incident["calculation_version"],
        }
    )
    if incident["state"] == "approved":
        incident["state"] = "awaiting_approval"
    event(session, reason)


def temperature_triggers(session, row):
    if session.get("_source_id"):
        if row.get("source_version") != session.get("_source_version"):
            return []
        rules = {r["signal_id"]: r for r in session.get("_source_rules", []) if r.get("requires_stop")}
        return [
            Signal.model_validate(signal).model_dump()
            for signal in row["signals"]
            if signal["signal_id"] in rules
            and (
                (
                    rules[signal["signal_id"]]["lower"] is not None
                    and signal["value"] < rules[signal["signal_id"]]["lower"]
                )
                or (
                    rules[signal["signal_id"]]["upper"] is not None
                    and signal["value"] > rules[signal["signal_id"]]["upper"]
                )
            )
        ]
    incident = session["incident"]
    return [
        Signal.model_validate(signal).model_dump()
        for signal in row["signals"]
        if signal["asset_id"] == incident["asset_id"]
        and signal["signal_id"] == "temperature"
        and signal["unit"] == "°C"
        and signal["value"] >= ASSUMPTIONS["configured_temperature_stop_celsius"]
    ]


def refresh_constraints(session):
    """Latch the first breach. Never rewrite an intervention already being executed."""
    incident = session.get("incident")
    if not incident or incident["state"] == "resolved" or incident.get("safety_stop"):
        return False
    history = session.get("history", [])
    if not history:
        return False
    triggers = temperature_triggers(session, history[-1])
    if not triggers:
        return False
    incident.update(safety_stop=True, safety_evidence=triggers, severity="critical")
    reason = (
        "Reviewed operating envelope breached; stop authorization required until verified recovery"
        if session.get("_source_id")
        else "Demo temperature constraint breached; stop is required until verified recovery"
    )
    if incident["state"] in {"repairing", "verifying"}:
        # Preserve the recorded authorization without claiming that physical isolation occurred.
        event(session, reason + "; active repair authorization and verification remain recorded")
        return True
    calculation = calculate(
        incident["calculation"]["risk_multiplier"],
        safety_stop=True,
        profile=session_profile(session),
        lines=affected_lines(incident["asset_id"], catalog(session)),
        capacities=affected_capacities(incident["asset_id"], catalog(session)),
    )
    replace_calculation(session, calculation, reason)
    return True
