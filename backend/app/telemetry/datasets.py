import json
import math
from datetime import datetime, timezone
from functools import lru_cache

from app.core import config
from app.plant.profiles import profile_for

UNITS = {
    "pressure": "bar",
    "flow": "L/min",
    "temperature": "°C",
    "power": "W",
    "vibration": "mm/s",
    "cooling_efficiency": "%",
    "cooling_power": "kW",
    "pressure_secondary": "bar",
    "flow_secondary": "L/min",
}
FALLBACK = {"pressure": 165.0, "flow": 6.5, "temperature": 42.0, "power": 2500.0, "vibration": 0.6}


@lru_cache(maxsize=1)
def detector():
    import pickle

    path = config.DATA / "artifacts" / "detector.pkl"
    # Load only the local artifact produced by prepare_data.py; never accept uploaded pickle files.
    with path.open("rb") as f:
        return pickle.load(f)


def replay_data():
    path = config.DATA / "artifacts" / "replay.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def bearing_data():
    path = config.DATA / "artifacts" / "bearing-replay.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def sample(window, scenario, recovering=False, failed=False):
    profile = profile_for(scenario)
    data = replay_data()
    if profile.id == "bearing":
        return bearing_sample(window, scenario, recovering, failed)
    if profile.id != "pump":
        data = data and data.get("profiles", {}).get(profile.id)
    abnormal = window >= 3 and scenario is not None and (not recovering or failed)
    kind = "fault" if abnormal and scenario != "sensor_uncertainty" else "healthy"
    if data:
        rows = data[kind]
        row = rows[window % len(rows)]
        values = row["values"].copy()
        cycle = row["cycle_id"]
        provenance = "measured_replay"
        baseline = data["baseline"]
    else:
        values = {
            k: round(v * (1 + 0.015 * math.sin(window + i)), 3) for i, (k, v) in enumerate(FALLBACK.items())
        }
        if kind == "fault":
            values.update(flow=3.5, pressure=125.0, power=2700.0, temperature=49.0, vibration=1.1)
        cycle, provenance, baseline = None, "synthetic", FALLBACK
    synthetic_override = abnormal and scenario == "sensor_uncertainty"
    if synthetic_override:
        values["pressure"] = baseline["pressure"] * 1.8
    stamp = datetime.now(timezone.utc).isoformat()
    signals = [
        {
            "asset_id": profile.asset_id,
            "signal_id": key,
            "timestamp": stamp,
            "value": round(value, 3),
            "unit": UNITS[key],
            "provenance": "synthetic" if synthetic_override and key == "pressure" else provenance,
            "source_cycle_id": None if synthetic_override and key == "pressure" else cycle,
            "source_dataset_id": "uci-hydraulics"
            if provenance == "measured_replay" and not (synthetic_override and key == "pressure")
            else None,
            "source_record_id": str(cycle)
            if cycle and not (synthetic_override and key == "pressure")
            else None,
        }
        for key, value in values.items()
    ]
    deviations = {k: round((values[k] - baseline[k]) / max(abs(baseline[k]), 0.001), 3) for k in values}
    feature_deviations = {}
    if data and not synthetic_override:
        import numpy as np

        fitted = detector()
        feature_values = row.get("features", values)
        feature_deviations = {
            k: round((feature_values[k] - v) / max(abs(v), 0.001), 3)
            for k, v in fitted.get("baseline_features", {}).items()
        }
        features = np.array([[feature_values[k] for k in fitted.get("features", list(values))]])
        score = float(-fitted["model"].score_samples(fitted["scaler"].transform(features))[0])
        anomaly = score > fitted["threshold"]
    else:
        score = max(abs(v) for v in deviations.values())
        anomaly = score > 0.15
    return {
        "window": window,
        "signals": signals,
        "baseline": baseline,
        "deviations": deviations,
        "anomaly": anomaly,
        "score": score,
        "sensor_disagreement": synthetic_override,
        "feature_deviations": feature_deviations,
        "provenance": provenance,
        "source_cycle_id": cycle,
    }


def bearing_sample(window, scenario, recovering=False, failed=False):
    """Bearing acceleration remains in source units; never present it as hydraulic mm/s."""
    data = bearing_data()
    abnormal = window >= 3 and scenario is not None and (not recovering or failed)
    baseline = (
        data["baseline"]
        if data
        else {"acceleration_rms": 0.08, "kurtosis": 3.0, "crest_factor": 4.0, "spectral_centroid": 2300.0}
    )
    row = (
        data["fault" if abnormal else "healthy"][window % len(data["fault" if abnormal else "healthy"])]
        if data
        else None
    )
    values = (
        row["values"]
        if row
        else {k: v * (3.5 if abnormal and k != "spectral_centroid" else 1) for k, v in baseline.items()}
    )
    units = (
        data["units"]
        if data
        else {
            "acceleration_rms": "g",
            "kurtosis": "dimensionless",
            "crest_factor": "dimensionless",
            "spectral_centroid": "Hz",
        }
    )
    deviations = {k: (values[k] - baseline[k]) / max(abs(baseline[k]), 0.001) for k in values}
    score = max(abs(v) for v in deviations.values())
    anomaly = score > (data["threshold"] if data else 0.8)
    provenance = "measured_replay" if data else "synthetic"
    signals = [
        {
            "asset_id": "M-107",
            "signal_id": k,
            "value": round(v, 4),
            "unit": units[k],
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "provenance": provenance,
            "source_cycle_id": None,
            "source_dataset_id": "ims-bearings" if data else None,
            "source_record_id": row["record_id"] if row else None,
        }
        for k, v in values.items()
    ]
    return {
        "window": window,
        "signals": signals,
        "baseline": baseline,
        "deviations": deviations,
        "anomaly": anomaly,
        "score": score,
        "sensor_disagreement": False,
        "provenance": provenance,
        "source_cycle_id": None,
    }


def asset_signals(asset, window):
    values = {
        "pump": ("flow", 6.5, "L/min"),
        "motor": ("power", 2500, "W"),
        "press": ("output", 100, "parts/h"),
        "conveyor": ("speed", 1.2, "m/s"),
        "cooling": ("temperature", 38, "°C"),
        "compressor": ("pressure", 7, "bar"),
        "electrical": ("voltage", 415, "V"),
        "goods": ("output", 200, "parts/h"),
    }
    key, value, unit = values[asset["type"]]
    factor = 0.6 if asset["status"] == "affected" else 0 if asset["status"] == "stopped" else 1
    return [
        {
            "asset_id": asset["id"],
            "signal_id": key,
            "value": round(value * factor * (1 + 0.005 * math.sin(window)), 2),
            "unit": unit,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "provenance": "synthetic",
            "source_cycle_id": None,
        }
    ]
