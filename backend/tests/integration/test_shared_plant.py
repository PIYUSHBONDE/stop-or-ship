"""Security and concurrency acceptance for the local shared-plant foundation."""

import copy
import json
import sqlite3
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

from app.identity.staff_security import COOKIE, token_hash
from app.main import create_app
from app.persistence.store import Store
from tests.support.workspace import PASSWORD, approval, create_incident


def test_named_identity_cookie_and_one_time_setup(shared):
    store, app, admin, plant_id, _ = shared
    token = admin.cookies.get(COOKIE)
    assert token and token not in admin.get("/api/v1/access/state").text
    with store.connection() as db:
        password_hash = db.execute("SELECT password_hash FROM staff_users").fetchone()[0]
        stored_token = db.execute("SELECT token_hash FROM staff_sessions").fetchone()[0]
    assert password_hash.startswith("scrypt-v1$") and PASSWORD not in password_hash
    assert stored_token == token_hash(token)
    assert (
        admin.post(
            "/api/v1/access/setup",
            json={
                "email": "another@example.test",
                "password": PASSWORD,
                "display_name": "Other Admin",
                "organization_name": "Other org",
                "plant_name": "Other plant",
            },
        ).status_code
        == 409
    )
    unknown = TestClient(app)
    assert unknown.get(f"/api/v1/plants/{plant_id}/snapshot").status_code == 401
    result = unknown.post(
        "/api/v1/access/sign-in", json={"email": "admin@example.test", "password": PASSWORD}
    )
    assert result.status_code == 200
    assert "HttpOnly" in result.headers["set-cookie"] and "SameSite=strict" in result.headers["set-cookie"]
    assert unknown.post("/api/v1/access/sign-out").status_code == 200
    assert unknown.get(f"/api/v1/plants/{plant_id}/snapshot").status_code == 401


def test_plant_catalog_is_scoped_durable_and_additively_migrated(shared):
    store, _, admin, plant_id, _ = shared
    state = admin.get(f"/api/v1/plants/{plant_id}/snapshot").json()
    assert len(state["assets"]) == 12 and len(state["areas"]) == 4
    with store.connection() as db:
        assert (
            db.execute("SELECT COUNT(*) FROM plant_assets WHERE plant_id=?", (plant_id,)).fetchone()[0] == 12
        )
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO plant_assets VALUES ('unknown-plant','P-X','line-a','{}')")
    configuration = admin.get(f"/api/v1/plants/{plant_id}/configuration").json()
    next(asset for asset in configuration["configuration"]["assets"] if asset["id"] == "P-107")["name"] = (
        "Site pump A"
    )
    assert (
        admin.post(
            f"/api/v1/plants/{plant_id}/configuration",
            json={
                "expected_version": configuration["version"],
                "configuration": configuration["configuration"],
            },
        ).status_code
        == 200
    )
    Store(store.path, cloud=False)
    state = admin.get(f"/api/v1/plants/{plant_id}/snapshot").json()
    assert next(asset for asset in state["assets"] if asset["id"] == "P-107")["name"] == "Site pump A"
    with store.connection() as db:
        assert db.execute("SELECT version FROM workspace_migrations ORDER BY version").fetchall() == [
            (1,),
            (2,),
            (3,),
            (4,),
            (5,),
            (6,),
            (7,),
        ]


def test_password_whitespace_is_preserved(tmp_path):
    store = Store(str(tmp_path / "whitespace.db"), cloud=False)
    password = "  a unique testing passphrase!  "
    with TestClient(create_app(store, shared_runtime=False)) as client:
        assert (
            client.post(
                "/api/v1/access/setup",
                json={
                    "email": "spaces@example.test",
                    "password": password,
                    "display_name": "Space Test",
                    "organization_name": "Test org",
                    "plant_name": "Test plant",
                },
            ).status_code
            == 200
        )
        client.post("/api/v1/access/sign-out")
        assert (
            client.post(
                "/api/v1/access/sign-in", json={"email": "spaces@example.test", "password": password.strip()}
            ).status_code
            == 401
        )
        assert (
            client.post(
                "/api/v1/access/sign-in", json={"email": "spaces@example.test", "password": password}
            ).status_code
            == 200
        )


