"""Operational observations, historical boundaries, migration and recovery gates."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from test_shared_plant import approval
from test_shared_plant import shared as shared

from app import config, engine, sources, workflow
from app.store import Store


@pytest.fixture
def clock(monkeypatch):
    class Clock(datetime):
        value = datetime.now(timezone.utc).replace(microsecond=0)

        @classmethod
        def now(cls, tz=None):
            return cls.value

    monkeypatch.setattr(engine, "datetime", Clock)
    monkeypatch.setattr(workflow, "datetime", Clock)
    monkeypatch.setattr(sources, "utcnow", lambda: Clock.value)
    return Clock


def create(client, plant, kind="operational", **changes):
    body = dict(
        expected_version=0,
        plant_configuration_version=1,
        name="Reviewed pump source",
        asset_id="P-107",
        kind=kind,
        rules=[dict(signal_id="pressure", unit="bar", lower=130, upper=180)],
        procedure="Reviewed isolation and pump inspection procedure, revision 1",
        dataset="uci-hydraulics" if kind == "historical" else "",
        attribution="UCI hydraulic system dataset, CC BY 4.0" if kind == "historical" else "",
    )
    body.update(changes)
    response = client.post(f"/api/v1/plants/{plant}/sources", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def window(clock, record, value=190, seconds=0, **changes):
    end = clock.value + timedelta(seconds=seconds)
    result = dict(
        record_id=record,
        window_start=(end - timedelta(seconds=60)).isoformat(),
        observed_at=end.isoformat(),
        values=[dict(signal_id="pressure", value=value, unit="bar")],
    )
    result.update(changes)
    return result


def submit(client, plant, source, windows, key="batch-0001"):
    return client.post(
        f"/api/v1/plants/{plant}/sources/{source['id']}/observations",
        json=dict(expected_version=source["version"], windows=windows),
        headers={"Idempotency-Key": key},
    )


def incident(client, plant, source, clock, prefix="fault"):
    response = submit(
        client,
        plant,
        source,
        [window(clock, f"{prefix}-{i}", seconds=60 * (i - 2)) for i in range(3)],
        prefix + "-batch",
    )
    assert response.status_code == 200, response.text
    result = client.get(f"/api/v1/plants/{plant}/snapshot").json()
    assert result["incident"]["state"] == "awaiting_approval", result["incident"]
    return result["incident"]


def test_empty_product_has_no_fallback_or_demo_access(shared, monkeypatch):
    _, _, client, plant, _ = shared
    monkeypatch.setattr(engine, "sample", lambda *a: pytest.fail("Product called replay adapter"))
    monkeypatch.setattr(
        "app.workspace_store.asset_signals", lambda *a: pytest.fail("Product generated supporting signals")
    )
    response = client.get(f"/api/v1/plants/{plant}/snapshot")
    assert response.status_code == 200, response.text
    state = response.json()
    assert all(a["status"] == "unknown" for a in state["assets"])
    assert all(not values for values in state["signals"].values())
    assert state["measured_output_per_hour"] is None and not state["scenarios"]
    assert client.post("/api/v1/sessions", headers={"Authorization": "Bearer " + "x" * 40}).status_code == 404
    assert (
        client.post(f"/api/v1/plants/{plant}/scenarios", json={"scenario": "pump_degradation"}).status_code
        == 404
    )
    assert client.get(f"/api/v1/plants/{plant}/monitoring").status_code == 404


def test_source_roles_scope_and_version(shared, clock):
    _, _, client, plant, invite = shared
    viewer, _, _ = invite("viewer")
    manager, _, _ = invite("manager")
    source = create(client, plant)
    path = f"/api/v1/plants/{plant}/sources"
    assert viewer.post(path, json=source["configuration"]).status_code == 403
    assert manager.post(path, json=source["configuration"]).status_code == 403
    assert (
        viewer.post(
            path + f"/{source['id']}/observations",
            json=dict(expected_version=1, windows=[window(clock, "r1")]),
            headers={"Idempotency-Key": "viewer-batch"},
        ).status_code
        == 403
    )
    assert manager.get("/api/v1/plants/another-plant/sources").status_code == 404
    assert submit(manager, plant, source, [window(clock, "r1", 165)]).status_code == 200
    changed = {**source["configuration"], "expected_version": 1, "name": "Source revision two"}
    assert client.post(path + f"/{source['id']}", json=changed).status_code == 200
    assert client.post(path + f"/{source['id']}", json=changed).status_code == 409
    assert submit(client, plant, source, [window(clock, "r2")]).status_code == 409


def test_duplicates_order_freshness_and_atomic_rejection(shared, clock):
    store, _, client, plant, _ = shared
    source = create(client, plant)
    body = [window(clock, "r1", 165)]
    assert submit(client, plant, source, body).json()["accepted"] == 1
    assert submit(client, plant, source, body).json()["accepted"] == 1
    assert submit(client, plant, source, body, "another-key").json()["duplicates"] == 1
    assert submit(client, plant, source, [window(clock, "r1", 166)], "changed-key").status_code == 409
    assert submit(client, plant, source, [window(clock, "r2", seconds=-60)], "old-order").status_code == 409
    assert (
        submit(client, plant, source, [window(clock, "stale", seconds=-181)], "stale-key").status_code == 422
    )
    assert (
        submit(client, plant, source, [window(clock, "future", seconds=31)], "future-key").status_code == 422
    )
    bad = window(clock, "bad", seconds=60)
    bad["values"][0]["unit"] = "psi"
    clock.value += timedelta(seconds=60)
    assert submit(client, plant, source, [window(clock, "valid"), bad], "atomic-key").status_code == 422
    with store.connection() as db:
        assert db.execute("SELECT COUNT(*) FROM telemetry_records").fetchone()[0] == 1
    clock.value += timedelta(seconds=181)
    view = client.get(f"/api/v1/plants/{plant}/sources").json()[0]
    assert view["quality"] == "stale"


def test_historical_preview_is_read_only_and_cannot_authorize(shared):
    store, _, client, plant, _ = shared
    source = create(client, plant, "historical")
    csv = "asset_id,record_id,window_start,observed_at,signal_id,value,unit,std,p95\n" + "".join(
        f"P-107,cycle-{i},,,pressure,190,bar,,\n" for i in range(3)
    )
    base = f"/api/v1/plants/{plant}/sources/{source['id']}/imports"
    body = dict(expected_version=1, csv=csv)
    preview = client.post(base + "/preview", json=body)
    assert preview.status_code == 200, preview.text
    assert preview.json()["missing_timestamp_count"] == 3
    with store.connection() as db:
        assert db.execute("SELECT COUNT(*) FROM telemetry_records").fetchone()[0] == 0
        assert db.execute("SELECT COUNT(*) FROM plant_workflows").fetchone()[0] == 0
    assert (
        client.post(base + "/commit", json=body, headers={"Idempotency-Key": "import-key"}).status_code == 422
    )
    body["preview_checksum"] = preview.json()["checksum"]
    response = client.post(base + "/commit", json=body, headers={"Idempotency-Key": "import-key"})
    assert response.status_code == 200, response.text
    assert (
        client.post(base + "/commit", json=body, headers={"Idempotency-Key": "import-key"}).json()
        == response.json()
    )
    state = client.get(f"/api/v1/plants/{plant}/snapshot").json()
    current = state["incident"]
    assert current["record_origin"] == "historical_import"
    assert approval(client, plant, current).status_code == 409
    assert not state["memory"] and all(a["status"] == "unknown" for a in state["assets"])
    records = client.get(f"/api/v1/plants/{plant}/sources/{source['id']}/records").json()
    assert records["items"][0]["observation"]["observed_at"] is None
    assert records["items"][0]["checksum"]


def test_missing_rules_procedure_and_changed_revision_block_approval(shared, clock):
    _, _, client, plant, _ = shared
    source = create(client, plant, procedure="")
    case = incident(client, plant, source, clock)
    assert approval(client, plant, case).status_code == 409
    changed = {
        **source["configuration"],
        "expected_version": 1,
        "procedure": "Reviewed plant procedure revision 2",
    }
    response = client.post(f"/api/v1/plants/{plant}/sources/{source['id']}", json=changed)
    assert response.status_code == 200, response.text
    source = response.json()
    assert approval(client, plant, case).status_code == 409
    clock.value += timedelta(seconds=60)
    assert submit(client, plant, source, [window(clock, "revision2")], "revision2-key").status_code == 200
    case = client.get(f"/api/v1/plants/{plant}/snapshot").json()["incident"]
    assert approval(client, plant, case).status_code == 200
    clock.value += timedelta(seconds=181)
    assert (
        client.post(f"/api/v1/plants/{plant}/repair/start", headers={"X-Incident-ID": case["id"]}).status_code
        == 409
    )


def test_unconfigured_diagnostics_do_not_assert_health(shared, clock):
    _, _, client, plant, _ = shared
    source = create(client, plant, rules=[])
    assert (
        submit(
            client, plant, source, [window(clock, f"r{i}", seconds=60 * (i - 2)) for i in range(3)]
        ).status_code
        == 200
    )
    state = client.get(f"/api/v1/plants/{plant}/snapshot").json()
    assert not state["incident"]
    assert next(a for a in state["assets"] if a["id"] == "P-107")["status"] == "unknown"
    assert not state["sources"][0]["diagnostic_ready"]


def test_five_operational_repairs_require_post_completion_data(shared, clock):
    _, _, client, plant, _ = shared
    source = create(client, plant)
    base = f"/api/v1/plants/{plant}"
    for run in range(5):
        if run:
            clock.value += timedelta(days=1)
        case = incident(client, plant, source, clock, f"fault-{run}")
        first = approval(client, plant, case, f"approval-{run}")
        assert first.status_code == 200, first.text
        assert approval(client, plant, case, f"approval-{run}").json()["id"] == first.json()["id"]
        headers = {"X-Incident-ID": case["id"]}
        assert client.post(base + "/repair/start", headers=headers).status_code == 200
        repair = dict(
            observed_cause="Valve bypass",
            fix="Inspected and repaired valve",
            parts="Seal kit",
            outcome="Repair complete; verification pending",
        )
        assert (
            client.post(
                base + "/repair/complete", headers=headers, json={**repair, "recovery": "healthy"}
            ).status_code
            == 422
        )
        response = client.post(base + "/repair/complete", headers=headers, json=repair)
        assert response.status_code == 200, response.text
        assert response.json()["incident"]["verification_windows"] == 0
        assert len(response.json()["memory"]) == run
        for i in range(3):
            clock.value += timedelta(seconds=60)
            response = submit(
                client, plant, source, [window(clock, f"recovery-{run}-{i}", 165)], f"recovery-{run}-{i}"
            )
            assert response.status_code == 200, response.text
        state = client.get(base + "/snapshot").json()
        assert state["incident"]["state"] == "resolved", state["incident"]
        assert len(state["memory"]) == run + 1
        assert all(c["record_origin"] == "plant_observation" for c in state["memory"])
        if run:
            assert any(e["id"].startswith("case-") for e in state["incident"]["evidence"])


def test_legacy_migration_preserves_records_and_pauses_sources(shared, monkeypatch):
    from test_shared_plant import create_incident

    store, _, client, plant, _ = shared
    monkeypatch.setattr(config, "INTERNAL_TEST_MODE", True)
    case = create_incident(client, plant)
    with store.connection() as db:
        original = db.execute("SELECT data FROM plant_workflows").fetchone()[0]
        db.execute("DELETE FROM workspace_migrations WHERE version=5")
    monkeypatch.setattr(config, "INTERNAL_TEST_MODE", False)
    Store(store.path, cloud=False)
    with store.connection() as db:
        migrated = json.loads(db.execute("SELECT data FROM plant_workflows").fetchone()[0])
        assert not migrated["running"] and migrated["record_origin"] == "legacy_replay"
        assert migrated["incident"]["evidence"] == json.loads(original)["incident"]["evidence"]
        assert db.execute("SELECT COUNT(*) FROM staff_users").fetchone()[0] == 1
    assert approval(client, plant, case).status_code == 409
    assert (
        client.get(f"/api/v1/plants/{plant}/snapshot").json()["incident"]["record_origin"] == "legacy_replay"
    )
