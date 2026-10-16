"""Transactional issue coordination. No model/network calls occur in these transactions."""

import hashlib
import json
import uuid

from fastapi import HTTPException

from app.core.events import now
from app.identity.staff_access import audit, authorize

SUPPORTED = {"equipment", "production"}
TERMINAL = {"resolved", "cancelled"}
DOMAIN_PHASES = {
    "detected": "triage",
    "investigating": "investigating",
    "investigation_failed": "blocked",
    "awaiting_approval": "awaiting_decision",
    "approved": "in_progress",
    "repairing": "in_progress",
    "verifying": "verifying",
    "resolved": "resolved",
    "rejected": "blocked",
}


def row(db, sql, args=()):
    result = db.execute(sql, args)
    value = result.fetchone()
    return dict(zip((c[0] for c in result.description), value)) if value else None


def rows(db, sql, args=()):
    result = db.execute(sql, args)
    names = [c[0] for c in result.description]
    return [dict(zip(names, values)) for values in result.fetchall()]


def unpack(record):
    if record is None:
        raise HTTPException(404, "Case record not found")
    return {**{k: v for k, v in record.items() if k != "data"}, **json.loads(record.get("data", "{}"))}


def case_row(db, scope, case_id):
    return unpack(
        row(
            db,
            "SELECT * FROM issue_cases WHERE id=? AND organization_id=? AND plant_id=?",
            (case_id, scope["organization_id"], scope["id"]),
        )
    )


def event(db, case, action, message, actor=None):
    db.execute(
        "INSERT INTO issue_events(id,organization_id,plant_id,case_id,actor_id,at,action,data) VALUES (?,?,?,?,?,?,?,?)",
        (
            str(uuid.uuid4()),
            case["organization_id"],
            case["plant_id"],
            case.get("id"),
            actor["id"] if actor else None,
            now(),
            action,
            json.dumps({"message": message}),
        ),
    )
    audit(db, case["plant_id"], actor, action, message)


def policy(db, plant_id):
    saved = row(db, "SELECT version,enabled,data FROM issue_policies WHERE plant_id=?", (plant_id,))
    return (
        {"version": saved["version"], "enabled": bool(saved["enabled"]), **json.loads(saved["data"])}
        if saved
        else {
            "version": 0,
            "enabled": False,
            "request_information": True,
            "record_findings": True,
            "escalate_overdue": True,
        }
    )


def require_writer(scope):
    if scope["role"] == "viewer":
        raise HTTPException(403, "Read-only staff cannot change case records")


def require_reviewer(scope):
    if scope["role"] not in {"admin", "manager", "reliability"}:
        raise HTTPException(403, "Case review requires a manager or reliability role")


def revision(record, expected):
    if record["revision"] != expected:
        raise HTTPException(409, "Record changed; refresh before acting")


def mutate(store, token, plant_id, key, action, body, operation):
    if not key or not 8 <= len(key) <= 100:
        raise HTTPException(422, "A stable Idempotency-Key of 8–100 characters is required")
    digest = hashlib.sha256(json.dumps([action, body], sort_keys=True).encode()).hexdigest()
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        scope = authorize(db, token, plant_id)
        require_writer(scope)
        receipt = row(
            db,
            "SELECT digest,data FROM issue_receipts WHERE organization_id=? AND plant_id=? AND actor_id=? AND key=?",
            (scope["organization_id"], plant_id, scope["user"]["id"], key),
        )
        if receipt:
            if receipt["digest"] != digest:
                raise HTTPException(409, "Request key belongs to a different intent")
            return json.loads(receipt["data"])
        result = operation(db, scope)
        db.execute(
            "INSERT INTO issue_receipts VALUES (?,?,?,?,?,?)",
            (scope["organization_id"], plant_id, scope["user"]["id"], key, digest, json.dumps(result)),
        )
        return result


def save_case(db, case, *, phase=None, new_analysis=False):
    case["phase"] = phase or case["phase"]
    case["revision"] += 1
    case["analysis_version"] += int(new_analysis)
    case["updated_at"] = now()
    db.execute(
        "UPDATE issue_cases SET phase=?,revision=?,analysis_version=?,updated_at=?,data=? WHERE id=? AND organization_id=? AND plant_id=?",
        (
            case["phase"],
            case["revision"],
            case["analysis_version"],
            case["updated_at"],
            json.dumps(
                {
                    k: case[k]
                    for k in ("title", "description", "origin", "outcome", "domain_version")
                    if k in case
                }
            ),
            case["id"],
            case["organization_id"],
            case["plant_id"],
        ),
    )


