"""Recorded equipment recurrence, distinct from diagnosis and verified repair memory."""

import json
from datetime import datetime, timedelta, timezone

from app.cases.service import rows

WINDOW_DAYS = 30
RECURRENCE_THRESHOLD = 3
# Deduplicate linked reports of one incident before counting. Each unlinked staff
# case remains a reported issue, not a confirmed independent physical failure.
RECENT_EQUIPMENT = """
 SELECT c.* FROM issue_cases c
 WHERE c.organization_id=? AND c.plant_id=? AND c.category='equipment'
   AND c.asset_id IS NOT NULL AND c.phase!='cancelled'
   AND c.created_at>=? AND c.created_at<=?
   AND (c.incident_id IS NULL OR NOT EXISTS (
     SELECT 1 FROM issue_cases earlier
     WHERE earlier.organization_id=c.organization_id AND earlier.plant_id=c.plant_id
       AND earlier.incident_id=c.incident_id AND earlier.phase!='cancelled'
       AND (earlier.created_at<c.created_at OR (earlier.created_at=c.created_at AND earlier.id<c.id))
   ))
"""


def window():
    captured = datetime.now(timezone.utc)
    return ((captured - timedelta(days=WINDOW_DAYS)).isoformat(), captured.isoformat())


def equipment_history(db, case):
    start, captured = window()
    if not case.get("asset_id"):
        return {
            "id": "equipment-history",
            "origin": "recorded_case_history",
            "captured_at": captured,
            "window_start": start,
            "window_days": WINDOW_DAYS,
            "asset_id": None,
            "recorded_issues": 0,
            "recurrence_threshold": RECURRENCE_THRESHOLD,
            "cases": [],
            "note": "No equipment selected. No recurrence inference is available.",
        }
    args = (case["organization_id"], case["plant_id"], start, captured, case["asset_id"])
    query = "WITH recent AS (" + RECENT_EQUIPMENT + ") "
    count = db.execute(query + "SELECT count(*) FROM recent WHERE asset_id=?", args).fetchone()[0]
    records = rows(
        db,
        query + "SELECT * FROM recent WHERE asset_id=? ORDER BY created_at DESC,id DESC LIMIT 10",
        args,
    )
    return {
        "id": "equipment-history",
        "origin": "recorded_case_history",
        "captured_at": captured,
        "window_start": start,
        "window_days": WINDOW_DAYS,
        "asset_id": case["asset_id"],
        "recorded_issues": count,
        "recurrence_threshold": RECURRENCE_THRESHOLD,
        "cases": [
            {
                **{key: item[key] for key in ("id", "created_at", "phase", "incident_id")},
                **{
                    key: str(json.loads(item["data"]).get(key) or "")[:600]
                    for key in ("title", "description", "origin", "outcome")
                },
            }
            for item in records
        ],
        "note": "Counts include the current equipment case and distinct saved reports/detections, not confirmed failures. Linked duplicates, cancelled cases, browser ledgers and other plants are excluded. Repeated reports do not prove a shared cause. Cases are limited to the ten latest; verified repairs are a separate source.",
    }
