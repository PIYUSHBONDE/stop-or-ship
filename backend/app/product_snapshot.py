"""Operational plant projection: absent data never becomes generated health."""

import json

from .sources import views


def project(db, plant_id, result, states, catalog):
    sources = views(db, plant_id)
    result.update(
        sources=sources,
        monitoring=None,
        scenarios=[],
        running=False,
        simulated_minutes=0,
        data_mode="Plant observations",
        active_source_count=sum(s["configuration"]["kind"] == "operational" for s in sources),
    )
    result["signals"] = {asset["id"]: [] for asset in result["assets"]}
    assets = {asset["id"]: asset for asset in result["assets"]}
    for asset in assets.values():
        asset["status"] = "unknown"
    for source in sources:
        if source["configuration"]["kind"] != "operational":
            continue
        asset_id = source["configuration"]["asset_id"]
        if asset_id not in assets:
            continue
        result["signals"][asset_id] = source["signals"]
        if source["quality"] == "fresh" and source["diagnostic_ready"]:
            assets[asset_id]["status"] = (
                "healthy" if source["condition"] == "within_envelope" else "degrading"
            )
    affected = set()
    for state in states:
        incident = state["incident"]
        if (
            state.get("record_origin") != "plant_observation"
            or not incident
            or incident["state"] == "resolved"
        ):
            continue
        asset = assets.get(incident["asset_id"])
        if asset:
            asset["status"] = (
                "verifying"
                if incident["state"] == "verifying"
                else "investigating"
                if incident["state"] == "investigating"
                else "critical"
                if incident["severity"] == "critical"
                else "degrading"
            )
        from .plant import downstream

        affected.update(downstream(incident["asset_id"], catalog))
    result["affected"] = sorted(affected)
    for asset_id in affected:
        if asset_id in assets and assets[asset_id]["status"] == "healthy":
            assets[asset_id]["status"] = "affected"
    current_output = []
    for source in sources:
        asset = assets.get(source["configuration"]["asset_id"])
        if (
            asset
            and asset["type"] == "goods"
            and source["configuration"]["kind"] == "operational"
            and source["quality"] == "fresh"
        ):
            current_output.extend(
                signal["value"] for signal in source["signals"] if signal["signal_id"] == "output"
            )
    result["measured_output_per_hour"] = sum(current_output) if current_output else None
    result["estimated_output_per_hour"] = result["output_per_hour"]
    result["memory"] = [
        json.loads(row[0])
        for row in db.execute(
            "SELECT data FROM plant_cases WHERE plant_id=? ORDER BY verified_at,id", (plant_id,)
        )
        if json.loads(row[0]).get("record_origin") == "plant_observation"
    ]
    for incident in result["incidents"]:
        source = next((s for s in sources if s["id"] == incident.get("source_id")), None)
        reason = "Historical or legacy evidence; operational work is unavailable"
        if incident.get("record_origin") == "plant_observation":
            reason = None
            if not source or source["quality"] != "fresh" or not source["diagnostic_ready"]:
                reason = "Current complete telemetry and reviewed diagnostic rules are required"
            elif not source["configuration"]["procedure"].strip():
                reason = "Administrator-reviewed procedure required before approval"
        incident["authorization_blocked_reason"] = reason
    return result