def execution_identity():
    from app.ai.evaluation_gate import fingerprint
    from app.core import config

    return {"fingerprint": fingerprint(), "model": config.MODEL}


def enqueue(db, case, initiated_by=None):
    selected = policy(db, case["plant_id"])
    if not selected["enabled"] or case["category"] not in SUPPORTED or case["phase"] in TERMINAL:
        return None
    from app.core import config

    if not config.CASES_ENABLED:
        return None
    run_id = str(uuid.uuid5(uuid.NAMESPACE_URL, f"run:{case['id']}:{case['analysis_version']}"))
    db.execute(
        "INSERT OR IGNORE INTO issue_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        (
            run_id,
            case["organization_id"],
            case["plant_id"],
            case["id"],
            case["analysis_version"],
            selected["version"],
            initiated_by,
            config.AI_PROVIDER,
            "queued",
            now(),
            json.dumps(execution_identity()),
        ),
    )
    db.execute(
        "INSERT OR IGNORE INTO issue_jobs(id,organization_id,plant_id,case_id,run_id,state,available_at,data) VALUES (?,?,?,?,?,'queued',0,'{}')",
        (run_id, case["organization_id"], case["plant_id"], case["id"], run_id),
    )
    return run_id


def add_evidence(db, case, actor, text, origin, *, task_id=None, values=None, evidence_ids=None):
    identity = str(uuid.uuid4())
    db.execute(
        "INSERT INTO issue_evidence VALUES (?,?,?,?,?,?,?,?,?)",
        (
            identity,
            case["organization_id"],
            case["plant_id"],
            case["id"],
            task_id,
            actor["id"],
            now(),
            origin,
            json.dumps({"text": text, "values": values or [], "evidence_ids": evidence_ids or []}),
        ),
    )
    return identity


def create_case(store, token, plant_id, body, key):
    data = body.model_dump(mode="json")

    def apply(db, scope):
        if (
            body.asset_id
            and not db.execute(
                "SELECT 1 FROM plant_assets WHERE plant_id=? AND id=?", (plant_id, body.asset_id)
            ).fetchone()
        ):
            raise HTTPException(404, "Equipment not found in this plant")
        identity, stamp = str(uuid.uuid4()), now()
        db.execute(
            "INSERT INTO issue_cases VALUES (?,?,?,?,?,?,?,1,1,?,?,?,?)",
            (
                identity,
                scope["organization_id"],
                plant_id,
                body.category,
                body.asset_id,
                None,
                "triage",
                stamp,
                stamp,
                scope["user"]["id"],
                json.dumps({"title": body.title, "description": body.description, "origin": "staff_report"}),
            ),
        )
        case = case_row(db, scope, identity)
        add_evidence(db, case, scope["user"], body.description, "staff_report")
        event(db, case, "case.created", "Staff issue recorded; report is not sensor-verified", scope["user"])
        enqueue(db, case, scope["user"]["id"])
        return case

    return mutate(store, token, plant_id, key, "case.create", data, apply)


