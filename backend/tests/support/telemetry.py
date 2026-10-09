"""Operational source request helpers and a controlled UTC clock fixture."""

from datetime import datetime, timedelta, timezone

import pytest

from app.incidents import engine, workflow
from app.telemetry import sources


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
