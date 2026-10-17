"""Notifications follow committed, scoped work; acknowledgements never advance cases."""

from app.cases import service
from app.persistence.store import Store
from tests.integration.test_case_foundation import create, post, tenant


def feed(client, plant, query=""):
    result = client.get(f"/api/v1/plants/{plant}/notifications" + query)
    assert result.status_code == 200, result.text
    return result.json()


def request(admin, plant, case, role="technician"):
    result = post(
        admin,
        plant,
        f"/cases/{case['id']}/tasks",
        {
            "expected_revision": case["revision"],
            "question": "Record the available pressure",
            "reason": "Independent evidence is missing",
            "completion_requirements": "Reading, units and time, or unavailable",
            "target_role": role,
        },
    )
    assert result.status_code == 200, result.text
    return result.json()


def phase(store, identity, value):
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        case = service.unpack(service.row(db, "SELECT * FROM issue_cases WHERE id=?", (identity,)))
        service.save_case(db, case, phase=value)


def test_read_is_durable_actor_owned_and_has_no_workflow_side_effect(shared):
    store, _, admin, plant, invite = shared
    technician, _, _ = invite("technician")
    case = create(admin, plant)
    task = request(admin, plant, case)
    notice = feed(technician, plant)["items"][0]
    assert notice["task_id"] == task["id"]
    assert not notice["read"]
    before = admin.get(f"/api/v1/plants/{plant}/cases/{case['id']}").json()
    body = {"notification_id": notice["id"]}
    result = post(technician, plant, "/notifications/read", body, "same-read-intent")
    assert result.status_code == 200, result.text
    assert post(technician, plant, "/notifications/read", body, "same-read-intent").json() == result.json()
    Store(store.path, cloud=False)
    assert feed(technician, plant)["unread_count"] == 0
    assert feed(technician, plant)["items"][0]["read"]
    assert feed(admin, plant)["unread_count"] == 1
    assert admin.get(f"/api/v1/plants/{plant}/cases/{case['id']}").json() == before
    with store.connection() as db:
        assert db.execute("SELECT count(*) FROM issue_jobs").fetchone()[0] == 0


def test_role_owner_membership_and_tenant_boundaries(shared):
    store, _, admin, plant, invite = shared
    technician, user, _ = invite("technician")
    manager, _, _ = invite("manager")
    viewer, _, _ = invite("viewer")
    case = create(admin, plant)
    task = request(admin, plant, case)
    notice = feed(technician, plant)["items"][0]
    assert not feed(manager, plant)["items"]
    assert not feed(viewer, plant)["items"]
    assert post(manager, plant, "/notifications/read", {"notification_id": notice["id"]}).status_code == 404
    other_plant, _, _ = tenant(store)
    assert technician.get(f"/api/v1/plants/{other_plant}/notifications").status_code == 404
    assert (
        post(technician, other_plant, "/notifications/read", {"notification_id": notice["id"]}).status_code
        == 404
    )
    claimed = post(admin, plant, f"/tasks/{task['id']}/claim", {"expected_revision": task["revision"]})
    assert claimed.status_code == 200
    assert not feed(technician, plant)["items"]
    assert (
        post(technician, plant, "/notifications/read", {"notification_id": notice["id"]}).status_code == 404
    )
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("UPDATE memberships SET active=0 WHERE user_id=? AND plant_id=?", (user, plant))
    assert technician.get(f"/api/v1/plants/{plant}/notifications").status_code == 404


def test_review_blocked_and_new_revision_notifications_are_distinct(shared):
    store, _, admin, plant, _ = shared
    case = create(admin, plant)
    phase(store, case["id"], "awaiting_decision")
    first = feed(admin, plant)["items"][0]
    assert first["kind"] == "analysis_ready"
    assert post(admin, plant, "/notifications/read", {"notification_id": first["id"]}).status_code == 200
    phase(store, case["id"], "blocked")
    blocked = feed(admin, plant)["items"][0]
    assert blocked["kind"] == "blocked" and blocked["id"] != first["id"] and not blocked["read"]
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        record = service.unpack(service.row(db, "SELECT * FROM issue_cases WHERE id=?", (case["id"],)))
        service.save_case(db, record, phase="awaiting_decision", new_analysis=True)
    changed = feed(admin, plant)["items"][0]
    assert changed["id"] != first["id"] and not changed["read"]
    phase(store, case["id"], "resolved")
    assert feed(admin, plant) == {"items": [], "unread_count": 0, "next_cursor": None}


def test_pagination_counts_and_repeated_polls_do_not_create_notifications(shared):
    store, _, admin, plant, _ = shared
    for _ in range(3):
        request(admin, plant, create(admin, plant))
    page = feed(admin, plant, "?limit=2")
    assert len(page["items"]) == 2 and page["unread_count"] == 3 and page["next_cursor"] == 2
    assert feed(admin, plant, "?limit=2") == page
    end = feed(admin, plant, "?limit=2&cursor=2")
    assert len(end["items"]) == 1 and end["next_cursor"] is None
    assert not ({n["id"] for n in page["items"]} & {n["id"] for n in end["items"]})
    with store.connection() as db:
        assert (
            db.execute("SELECT count(*) FROM issue_receipts WHERE key LIKE 'notification-read:%'").fetchone()[
                0
            ]
            == 0
        )


def test_repeated_equipment_alerts_are_scoped_deduplicated_and_not_failure_claims(shared):
    store, _, admin, plant, invite = shared
    technician, _, _ = invite("technician")
    create(admin, plant, "equipment")
    create(admin, plant, "equipment")
    create(admin, plant, "equipment", asset_id="P-207")
    create(admin, plant, "production")
    assert not feed(admin, plant)["items"]
    latest = create(admin, plant, "equipment")
    notices = feed(admin, plant)
    assert notices["unread_count"] == 1
    notice = notices["items"][0]
    assert notice["kind"] == "recurring_issue" and notice["case_id"] == latest["id"]
    assert "3 equipment cases" in notice["message"] and "not confirmed" in notice["message"]
    assert feed(admin, plant) == notices
    assert not feed(technician, plant)["items"]
    assert post(admin, plant, "/notifications/read", {"notification_id": notice["id"]}).status_code == 200
    assert feed(admin, plant)["unread_count"] == 0
    rejected = post(
        admin,
        plant,
        "/notifications/read",
        {"notification_id": notice["id"]},
        "notification-read:" + notice["id"],
    )
    assert rejected.status_code == 422 and "reserved server namespace" in rejected.text
    phase(store, latest["id"], "cancelled")
    assert not feed(admin, plant)["items"]


def test_review_notification_uses_only_current_completed_assessment(shared):
    import json

    from tests.integration.test_case_foundation import enable

    store, _, admin, plant, _ = shared
    enable(admin, plant)
    case = create(admin, plant)
    with store.connection() as db:
        run = db.execute("SELECT id FROM issue_runs WHERE case_id=?", (case["id"],)).fetchone()[0]
        db.execute(
            "INSERT INTO issue_steps VALUES (?,?,?,?,?,?,?,?)",
            (
                run,
                "investigator",
                case["organization_id"],
                plant,
                "completed",
                "fixture",
                case["created_at"],
                json.dumps({"summary": "Evidence is incomplete; no cause confirmed."}),
            ),
        )
    phase(store, case["id"], "awaiting_decision")
    assert feed(admin, plant)["items"][0]["ai_summary"] == "Evidence is incomplete; no cause confirmed."
    with store.connection() as db:
        db.execute("UPDATE issue_steps SET state='failed' WHERE run_id=?", (run,))
    assert feed(admin, plant)["items"][0]["ai_summary"] is None