def sync_incident(db, plant_id, incident, actor=None, *, enqueue=True):
    if incident.get("record_origin") != "plant_observation":
        return
    saved = row(
        db, "SELECT * FROM issue_cases WHERE incident_id=? AND plant_id=?", (incident["id"], plant_id)
    )
    phase = DOMAIN_PHASES.get(incident["state"], "triage")
    if not saved:
        org = db.execute("SELECT organization_id FROM plants WHERE id=?", (plant_id,)).fetchone()[0]
        identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f"incident-case:{plant_id}:{incident['id']}"))
        stamp = incident.get("created_at", now())
        db.execute(
            "INSERT INTO issue_cases VALUES (?,?,?,?,?,?,?,1,1,?,?,?,?)",
            (
                identity,
                org,
                plant_id,
                "equipment",
                incident["asset_id"],
                incident["id"],
                phase,
                stamp,
                now(),
                actor["id"] if actor else None,
                json.dumps(
                    {
                        "title": f"Equipment issue · {incident['asset_id']}",
                        "description": "Linked observation-based incident",
                        "origin": "plant_observation",
                        "domain_version": incident.get("calculation_version"),
                    }
                ),
            ),
        )
        saved = row(db, "SELECT * FROM issue_cases WHERE id=?", (identity,))
    for record in rows(
        db, "SELECT * FROM issue_cases WHERE incident_id=? AND plant_id=?", (incident["id"], plant_id)
    ):
        case = unpack(record)
        material_change = case.get("domain_version") and case["domain_version"] != incident.get(
            "calculation_version"
        )
        case["domain_version"] = incident.get("calculation_version")
        if material_change:
            save_case(db, case, new_analysis=True)
            db.execute(
                "UPDATE issue_jobs SET state='superseded',lease_token=NULL WHERE case_id=? AND state IN ('queued','running')",
                (case["id"],),
            )
            db.execute(
                "UPDATE issue_runs SET state='superseded' WHERE case_id=? AND state IN ('queued','running','waiting_for_input')",
                (case["id"],),
            )
            event(
                db,
                case,
                "analysis.evidence_changed",
                "Domain calculation/source evidence changed; old analysis cannot publish",
                actor,
            )
            globals()["enqueue"](db, case, actor["id"] if actor else case.get("created_by"))
        # A missing-information task cannot override domain repair/verification.
        if phase in {"in_progress", "verifying", "resolved"} or case["phase"] not in {
            "waiting_for_input",
            "blocked",
        }:
            if phase != case["phase"]:
                save_case(db, case, phase=phase)
        if phase == "resolved":
            db.execute(
                "UPDATE issue_tasks SET state='cancelled',revision=revision+1 WHERE case_id=? AND state IN ('open','claimed')",
                (case["id"],),
            )
        if enqueue and incident["state"] == "detected":
            globals()["enqueue"](db, case, actor["id"] if actor else None)


def create_task(db, case, question, reason, requirements, role, *, due_at=None, request_key=None, actor=None):
    identity = str(uuid.uuid4())
    request_key = request_key or str(uuid.uuid4())
    old = row(db, "SELECT * FROM issue_tasks WHERE case_id=? AND request_key=?", (case["id"], request_key))
    if old:
        return unpack(old)
    if db.execute(
        "SELECT count(*) FROM issue_tasks WHERE case_id=? AND state IN ('open','claimed')", (case["id"],)
    ).fetchone()[0] >= 5 and not request_key.startswith("overdue:"):
        raise HTTPException(409, "Complete an existing request before creating another")
    db.execute(
        "INSERT INTO issue_tasks VALUES (?,?,?,?,?,?,NULL,'open',1,?,?,?)",
        (
            identity,
            case["organization_id"],
            case["plant_id"],
            case["id"],
            request_key,
            role,
            due_at,
            now(),
            json.dumps(
                {
                    "question": question,
                    "reason": reason,
                    "completion_requirements": requirements,
                    "escalated": False,
                }
            ),
        ),
    )
    event(db, case, "task.requested", "Information requested from " + role, actor)
    return unpack(row(db, "SELECT * FROM issue_tasks WHERE id=?", (identity,)))


def request_task(store, token, plant_id, case_id, body, key):
    def apply(db, scope):
        require_reviewer(scope)
        case = case_row(db, scope, case_id)
        revision(case, body.expected_revision)
        if case["phase"] in TERMINAL:
            raise HTTPException(409, "Closed cases cannot request work")
        result = create_task(
            db,
            case,
            body.question,
            body.reason,
            body.completion_requirements,
            body.target_role,
            due_at=body.due_at.isoformat() if body.due_at else None,
            actor=scope["user"],
        )
        save_case(db, case, phase="waiting_for_input")
        return result

    return mutate(store, token, plant_id, key, "task.create:" + case_id, body.model_dump(mode="json"), apply)


