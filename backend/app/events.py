"""Compact workflow audit events shared by transition modules."""

import uuid
from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def event(session, message):
    session["events"].append(
        {"id": str(uuid.uuid4()), "at": now(), "message": message, "actor": session.get("_actor")}
    )
    session["events"] = session["events"][-40:]
