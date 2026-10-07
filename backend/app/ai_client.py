"""AI identity is independent of persistence/deployment mode; credentials stay server-side."""

import os

from . import config


def client(embedding=False):
    from google import genai
    from google.genai import types

    options = {
        "http_options": types.HttpOptions(timeout=15000, retry_options=types.HttpRetryOptions(attempts=1))
    }
    if config.AI_PROVIDER == "gemini_api":
        key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if not key:
            raise RuntimeError("Gemini API credentials are not configured")
        return genai.Client(api_key=key, **options)
    if config.AI_PROVIDER == "vertex":
        if not config.PROJECT:
            raise RuntimeError("Vertex project is not configured")
        return genai.Client(
            vertexai=True,
            project=config.PROJECT,
            location=config.EMBEDDING_LOCATION if embedding else config.LOCATION,
            **options,
        )
    raise RuntimeError("Scripted mode does not create a model client")