def task_action(store, token, plant_id, task_id, body, key, *, respond=False):
    def apply(db, scope):
        task = unpack(
            row(
                db,
                "SELECT * FROM issue_tasks WHERE id=? AND organization_id=? AND plant_id=?",
                (task_id, scope["organization_id"], plant_id),
            )
        )
        revision(task, body.expected_revision)
        case = case_row(db, scope, task["case_id"])
        if case["phase"] in TERMINAL or task["state"] not in {"open", "claimed"}:
            raise HTTPException(409, "Request is no longer active")
        if scope["role"] not in {"admin", task["target_role"]}:
            raise HTTPException(403, "This request belongs to another staff role")
        actor_id = scope["user"]["id"]
        if task["owner_id"] and task["owner_id"] != actor_id:
            raise HTTPException(409, "Another staff member owns this request")
        if respond and task["owner_id"] != actor_id:
            raise HTTPException(409, "Claim the request before responding")
        state = "completed" if respond else "claimed"
        db.execute(
            "UPDATE issue_tasks SET owner_id=?,state=?,revision=revision+1 WHERE id=?",
            (actor_id, state, task_id),
        )
        if respond:
            add_evidence(
                db,
                case,
                scope["user"],
                body.text,
                "technician_statement",
                task_id=task_id,
                values=[v.model_dump() for v in body.values],
            )
            # Supersede prior jobs, preserving their evidence, results and reserved spend.
            save_case(db, case, phase="triage", new_analysis=True)
            db.execute(
                "UPDATE issue_jobs SET state='superseded',lease_token=NULL WHERE case_id=? AND state IN ('queued','running')",
                (case["id"],),
            )
            db.execute(
                "UPDATE issue_runs SET state='superseded' WHERE case_id=? AND state IN ('queued','running','waiting_for_input')",
                (case["id"],),
            )
            enqueue(db, case, actor_id)
        else:
            save_case(db, case)
        event(
            db,
            case,
            "task.responded" if respond else "task.claimed",
            "Human evidence recorded" if respond else "Request claimed",
            scope["user"],
        )
        return unpack(row(db, "SELECT * FROM issue_tasks WHERE id=?", (task_id,)))

    return mutate(
        store,
        token,
        plant_id,
        key,
        ("task.respond:" if respond else "task.claim:") + task_id,
        body.model_dump(mode="json"),
        apply,
    )


