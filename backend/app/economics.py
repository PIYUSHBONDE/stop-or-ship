from decimal import ROUND_HALF_UP, Decimal

from .models import DecisionOption
from .profiles import EquipmentProfile

ASSUMPTIONS = {
    "horizon_minutes": 480,
    "configured_temperature_stop_celsius": 85,
    "line_units_per_hour": 100,
    "margin_per_unit_paise": 25000,
    "degraded_line_units_per_hour": 60,
    "derated_line_units_per_hour": 40,
    "repair_cost_paise": 1800000,
    "planned_repair_minutes": 60,
    "window_in_minutes": 180,
    "failure_extra_downtime_minutes": 240,
    "failure_damage_paise": 6500000,
    "delivery_target_units": 650,
    "penalty_per_missing_unit_paise": 10000,
    "failure_probabilities": {"stop": 0.01, "defer": 0.25, "derate": 0.07, "continue": 0.55},
    "provenance": "Synthetic operational assumptions; probabilities are not model predictions",
}


def rounded(value):
    return int(Decimal(str(value)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def calculate(
    risk_multiplier=1.0,
    safety_stop=False,
    profile: EquipmentProfile | None = None,
    lines=None,
    capacities=None,
):
    a = {**ASSUMPTIONS}
    lines = lines if lines is not None else ["line-a"]
    if profile:
        a.update(
            repair_cost_paise=profile.repair_cost_paise,
            planned_repair_minutes=profile.repair_minutes,
            degraded_line_units_per_hour=profile.degraded_rate,
            derated_line_units_per_hour=profile.derated_rate,
        )
    a["affected_lines"] = list(lines)
    capacities = capacities if capacities is not None else {line: 100 for line in set(lines)}
    nominal_rate = sum(capacities[line] for line in set(lines))
    a["line_capacities_units_per_hour"] = {line: capacities[line] for line in sorted(set(lines))}
    a["affected_nominal_units_per_hour"] = nominal_rate
    a["affected_delivery_target_units"] = rounded(Decimal(a["delivery_target_units"]) * nominal_rate / 100)
    a["production_scaling"] = (
        "Configured line capacities; degraded and derated rates are percentages of each line's nominal output. "
        "Delivery target units are scaled from the reference capacity of 100 parts/h. Integer quantities use half-up rounding."
    )
    repair_minutes = a["planned_repair_minutes"]
    plans = [
        ("stop", "Stop & repair now", repair_minutes, 0, 100),
        ("defer", "Repair at planned window", repair_minutes, 180, a["degraded_line_units_per_hour"]),
        ("derate", "Derate until repair window", repair_minutes, 180, a["derated_line_units_per_hour"]),
        ("continue", "Continue this shift", 0, 480, a["degraded_line_units_per_hour"]),
    ]
    options = []
    # Count unique affected lines once, including shared utility paths. Equipment repair is paid once.
    for id, name, downtime, delay, run_rate in plans:
        lost = rounded(
            (Decimal(downtime) * Decimal(100) / 60 + Decimal(delay) * Decimal(100 - run_rate) / 60)
            * Decimal(nominal_rate)
            / 100
        )
        output = rounded(Decimal(a["horizon_minutes"]) * nominal_rate / 60) - lost
        planned_margin = lost * a["margin_per_unit_paise"]
        target = a["affected_delivery_target_units"]
        planned_penalty = max(0, target - output) * a["penalty_per_missing_unit_paise"]
        p = min(0.95, a["failure_probabilities"][id] * risk_multiplier)
        additional_lost = min(
            output, rounded(Decimal(a["failure_extra_downtime_minutes"]) * nominal_rate / 60)
        )
        # Only incremental failure loss is charged; planned downtime is already accounted for.
        extra_penalty = (
            max(0, target - (output - additional_lost)) * a["penalty_per_missing_unit_paise"]
            - planned_penalty
        )
        failure = rounded(
            Decimal(str(p))
            * (
                a["failure_damage_paise"]
                + additional_lost * a["margin_per_unit_paise"]
                + extra_penalty
                + (a["repair_cost_paise"] if id == "continue" else 0)
            )
        )
        repair = a["repair_cost_paise"] if id != "continue" else 0
        feasible = not safety_stop or id == "stop"
        options.append(
            DecisionOption(
                id=id,
                name=name,
                feasible=feasible,
                constraint=None if feasible else "Configured hard safety stop forbids continued operation",
                repair_cost_paise=repair,
                lost_margin_paise=planned_margin,
                penalty_paise=planned_penalty,
                failure_exposure_paise=failure,
                total_paise=repair + planned_margin + planned_penalty + failure,
                failure_probability=p,
                lost_units=lost,
                downtime_minutes=downtime,
            ).model_dump()
        )
    feasible_options = [o for o in options if o["feasible"]]
    return {
        "options": options,
        "recommended": min(feasible_options, key=lambda o: o["total_paise"])["id"],
        "assumptions": a,
        "risk_multiplier": risk_multiplier,
        "sensitivity": [
            {
                "multiplier": m,
                "recommended": min(
                    calculate(m, safety_stop, profile, lines, capacities)["options"],
                    key=lambda o: o["total_paise"] if o["feasible"] else float("inf"),
                )["id"],
            }
            for m in (0.5, 1.5, 2)
        ]
        if risk_multiplier == 1.0
        else [],
    }