def test_shared_view_and_permission_matrix(shared):
    _, _, admin, plant_id, invite = shared
    viewer, _, _ = invite("viewer")
    technician, _, _ = invite("technician")
    reliability, _, _ = invite("reliability")
    incident = create_incident(admin, plant_id)
    base = f"/api/v1/plants/{plant_id}"
    viewed = viewer.get(base + "/snapshot").json()
    assert viewed["incident"]["id"] == incident["id"]
    assert viewed["workspace"]["role"] == "viewer"
    assert approval(viewer, plant_id, incident).status_code == 403
    assert approval(technician, plant_id, incident).status_code == 403
    assert approval(reliability, plant_id, incident).status_code == 403
    assert viewer.post(base + "/scenarios", json={"scenario": "cooler_degradation"}).status_code == 403
    assert (
        viewer.post(
            base + "/calculate", json={"risk_multiplier": 2}, headers={"X-Incident-ID": incident["id"]}
        ).status_code
        == 403
    )
    assert (
        technician.post(base + "/repair/start", headers={"X-Incident-ID": incident["id"]}).status_code == 409
    )
    assert approval(admin, plant_id, incident, approver="Forged manager").status_code == 422
    order = approval(admin, plant_id, incident).json()
    assert order["approval"]["approver"] == "Plant Administrator"
    assert order["approval"]["actor_id"] == admin.get("/api/v1/access/state").json()["user"]["id"]
    assert viewer.post(base + "/repair/start", headers={"X-Incident-ID": incident["id"]}).status_code == 403
    assert (
        technician.post(base + "/repair/start", headers={"X-Incident-ID": incident["id"]}).status_code == 200
    )


def test_multiple_cases_selection_and_aggregate_capacity(shared):
    _, _, admin, plant_id, _ = shared
    first = create_incident(admin, plant_id)
    second = create_incident(admin, plant_id, "cooler_degradation")
    base = f"/api/v1/plants/{plant_id}"
    selected = admin.get(base + "/snapshot", params={"incident": first["id"]}).json()
    assert selected["incident"]["id"] == first["id"]
    assert {case["id"] for case in selected["incidents"]} == {first["id"], second["id"]}
    # Shared cooling and a pump constrain a shared line once, rather than summing its loss twice.
    assert selected["output_per_hour"] == 125
    assert approval(admin, plant_id, first).status_code == 200
    still_open = admin.get(base + "/snapshot", params={"incident": second["id"]}).json()
    assert still_open["incident"]["state"] == "awaiting_approval"
    assert still_open["output_per_hour"] == 65
    assert admin.post(base + "/scenarios", json={"scenario": "pump_degradation"}).status_code == 409


def test_concurrent_approval_one_order_and_attributed_audit(shared):
    store, _, admin, plant_id, _ = shared
    incident = create_incident(admin, plant_id)
    with ThreadPoolExecutor(max_workers=4) as executor:
        responses = list(executor.map(lambda _: approval(admin, plant_id, incident), range(4)))
    assert all(response.status_code == 200 for response in responses)
    assert len({response.json()["id"] for response in responses}) == 1
    with store.connection() as db:
        assert db.execute("SELECT COUNT(*) FROM plant_orders").fetchone()[0] == 1
        rows = db.execute(
            "SELECT actor_id,actor_name,calculation_version FROM plant_audit WHERE action='decision.approved'"
        ).fetchall()
    assert len(rows) == 1 and rows[0][1] == "Plant Administrator"
    assert rows[0][2] == incident["calculation_version"]


