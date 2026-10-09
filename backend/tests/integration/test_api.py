import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import main
from app.persistence.store import Store


@pytest.fixture
def client():
    with tempfile.TemporaryDirectory() as d:
        application = main.create_app(Store(str(Path(d) / "api.db"), cloud=False))
        with TestClient(application) as c:
            yield c


def session(client):
    token = client.post("/api/v1/local-identity").json()["token"]
    headers = {"Authorization": "Bearer " + token}
    r = client.post("/api/v1/sessions", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"], headers


def incident(client, id, headers, scenario="pump_degradation"):
    base = f"/api/v1/sessions/{id}"
    assert client.post(base + "/scenarios", json={"scenario": scenario}, headers=headers).status_code == 200
    for _ in range(6):
        r = client.post(base + "/replay", json={"action": "step"}, headers=headers)
        assert r.status_code == 200, r.text
    r = client.get(base, headers=headers).json()
    assert r["incident"]["state"] == "awaiting_approval", r
    return r


@pytest.mark.parametrize(
    "scenario,asset,lines",
    [
        ("cooler_degradation", "CL-001", 2),
        ("valve_degradation", "PR-101", 1),
        ("bearing_degradation", "M-107", 1),
    ],
)
def test_equipment_workflow_history_and_stale_actions(client, scenario, asset, lines):
    sid, headers = session(client)
    base = f"/api/v1/sessions/{sid}"
    state = incident(client, sid, headers, scenario)
    current = state["incident"]
    assert current["asset_id"] == asset
    assert len(current["affected_lines"]) == lines
    assert state["signals"][asset][0]["asset_id"] == asset
    assert state["signals"]["FG-001"][0]["value"] == state["output_per_hour"]
    assert current["diagnosis"]["hypotheses"][0]["supporting_evidence"]
    assert (
        client.post(base + "/scenarios", json={"scenario": "pump_degradation"}, headers=headers).status_code
        == 409
    )
    stop = next(option for option in current["calculation"]["options"] if option["id"] == "stop")
    assert stop["lost_margin_paise"] == stop["lost_units"] * 25000
    request = {
        "option_id": "stop",
        "calculation_version": current["calculation_version"],
        "approver": "Judge",
    }
    action_headers = {**headers, "X-Incident-ID": current["id"], "Idempotency-Key": "equipment-approval"}
    assert client.post(base + "/approve", json=request, headers=action_headers).status_code == 200
    assert client.post(base + "/repair/start", headers=action_headers).status_code == 200
    assert (
        client.post(
            base + "/repair/complete",
            json={
                "observed_cause": "Technician confirmed component issue",
                "fix": "Inspected and serviced component",
                "parts": "Demo service kit",
                "outcome": "Verification pending",
                "recovery": "healthy",
            },
            headers=action_headers,
        ).status_code
        == 200
    )
    for _ in range(3):
        client.post(base + "/replay", json={"action": "step"}, headers=headers)
    state = client.get(base, headers=headers).json()
    assert state["incident"]["state"] == "resolved"
    assert state["memory"][0]["asset_id"] == asset
    previous_id = current["id"]
    state = incident(client, sid, headers, "memory_recurrence")
    assert state["incident"]["asset_id"] == asset
    assert len(state["incidents"]) == 2
    assert any(e["id"].startswith("case-") for e in state["incident"]["evidence"])
    archived = client.get(base + "/incidents/" + previous_id, headers=headers)
    assert archived.status_code == 200 and archived.json()["state"] == "resolved"
    assert client.post(base + "/reject", headers=action_headers).status_code == 409
    _, other = session(client)
    assert client.get(base + "/incidents/" + previous_id, headers=other).status_code == 404


def test_unauthenticated_and_cross_session(client):
    assert client.post("/api/v1/sessions").status_code == 401
    id, headers = session(client)
    _, other = session(client)
    assert client.get(f"/api/v1/sessions/{id}", headers=other).status_code == 404
    assert client.post(f"/api/v1/sessions/{id}/reset", headers=other).status_code == 404
    assert client.post("/internal/investigate", json={}).status_code == 404


def test_http_workflow_stale_approval_and_correction(client):
    id, headers = session(client)
    base = f"/api/v1/sessions/{id}"
    assert client.post(base + "/repair/start", headers=headers).status_code == 409
    s = incident(client, id, headers)
    old = s["incident"]["calculation_version"]
    assert client.post(base + "/calculate", json={"risk_multiplier": 2}, headers=headers).status_code == 200
    req = {"option_id": "stop", "calculation_version": old, "approver": "Judge"}
    h = {**headers, "Idempotency-Key": "approval-test-01"}
    assert client.post(base + "/approve", json=req, headers=h).status_code == 409
    req["calculation_version"] = client.get(base, headers=headers).json()["incident"]["calculation_version"]
    wo = client.post(base + "/approve", json=req, headers=h)
    assert wo.status_code == 200
    assert client.post(base + "/approve", json=req, headers=h).json() == wo.json()
    assert client.post(base + "/repair/start", headers=headers).status_code == 200
    repair = {
        "observed_cause": "Valve bypass",
        "fix": "Reseated valve",
        "parts": "Seal",
        "outcome": "Recovered",
        "recovery": "healthy",
    }
    assert client.post(base + "/repair/complete", json=repair, headers=headers).status_code == 200
    for _ in range(3):
        assert client.post(base + "/replay", json={"action": "step"}, headers=headers).status_code == 200
    result = client.get(base, headers=headers).json()
    assert result["incident"]["state"] == "resolved"
    assert result["memory"][0]["observed_cause"] == "Valve bypass"


def test_input_validation_quota_and_rejection(client):
    id, headers = session(client)
    base = f"/api/v1/sessions/{id}"
    assert (
        client.post(base + "/scenarios", json={"scenario": "arbitrary"}, headers=headers).status_code == 422
    )
    assert client.post(base + "/calculate", json={"risk_multiplier": -1}, headers=headers).status_code == 422
    incident(client, id, headers)
    assert client.post(base + "/reject", headers=headers).status_code == 200
    assert client.get(base, headers=headers).json()["incident"]["work_order"] is None
    assert client.post(base + "/reopen", headers=headers).status_code == 200
    for _ in range(5):
        assert (
            client.post(base + "/questions", json={"question": "What changed?"}, headers=headers).status_code
            == 200
        )
    assert (
        client.post(base + "/questions", json={"question": "What changed?"}, headers=headers).status_code
        == 429
    )
    client.post(base + "/reset", headers=headers)
    assert (
        client.post(base + "/questions", json={"question": "What changed?"}, headers=headers).status_code
        == 429
    )


def test_request_boundary_and_strict_input(client):
    sid, headers = session(client)
    base = f"/api/v1/sessions/{sid}"
    response = client.post(base + "/questions", content=b"x" * (65536 + 1), headers=headers)
    assert response.status_code == 413
    assert response.headers["x-request-id"]
    assert response.headers["cache-control"] == "no-store"
    assert client.post(base + "/questions", json={"question": "    "}, headers=headers).status_code == 422
    assert (
        client.post(
            base + "/questions", json={"question": "What changed?", "execute": True}, headers=headers
        ).status_code
        == 422
    )
    assert client.get(base, headers=headers).json()["quotas"]["questions"] == 0


def test_grounded_questions_use_current_session(client):
    sid, headers = session(client)
    base = f"/api/v1/sessions/{sid}"
    incident(client, sid, headers)
    measured = client.post(
        base + "/questions", json={"question": "What is the flow measurement?"}, headers=headers
    )
    assert measured.status_code == 200
    answer = measured.json()
    assert "flow" in answer["answer"]
    assert "cycle-level" in answer["answer"]
    assert set(answer["citations"]).issubset({doc["id"] for doc in answer["evidence"]})
    costs = client.post(
        base + "/questions", json={"question": "Which intervention has the lowest cost?"}, headers=headers
    )
    assert costs.status_code == 200
    assert "₹45,000.00" in costs.json()["answer"]
    _, other = session(client)
    assert (
        client.post(base + "/questions", json={"question": "What changed?"}, headers=other).status_code == 404
    )


def test_failed_verification_can_continue_approved_repair(client):
    sid, headers = session(client)
    base = f"/api/v1/sessions/{sid}"
    state = incident(client, sid, headers)
    current = state["incident"]
    action_headers = {**headers, "X-Incident-ID": current["id"], "Idempotency-Key": "recovery-approval"}
    request = {
        "option_id": "stop",
        "calculation_version": current["calculation_version"],
        "approver": "Judge",
    }
    assert client.post(base + "/approve", json=request, headers=action_headers).status_code == 200
    client.post(base + "/repair/start", headers=action_headers)
    repair = {
        "observed_cause": "Valve bypass",
        "fix": "Inspected valve",
        "parts": "Seal",
        "outcome": "Verification required",
        "recovery": "failed",
    }
    client.post(base + "/repair/complete", json=repair, headers=action_headers)
    for _ in range(3):
        client.post(base + "/replay", json={"action": "step"}, headers=headers)
    state = client.get(base, headers=headers).json()
    assert state["memory"] == [] and state["incident"]["state"] == "verifying"
    assert client.post(base + "/repair/reopen", headers=action_headers).status_code == 200
    repair.update(fix="Replaced bypass seal", recovery="healthy")
    client.post(base + "/repair/complete", json=repair, headers=action_headers)
    for _ in range(3):
        client.post(base + "/replay", json={"action": "step"}, headers=headers)
    state = client.get(base, headers=headers).json()
    assert state["incident"]["state"] == "resolved"
    assert state["incident"]["repair_attempts"][0]["recovery"] == "failed"
    assert state["memory"][0]["fix"] == "Replaced bypass seal"
    assert client.post(base + "/repair/reopen", headers=action_headers).status_code == 409
