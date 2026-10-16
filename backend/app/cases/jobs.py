"""Durable local outbox/worker claims, fencing and scoped MCP capabilities."""

import hashlib
import json
import os
import secrets
import time
from datetime import datetime, timezone

from fastapi import HTTPException

from app.cases.service import (
    TERMINAL,
    case_row,
    create_task,
    event,
    execution_identity,
    policy,
    row,
    rows,
    save_case,
)
from app.core import config
from app.core.events import now

LEASE_SECONDS = 300
STAGES = (
    "context",
    "investigator",
    "reviewer",
    "Reliability",
    "Production",
    "domain_investigator",
    "domain_reviewer",
    "domain_Reliability",
    "domain_Production",
)


def block_case(db, job):
    run = row(db, "SELECT analysis_version FROM issue_runs WHERE id=?", (job["run_id"],))
    case = case_row(db, {"organization_id": job["organization_id"], "id": job["plant_id"]}, job["case_id"])
    if (
        run
        and run["analysis_version"] == case["analysis_version"]
        and case["phase"] not in {*TERMINAL, "in_progress", "verifying"}
    ):
        save_case(db, case, phase="blocked")


def validate(db, job_id, lease_token):
    job = row(db, "SELECT * FROM issue_jobs WHERE id=?", (job_id,))
    if (
        not job
        or job["state"] != "running"
        or job["lease_token"] != lease_token
        or job["lease_until"] <= time.time()
    ):
        raise HTTPException(409, "Worker lease expired or superseded")
    run = row(
        db,
        "SELECT * FROM issue_runs WHERE id=? AND organization_id=? AND plant_id=?",
        (job["run_id"], job["organization_id"], job["plant_id"]),
    )
    case = case_row(db, {"organization_id": job["organization_id"], "id": job["plant_id"]}, job["case_id"])
    selected = policy(db, job["plant_id"])
    if not run or case["phase"] in TERMINAL or run["analysis_version"] != case["analysis_version"]:
        raise HTTPException(409, "Analysis was superseded")
    if not config.CASES_ENABLED or run["provider"] != config.AI_PROVIDER:
        raise HTTPException(403, "Worker provider or feature configuration differs from the queued run")
    if any(json.loads(run["data"]).get(k) != v for k, v in execution_identity().items()):
        raise HTTPException(409, "Worker implementation or model changed; request a new analysis revision")
    if not selected["enabled"] or selected["version"] != run["policy_version"]:
        raise HTTPException(403, "Automation policy changed; authorized review is required")
    if run["initiated_by"]:
        member = db.execute(
            "SELECT u.enabled,m.active,m.role FROM staff_users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.plant_id=?",
            (run["initiated_by"], job["plant_id"]),
        ).fetchone()
        if not member or not member[0] or not member[1] or member[2] == "viewer":
            raise HTTPException(403, "Initiating staff access was revoked")
    elif case["origin"] != "plant_observation":
        raise HTTPException(403, "System execution requires an observation-origin case")
    return job, run, case, selected


def claim(store, job_id=None):
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        stamp = time.time()
        if (
            config.AI_PROVIDER != "scripted"
            and db.execute(
                "SELECT 1 FROM issue_jobs WHERE state='running' AND lease_until>?", (stamp,)
            ).fetchone()
        ):
            return None
        for job in rows(
            db,
            "SELECT * FROM issue_jobs WHERE ((state='queued' AND available_at<=?) OR (state='running' AND lease_until<=?)) AND (? IS NULL OR id=?) ORDER BY available_at,id LIMIT 100",
            (stamp, stamp, job_id, job_id),
        ):
            if job_id is not None and job["id"] != job_id:
                continue
            if job["attempts"] >= 2:
                db.execute(
                    "UPDATE issue_jobs SET state='failed',lease_token=NULL,data=? WHERE id=?",
                    (json.dumps({"error": "Worker attempt allowance exhausted"}), job["id"]),
                )
                db.execute(
                    "UPDATE issue_runs SET state='blocked',data=json_set(data,'$.error',?) WHERE id=?",
                    ("Worker attempt allowance exhausted", job["run_id"]),
                )
                block_case(db, job)
                continue
            token = secrets.token_hex(24)
            db.execute(
                "UPDATE issue_jobs SET state='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=?",
                (token, stamp + LEASE_SECONDS, job["id"]),
            )
            try:
                _, _, case, _ = validate(db, job["id"], token)
            except HTTPException as error:
                message = str(error.detail)[:200]
                db.execute(
                    "UPDATE issue_jobs SET state='blocked',lease_token=NULL,data=? WHERE id=?",
                    (json.dumps({"error": message}), job["id"]),
                )
                db.execute(
                    "UPDATE issue_runs SET state='blocked',data=json_set(data,'$.error',?) WHERE id=?",
                    (message, job["run_id"]),
                )
                block_case(db, job)
                event(
                    db,
                    case_row(
                        db, {"organization_id": job["organization_id"], "id": job["plant_id"]}, job["case_id"]
                    ),
                    "analysis.blocked",
                    message,
                )
                continue
            db.execute("UPDATE issue_runs SET state='running' WHERE id=?", (job["run_id"],))
            if case["phase"] not in {"in_progress", "verifying"}:
                save_case(db, case, phase="investigating")
            event(db, case, "analysis.claimed", "Worker claimed durable analysis")
            job.update(lease_token=token, lease_until=stamp + LEASE_SECONDS, attempts=job["attempts"] + 1)
            return job
    return None