def test_revocation_expiry_and_last_administrator(shared):
    store, _, admin, plant_id, invite = shared
    manager, user_id, _ = invite("manager")
    incident = create_incident(admin, plant_id)
    base = f"/api/v1/plants/{plant_id}"
    assert (
        admin.post(base + "/members/" + user_id, json={"role": "manager", "active": False}).status_code == 200
    )
    assert manager.get(base + "/snapshot").status_code == 404
    assert approval(manager, plant_id, incident).status_code == 404
    administrator = admin.get("/api/v1/access/state").json()["user"]["id"]
    assert (
        admin.post(base + "/members/" + administrator, json={"role": "viewer", "active": True}).status_code
        == 409
    )
    with store.connection() as db:
        db.execute("UPDATE staff_sessions SET expires_at=? WHERE user_id=?", (time.time() - 1, administrator))
    assert admin.get(base + "/snapshot").status_code == 401


def test_cross_plant_and_demo_tokens_do_not_authorize(shared):
    store, app, admin, plant_id, _ = shared
    other = TestClient(app)
    other_organization = "unrelated-organization"
    other_plant = "unrelated-plant"
    with store.connection() as db:
        db.execute("INSERT INTO organizations VALUES (?,?)", (other_organization, "Unrelated"))
        db.execute("INSERT INTO plants VALUES (?,?,?)", (other_plant, other_organization, "Other plant"))
    assert admin.get(f"/api/v1/plants/{other_plant}/snapshot").status_code == 404
    assert admin.get(f"/api/v1/plants/{other_plant}/audit").status_code == 404
    assert (
        admin.post(
            f"/api/v1/plants/{other_plant}/invitations",
            json={"email": "intruder@example.test", "role": "admin"},
        ).status_code
        == 404
    )
    demo_token = other.post("/api/v1/local-identity").json()["token"]
    assert (
        other.get(
            f"/api/v1/plants/{plant_id}/snapshot", headers={"Authorization": "Bearer " + demo_token}
        ).status_code
        == 401
    )
    incident = create_incident(admin, plant_id)
    with store.connection() as db:
        workflow_id = db.execute(
            "SELECT workflow_id FROM plant_incidents WHERE id=?", (incident["id"],)
        ).fetchone()[0]
    assert (
        other.get(
            f"/api/v1/sessions/{workflow_id}", headers={"Authorization": "Bearer " + demo_token}
        ).status_code
        == 404
    )


def test_audit_retention_pagination_restart_and_immutable_records(shared):
    store, _, admin, plant_id, _ = shared
    from app.identity.staff_access import audit

    user = admin.get("/api/v1/access/state").json()["user"]
    with store.connection() as db:
        for index in range(75):
            audit(db, plant_id, user, "test.retention", "Retained event " + str(index))
    page = admin.get(f"/api/v1/plants/{plant_id}/audit", params={"limit": 30}).json()
    assert len(page["items"]) == 30 and page["next_cursor"]
    older = admin.get(
        f"/api/v1/plants/{plant_id}/audit", params={"limit": 100, "cursor": page["next_cursor"]}
    ).json()
    assert len(older["items"]) == 46 and older["next_cursor"] is None
    assert not {entry["id"] for entry in page["items"]} & {entry["id"] for entry in older["items"]}
    for statement in ("UPDATE plant_audit SET message='tampered'", "DELETE FROM plant_audit"):
        with pytest.raises(sqlite3.IntegrityError):
            with store.connection() as db:
                db.execute(statement)
    restored = Store(store.path, cloud=False)
    with TestClient(create_app(restored, shared_runtime=False)) as restarted:
        restarted.cookies.set(COOKIE, admin.cookies.get(COOKIE))
        assert (
            len(restarted.get(f"/api/v1/plants/{plant_id}/audit", params={"limit": 100}).json()["items"])
            == 76
        )
        assert (
            restarted.get(f"/api/v1/plants/{plant_id}/snapshot").json()["workspace"]["user"]["id"]
            == user["id"]
        )


