"""Traffic promotion must restore all prior services after a failed smoke check."""

import io
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import promote


@pytest.fixture
def rollout(monkeypatch, tmp_path):
    calls = []
    revisions = {}

    def describe(name):
        revision = revisions.get(name, "old-" + name)
        return {
            "status": {
                "latestCreatedRevisionName": revision,
                "latestReadyRevisionName": revision,
                "traffic": [
                    {"revisionName": "old-" + name, "percent": 100},
                    {
                        "revisionName": revision,
                        "tag": "candidate",
                        "url": "https://candidate.example",
                    },
                ],
            }
        }

    def command(*args):
        name = args[3].removeprefix("plantsense-")
        assert "--no-traffic" in args
        revisions[name] = "new-" + name

    monkeypatch.setattr(promote, "PRIVATE", tmp_path)
    monkeypatch.setattr(promote, "describe", describe)
    monkeypatch.setattr(promote, "cloud", command)
    monkeypatch.setattr(
        promote, "immutable_image", lambda name, tag: name + "@sha256:fixture"
    )
    monkeypatch.setattr(
        promote, "traffic", lambda name, shares: calls.append((name, shares))
    )
    return calls


def test_failed_smoke_restores_every_service(rollout, monkeypatch):
    def unavailable(*args, **kwargs):
        raise OSError("Fixture network failure")

    monkeypatch.setattr(promote, "urlopen", unavailable)
    with pytest.raises(OSError):
        promote.promote("fixture")
    assert rollout[-3:] == [
        (name, {"old-" + name: 100}) for name in ("worker", "api", "web")
    ]
    assert ("web", {"new-web": 100}) not in rollout


def test_public_setup_required_blocks_promotion(rollout, monkeypatch):
    class Response(io.BytesIO):
        status = 200

    monkeypatch.setattr(
        promote, "urlopen", lambda *a, **k: Response(b'{"setup_required":true}')
    )
    with pytest.raises(RuntimeError, match="database connection failed"):
        promote.promote("fixture")
    assert rollout[-3:] == [
        (name, {"old-" + name: 100}) for name in ("worker", "api", "web")
    ]
