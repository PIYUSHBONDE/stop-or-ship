"""Manual-only Vertex Compose cannot bypass mount isolation or partial configuration checks."""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "scripts"))
import check_containers


@pytest.fixture
def inspected(monkeypatch):
    value = {
        "State": {"Health": {"Status": "healthy"}},
        "Config": {
            "User": "10001:10001",
            "Env": ["PLANTSENSE_MODE=local", "PLANTSENSE_AI_PROVIDER=vertex"],
        },
        "HostConfig": {
            "ReadonlyRootfs": True,
            "CapDrop": ["ALL"],
            "SecurityOpt": ["no-new-privileges:true"],
            "Privileged": False,
            "NetworkMode": "bridge",
            "PidMode": "",
            "Memory": 1,
            "PidsLimit": 128,
            "NanoCpus": 1,
        },
        "Mounts": [],
    }

    def docker(*args):
        if args[0] == "inspect":
            return json.dumps([value])
        return "10001" if "exec" in args else "fixture-container"

    monkeypatch.setattr(check_containers, "docker", docker)
    return value


def test_unconfigured_vertex_remains_manual_only(inspected):
    assert check_containers.check_runtime("api", "10001") == inspected


def test_partial_vertex_credentials_do_not_bypass_required_evidence(inspected):
    inspected["Config"]["Env"].append(
        "GOOGLE_APPLICATION_CREDENTIALS=/run/secrets/google_adc.json"
    )
    with pytest.raises(RuntimeError, match="credential or evaluation paths"):
        check_containers.check_runtime("api", "10001")


def test_unconfigured_vertex_still_rejects_host_mounts(inspected):
    inspected["Mounts"] = [{"Type": "bind", "Destination": "/unreviewed", "RW": False}]
    with pytest.raises(RuntimeError, match="bind mount"):
        check_containers.check_runtime("api", "10001")