def test_invitation_replay_and_credentials_never_echoed(shared):
    _, app, admin, plant_id, invite = shared
    member, _, raw_token = invite("viewer")
    repeated = member.post(
        "/api/v1/access/accept-invitation",
        json={
            "email": "viewer@example.test",
            "password": PASSWORD,
            "display_name": "Other",
            "token": raw_token,
        },
    )
    assert repeated.status_code == 409
    invalid = admin.post(
        "/api/v1/access/setup", json={"email": "invalid", "password": "secret-not-for-errors"}
    )
    assert invalid.status_code == 422 and "secret-not-for-errors" not in invalid.text
    assert (
        admin.post(
            "/api/v1/access/sign-in",
            json={"email": "admin@example.test", "password": "wrong"},
            headers={"Origin": "https://untrusted.example"},
        ).status_code
        == 403
    )
    unknown = TestClient(app)
    for _ in range(8):
        assert (
            unknown.post(
                "/api/v1/access/sign-in", json={"email": "missing@example.test", "password": PASSWORD}
            ).status_code
            == 401
        )
    assert (
        unknown.post(
            "/api/v1/access/sign-in", json={"email": "missing@example.test", "password": PASSWORD}
        ).status_code
        == 429
    )


def test_shared_temperature_revision_retires_authorization(shared):
    from app.persistence.workspace_store import internal_owner

    store, _, admin, plant_id, _ = shared
    incident = create_incident(admin, plant_id)
    assert approval(admin, plant_id, incident).status_code == 200
    with store.connection() as db:
        workflow_id = db.execute(
            "SELECT workflow_id FROM plant_incidents WHERE id=?", (incident["id"],)
        ).fetchone()[0]

    def breach(state):
        signal = next(item for item in state["history"][-1]["signals"] if item["signal_id"] == "temperature")
        signal["value"] = 90

    store.mutate(workflow_id, internal_owner(plant_id), breach)
    assert approval(admin, plant_id, incident, key="late-temperature").status_code == 409
    current = admin.get(f"/api/v1/plants/{plant_id}/snapshot").json()["incident"]
    assert current["safety_stop"] and current["work_order"] is None
    assert current["calculation_version"] != incident["calculation_version"]
    assert current["superseded_work_orders"][0]["status"] == "superseded"
    with store.connection() as db:
        assert db.execute("SELECT status FROM plant_orders").fetchone()[0] == "superseded"
        assert (
            db.execute("SELECT COUNT(*) FROM plant_audit WHERE action='decision.approved'").fetchone()[0] == 1
        )
        assert (
            db.execute(
                "SELECT COUNT(*) FROM plant_audit WHERE action='decision.constraint_changed'"
            ).fetchone()[0]
            >= 1
        )


def test_expired_invitation_and_revoked_inviter(shared):
    store, app, admin, plant_id, invite = shared
    other_admin, _, _ = invite("admin", "other-admin@example.test")
    receipt = admin.post(
        f"/api/v1/plants/{plant_id}/invitations", json={"email": "pending@example.test", "role": "viewer"}
    ).json()
    administrator = admin.get("/api/v1/access/state").json()["user"]["id"]
    assert (
        other_admin.post(
            f"/api/v1/plants/{plant_id}/members/{administrator}", json={"role": "manager", "active": True}
        ).status_code
        == 200
    )
    newcomer = TestClient(app)
    body = {
        "email": receipt["email"],
        "password": PASSWORD,
        "display_name": "Pending staff",
        "token": receipt["token"],
    }
    assert newcomer.post("/api/v1/access/accept-invitation", json=body).status_code == 409
    expired = other_admin.post(
        f"/api/v1/plants/{plant_id}/invitations", json={"email": "expired@example.test", "role": "viewer"}
    ).json()
    with store.connection() as db:
        db.execute(
            "UPDATE invitations SET expires_at=? WHERE token_hash=?",
            (time.time() - 1, token_hash(expired["token"])),
        )
    body.update(email=expired["email"], token=expired["token"])
    assert newcomer.post("/api/v1/access/accept-invitation", json=body).status_code == 409


