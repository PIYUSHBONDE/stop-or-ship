"""Transactional source configuration and accepted observation ingestion.

Uploaded data is evidence, never executable code or detector output. Operational
envelopes are reviewed per source; historical models stay scoped to test-rig data.
"""

import hashlib
import json
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.contracts.sources import SourceConfiguration
from app.core.events import now
from app.identity.staff_access import audit, authorize, available
from app.incidents.engine import fresh, ingest_window
from app.persistence.workspace_store import internal_owner, load_runtime, save_runtime
from app.plant.catalog import configuration_view
from app.telemetry.datasets import UNITS

BEARING_UNITS = {
    "acceleration_rms": "source units",
    "kurtosis": "dimensionless",
    "crest_factor": "dimensionless",
    "spectral_centroid": "Hz",
}
KNOWN_UNITS = {**UNITS, **BEARING_UNITS, "output": "parts/h"}


def utcnow():
    return datetime.now(timezone.utc)


def checksum(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def source_record(db, plant_id, source_id):
    row = db.execute(
        "SELECT data FROM telemetry_sources WHERE plant_id=? AND id=?", (plant_id, source_id)
    ).fetchone()
    if not row:
        raise HTTPException(404, "Source not found")
    return json.loads(row[0])


def checkpoint(db, source_id):
    row = db.execute("SELECT data FROM source_checkpoints WHERE source_id=?", (source_id,)).fetchone()
    return json.loads(row[0]) if row else {"recent": [], "latest": None, "workflow": None}


def diagnostic_ready(source):
    return any(
        rule["lower"] is not None or rule["upper"] is not None for rule in source["configuration"]["rules"]
    )


def source_view(db, source):
    point = checkpoint(db, source["id"])
    latest = point["latest"]
    configuration = source["configuration"]
    quality, reason = "not_connected", "No observations received; equipment condition unknown"
    signals = []
    if latest:
        quality = latest["quality"]
        if configuration["kind"] == "historical":
            quality, reason = "historical", "Historical evidence; not a current plant measurement"
        elif latest["source_version"] != source["version"]:
            quality, reason = "missing", "Source changed; submit a complete observation for this revision"
        elif (utcnow() - datetime.fromisoformat(latest["observed_at"])).total_seconds() > 180:
            quality, reason = "stale", "Observation is older than 180 seconds; condition unknown"
        elif quality == "incomplete":
            reason = "Required signals are missing; condition unknown"
        else:
            reason = "Complete current observation received"
        signals = latest["signals"]
    incident_id = None
    if point["workflow"]:
        row = db.execute(
            "SELECT data FROM plant_workflows WHERE id=? AND plant_id=?",
            (point["workflow"], source["plant_id"]),
        ).fetchone()
        incident = json.loads(row[0])["incident"] if row else None
        incident_id = incident["id"] if incident else None
    return {
        **{key: source[key] for key in ("id", "version", "configuration", "reviewed_by", "reviewed_at")},
        "quality": quality,
        "reason": reason,
        "diagnostic_ready": diagnostic_ready(source)
        or bool(configuration["kind"] == "historical" and latest and latest["analysis_available"]),
        "condition": "outside_envelope"
        if latest and quality == "fresh" and latest["analysis_available"] and latest["anomaly"]
        else "within_envelope"
        if latest and quality == "fresh" and latest["analysis_available"]
        else "unknown",
        "observed_at": latest["observed_at"] if latest else None,
        "received_at": latest["received_at"] if latest else None,
        "signals": signals,
        "incident_id": incident_id,
    }


def views(db, plant_id):
    return [
        source_view(db, json.loads(row[0]))
        for row in db.execute("SELECT data FROM telemetry_sources WHERE plant_id=? ORDER BY id", (plant_id,))
    ]


def read(store, token, plant_id):
    available(store)
    with store.connection() as db:
        db.execute("BEGIN")
        authorize(db, token, plant_id)
        return views(db, plant_id)


def configure(store, token, plant_id, request: SourceConfiguration, source_id=None):
    available(store)
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        actor = authorize(db, token, plant_id, "plant.configure")["user"]
        catalog = configuration_view(db, plant_id)
        if catalog["version"] != request.plant_configuration_version:
            raise HTTPException(409, "Plant configuration changed; reload before saving the source")
        asset = next((a for a in catalog["configuration"]["assets"] if a["id"] == request.asset_id), None)
        if not asset:
            raise HTTPException(422, "Source equipment is not in this plant")
        for rule in request.rules:
            if KNOWN_UNITS.get(rule.signal_id) != rule.unit:
                raise HTTPException(422, "Unsupported signal or incompatible unit: " + rule.signal_id)
        prior = source_record(db, plant_id, source_id) if source_id else None
        if request.expected_version != (prior["version"] if prior else 0):
            raise HTTPException(409, "Source revision changed; reload before saving")
        if prior and any(
            prior["configuration"][key] != getattr(request, key) for key in ("asset_id", "kind")
        ):
            raise HTTPException(422, "Source equipment and origin are immutable; create a different source")
        if request.kind == "operational":
            other = db.execute(
                "SELECT id FROM telemetry_sources WHERE plant_id=? AND asset_id=? AND kind='operational'",
                (plant_id, request.asset_id),
            ).fetchone()
            if other and other[0] != source_id:
                raise HTTPException(409, "Equipment already has an operational source")
        source_id = source_id or str(uuid.uuid4())
        source = dict(
            id=source_id,
            plant_id=plant_id,
            version=(prior["version"] + 1 if prior else 1),
            configuration=request.model_dump(),
            reviewed_by=actor["display_name"],
            reviewed_at=now(),
        )
        db.execute(
            "INSERT INTO telemetry_sources VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data",
            (source_id, plant_id, request.asset_id, request.kind, source["version"], json.dumps(source)),
        )
        db.execute(
            "INSERT INTO source_revisions VALUES (?,?,?)", (source_id, source["version"], json.dumps(source))
        )
        point = checkpoint(db, source_id)
        point["recent"] = []
        if point["workflow"]:
            row = db.execute(
                "SELECT id,plant_id,data FROM plant_workflows WHERE id=?", (point["workflow"],)
            ).fetchone()
            state = load_runtime(db, row)
            state["_source_version"] = source["version"]
            state["_procedure"] = request.procedure
            state["_source_rules"] = [rule.model_dump() for rule in request.rules]
            state["_monitoring_quality"] = "missing"
            incident = state["incident"]
            if incident and incident["state"] not in {"resolved", "repairing", "verifying"}:
                from app.incidents.decision_rules import replace_calculation

                replace_calculation(
                    state,
                    incident["calculation"],
                    "Source configuration changed; renewed review and approval required",
                )
            if incident:
                incident["verification_windows"] = 0
            save_runtime(db, state, actor, "source.configuration_changed")
        save_checkpoint(db, source_id, point)
        audit(
            db,
            plant_id,
            actor,
            "source.configured",
            f"Source {source_id} revision {source['version']} reviewed",
        )
        return source_view(db, source)


def save_checkpoint(db, source_id, point):
    db.execute(
        "INSERT INTO source_checkpoints VALUES (?,?) ON CONFLICT(source_id) DO UPDATE SET data=excluded.data",
        (source_id, json.dumps(point)),
    )


def normalized_frame(source, window, ordinal):
    configuration = source["configuration"]
    historical = configuration["kind"] == "historical"
    rules = {r["signal_id"]: r for r in configuration["rules"]}
    values = {v.signal_id: v for v in window.values}
    for key, value in values.items():
        if KNOWN_UNITS.get(key) != value.unit or (key in rules and rules[key]["unit"] != value.unit):
            raise HTTPException(422, "Unsupported signal or incompatible unit: " + key)
    if not historical:
        if not rules:
            # Accept observations without diagnostic envelopes, but never assert healthy.
            expected = set(values)
        else:
            expected = set(rules)
        if window.observed_at is None or window.window_start is None:
            raise HTTPException(422, "Operational observations require UTC window start and end")
        if (window.observed_at - window.window_start).total_seconds() != 60:
            raise HTTPException(422, "Operational windows must cover exactly 60 seconds")
        age = (utcnow() - window.observed_at).total_seconds()
        if age > 180 or age < -30:
            raise HTTPException(422, "Observation is stale or more than 30 seconds in the future")
    else:
        expected = set(values)
    observed = window.observed_at.astimezone(timezone.utc).isoformat() if window.observed_at else None
    signals = [
        dict(
            asset_id=configuration["asset_id"],
            signal_id=v.signal_id,
            value=v.value,
            unit=v.unit,
            timestamp=observed,
            provenance="historical_import" if historical else "operational_observation",
            source_record_id=window.record_id,
            source_dataset_id=configuration["dataset"] or None,
            source_cycle_id=None,
            source_id=source["id"],
            source_version=source["version"],
        )
        for v in window.values
    ]
    baseline, deviations = {}, {}
    abnormal = False
    for key, rule in rules.items():
        if key not in values:
            continue
        value = values[key].value
        abnormal |= (rule["lower"] is not None and value < rule["lower"]) or (
            rule["upper"] is not None and value > rule["upper"]
        )
        if rule["lower"] is not None and rule["upper"] is not None:
            baseline[key] = (rule["lower"] + rule["upper"]) / 2
            deviations[key] = (value - baseline[key]) / max(abs(baseline[key]), 0.001)
    complete = expected.issubset(values)
    return dict(
        window=ordinal,
        signals=signals,
        baseline=baseline,
        deviations=deviations,
        feature_deviations={},
        anomaly=bool(abnormal and complete),
        score=max([abs(d) for d in deviations.values()] or [0]),
        sensor_disagreement=False,
        provenance="Historical imported dataset" if historical else "Submitted operational observation",
        source_cycle_id=None,
        source_id=source["id"],
        source_version=source["version"],
        observed_at=observed,
        window_start=window.window_start.astimezone(timezone.utc).isoformat()
        if window.window_start
        else None,
        received_at=now(),
        quality="fresh" if complete else "incomplete",
        record_id=window.record_id,
        analysis_available=diagnostic_ready(source),
    )


def apply_historical_model(frame, source, window, profile):
    """Only score compatible original dataset features; never fill missing values."""
    from app.telemetry.datasets import bearing_data, detector, replay_data

    dataset = source["configuration"]["dataset"]
    if dataset == "ims-bearings" and profile == "bearing":
        data = bearing_data()
        if data and set(data["baseline"]).issubset(v.signal_id for v in window.values):
            values = {v.signal_id: v.value for v in window.values}
            deviations = {
                key: (values[key] - baseline) / max(abs(baseline), 0.001)
                for key, baseline in data["baseline"].items()
            }
            score = max(abs(v) for v in deviations.values())
            frame.update(
                baseline=data["baseline"],
                deviations=deviations,
                score=score,
                anomaly=score > data["threshold"],
                analysis_available=True,
            )
    elif dataset == "uci-hydraulics" and profile in {"pump", "cooler", "valve"} and replay_data():
        fitted = detector()
        features = {}
        for v in window.values:
            features[v.signal_id] = v.value
            if v.std is not None:
                features[v.signal_id + "_std"] = v.std
            if v.p95 is not None:
                features[v.signal_id + "_p95"] = v.p95
        if set(fitted["features"]).issubset(features):
            import numpy as np

            baseline = fitted["baseline_features"]
            score = float(
                -fitted["model"].score_samples(
                    fitted["scaler"].transform(np.array([[features[k] for k in fitted["features"]]]))
                )[0]
            )
            frame.update(
                baseline={k: v for k, v in baseline.items() if not k.endswith(("_std", "_p95"))},
                feature_deviations={k: (features[k] - v) / max(abs(v), 0.001) for k, v in baseline.items()},
                score=score,
                anomaly=score > fitted["threshold"],
                analysis_available=True,
            )


def ingest(store, token, plant_id, source_id, expected_version, windows, key, expected_checksum=None):
    available(store)
    payload_hash = checksum(
        dict(
            source_id=source_id,
            version=expected_version,
            windows=[w.model_dump(mode="json") for w in windows],
        )
    )
    if expected_checksum and expected_checksum != payload_hash:
        raise HTTPException(409, "Import preview changed; preview this batch again")
    jobs = []
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        actor = authorize(db, token, plant_id, "plant.manage")["user"]
        receipt_key = actor["id"] + ":" + key
        receipt = db.execute(
            "SELECT checksum,data FROM ingestion_receipts WHERE plant_id=? AND key=?", (plant_id, receipt_key)
        ).fetchone()
        if receipt:
            if receipt[0] != payload_hash:
                raise HTTPException(409, "Idempotency key belongs to a different ingestion")
            return json.loads(receipt[1]), []
        source = source_record(db, plant_id, source_id)
        if source["version"] != expected_version:
            raise HTTPException(409, "Source changed; reload before submitting observations")
        catalog = configuration_view(db, plant_id)
        asset = next(
            (a for a in catalog["configuration"]["assets"] if a["id"] == source["configuration"]["asset_id"]),
            None,
        )
        if not asset:
            raise HTTPException(409, "Source equipment is no longer configured")
        point = checkpoint(db, source_id)
        accepted, duplicates, incidents = 0, 0, []
        for window in windows:
            raw = window.model_dump(mode="json")
            digest = checksum(raw)
            prior = db.execute(
                "SELECT checksum FROM telemetry_records WHERE source_id=? AND record_id=?",
                (source_id, window.record_id),
            ).fetchone()
            if prior:
                if prior[0] != digest:
                    raise HTTPException(409, "Record ID already exists with different data")
                duplicates += 1
                continue
            row = normalized_frame(source, window, point.get("count", 0))
            if source["configuration"]["kind"] == "historical":
                apply_historical_model(row, source, window, asset.get("diagnostic_profile"))
            latest = point["latest"]
            if source["configuration"]["kind"] == "operational" and latest:
                if row["window_start"] < latest["observed_at"]:
                    raise HTTPException(409, "Out-of-order or overlapping observation window")
                if row["window_start"] != latest["observed_at"]:
                    point["recent"] = []
            db.execute(
                "INSERT INTO telemetry_records VALUES (?,?,?,?,?)",
                (
                    source_id,
                    window.record_id,
                    digest,
                    json.dumps(
                        dict(
                            observation=raw,
                            frame=row,
                            source_version=source["version"],
                            attribution=source["configuration"]["attribution"],
                            transformation=source["configuration"]["transformation"],
                        )
                    ),
                    row["received_at"],
                ),
            )
            point["recent"] = (point["recent"] + [row])[-3:]
            point["latest"] = row
            point["count"] = point.get("count", 0) + 1
            accepted += 1
            state = None
            if point["workflow"]:
                record = db.execute(
                    "SELECT id,plant_id,data FROM plant_workflows WHERE id=?", (point["workflow"],)
                ).fetchone()
                state = load_runtime(db, record)
                if state["incident"]["state"] == "resolved":
                    state = None
            persistent = len(point["recent"]) == 3 and all(
                r["anomaly"] and r["quality"] == "fresh" and r["analysis_available"] for r in point["recent"]
            )
            if state is None and persistent and asset.get("diagnostic_profile"):
                state = fresh(internal_owner(plant_id))
                state.update(
                    _plant_id=plant_id,
                    _catalog=catalog["configuration"],
                    _configuration_version=catalog["version"],
                    _profile_id=asset["diagnostic_profile"],
                    _asset_id=asset["id"],
                    _source_id=source_id,
                    _source_version=source["version"],
                    _procedure=source["configuration"]["procedure"],
                    _source_rules=source["configuration"]["rules"],
                    _monitoring=True,
                    record_origin="historical_import"
                    if source["configuration"]["kind"] == "historical"
                    else "plant_observation",
                    scenario=asset["diagnostic_profile"] + "_degradation",
                    history=point["recent"][:-1],
                    running=False,
                )
                db.execute(
                    "INSERT INTO plant_workflows VALUES (?,?,?,?,1,?)",
                    (state["id"], plant_id, asset["id"], now(), "{}"),
                )
                point["workflow"] = state["id"]
            if state:
                if (
                    row["window_start"]
                    and len(point["recent"]) == 1
                    and state["incident"]["state"] == "verifying"
                ):
                    state["incident"]["verification_windows"] = 0
                state["window"] = row["window"]
                state["_monitoring_quality"] = row["quality"]
                state["_actor"] = actor
                job = ingest_window(state, row)
                if job:
                    day = utcnow().date().isoformat()
                    budget = db.execute(
                        "SELECT calls FROM ingestion_budgets WHERE plant_id=? AND day=?", (plant_id, day)
                    ).fetchone()
                    used = budget[0] if budget else 0
                    if used >= 3:
                        state["incident"].update(
                            state="investigation_failed",
                            error="Daily plant investigation allowance reached; evidence retained",
                        )
                    else:
                        db.execute(
                            "INSERT INTO ingestion_budgets VALUES (?,?,1) ON CONFLICT(plant_id,day) DO UPDATE SET calls=calls+1",
                            (plant_id, day),
                        )
                        jobs.append(job)
                if state["incident"]:
                    incidents.append(state["incident"]["id"])
                save_runtime(db, state, actor, "telemetry.ingested")
        save_checkpoint(db, source_id, point)
        result = dict(accepted=accepted, duplicates=duplicates, incident_ids=list(dict.fromkeys(incidents)))
        db.execute(
            "INSERT INTO ingestion_receipts VALUES (?,?,?,?)",
            (plant_id, receipt_key, payload_hash, json.dumps(result)),
        )
        audit(
            db,
            plant_id,
            actor,
            "telemetry.batch_accepted",
            f"Source {source_id}: {accepted} windows accepted; {duplicates} duplicates",
        )
        return result, jobs
