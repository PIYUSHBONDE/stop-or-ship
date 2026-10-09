"""Reviewed demo configuration; profiles are data, never model instructions."""

from dataclasses import dataclass, replace


@dataclass(frozen=True)
class EquipmentProfile:
    id: str
    asset_id: str
    title: str
    dataset: str
    primary_cause: str
    alternative: str
    missing: str
    procedure: str
    repair_cost_paise: int
    repair_minutes: int
    degraded_rate: int = 60
    derated_rate: int = 40


PROFILES = {
    "pump": EquipmentProfile(
        "pump",
        "P-107",
        "Pump degradation",
        "uci-hydraulics",
        "Internal pump leakage",
        "Valve bypass or restriction",
        "Independent leakage and valve inspection",
        "Apply the demo isolation procedure; independently inspect leakage and bypass valves before replacing seals.",
        1800000,
        60,
    ),
    "cooler": EquipmentProfile(
        "cooler",
        "CL-001",
        "Shared cooling degradation",
        "uci-hydraulics",
        "Reduced cooling performance",
        "Changing heat load or temperature instrumentation",
        "Independent oil temperature and cooling-circuit inspection",
        "Isolate shared cooling in the simulation; inspect airflow, fouling and cooling flow before restoring dependent lines.",
        2400000,
        90,
        65,
        45,
    ),
    "valve": EquipmentProfile(
        "valve",
        "PR-101",
        "Press valve degradation",
        "uci-hydraulics",
        "Delayed hydraulic valve response",
        "Pump leakage or changing cycle demand",
        "Valve timing measurement and independent hydraulic inspection",
        "Isolate the press in the simulation; inspect valve timing, spool movement and bypass before servicing the valve.",
        1200000,
        45,
        70,
        45,
    ),
    "bearing": EquipmentProfile(
        "bearing",
        "M-107",
        "Motor bearing degradation",
        "ims-bearings",
        "Possible bearing degradation",
        "Misalignment, looseness or changing vibration acquisition",
        "Independent bearing inspection and alignment measurement",
        "Isolate the motor in the simulation; inspect bearing, alignment and mounting before replacing the bearing.",
        1500000,
        90,
        55,
        35,
    ),
}

SCENARIOS = {
    "pump_degradation": "pump",
    "cooler_degradation": "cooler",
    "valve_degradation": "valve",
    "bearing_degradation": "bearing",
    "sensor_uncertainty": "pump",
    "memory_recurrence": "pump",
}


def profile_for(scenario: str | None) -> EquipmentProfile:
    return PROFILES[SCENARIOS.get(scenario, "pump")]


def affected_lines(asset_id: str, configuration=None) -> list[str]:
    from app.plant.configuration import affected_capacities
    from app.plant.topology import catalog

    return sorted(affected_capacities(asset_id, configuration or catalog({})))


def session_profile(session) -> EquipmentProfile:
    if session.get("_profile_id") in PROFILES:
        profile = PROFILES[session["_profile_id"]]
        return replace(profile, asset_id=session.get("_asset_id", profile.asset_id))
    if session["scenario"] == "memory_recurrence" and session["memory"]:
        asset_id = session["memory"][-1]["asset_id"]
        return next(
            (profile for profile in PROFILES.values() if profile.asset_id == asset_id), PROFILES["pump"]
        )
    return profile_for(session["scenario"])