def test_shared_replay_progresses_without_browser_writes(shared):
    import asyncio

    from app.ai.agent import investigate
    from app.persistence.workspace_store import advance_all, internal_owner

    store, _, admin, plant_id, _ = shared
    assert (
        admin.post(f"/api/v1/plants/{plant_id}/scenarios", json={"scenario": "pump_degradation"}).status_code
        == 200
    )
    with store.connection() as db:
        workflow = db.execute("SELECT id FROM plant_workflows").fetchone()[0]
    store.mutate(workflow, internal_owner(plant_id), lambda state: state.update(last_tick=time.time() - 30))
    jobs = advance_all(store)
    assert len(jobs) == 1
    asyncio.run(investigate(store, jobs[0]))
    assert admin.get(f"/api/v1/plants/{plant_id}/snapshot").json()["incident"]["state"] == "awaiting_approval"
    with store.connection() as db:
        revision = db.execute("SELECT revision FROM plant_workflows").fetchone()[0]
    assert admin.get(f"/api/v1/plants/{plant_id}/snapshot").status_code == 200
    with store.connection() as db:
        assert db.execute("SELECT revision FROM plant_workflows").fetchone()[0] == revision


@pytest.mark.parametrize("run", range(5))
def test_shared_incident_to_verified_repair(shared, run):
    store, _, admin, plant_id, invite = shared
    technician, _, _ = invite("technician")
    incident = create_incident(admin, plant_id)
    assert approval(admin, plant_id, incident, key=f"workflow-{run}").status_code == 200
    base = f"/api/v1/plants/{plant_id}"
    headers = {"X-Incident-ID": incident["id"]}
    assert technician.post(base + "/repair/start", headers=headers).status_code == 200
    assert (
        technician.post(
            base + "/repair/complete",
            headers=headers,
            json={
                "observed_cause": "Valve bypass",
                "fix": "Reseated valve",
                "parts": "Valve seal",
                "outcome": "Flow recovered",
                "recovery": "healthy",
            },
        ).status_code
        == 200
    )
    for _ in range(3):
        result = admin.post(base + "/replay", headers=headers, json={"action": "step"})
        assert result.status_code == 200, result.text
    assert result.json()["incident"]["state"] == "resolved"
    assert result.json()["memory"][0]["observed_cause"] == "Valve bypass"
    with store.connection() as db:
        assert db.execute("SELECT state FROM plant_incidents").fetchone()[0] == "resolved"
        assert db.execute("SELECT status FROM plant_orders").fetchone()[0] == "verified"
        assert db.execute("SELECT COUNT(*) FROM plant_cases").fetchone()[0] == 1


def large_configuration(client, plant_id, lines=8):
    base = f"/api/v1/plants/{plant_id}/configuration"
    current = client.get(base).json()
    template = client.post(base + "/template", json={"lines": lines, "name": "Eight-line hydraulic works"})
    assert template.status_code == 200, template.text
    return {"expected_version": current["version"], "configuration": template.json()}


def test_configuration_permissions_versions_and_concurrent_activation(shared):
    store, _, admin, plant_id, invite = shared
    viewer, _, _ = invite("viewer")
    manager, _, _ = invite("manager")
    base = f"/api/v1/plants/{plant_id}/configuration"
    body = large_configuration(admin, plant_id)
    assert viewer.get(base).status_code == 200
    assert viewer.post(base, json=body).status_code == 403
    assert manager.post(base, json=body).status_code == 403
    alternate = copy.deepcopy(body)
    alternate["configuration"]["name"] = "Alternate reviewed name"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda payload: admin.post(base, json=payload), (body, alternate)))
    assert sorted(response.status_code for response in results) == [200, 409]
    view = admin.get(base).json()
    assert view["version"] == 2
    assert (
        admin.post(base, json={"expected_version": 2, "configuration": view["configuration"]}).json()[
            "version"
        ]
        == 2
    )
    assert admin.get(base.replace(plant_id, "another-plant")).status_code == 404
    Store(store.path, cloud=False)
    state = admin.get(f"/api/v1/plants/{plant_id}/snapshot").json()
    assert len(state["assets"]) == 36 and len(state["signals"]) == 36
    assert state["nominal_output_per_hour"] == state["output_per_hour"] == 800
    assert state["configuration_version"] == 2
    with store.connection() as db:
        assert (
            db.execute("SELECT COUNT(*) FROM plant_configurations WHERE plant_id=?", (plant_id,)).fetchone()[
                0
            ]
            == 2
        )
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("DELETE FROM plant_configurations WHERE plant_id=?", (plant_id,))


