"""Compact workflow audit events shared by transition modules."""

from datetime import datetime, timezone


def now():
    return datetime.now(timezone.utc).isoformat()


def event(session, message):
    session["events"].append({"at": now(), "message": message})
    session["events"] = session["events"][-40:]
