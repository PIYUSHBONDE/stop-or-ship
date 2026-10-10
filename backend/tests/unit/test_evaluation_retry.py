"""Failed-case evaluation retries retain evidence and cannot reuse stale results."""

import asyncio
import importlib.util
import json
from pathlib import Path

import pytest

from app.core import config


@pytest.fixture
def evaluator():
    path = Path(__file__).resolve().parents[2] / "scripts/evaluation/evaluate_gemini.py"
    spec = importlib.util.spec_from_file_location("gemini_evaluator_test", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def report(module):
    names = [
        "sensor_disagreement",
        "historical_boundary",
        "verified_memory_injection",
        "hard_constraint",
        "operational_sparse",
    ]
    return {
        "fingerprint": module.fingerprint(),
        "model": config.MODEL,
        "provider": config.AI_PROVIDER,
        "code_stable": True,
        "passed": False,
        "cases": [
            {
                "name": name,
                "passed": name != "hard_constraint",
                "checks": {"completed": name != "hard_constraint"},
            }
            for name in names
        ],
    }


def test_retry_runs_only_failed_case_and_retains_previous(evaluator, tmp_path, monkeypatch):
    path = tmp_path / "report.json"
    original = report(evaluator)
    path.write_text(json.dumps(original))
    called = []

    async def evaluate(output, name):
        called.append(name)
        case = {"name": name, "passed": True, "checks": {"completed": True}}
        output.write_text(
            json.dumps({"fingerprint": original["fingerprint"], "code_stable": True, "cases": [case]})
        )

    monkeypatch.setattr(evaluator, "evaluate", evaluate)
    assert asyncio.run(evaluator.retry_failed(path)) is True
    updated = json.loads(path.read_text())
    assert called == ["hard_constraint"]
    assert updated["prior_attempts"] == [original["cases"][3]]
    assert updated["cases"][:3] == original["cases"][:3]


def test_retry_refuses_stale_or_partial_report(evaluator, tmp_path):
    path = tmp_path / "report.json"
    original = report(evaluator)
    for invalid in ({**original, "fingerprint": "stale"}, {**original, "cases": original["cases"][:4]}):
        path.write_text(json.dumps(invalid))
        with pytest.raises(RuntimeError, match="complete matching"):
            asyncio.run(evaluator.retry_failed(path))