@pytest.mark.parametrize(
    "invalid", ["duplicate", "unknown", "cycle", "profile", "capacity", "position", "multiple_press"]
)
def test_configuration_rejects_invalid_topology(shared, invalid):
    _, _, admin, plant_id, _ = shared
    base = f"/api/v1/plants/{plant_id}/configuration"
    body = large_configuration(admin, plant_id)
    draft = body["configuration"]
    if invalid == "duplicate":
        draft["assets"][1]["id"] = draft["assets"][0]["id"]
    elif invalid == "unknown":
        draft["dependencies"][0]["target"] = "NOT-CONFIGURED"
    elif invalid == "cycle":
        draft["dependencies"].append(
            {"source": "P-107", "target": "M-107", "relationship": "invalid loop", "capacity_fraction": 1}
        )
    elif invalid == "profile":
        draft["assets"][0]["diagnostic_profile"] = "bearing"
    elif invalid == "capacity":
        draft["areas"][0]["nominal_units_per_hour"] = -1
    elif invalid == "position":
        draft["assets"][0]["position"] = [0, 1, 500]
    else:
        next(asset for asset in draft["assets"] if asset["id"] == "PR-201")["area_id"] = "line-a"
    assert admin.post(base, json=body).status_code == 422
    assert admin.get(base).json()["version"] == 1
    assert len(admin.get(f"/api/v1/plants/{plant_id}/snapshot").json()["assets"]) == 12


def test_large_plant_sources_ai_topology_and_frozen_approval(shared):
    store, _, admin, plant_id, _ = shared
    base = f"/api/v1/plants/{plant_id}"
    assert admin.post(base + "/configuration", json=large_configuration(admin, plant_id)).status_code == 200
    response = admin.post(base + "/scenarios", json={"scenario": "pump_degradation", "asset_id": "P-807"})
    assert response.status_code == 200, response.text
    for _ in range(6):
        assert admin.post(base + "/replay", json={"action": "step"}).status_code == 200
    state = admin.get(base + "/snapshot").json()
    incident = state["incident"]
    assert incident["state"] == "awaiting_approval" and incident["asset_id"] == "P-807"
    assert incident["affected_lines"] == ["line-h"] and incident["plant_configuration_version"] == 2
    assert state["output_per_hour"] == 760
    assert all(signal["asset_id"] == "P-807" for window in state["history"] for signal in window["signals"])
    impact = json.loads(next(item for item in incident["evidence"] if item["id"] == "plant-impact")["text"])
    assert set(impact["affected_assets"]) == {"PR-801", "CV-801", "FG-001"}
    assert impact["configured_line_capacities"] == {"line-h": 100}
    version = incident["calculation_version"]
    assert approval(admin, plant_id, incident).status_code == 200
    blocked = large_configuration(admin, plant_id, lines=4)
    assert admin.post(base + "/configuration", json=blocked).status_code == 409
    unchanged = admin.get(base + "/snapshot").json()["incident"]
    assert unchanged["calculation_version"] == version and unchanged["work_order"]["status"] == "approved"
    cooler = create_incident(admin, plant_id, "cooler_degradation")
    assert len(cooler["affected_lines"]) == 8
    assert cooler["calculation"]["assumptions"]["line_capacities_units_per_hour"] == {
        f"line-{chr(97 + i)}": 100 for i in range(8)
    }
    impact = json.loads(next(item for item in cooler["evidence"] if item["id"] == "plant-impact")["text"])
    assert len([edge for edge in impact["dependencies"] if edge["source"] == "CL-001"]) == 8
    # Pump H is stopped by its human authorization; cooler constrains each other line to 65.
    assert admin.get(base + "/snapshot").json()["output_per_hour"] == 455
    with store.connection() as db:
        runtime = json.loads(
            db.execute("SELECT data FROM plant_workflows WHERE asset_id='P-807'").fetchone()[0]
        )
        assert runtime["_configuration_version"] == 2 and len(runtime["_catalog"]["assets"]) == 36


