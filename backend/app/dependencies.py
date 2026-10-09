"""HTTP identity and request-scoped persistence dependencies."""

import hashlib
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request

from . import config
from .store import Store


def session_owner(authorization: Annotated[str | None, Header()] = None) -> str:
    if not config.INTERNAL_TEST_MODE:
        raise HTTPException(404, "Isolated test endpoints are disabled; sign in to a plant workspace")
    if config.SERVICE_ROLE != "api":
        raise HTTPException(404, "Endpoint unavailable")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Session authentication required")
    token = authorization[7:]
    if not 32 <= len(token) <= 4096:
        raise HTTPException(401, "Invalid identity")
    if config.MODE == "cloud":
        import firebase_admin
        from firebase_admin import auth

        if not firebase_admin._apps:
            firebase_admin.initialize_app()
        try:
            return auth.verify_id_token(token, check_revoked=True)["uid"]
        except Exception:
            raise HTTPException(401, "Invalid Firebase identity") from None
    if len(token) > 200:
        raise HTTPException(401, "Invalid local identity")
    return hashlib.sha256(token.encode()).hexdigest()


def session_store(request: Request) -> Store:
    return request.app.state.store


Owner = Annotated[str, Depends(session_owner)]
Storage = Annotated[Store, Depends(session_store)]