def heartbeat(store, job):
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        validate(db, job["id"], job["lease_token"])
        db.execute("UPDATE issue_jobs SET lease_until=? WHERE id=?", (time.time() + LEASE_SECONDS, job["id"]))


def step(store, job, stage, input_hash, output=None):
    if stage not in STAGES:
        raise ValueError("Unknown analysis stage")
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        _, _, case, _ = validate(db, job["id"], job["lease_token"])
        if output is None:
            found = row(
                db,
                "SELECT data FROM issue_steps WHERE run_id=? AND stage=? AND input_hash=? AND state='completed'",
                (job["run_id"], stage, input_hash),
            )
            return json.loads(found["data"]) if found else None
        db.execute(
            "INSERT INTO issue_steps VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(run_id,stage) DO UPDATE SET state=excluded.state,input_hash=excluded.input_hash,updated_at=excluded.updated_at,data=excluded.data",
            (
                job["run_id"],
                stage,
                job["organization_id"],
                job["plant_id"],
                "completed",
                input_hash,
                now(),
                json.dumps(output),
            ),
        )
        event(db, case, "analysis.step_completed", stage + " completed")
        return output


def mint_capability(store, job):
    token = secrets.token_hex(32)
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        validate(db, job["id"], job["lease_token"])
        db.execute("DELETE FROM issue_capabilities WHERE expires_at<=?", (time.time(),))
        db.execute(
            "INSERT INTO issue_capabilities VALUES (?,?,?,?,?)",
            (
                hashlib.sha256(token.encode()).hexdigest(),
                job["run_id"],
                job["id"],
                job["lease_token"],
                time.time() + LEASE_SECONDS,
            ),
        )
    return token


def authorize_capability(db, token):
    if not token or len(token) != 64:
        raise HTTPException(403, "Worker capability required")
    saved = row(
        db,
        "SELECT * FROM issue_capabilities WHERE token_hash=? AND expires_at>?",
        (hashlib.sha256(token.encode()).hexdigest(), time.time()),
    )
    if not saved:
        raise HTTPException(403, "Worker capability expired")
    return validate(db, saved["job_id"], saved["lease_token"])


def finish(store, job, phase, *, error=None):
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        try:
            _, _, case, _ = validate(db, job["id"], job["lease_token"])
        except HTTPException:
            # Never publish after revocation, policy changes or a replacement claim.
            changed = db.execute(
                "UPDATE issue_jobs SET state='blocked',lease_token=NULL,data=? WHERE id=? AND lease_token=? AND state='running'",
                (json.dumps({"error": "Execution authorization changed"}), job["id"], job["lease_token"]),
            )
            if changed.rowcount:
                block_case(db, job)
                db.execute(
                    "UPDATE issue_runs SET state='blocked',data=json_set(data,'$.error',?) WHERE id=? AND state='running'",
                    ("Execution authorization changed", job["run_id"]),
                )
            return
        if (
            not error
            and db.execute(
                "SELECT 1 FROM issue_tasks WHERE case_id=? AND state IN ('open','claimed')", (case["id"],)
            ).fetchone()
        ):
            phase = "waiting_for_input"
        if case["phase"] not in {"in_progress", "verifying"}:
            save_case(db, case, phase="blocked" if error else phase)
        db.execute(
            "UPDATE issue_runs SET state=?,data=json_set(data,'$.error',?) WHERE id=?",
            ("blocked" if error else phase, error, job["run_id"]),
        )
        db.execute(
            "UPDATE issue_jobs SET state=?,lease_token=NULL,data=? WHERE id=?",
            (
                "failed" if error else "completed",
                json.dumps({"worker_id": os.getpid(), **({"error": error} if error else {})}),
                job["id"],
            ),
        )
        event(
            db,
            case,
            "analysis.blocked"
            if error
            else "analysis.paused"
            if phase == "waiting_for_input"
            else "analysis.completed",
            "Analysis unavailable: " + error if error else "Analysis " + phase.replace("_", " "),
        )


def escalate_overdue(store):
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        stamp = datetime.now(timezone.utc)
        count = 0
        for task in rows(
            db,
            "SELECT * FROM issue_tasks WHERE state IN ('open','claimed') AND due_at IS NOT NULL ORDER BY due_at LIMIT 500",
        ):
            data = json.loads(task["data"])
            selected = policy(db, task["plant_id"])
            if (
                data.get("escalated")
                or not selected["enabled"]
                or not selected["escalate_overdue"]
                or datetime.fromisoformat(task["due_at"]) > stamp
            ):
                continue
            case = case_row(
                db, {"organization_id": task["organization_id"], "id": task["plant_id"]}, task["case_id"]
            )
            if case["phase"] in TERMINAL:
                continue
            create_task(
                db,
                case,
                "Review overdue request: " + data["question"][:2000],
                "An information request passed its recorded due date.",
                "Record the responsible person's update; a deadline does not authorize work.",
                "manager",
                request_key="overdue:" + task["id"],
            )
            data["escalated"] = True
            db.execute(
                "UPDATE issue_tasks SET data=?,revision=revision+1 WHERE id=?", (json.dumps(data), task["id"])
            )
            event(db, case, "task.escalated", "Overdue request added to manager inbox")
            count += 1
        return count


def managed_incident(store, incident_id):
    if store.cloud or not config.CASES_ENABLED:
        return False
    with store.connection() as db:
        return bool(
            db.execute(
                "SELECT 1 FROM issue_cases c JOIN issue_runs r ON r.case_id=c.id JOIN issue_policies p ON p.plant_id=c.plant_id AND p.enabled=1 WHERE c.incident_id=?",
                (incident_id,),
            ).fetchone()
        )