def change_case(store, token, plant_id, case_id, body, key, operation):
    def apply(db, scope):
        require_reviewer(scope)
        case = case_row(db, scope, case_id)
        revision(case, body.expected_revision)
        if case["phase"] in TERMINAL:
            raise HTTPException(409, "Case is closed")
        if operation == "link":
            if case["incident_id"] or case["category"] not in {"equipment", "maintenance"}:
                raise HTTPException(409, "Only unlinked equipment reports can link an incident")
            incident = row(
                db, "SELECT data FROM plant_incidents WHERE id=? AND plant_id=?", (body.incident_id, plant_id)
            )
            if not incident:
                raise HTTPException(404, "Incident not found in this plant")
            source = json.loads(incident["data"])
            if source.get("record_origin") != "plant_observation" or (
                case["asset_id"] and case["asset_id"] != source["asset_id"]
            ):
                raise HTTPException(409, "Incident must contain accepted observations for the same equipment")
            case.update(incident_id=source["id"], asset_id=source["asset_id"])
            case["domain_version"] = source.get("calculation_version")
            db.execute(
                "UPDATE issue_cases SET incident_id=?,asset_id=? WHERE id=?",
                (source["id"], source["asset_id"], case_id),
            )
            save_case(db, case, phase=DOMAIN_PHASES.get(source["state"], "triage"), new_analysis=True)
            enqueue(db, case, scope["user"]["id"])
        elif operation == "resolve":
            if scope["role"] not in {"admin", "manager"}:
                raise HTTPException(403, "A manager must record the production outcome")
            if case["incident_id"] or case["category"] in {"equipment", "maintenance"}:
                raise HTTPException(
                    409, "Equipment resolution requires the incident repair verification workflow"
                )
            if db.execute(
                "SELECT 1 FROM issue_tasks WHERE case_id=? AND state IN ('open','claimed')", (case_id,)
            ).fetchone():
                raise HTTPException(409, "Complete outstanding information requests first")
            permitted = {
                r[0]
                for r in db.execute(
                    "SELECT id FROM issue_evidence WHERE case_id=? AND organization_id=? AND plant_id=?",
                    (case_id, scope["organization_id"], plant_id),
                )
            }
            if not set(body.evidence_ids).issubset(permitted):
                raise HTTPException(404, "Outcome evidence not found in this case")
            add_evidence(
                db, case, scope["user"], body.outcome, "manager_outcome", evidence_ids=body.evidence_ids
            )
            case["outcome"] = body.outcome
            save_case(db, case, phase="resolved")
        elif operation == "cancel":
            if case["incident_id"]:
                raise HTTPException(409, "Linked incidents retain their domain lifecycle")
            save_case(db, case, phase="cancelled")
            db.execute(
                "UPDATE issue_tasks SET state='cancelled',revision=revision+1 WHERE case_id=? AND state IN ('open','claimed')",
                (case_id,),
            )
        else:
            if not policy(db, plant_id)["enabled"]:
                raise HTTPException(409, "An administrator must enable the plant automation policy")
            if case["category"] not in SUPPORTED:
                raise HTTPException(409, "This category currently supports human triage only")
            if db.execute(
                "SELECT 1 FROM issue_jobs WHERE case_id=? AND state IN ('queued','running')", (case_id,)
            ).fetchone():
                raise HTTPException(409, "Analysis is already queued or running")
            # Retry the same run and checkpoints; a retry never resets analysis or budget.
            selected = row(
                db,
                "SELECT id,policy_version,data FROM issue_runs WHERE case_id=? AND analysis_version=?",
                (case_id, case["analysis_version"]),
            )
            if selected and (
                selected["policy_version"] != policy(db, plant_id)["version"]
                or any(json.loads(selected["data"]).get(k) != v for k, v in execution_identity().items())
            ):
                save_case(db, case, new_analysis=True)
                enqueue(db, case, scope["user"]["id"])
            elif selected:
                db.execute(
                    "UPDATE issue_jobs SET state='queued',available_at=0,lease_token=NULL WHERE id=? AND attempts<2",
                    (selected["id"],),
                )
                if not db.execute(
                    "SELECT 1 FROM issue_jobs WHERE id=? AND state='queued'", (selected["id"],)
                ).fetchone():
                    raise HTTPException(
                        409, "Run attempt allowance exhausted; retain evidence and review manually"
                    )
                db.execute("UPDATE issue_runs SET state='queued' WHERE id=?", (selected["id"],))
            else:
                enqueue(db, case, scope["user"]["id"])
            save_case(db, case, phase="triage")
        if operation in {"resolve", "cancel"}:
            db.execute(
                "UPDATE issue_jobs SET state='superseded',lease_token=NULL WHERE case_id=? AND state IN ('queued','running')",
                (case_id,),
            )
            db.execute(
                "UPDATE issue_runs SET state='superseded' WHERE case_id=? AND state IN ('queued','running','waiting_for_input')",
                (case_id,),
            )
        event(
            db,
            case,
            "case." + operation,
            "Case cancelled: " + body.reason if operation == "cancel" else "Case " + operation + " recorded",
            scope["user"],
        )
        return case

    return mutate(store, token, plant_id, key, operation + ":" + case_id, body.model_dump(mode="json"), apply)


def update_policy(store, token, plant_id, body, key):
    def apply(db, scope):
        if scope["role"] != "admin":
            raise HTTPException(403, "Only administrators manage automation")
        old = policy(db, plant_id)
        if old["version"] != body.expected_version:
            raise HTTPException(409, "Policy changed; refresh first")
        data = body.model_dump(exclude={"expected_version", "enabled"})
        db.execute(
            "INSERT INTO issue_policies VALUES (?,?,?,?,?) ON CONFLICT(plant_id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled,data=excluded.data",
            (plant_id, scope["organization_id"], old["version"] + 1, int(body.enabled), json.dumps(data)),
        )
        event(
            db,
            {"plant_id": plant_id, "organization_id": scope["organization_id"]},
            "automation.policy",
            json.dumps({"version": old["version"] + 1, "enabled": body.enabled, **data}),
            scope["user"],
        )
        return policy(db, plant_id)

    return mutate(store, token, plant_id, key, "policy.update", body.model_dump(mode="json"), apply)


def list_cases(store, token, plant_id, cursor=0, limit=25):
    with store.connection() as db:
        scope = authorize(db, token, plant_id)
        found = rows(
            db,
            "SELECT * FROM issue_cases WHERE organization_id=? AND plant_id=? ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
            (scope["organization_id"], plant_id, limit + 1, cursor),
        )
        items = [unpack(r) for r in found[:limit]]
        for item in items:
            task = row(
                db,
                "SELECT t.data,t.target_role,u.display_name FROM issue_tasks t LEFT JOIN staff_users u ON u.id=t.owner_id WHERE t.case_id=? AND t.organization_id=? AND t.plant_id=? AND t.state IN ('open','claimed') ORDER BY t.created_at,t.id LIMIT 1",
                (item["id"], scope["organization_id"], plant_id),
            )
            if task:
                item["next_action"] = json.loads(task["data"])["question"]
                item["next_owner"] = task["display_name"] or task["target_role"]
        return {
            "items": items,
            "next_cursor": cursor + limit if len(found) > limit else None,
        }


