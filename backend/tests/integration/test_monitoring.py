"""Coordinated ingestion, ownership and recovery correctness with isolated plants."""

import copy
import json
import time

import pytest

from app.persistence.store import Store
from app.telemetry.legacy_monitoring import advance_plants
from tests.support.workspace import approval


def configuration(client, plant_id, profile=None, quality="fresh"):
    base = f"/api/v1/plants/{plant_id}"
    view = client.get(base + "/monitoring").json()
    assets = client.get(base + "/snapshot").json()["assets"]
    target = next((asset["id"] for asset in assets if asset["diagnostic_profile"] == profile), None)
    for binding in view["sources"]:
        if profile and binding["asset_id"] == target:
            binding.update(mode="degradation", quality_mode=quality)
    body = dict(
        expected_version=view["version"],
        plant_configuration_version=view["plant_configuration_version"],
        enabled=True,
        sources=view["sources"],
    )
    result = client.post(base + "/monitoring", json=body)
    assert result.status_code == 200, result.text
    return result.json(), target


def clock(client, plant_id, action="step", key=None, **overrides):
    base = f"/api/v1/plants/{plant_id}"
    current = client.get(base + "/monitoring").json()
    return client.post(
        base + "/monitoring/clock",
        json=dict(
            action=action, expected_tick=current["tick"], expected_version=current["version"], **overrides
        ),
        headers={"Idempotency-Key": key or f"tick-{action}-{current['tick']}-{current['version']}"},
    )


def steps(client, plant_id, count=6):
    for _ in range(count):
        response = clock(client, plant_id)
        assert response.status_code == 200, response.text
    return client.get(f"/api/v1/plants/{plant_id}/snapshot").json()


def quality(client, plant_id, asset_id, value):
    view = client.get(f"/api/v1/plants/{plant_id}/monitoring").json()
    sources = copy.deepcopy(view["sources"])
    next(binding for binding in sources if binding["asset_id"] == asset_id)["quality_mode"] = value
    return client.post(
        f"/api/v1/plants/{plant_id}/monitoring",
        json=dict(
            expected_version=view["version"],
            plant_configuration_version=view["plant_configuration_version"],
            enabled=True,
            sources=sources,
        ),
    )


def test_one_clock_all_assets_and_read_only_polling(shared):
    _, _, client, plant_id, _ = shared
    configuration(client, plant_id)
    state = steps(client, plant_id, 1)
    monitoring = state["monitoring"]
    assert monitoring["tick"] == 0 and monitoring["quality_issue_count"] == 0
    stamps = {signal["timestamp"] for source in monitoring["health"] for signal in source["signals"]}
    assert stamps == {monitoring["observed_at"]}
    assert len(monitoring["health"]) == len(state["assets"])
    assert not state["incidents"]
    for _ in range(3):
        assert client.get(f"/api/v1/plants/{plant_id}/snapshot").json()["monitoring"]["tick"] == 0
    assert (
        client.post(f"/api/v1/plants/{plant_id}/scenarios", json={"scenario": "pump_degradation"}).status_code
        == 409
    )


@pytest.mark.parametrize("profile", ["pump", "cooler", "valve", "bearing"])
def test_automatic_detection_and_versioned_ai_evidence(shared, profile):
    _, _, client, plant_id, _ = shared
    mapping, target = configuration(client, plant_id, profile)
    state = steps(client, plant_id)
    incident = state["incident"]
    assert incident["asset_id"] == target
    assert incident["state"] == "awaiting_approval"
    assert incident["monitoring_version"] == mapping["version"]
    assert incident["detection_tick"] == 5
    doc = next(doc for doc in incident["evidence"] if doc["id"] == "telemetry-current")
    text = json.loads(doc["text"])
    assert text["plant_tick"] == 5 and text["quality"] == "fresh"
    assert text["observed_at"] == incident["detection_observed_at"]
    state = steps(client, plant_id, 4)
    assert len(state["incidents"]) == 1
    assert (
        client.post(
            f"/api/v1/plants/{plant_id}/replay",
            json={"action": "step"},
            headers={"X-Incident-ID": incident["id"]},
        ).status_code
        == 409
    )


