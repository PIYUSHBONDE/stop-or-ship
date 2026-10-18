"""Project committed workflow state; persist actor-owned acknowledgements, never model output."""

import hashlib
import json

from fastapi import HTTPException

from app.cases import service
from app.cases.history import RECENT_EQUIPMENT, RECURRENCE_THRESHOLD, window
from app.identity.staff_access import authorize

# A task/case version is its stable notification identity. Retries and polling create no rows.
# Closed/superseded work leaves the actionable feed; its original history stays in the case.
CANDIDATES = (
    "WITH recent AS ("
    + RECENT_EQUIPMENT
    + """), notices AS (
 SELECT 'task:' || t.id AS id,t.case_id,t.id AS task_id,c.asset_id,
        'human_request' AS kind,t.created_at,t.data,c.data AS case_data,NULL AS assessment,0 AS issue_count
 FROM issue_tasks t JOIN issue_cases c ON c.id=t.case_id
   AND c.organization_id=t.organization_id AND c.plant_id=t.plant_id
 WHERE t.organization_id=? AND t.plant_id=? AND t.state IN ('open','claimed')
   AND c.phase NOT IN ('resolved','cancelled')
   AND (?='admin' OR t.target_role=?) AND (t.owner_id IS NULL OR t.owner_id=?)
 UNION ALL
 SELECT 'case:' || CASE WHEN c.phase='blocked' THEN 'blocked' ELSE 'review' END
        || ':' || c.id || ':' || CAST(c.analysis_version AS TEXT),
        c.id,NULL,c.asset_id,
        CASE WHEN c.phase='blocked' THEN 'blocked' ELSE 'analysis_ready' END,
        c.updated_at,c.data,c.data,s.data,0
 FROM issue_cases c
 LEFT JOIN issue_runs r ON r.case_id=c.id AND r.organization_id=c.organization_id
   AND r.plant_id=c.plant_id AND r.analysis_version=c.analysis_version
 LEFT JOIN issue_steps s ON s.run_id=r.id AND s.stage='investigator' AND s.state='completed'
 WHERE c.organization_id=? AND c.plant_id=? AND c.phase IN ('awaiting_decision','blocked')
   AND (? IN ('admin','manager','reliability') OR c.created_by=?)
 UNION ALL
 SELECT 'recurrence:' || c.id,c.id,NULL,c.asset_id,'recurring_issue',c.created_at,
        c.data,c.data,NULL,totals.issue_count
 FROM recent c JOIN (SELECT asset_id,count(*) AS issue_count FROM recent GROUP BY asset_id
   HAVING count(*)>=?) totals ON totals.asset_id=c.asset_id
 WHERE ? IN ('admin','manager','reliability') AND c.phase!='resolved'
   AND NOT EXISTS (SELECT 1 FROM recent newer WHERE newer.asset_id=c.asset_id
     AND newer.phase!='resolved'
     AND (newer.created_at>c.created_at OR (newer.created_at=c.created_at AND newer.id>c.id)))
), feed AS (
 SELECT n.*,CASE WHEN r.key IS NULL THEN 0 ELSE 1 END AS acknowledged
 FROM notices n LEFT JOIN issue_receipts r ON r.organization_id=? AND r.plant_id=?
   AND r.actor_id=? AND r.key='notification-read:' || n.id
)
"""
)


def parameters(scope, plant_id):
    org, role, user = scope["organization_id"], scope["role"], scope["user"]["id"]
    return (
        org,
        plant_id,
        *window(),
        org,
        plant_id,
        role,
        role,
        user,
        org,
        plant_id,
        role,
        user,
        RECURRENCE_THRESHOLD,
        role,
        org,
        plant_id,
        user,
    )


def present(record):
    data = json.loads(record["data"])
    if record["kind"] == "human_request":
        title = "A human finding is needed"
        message = data["question"][:400]
    elif record["kind"] == "recurring_issue":
        title = "Repeated equipment issues"
        message = f"{record['asset_id']}: {record['issue_count']} equipment cases recorded in 30 days. Review the history; a shared physical cause is not confirmed."
    else:
        title = "Case needs attention" if record["kind"] == "blocked" else "Case ready for review"
        message = json.loads(record["case_data"])["title"]
    return {
        **{key: record[key] for key in ("id", "kind", "case_id", "task_id", "asset_id", "created_at")},
        "title": title,
        "message": message,
        "ai_summary": (json.loads(record["assessment"]).get("summary") or "")[:1200]
        if record["kind"] == "analysis_ready" and record["assessment"]
        else None,
        "read": bool(record["acknowledged"]),
    }


def list_notifications(store, token, plant_id, cursor=0, limit=25, unread_only=False):
    with store.connection() as db:
        scope = authorize(db, token, plant_id)
        if scope["role"] == "viewer":
            return {"items": [], "unread_count": 0, "next_cursor": None}
        args = parameters(scope, plant_id)
        count = service.row(
            db, CANDIDATES + "SELECT count(*)-COALESCE(sum(acknowledged),0) AS unread FROM feed", args
        )
        found = service.rows(
            db,
            CANDIDATES
            + "SELECT * FROM feed WHERE (?=0 OR acknowledged=0) ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
            (*args, int(unread_only), limit + 1, cursor),
        )
        return {
            "items": [present(item) for item in found[:limit]],
            "unread_count": count["unread"],
            "next_cursor": cursor + limit if len(found) > limit else None,
        }


def acknowledge(store, token, plant_id, body, key):
    def apply(db, scope):
        notice = service.row(
            db,
            CANDIDATES + "SELECT * FROM feed WHERE id=?",
            (*parameters(scope, plant_id), body.notification_id),
        )
        if notice is None:
            raise HTTPException(404, "Notification is no longer actionable or available to you")
        result = {"notification_id": body.notification_id, "read": True}
        # The existing receipt table already has exactly the required actor/plant scope and
        # transactional uniqueness. This command receipt is the durable read acknowledgement.
        db.execute(
            "INSERT OR IGNORE INTO issue_receipts VALUES (?,?,?,?,?,?)",
            (
                scope["organization_id"],
                plant_id,
                scope["user"]["id"],
                "notification-read:" + body.notification_id,
                hashlib.sha256(body.notification_id.encode()).hexdigest(),
                json.dumps(result),
            ),
        )
        return result

    return service.mutate(store, token, plant_id, key, "notification.read", body.model_dump(), apply)
