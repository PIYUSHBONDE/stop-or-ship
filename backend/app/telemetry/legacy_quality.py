"""Trusted local adapters; aligned replay timestamps never imply live PLC data."""

import math
from datetime import datetime, timedelta

from app.core.events import now
from app.telemetry.datasets import asset_signals, sample


def source_frame(asset, binding, tick, version, observed_at, incident=None, index=None):
    profile = asset.get("diagnostic_profile")
    recovering = bool(incident and incident["state"] in {"verifying", "resolved"})
    failed = bool(incident and (incident.get("repair") or {}).get("recovery") == "failed")
    if profile:
        row = sample(
            tick if index is None else index,
            profile + "_degradation",
            binding["mode"] == "healthy" or recovering,
            failed,
        )
    else:
        row = {
            "signals": asset_signals(dict(asset, status="healthy"), tick),
            "baseline": {},
            "deviations": {},
            "feature_deviations": {},
            "anomaly": False,
            "score": 0,
            "sensor_disagreement": False,
            "provenance": "synthetic",
            "source_cycle_id": None,
        }
    quality = binding["quality_mode"]
    timestamp = observed_at
    if quality == "stale":
        timestamp = (datetime.fromisoformat(observed_at) - timedelta(minutes=10)).isoformat()
    for signal in row["signals"]:
        signal.update(asset_id=asset["id"], timestamp=timestamp)
    if quality == "missing":
        row["signals"] = []
    if quality == "conflicting" and row["signals"]:
        signal = row["signals"][0]
        signal["value"] *= 1.8
        signal.update(
            provenance="synthetic", source_cycle_id=None, source_record_id=None, source_dataset_id=None
        )
        row["sensor_disagreement"] = True
        row["provenance"] = "Synthetic conflicting-sensor override; other values retain source provenance"
    if not row["signals"]:
        quality = "missing"
    elif any(not math.isfinite(signal["value"]) or not signal["unit"] for signal in row["signals"]):
        quality = "conflicting"
    # Quality faults are data availability events, not fault diagnoses or recovery evidence.
    if quality != "fresh":
        row["anomaly"] = False
    row.update(
        window=tick,
        plant_tick=tick,
        monitoring_version=version,
        observed_at=timestamp,
        received_at=now(),
        quality=quality,
    )
    return row


def health_view(asset, binding, row=None, workflow=None):
    quality = row["quality"] if row else "not_started"
    reasons = {
        "fresh": "Aligned observation available",
        "missing": "No observation received; condition unknown",
        "stale": "Observation is outdated or the running source stopped updating; condition unknown",
        "conflicting": "Configured sensor disagreement; condition unknown",
        "not_started": "No coordinated observation yet; condition unknown",
    }
    signals = row["signals"] if row else []
    measured = any(signal["provenance"] == "measured_replay" for signal in signals)
    return {
        "asset_id": asset["id"],
        "profile_id": asset.get("diagnostic_profile"),
        "source_label": "Measured test-rig replay mapped to equipment (records may be reused)"
        if measured
        else "Generated supporting signals / synthetic fallback",
        "quality": quality,
        "reason": reasons[quality],
        "observed_at": row["observed_at"] if row else None,
        "received_at": row["received_at"] if row else None,
        "signals": signals,
        "workflow_id": workflow["id"] if workflow else None,
        "incident_id": workflow["incident"]["id"] if workflow and workflow["incident"] else None,
    }
