"""Separate assistant/speech activation report, tied to evaluated code."""

import json
from pathlib import Path

from app.ai.evaluation_gate import fingerprint, require_evaluation
from app.core import config


def require_assistant_evaluation(*, voice=False):
    from fastapi import HTTPException

    try:
        require_evaluation()
    except RuntimeError as exc:
        raise HTTPException(503, "AI activation requires matching live investigation evaluation") from exc
    try:
        report = json.loads(Path(config.ASSISTANT_EVALUATION_FILE).read_text(encoding="utf-8"))
        valid = (
            report["passed"] is True
            and report["fingerprint"] == fingerprint()
            and report["real_model_responses"] is True
            and report["model"] == config.MODEL
            and report["provider"] == config.AI_PROVIDER
            and {c["name"] for c in report["cases"]}
            == {
                "missing_readings",
                "history_injection",
                "historical_boundary",
                "saved_costs",
                "approval_blockers",
                "synthetic_case_boundary",
            }
            and len(report["cases"]) == 6
            and all(c["passed"] is True for c in report["cases"])
            and (not voice or report.get("voice_passed") is True)
        )
    except (OSError, ValueError, KeyError, TypeError):
        valid = False
    if not valid:
        raise HTTPException(503, "Assistant activation requires matching local text/voice evaluation")