@pytest.mark.parametrize("value", ["missing", "stale", "conflicting"])
def test_bad_data_never_becomes_healthy_or_creates_diagnosis(shared, value):
    _, _, client, plant_id, _ = shared
    _, target = configuration(client, plant_id, "pump", value)
    state = steps(client, plant_id)
    assert state["incidents"] == []
    assert next(asset for asset in state["assets"] if asset["id"] == target)["status"] == "unknown"
    source = next(source for source in state["monitoring"]["health"] if source["asset_id"] == target)
    assert source["quality"] == value
    if value == "missing":
        assert source["signals"] == []
    elif value == "conflicting":
        assert source["signals"][0]["provenance"] == "synthetic"
        assert source["signals"][0]["source_dataset_id"] is None


def test_stale_mapping_tick_and_idempotent_controls(shared):
    store, _, client, plant_id, _ = shared
    view, _ = configuration(client, plant_id)
    body = dict(action="step", expected_tick=-1, expected_version=view["version"])
    path = f"/api/v1/plants/{plant_id}/monitoring/clock"
    assert client.post(path, json=body, headers={"Idempotency-Key": "repeat-clock"}).status_code == 200
    assert client.post(path, json=body, headers={"Idempotency-Key": "repeat-clock"}).json()["tick"] == 0
    assert client.post(path, json=body, headers={"Idempotency-Key": "another-clock"}).status_code == 409
    assert (
        client.post(
            path, json={**body, "action": "play"}, headers={"Idempotency-Key": "repeat-clock"}
        ).status_code
        == 409
    )
    assert clock(client, plant_id, "play").status_code == 200
    with store.connection() as db:
        state = json.loads(
            db.execute("SELECT data FROM plant_monitoring WHERE plant_id=?", (plant_id,)).fetchone()[0]
        )
        state["last_tick"] = time.time() - 6
        db.execute("UPDATE plant_monitoring SET data=? WHERE plant_id=?", (json.dumps(state), plant_id))
    advance_plants(Store(store.path, cloud=False))
    assert client.get(f"/api/v1/plants/{plant_id}/monitoring").json()["tick"] == 1
    with store.connection() as db:
        assert (
            db.execute("SELECT COUNT(*) FROM monitoring_revisions WHERE plant_id=?", (plant_id,)).fetchone()[
                0
            ]
            == 1
        )


def test_quality_blocks_authorization_start_and_verified_memory(shared):
    _, _, client, plant_id, _ = shared
    _, target = configuration(client, plant_id, "pump")
    incident = steps(client, plant_id)["incident"]
    assert quality(client, plant_id, target, "missing").status_code == 200
    assert approval(client, plant_id, incident).status_code == 409
    assert quality(client, plant_id, target, "fresh").status_code == 200
    state = steps(client, plant_id, 1)
    incident = state["incident"]
    assert approval(client, plant_id, incident).status_code == 200
    assert quality(client, plant_id, target, "missing").status_code == 200
    base = f"/api/v1/plants/{plant_id}"
    headers = {"X-Incident-ID": incident["id"]}
    assert client.post(base + "/repair/start", json={}, headers=headers).status_code == 409
    assert quality(client, plant_id, target, "fresh").status_code == 200
    steps(client, plant_id, 1)
    assert client.post(base + "/repair/start", json={}, headers=headers).status_code == 200
    assert (
        client.post(
            base + "/repair/complete",
            json=dict(
                observed_cause="Seal degradation",
                fix="Replace seals and test flow",
                parts="Seal kit",
                outcome="Pressure recovered",
                recovery="healthy",
            ),
            headers=headers,
        ).status_code
        == 200
    )
    assert quality(client, plant_id, target, "missing").status_code == 200
    state = steps(client, plant_id, 3)
    assert state["incident"]["state"] == "verifying" and state["memory"] == []
    assert state["incident"]["verification_windows"] == 0
    assert quality(client, plant_id, target, "fresh").status_code == 200
    state = steps(client, plant_id, 3)
    assert state["incident"]["state"] == "resolved" and len(state["memory"]) == 1
    assert len(steps(client, plant_id, 3)["incidents"]) == 1


