from datetime import timedelta

from test_shared_plant import approval
from test_shared_plant import shared as shared
from test_sources import clock as clock
from test_sources import create, submit, window


def test_reviewed_stop_constraint_supersedes_authorization(shared, clock):
    _, _, client, plant, _ = shared
    source = create(
        client,
        plant,
        rules=[
            dict(signal_id="pressure", unit="bar", lower=130, upper=180),
            dict(signal_id="temperature", unit="°C", upper=100, requires_stop=True),
        ],
    )
    windows = [window(clock, f"fault-{i}", seconds=60 * (i - 2)) for i in range(3)]
    for row in windows:
        row["values"].append(dict(signal_id="temperature", value=90, unit="°C"))
    assert submit(client, plant, source, windows).status_code == 200
    base = f"/api/v1/plants/{plant}"
    case = client.get(base + "/snapshot").json()["incident"]
    assert not case["safety_stop"]  # The legacy demo limit of 85 C must not apply.
    assert approval(client, plant, case).status_code == 200
    clock.value += timedelta(seconds=60)
    breach = window(clock, "temperature-breach")
    breach["values"].append(dict(signal_id="temperature", value=101, unit="°C"))
    assert submit(client, plant, source, [breach], "breach-key").status_code == 200
    case2 = client.get(base + "/snapshot").json()["incident"]
    assert case2["safety_stop"] and case2["calculation_version"] != case["calculation_version"]
    assert case2["superseded_work_orders"][0]["status"] == "superseded"
    assert approval(client, plant, case, "stale-key").status_code == 409


def test_incomplete_and_gapped_recovery_never_confirms(shared, clock):
    _, _, client, plant, _ = shared
    source = create(
        client,
        plant,
        rules=[
            dict(signal_id="pressure", unit="bar", lower=130, upper=180),
            dict(signal_id="flow", unit="L/min", lower=5, upper=9),
        ],
    )
    windows = [window(clock, f"fault-{i}", seconds=60 * (i - 2)) for i in range(3)]
    for row in windows:
        row["values"].append(dict(signal_id="flow", value=6, unit="L/min"))
    assert submit(client, plant, source, windows).status_code == 200
    base = f"/api/v1/plants/{plant}"
    case = client.get(base + "/snapshot").json()["incident"]
    assert approval(client, plant, case).status_code == 200
    headers = {"X-Incident-ID": case["id"]}
    assert client.post(base + "/repair/start", headers=headers).status_code == 200
    assert (
        client.post(
            base + "/repair/complete",
            headers=headers,
            json=dict(
                observed_cause="Valve bypass",
                fix="Valve repaired",
                parts="Kit",
                outcome="Awaiting recovery observations",
            ),
        ).status_code
        == 200
    )
    for i in range(3):
        clock.value += timedelta(seconds=60)
        assert (
            submit(
                client, plant, source, [window(clock, f"missing-flow-{i}", 165)], f"missing-flow-{i}"
            ).status_code
            == 200
        )
    state = client.get(base + "/snapshot").json()
    assert state["incident"]["verification_windows"] == 0 and not state["memory"]
    for i in range(3):
        clock.value += timedelta(seconds=120)
        row = window(clock, f"gapped-{i}", 165)
        row["values"].append(dict(signal_id="flow", value=6, unit="L/min"))
        assert submit(client, plant, source, [row], f"gapped-key-{i}").status_code == 200
    state = client.get(base + "/snapshot").json()
    assert state["incident"]["verification_windows"] == 1 and not state["memory"]


def test_untrusted_fields_and_bad_csv_are_rejected(shared, clock):
    _, _, client, plant, _ = shared
    source = create(client, plant)
    base = f"/api/v1/plants/{plant}/sources/{source['id']}"
    row = window(clock, "forged-score")
    row["anomaly"] = False
    assert submit(client, plant, source, [row]).status_code == 422
    invalid = window(clock, "bad-number")
    invalid["values"][0]["value"] = "NaN"
    assert submit(client, plant, source, [invalid]).status_code == 422
    for csv in (
        "asset_id,signal_id,value\nP-107,pressure,165",
        "asset_id,record_id,window_start,observed_at,signal_id,value,unit,std,p95\nwrong,x,,,pressure,165,bar,,",
    ):
        assert (
            client.post(base + "/imports/preview", json=dict(expected_version=1, csv=csv)).status_code == 422
        )
