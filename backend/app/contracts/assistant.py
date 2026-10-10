"""Bounded, read-only assistant and voice contracts."""

from typing import Literal

from pydantic import Field

from app.contracts.models import RequestModel


class Exchange(RequestModel):
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=3000)


class AssistantContext(RequestModel):
    incident_id: str | None = Field(default=None, pattern=r"^[a-f0-9-]{36}$")
    asset_id: str | None = Field(default=None, min_length=1, max_length=80)


class AssistantQuestion(AssistantContext):
    question: str = Field(min_length=1, max_length=1000)
    screen: Literal["plant", "monitoring", "operations", "incidents", "maintenance", "memory", "plant-setup"]
    history: list[Exchange] = Field(default_factory=list, max_length=6)


class AssistantSource(RequestModel):
    id: str
    title: str
    text: str


class AssistantCost(RequestModel):
    option_id: str
    name: str
    total_paise: int
    feasible: bool


class AssistantUsage(RequestModel):
    request_id: str
    status: str
    charged_micro_usd: int
    audio_seconds: int | None = None
    synthesis_characters: int | None = None


class AssistantAnswer(AssistantContext):
    answer: str
    citations: list[AssistantSource]
    navigation: list[str]
    calculation_version: str | None
    configuration_version: int
    costs: list[AssistantCost]
    provider: str
    answer_reference: str
    usage: AssistantUsage | None = None


class TranscriptionRequest(AssistantContext):
    audio_base64: str = Field(min_length=60, max_length=700000)


class TranscriptionResponse(RequestModel):
    transcript: str
    usage: AssistantUsage


class SpeechRequest(AssistantContext):
    answer_reference: str = Field(pattern=r"^[a-f0-9]{32}$")


class SpeechResponse(RequestModel):
    audio_base64: str
    mime_type: Literal["audio/mpeg"] = "audio/mpeg"
    usage: AssistantUsage
