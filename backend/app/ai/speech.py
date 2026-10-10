"""Bounded Google speech REST calls using server-only ADC. No audio persistence."""

import asyncio
import base64
import binascii
import io
import math
import struct
import wave

import google.auth
import httpx
from fastapi import HTTPException
from google.auth.transport.requests import Request

from app.ai.assistant import once, reserve, scope_for, usage_view
from app.ai.assistant_gate import require_assistant_evaluation
from app.contracts.assistant import SpeechResponse, TranscriptionResponse
from app.core import config


def wav_seconds(encoded):
    try:
        raw = base64.b64decode(encoded, validate=True)
        if len(raw) > 480044 or raw[:4] != b"RIFF" or raw[8:12] != b"WAVE":
            raise ValueError()
        with wave.open(io.BytesIO(raw), "rb") as audio:
            if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate(), audio.getcomptype()) != (
                1,
                2,
                16000,
                "NONE",
            ):
                raise ValueError()
            frames = audio.getnframes()
            pcm = audio.readframes(frames)
            if not 1600 <= frames <= 240000 or len(pcm) != frames * 2:
                raise ValueError()
            values = struct.unpack("<" + "h" * frames, pcm)
            if max(abs(v) for v in values) < 100:
                raise HTTPException(422, "No audible speech; type your question or record again")
            return math.ceil(frames / 16000)
    except (ValueError, binascii.Error, wave.Error, EOFError, struct.error):
        raise HTTPException(422, "Expected mono 16 kHz PCM WAV, 0.1–15 seconds") from None


def credentials_headers():
    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    credentials.refresh(Request())
    return {"Authorization": "Bearer " + credentials.token, "x-goog-user-project": config.PROJECT}


async def google_post(url, payload):
    if config.AI_PROVIDER != "vertex" or not config.PROJECT:
        raise HTTPException(503, "Google voice requires server-side Vertex project authentication")
    headers = await asyncio.wait_for(asyncio.to_thread(credentials_headers), 15)
    async with httpx.AsyncClient(timeout=25, follow_redirects=False) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as response:
            if response.status_code != 200:
                # Provider bodies may contain credentials or submitted text. Never expose them.
                raise HTTPException(503, "Google speech unavailable; check API access and billing")
            data = bytearray()
            async for chunk in response.aiter_bytes():
                data.extend(chunk)
                if len(data) > 1024 * 1024:
                    raise ValueError("Speech response exceeds audio boundary")
            import json

            return json.loads(data)


async def transcribe(cache, store, token, plant_id, body, key, *, evaluation=False):
    scope, _ = scope_for(store, token, plant_id, body)
    seconds = wav_seconds(body.audio_base64)
    if not evaluation:
        require_assistant_evaluation(voice=True)

    async def execute(identity):
        amount = (seconds * 16000 + 59) // 60
        request_id = reserve(
            store,
            token,
            scope,
            identity,
            "assistant_transcription",
            amount,
            audio_seconds=seconds,
            model="speech-v2-short-en-IN",
        )
        completed = False
        try:
            data = await google_post(
                f"https://speech.googleapis.com/v2/projects/{config.PROJECT}/locations/global/recognizers/_:recognize",
                {
                    "config": {"autoDecodingConfig": {}, "languageCodes": ["en-IN"], "model": "short"},
                    "content": body.audio_base64,
                },
            )
            transcript = " ".join(
                r["alternatives"][0]["transcript"] for r in data.get("results", []) if r.get("alternatives")
            ).strip()
            completed = True
        finally:
            usage = store.settle_ai(
                request_id,
                scope[0],
                {"status": "completed" if completed else "unknown", "charged_micro_usd": amount},
            )
        if not transcript:
            raise HTTPException(422, "No speech recognized; type your question or record again")
        if len(transcript) > 1000:
            raise HTTPException(422, "Transcript exceeds question limit; record a shorter question")
        return TranscriptionResponse(transcript=transcript, usage=usage_view(usage))

    return await once(cache, store, token, scope, "transcription", key, body, execute)


async def speak(cache, store, token, plant_id, body, key, *, evaluation=False):
    scope, state = scope_for(store, token, plant_id, body)
    answer = cache.get(body.answer_reference, scope)
    if answer is None:
        raise HTTPException(404, "Answer expired; ask again before playback")
    if answer.configuration_version != state["configuration_version"] or answer.calculation_version != (
        state.get("incident") or {}
    ).get("calculation_version"):
        raise HTTPException(409, "Context changed; ask again before playback")
    if not evaluation:
        require_assistant_evaluation(voice=True)

    async def execute(identity):
        text = answer.answer[:3000]
        amount = len(text) * 4
        request_id = reserve(
            store,
            token,
            scope,
            identity,
            "assistant_speech",
            amount,
            synthesis_characters=len(text),
            model="en-IN-Wavenet-A",
        )
        completed = False
        try:
            data = await google_post(
                "https://texttospeech.googleapis.com/v1/text:synthesize",
                {
                    "input": {"text": text},
                    "voice": {"languageCode": "en-IN", "name": "en-IN-Wavenet-A"},
                    "audioConfig": {"audioEncoding": "MP3"},
                },
            )
            audio = data["audioContent"]
            decoded = base64.b64decode(audio, validate=True)
            if not decoded or len(decoded) > 700000:
                raise ValueError("Invalid bounded speech output")
            completed = True
        finally:
            usage = store.settle_ai(
                request_id,
                scope[0],
                {"status": "completed" if completed else "unknown", "charged_micro_usd": amount},
            )
        return SpeechResponse(audio_base64=audio, usage=usage_view(usage))

    # One synthesis per answer even if the client accidentally changes its retry key.
    return await once(cache, store, token, scope, "speech", body.answer_reference, body, execute)
