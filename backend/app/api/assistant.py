"""Thin authenticated plant assistant transport."""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request

from app.ai import assistant, speech
from app.api.dependencies import Storage
from app.api.workspace import StaffToken, check_origin
from app.contracts.assistant import (
    AssistantAnswer,
    AssistantQuestion,
    SpeechRequest,
    SpeechResponse,
    TranscriptionRequest,
    TranscriptionResponse,
)

router = APIRouter(prefix="/api/v1/plants/{plant_id}/assistant", dependencies=[Depends(check_origin)])
RequestKey = Annotated[
    str, Header(alias="Idempotency-Key", min_length=8, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")
]


@router.post("/questions")
async def question(
    plant_id: str,
    body: AssistantQuestion,
    key: RequestKey,
    request: Request,
    store: Storage,
    token: StaffToken = None,
) -> AssistantAnswer:
    return await assistant.question(request.app.state.assistant_cache, store, token, plant_id, body, key)


@router.post("/transcriptions")
async def transcription(
    plant_id: str,
    body: TranscriptionRequest,
    key: RequestKey,
    request: Request,
    store: Storage,
    token: StaffToken = None,
) -> TranscriptionResponse:
    return await speech.transcribe(request.app.state.assistant_cache, store, token, plant_id, body, key)


@router.post("/speech")
async def playback(
    plant_id: str,
    body: SpeechRequest,
    key: RequestKey,
    request: Request,
    store: Storage,
    token: StaffToken = None,
) -> SpeechResponse:
    return await speech.speak(request.app.state.assistant_cache, store, token, plant_id, body, key)