def test_configured_line_capacity_drives_integer_costs_and_impact(shared):
    _, _, admin, plant_id, _ = shared
    base = f"/api/v1/plants/{plant_id}"
    view = admin.get(base + "/configuration").json()
    view["configuration"]["areas"][0]["nominal_units_per_hour"] = 200
    assert (
        admin.post(
            base + "/configuration",
            json={"expected_version": view["version"], "configuration": view["configuration"]},
        ).status_code
        == 200
    )
    incident = create_incident(admin, plant_id)
    state = admin.get(base + "/snapshot").json()
    assert state["nominal_output_per_hour"] == 300 and state["output_per_hour"] == 220
    stop = next(option for option in incident["calculation"]["options"] if option["id"] == "stop")
    assert stop["lost_units"] == 200 and stop["lost_margin_paise"] == 5_000_000
    assert all(isinstance(option["total_paise"], int) for option in incident["calculation"]["options"])
    assert (
        admin.post(
            base + "/scenarios", json={"scenario": "bearing_degradation", "asset_id": "AC-001"}
        ).status_code
        == 422
    )


def test_shared_small_capacities_preserve_per_line_rounding_and_measured_valve_values(shared):
    _, _, admin, plant_id, _ = shared
    base = f"/api/v1/plants/{plant_id}"
    body = large_configuration(admin, plant_id, lines=3)
    for area, capacity in zip(body["configuration"]["areas"][:3], (1, 1, 2)):
        area["nominal_units_per_hour"] = capacity
    assert admin.post(base + "/configuration", json=body).status_code == 200
    cooler = create_incident(admin, plant_id, "cooler_degradation")
    state = admin.get(base + "/snapshot").json()
    assert state["nominal_output_per_hour"] == 4 and state["output_per_hour"] == 3
    assert state["line_output_per_hour"] == {"line-a": 1, "line-b": 1, "line-c": 1}
    valve = create_incident(admin, plant_id, "valve_degradation")
    # Select the cooler so that PR-101 is a different active source in the merged snapshot.
    state = admin.get(base + "/snapshot", params={"incident": cooler["id"]}).json()
    valve_view = admin.get(base + "/snapshot", params={"incident": valve["id"]}).json()
    recorded = {signal["signal_id"]: signal for signal in valve_view["history"][-1]["signals"]}
    displayed = {signal["signal_id"]: signal for signal in state["signals"]["PR-101"]}
    for signal_id, signal in recorded.items():
        assert displayed[signal_id]["value"] == signal["value"]
        assert displayed[signal_id]["unit"] == signal["unit"]
    assert displayed["output"]["unit"] == "parts/h" and displayed["output"]["provenance"] == "synthetic"


def test_capacity_half_units_use_consistent_production_and_economic_rounding(shared):
    from app.incidents.economics import calculate

    comparison = calculate(lines=["line-a"], capacities={"line-a": 101})
    assert comparison["assumptions"]["affected_delivery_target_units"] == 657
    _, _, admin, plant_id, _ = shared
    base = f"/api/v1/plants/{plant_id}"
    view = admin.get(base + "/configuration").json()
    view["configuration"]["areas"][0]["nominal_units_per_hour"] = 130
    assert (
        admin.post(
            base + "/configuration",
            json={"expected_version": view["version"], "configuration": view["configuration"]},
        ).status_code
        == 200
    )
    incident = create_incident(admin, plant_id, "cooler_degradation")
    state = admin.get(base + "/snapshot").json()
    assert state["line_output_per_hour"] == {"line-a": 85, "line-b": 65}
    assert state["output_per_hour"] == 150
    assumptions = incident["calculation"]["assumptions"]
    assert assumptions["affected_nominal_units_per_hour"] == 230
    assert assumptions["affected_delivery_target_units"] == 1495


