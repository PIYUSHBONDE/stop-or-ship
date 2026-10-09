"""Bounded ASGI request bodies and safe response metadata."""

import asyncio
import uuid

from starlette.responses import JSONResponse

MAX_REQUEST_BYTES = 64 * 1024


class RequestBoundary:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id

        async def safe_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + [
                    (b"x-request-id", request_id.encode()),
                    (b"cache-control", b"no-store"),
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"),
                ]
            await send(message)

        messages, size = [], 0
        while True:
            try:
                message = await asyncio.wait_for(receive(), timeout=10)
            except TimeoutError:
                response = JSONResponse({"detail": "Request body timed out"}, status_code=408)
                return await response(scope, receive, safe_send)
            if message["type"] == "http.disconnect":
                return
            size += len(message.get("body", b""))
            if size > MAX_REQUEST_BYTES:
                response = JSONResponse({"detail": "Request body exceeds 64 KiB"}, status_code=413)
                return await response(scope, receive, safe_send)
            messages.append(message)
            if not message.get("more_body", False):
                break

        async def buffered_receive():
            return messages.pop(0) if messages else await receive()

        await self.app(scope, buffered_receive, safe_send)
