"""Local release gate: a real-response report must match the evaluated implementation."""

import hashlib
import json
from pathlib import Path

from app.core import config


def fingerprint():
    root = Path(__file__).resolve().parents[1]
    digest = hashlib.sha256()
    paths = sorted((root / "ai").glob("*.py")) + [
        root / "contracts/models.py",
        root / "incidents/economics.py",
        root / "incidents/engine.py",
        root / "incidents/workflow.py",
        root / "incidents/decision_rules.py",
        root / "telemetry/sources.py",
        root / "plant/profiles.py",
        root / "persistence/ai_usage.py",
        root / "persistence/store.py",
        root / "core/config.py",
        config.DATA / "knowledge.json",
    ]
    for path in paths:
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    digest.update(
        json.dumps(
            {"provider": config.AI_PROVIDER, "model": config.MODEL, "location": config.LOCATION}
        ).encode()
    )
    return digest.hexdigest()


def require_evaluation():
    try:
        report = json.loads(Path(config.AI_EVALUATION_FILE).read_text(encoding="utf-8"))
        valid = (
            report["passed"] is True
            and report["code_stable"] is True
            and report["real_model_responses"] is True
            and report["fingerprint"] == fingerprint()
            and report["model"] == config.MODEL
            and report["provider"] == config.AI_PROVIDER
            and {case["name"] for case in report["cases"]}
            == {
                "sensor_disagreement",
                "historical_boundary",
                "verified_memory_injection",
                "hard_constraint",
                "operational_sparse",
            }
            and len(report["cases"]) == 5
            and all(case["passed"] is True for case in report["cases"])
        )
    except (OSError, ValueError, KeyError, TypeError):
        valid = False
    if not valid:
        raise RuntimeError("Live AI requires a passing local evaluation for this implementation and model")