def test_scope_roles_and_mapping_validation(shared):
    _, _, admin, plant_id, invite = shared
    viewer, _, _ = invite("viewer")
    view, _ = configuration(admin, plant_id)
    body = dict(
        expected_version=view["version"],
        plant_configuration_version=view["plant_configuration_version"],
        enabled=True,
        sources=view["sources"],
    )
    base = f"/api/v1/plants/{plant_id}"
    assert viewer.get(base + "/monitoring").status_code == 200
    assert viewer.post(base + "/monitoring", json=body).status_code == 403
    assert clock(viewer, plant_id).status_code == 403
    assert admin.get("/api/v1/plants/other-plant/monitoring").status_code == 404
    assert admin.post(base + "/monitoring", json={**body, "expected_version": 0}).status_code == 409
    assert admin.post(base + "/monitoring", json={**body, "sources": view["sources"][:-1]}).status_code == 422


def test_concurrent_faults_keep_plant_budget_and_branching_impact(shared):
    _, _, client, plant_id, _ = shared
    view, _ = configuration(client, plant_id)
    assets = client.get(f"/api/v1/plants/{plant_id}/snapshot").json()["assets"]
    targets = {
        next(asset["id"] for asset in assets if asset["diagnostic_profile"] == profile)
        for profile in ("pump", "cooler", "valve", "bearing")
    }
    for source in view["sources"]:
        if source["asset_id"] in targets:
            source["mode"] = "degradation"
    response = client.post(
        f"/api/v1/plants/{plant_id}/monitoring",
        json=dict(
            expected_version=view["version"],
            plant_configuration_version=view["plant_configuration_version"],
            enabled=True,
            sources=view["sources"],
        ),
    )
    assert response.status_code == 200
    state = steps(client, plant_id)
    assert len(state["incidents"]) == 4
    assert sum(incident["state"] == "investigation_failed" for incident in state["incidents"]) == 1
    assert state["monitoring"]["investigations_remaining_today"] == 0
    cooler = next(incident for incident in state["incidents"] if incident["profile_id"] == "cooler")
    assert len(cooler["affected_lines"]) == 2
    assert quality(client, plant_id, next(iter(targets)), "stale").status_code == 200
    assert client.get(f"/api/v1/plants/{plant_id}/monitoring").json()["investigations_remaining_today"] == 0


def test_scheduler_gap_reports_stale_and_does_not_authorize(shared):
    store, _, client, plant_id, _ = shared
    configuration(client, plant_id, "pump")
    incident = steps(client, plant_id)["incident"]
    assert clock(client, plant_id, "play").status_code == 200
    with store.connection() as db:
        state = json.loads(
            db.execute("SELECT data FROM plant_monitoring WHERE plant_id=?", (plant_id,)).fetchone()[0]
        )
        old = "2000-01-01T00:00:00+00:00"
        for frame in state["frames"].values():
            frame["received_at"] = old
        db.execute("UPDATE plant_monitoring SET data=? WHERE plant_id=?", (json.dumps(state), plant_id))
        row = db.execute("SELECT id,data FROM plant_workflows WHERE plant_id=?", (plant_id,)).fetchone()
        workflow = json.loads(row[1])
        workflow["history"][-1]["received_at"] = old
        db.execute("UPDATE plant_workflows SET data=? WHERE id=?", (json.dumps(workflow), row[0]))
    assert client.get(f"/api/v1/plants/{plant_id}/monitoring").json()["quality_issue_count"] > 0
    assert approval(client, plant_id, incident).status_code == 409