def test_resolved_case_retains_original_topology_after_expansion(shared):
    _, _, admin, plant_id, _ = shared
    base = f"/api/v1/plants/{plant_id}"
    incident = create_incident(admin, plant_id, "cooler_degradation")
    assert approval(admin, plant_id, incident).status_code == 200
    headers = {"X-Incident-ID": incident["id"]}
    assert admin.post(base + "/repair/start", json={}, headers=headers).status_code == 200
    assert (
        admin.post(
            base + "/repair/complete",
            json={
                "observed_cause": "Fouled cooling circuit",
                "fix": "Cleaned cooler",
                "parts": "Service kit",
                "outcome": "Healthy temperature",
                "recovery": "healthy",
            },
            headers=headers,
        ).status_code
        == 200
    )
    for _ in range(3):
        assert admin.post(base + "/replay", json={"action": "step"}, headers=headers).status_code == 200
    assert admin.get(base + "/snapshot").json()["incident"]["state"] == "resolved"
    assert admin.post(base + "/configuration", json=large_configuration(admin, plant_id)).status_code == 200
    historical = admin.get(base + "/snapshot", params={"incident": incident["id"]}).json()
    assert historical["configuration_version"] == 2 and len(historical["assets"]) == 36
    case = historical["incident"]
    assert case["plant_configuration_version"] == 1 and len(case["plant_context"]["assets"]) == 12
    assert len([edge for edge in case["plant_context"]["dependencies"] if edge["source"] == "CL-001"]) == 2
    assert case["calculation_version"] == incident["calculation_version"]
    assert case["work_order"]["status"] == "verified"
    assert (
        admin.post(
            base + "/approve",
            json={"option_id": "stop", "calculation_version": case["calculation_version"]},
            headers={**headers, "Idempotency-Key": "historical-configuration-case"},
        ).status_code
        == 409
    )


def test_shared_scheduler_skips_empty_ticks_closes_recovery_and_guards_history(shared):
    from app.persistence.workspace_store import advance_all, internal_owner

    store, _, admin, plant_id, _ = shared
    base = f"/api/v1/plants/{plant_id}"
    assert admin.post(base + "/scenarios", json={"scenario": "pump_degradation"}).status_code == 200
    with store.connection() as db:
        workflow = db.execute("SELECT id FROM plant_workflows WHERE plant_id=?", (plant_id,)).fetchone()[0]
    store.mutate(workflow, internal_owner(plant_id), lambda state: state.update(last_tick=time.time() + 60))
    with store.connection() as db:
        before = db.execute("SELECT revision FROM plant_workflows WHERE id=?", (workflow,)).fetchone()[0]
    assert advance_all(store) == []
    with store.connection() as db:
        assert (
            db.execute("SELECT revision FROM plant_workflows WHERE id=?", (workflow,)).fetchone()[0] == before
        )
    for _ in range(6):
        assert admin.post(base + "/replay", json={"action": "step"}).status_code == 200
    incident = admin.get(base + "/snapshot").json()["incident"]
    assert approval(admin, plant_id, incident).status_code == 200
    headers = {"X-Incident-ID": incident["id"]}
    assert admin.post(base + "/repair/start", json={}, headers=headers).status_code == 200
    assert (
        admin.post(
            base + "/repair/complete",
            json={
                "observed_cause": "Seal leakage",
                "fix": "Replaced seal",
                "parts": "Seal kit",
                "outcome": "Healthy flow",
                "recovery": "healthy",
            },
            headers=headers,
        ).status_code
        == 200
    )
    for _ in range(3):
        assert admin.post(base + "/replay", json={"action": "step"}, headers=headers).status_code == 200
    assert advance_all(store) == []
    state = admin.get(base + "/snapshot").json()
    assert state["incident"]["state"] == "resolved" and not state["running"]
    with store.connection() as db:
        before = db.execute("SELECT revision FROM plant_workflows WHERE id=?", (workflow,)).fetchone()[0]
    assert advance_all(store) == []
    with store.connection() as db:
        assert (
            db.execute("SELECT revision FROM plant_workflows WHERE id=?", (workflow,)).fetchone()[0] == before
        )
    for action in ("play", "step", "pause"):
        assert admin.post(base + "/replay", json={"action": action}, headers=headers).status_code == 409
    assert admin.get(base + "/snapshot").json()["incident"]["work_order"]["status"] == "verified"
