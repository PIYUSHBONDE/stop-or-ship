"""Shared authenticated plant fixture and request helpers."""

from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.persistence.store import Store

PASSWORD = "testing-only strong passphrase!"


@pytest.fixture
def shared(tmp_path):
    store = Store(str(tmp_path / "staff.db"), cloud=False)
    application = create_app(store, shared_runtime=False)
    with ExitStack() as stack:
        admin = stack.enter_context(TestClient(application))
        response = admin.post(
            "/api/v1/access/setup",
            json={
                "email": "admin@example.test",
                "password": PASSWORD,
                "display_name": "Plant Administrator",
                "organization_name": "Test organization",
                "plant_name": "Test plant",
            },
        )
        assert response.status_code == 200, response.text
        plant_id = response.json()["plants"][0]["id"]

        def invite(role, email=None):
            email = email or role + "@example.test"
            receipt = admin.post(
                f"/api/v1/plants/{plant_id}/invitations", json={"email": email, "role": role}
            )
            assert receipt.status_code == 200, receipt.text
            member = stack.enter_context(TestClient(application))
            result = member.post(
                "/api/v1/access/accept-invitation",
                json={
                    "email": email,
                    "password": PASSWORD,
                    "display_name": "Test " + role,
                    "token": receipt.json()["token"],
                },
            )
            assert result.status_code == 200, result.text
            return member, result.json()["user"]["id"], receipt.json()["token"]

        yield store, application, admin, plant_id, invite


def create_incident(client, plant_id, scenario="pump_degradation"):
    base = f"/api/v1/plants/{plant_id}"
    response = client.post(base + "/scenarios", json={"scenario": scenario})
    assert response.status_code == 200, response.text
    for _ in range(6):
        response = client.post(base + "/replay", json={"action": "step"})
        assert response.status_code == 200, response.text
    # Investigation is dispatched after the detection response is serialized.
    state = client.get(base + "/snapshot").json()
    assert state["incident"]["state"] == "awaiting_approval", state
    return state["incident"]


def approval(client, plant_id, incident, key="shared-approval", **extra):
    return client.post(
        f"/api/v1/plants/{plant_id}/approve",
        json={
            "option_id": "stop",
            "calculation_version": incident["calculation_version"],
            **extra,
        },
        headers={"Idempotency-Key": key, "X-Incident-ID": incident["id"]},
    )
