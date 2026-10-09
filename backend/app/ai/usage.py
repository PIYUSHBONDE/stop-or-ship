"""Bound ADK requests and retain provider token metadata without recording prompts."""

import json

from pydantic import BaseModel

from app.contracts.models import ModelUsage
from app.core import config

MAX_REQUEST_BYTES = 48000


def cost(input_tokens, output_tokens):
    numerator = (
        input_tokens * config.AI_INPUT_MICRO_USD_PER_MILLION
        + output_tokens * config.AI_OUTPUT_MICRO_USD_PER_MILLION
    )
    return (numerator + 999999) // 1000000


def reservation_size(payload, output_limit):
    def serialize(value):
        if isinstance(value, type) and issubclass(value, BaseModel):
            return value.model_json_schema()
        return str(value)

    size = len(json.dumps(payload, ensure_ascii=False, default=serialize).encode("utf-8")) + 4096
    if size > MAX_REQUEST_BYTES or not 0 < output_limit <= 2400:
        raise ValueError("Model request exceeds bounded context or output allowance")
    # UTF-8 byte count plus framing allowance is a conservative text-token reservation.
    # No cache discounts are assumed; reasoning is charged at the output rate.
    return cost(size, output_limit)


def outcome(metadata, reserved):
    if metadata is None or metadata.prompt_token_count is None or metadata.candidates_token_count is None:
        return {"status": "unknown", "charged_micro_usd": reserved}
    prompt = metadata.prompt_token_count
    output = metadata.candidates_token_count
    thoughts = metadata.thoughts_token_count or 0
    if min(prompt, output, thoughts) < 0:
        raise ValueError("Invalid model token usage")
    return {
        "status": "completed",
        "input_tokens": prompt,
        "output_tokens": output,
        "thought_tokens": thoughts,
        "charged_micro_usd": cost(prompt, output + thoughts),
    }


class InvestigationUsage:
    def __init__(self, store, job, claim_token, require_claim):
        self.store, self.job, self.claim_token = store, job, claim_token
        self.require_claim = require_claim
        self.pending = {}

    def publish(self, record):
        usage = ModelUsage.model_validate(record).model_dump()

        def save(current):
            self.require_claim(current)
            rows = current["incident"].setdefault("ai_usage", [])
            rows[:] = [r for r in rows if r["request_id"] != usage["request_id"]]
            rows.append(usage)

        self.store.mutate(self.job["session_id"], self.job["owner"], save)

    def before(self, callback_context, llm_request):
        stage = callback_context.agent_name
        if stage in self.pending:
            raise RuntimeError("Model stage already has an outstanding request")
        amount = reservation_size(
            llm_request.model_dump(mode="python", exclude_none=True),
            llm_request.config.max_output_tokens or 2400,
        )

        def reserve_turn(current):
            self.require_claim(current)
            incident = current["incident"]
            if incident.get("model_calls", 0) >= 8:
                raise RuntimeError("Investigation budget exhausted")
            incident["model_calls"] = incident.get("model_calls", 0) + 1

        self.store.mutate(self.job["session_id"], self.job["owner"], reserve_turn)
        record = {
            **self.job,
            "claim_token": self.claim_token,
            "stage": stage,
            "model": config.MODEL,
            "reserved_micro_usd": amount,
        }
        request_id = self.store.reserve_ai(record)
        self.pending[stage] = (request_id, amount)
        self.publish({**record, "request_id": request_id, "status": "reserved", "charged_micro_usd": amount})

    def finish(self, stage, metadata=None):
        request_id, reserved = self.pending.pop(stage)
        record = self.store.settle_ai(request_id, self.job["owner"], outcome(metadata, reserved))
        self.publish(record)

    def after(self, callback_context, llm_response):
        if not llm_response.partial:
            self.finish(callback_context.agent_name, llm_response.usage_metadata)

    def error(self, callback_context, llm_request, error):
        if callback_context.agent_name in self.pending:
            self.finish(callback_context.agent_name)

    def close(self):
        for stage in list(self.pending):
            try:
                self.finish(stage)
            except RuntimeError:
                # Accounting is settled first; a replaced claim cannot publish workflow progress.
                pass