def list_tasks(store, token, plant_id, cursor=0, limit=25):
    with store.connection() as db:
        scope = authorize(db, token, plant_id)
        role = scope["role"]
        found = rows(
            db,
            "SELECT t.*,u.display_name AS owner_name FROM issue_tasks t LEFT JOIN staff_users u ON u.id=t.owner_id WHERE t.organization_id=? AND t.plant_id=? AND t.state IN ('open','claimed') AND (?='admin' OR t.target_role=?) ORDER BY t.created_at,t.id LIMIT ? OFFSET ?",
            (scope["organization_id"], plant_id, role, role, limit + 1, cursor),
        )
        return {
            "items": [unpack(r) for r in found[:limit]],
            "next_cursor": cursor + limit if len(found) > limit else None,
        }


def detail(db, scope, case_id):
    case = case_row(db, scope, case_id)
    runs = rows(
        db, "SELECT * FROM issue_runs WHERE case_id=? ORDER BY analysis_version DESC LIMIT 10", (case_id,)
    )
    for run in runs:
        run.update(json.loads(run.pop("data")))
        run["sources"] = []
        run["steps"] = [
            unpack(r)
            for r in rows(
                db, "SELECT * FROM issue_steps WHERE run_id=? ORDER BY updated_at,stage", (run["id"],)
            )
        ]
        for step in run["steps"]:
            if step["stage"] == "context":
                names = [name for name, item in step.items() if isinstance(item, dict) and "id" in item]
                step["summary"] = (
                    "Read-only MCP tools completed: " + ", ".join(names)
                    if step["state"] == "completed"
                    else "Evidence collection " + step["state"]
                )
                step["citations"] = [step[name]["id"] for name in names]
                for name in names:
                    source = step[name]
                    title, status = {
                        "equipment_context": ("Equipment configuration", "recorded"),
                        "equipment_trends": (
                            "Saved operational readings",
                            "recorded" if source.get("readings") else "missing",
                        ),
                        "production_context": ("Production areas and dependencies", "reference"),
                        "search_knowledge": ("Procedures and confirmed repair references", "reference"),
                        "case_evidence": ("Staff reports and human findings", "recorded"),
                        "intervention_comparison": (
                            "Saved intervention comparison",
                            "recorded" if source.get("calculation") else "missing",
                        ),
                    }.get(name, (name.replace("_", " "), "recorded"))
                    run["sources"].append(
                        {
                            "id": source["id"],
                            "title": title,
                            "status": status,
                            "text": json.dumps(source, ensure_ascii=False),
                        }
                    )
                    # Nested procedure IDs stay inspectable rather than becoming dead citations.
                    for reference in source.get("shared_references", []) + source.get("verified_repairs", []):
                        run["sources"].append(
                            {
                                "id": reference["id"],
                                "title": "Procedure or confirmed repair reference",
                                "status": "reference",
                                "text": reference["text"],
                            }
                        )
    return {
        "case": case,
        "tasks": [
            unpack(r)
            for r in rows(
                db,
                "SELECT t.*,u.display_name AS owner_name FROM issue_tasks t LEFT JOIN staff_users u ON u.id=t.owner_id WHERE t.case_id=? ORDER BY t.created_at DESC LIMIT 50",
                (case_id,),
            )
        ],
        "evidence": [
            unpack(r)
            for r in rows(
                db,
                "SELECT e.*,u.display_name AS actor_name FROM issue_evidence e LEFT JOIN staff_users u ON u.id=e.actor_id WHERE e.case_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 50",
                (case_id,),
            )
        ],
        "runs": runs,
        "events": [
            unpack(r)
            for r in rows(
                db, "SELECT * FROM issue_events WHERE case_id=? ORDER BY sequence DESC LIMIT 100", (case_id,)
            )
        ],
    }


def get_detail(store, token, plant_id, case_id):
    with store.connection() as db:
        return detail(db, authorize(db, token, plant_id), case_id)
