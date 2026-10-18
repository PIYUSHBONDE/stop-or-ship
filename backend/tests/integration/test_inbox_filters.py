"""Inbox filters and counts use the complete authorized set before pagination."""

from fastapi.testclient import TestClient

from app.identity.staff_security import COOKIE
from tests.integration.test_case_foundation import create, post, tenant
from tests.integration.test_notifications import feed, request


def test_task_filters_counts_deadline_order_and_scope(shared):
    store, application, admin, plant, invite = shared
    technician, user, _ = invite("technician")
    other, _, _ = invite("technician", "other@example.test")
    viewer, _, _ = invite("viewer")

    def task(due=None, role="technician", client=None):
        case = create(admin, plant, "materials")
        result = post(
            admin,
            plant,
            f"/cases/{case['id']}/tasks",
            {
                "expected_revision": case["revision"],
                "question": "Record the available material",
                "reason": "Planning needs a human check",
                "completion_requirements": "Record availability or missing information",
                "target_role": role,
                "due_at": due,
            },
        )
        assert result.status_code == 200, result.text
        value = result.json()
        if client:
            assert (
                post(client, plant, f"/tasks/{value['id']}/claim", {"expected_revision": 1}).status_code
                == 200
            )
        return value["id"]

    undated = task()
    future = task("2050-01-01T00:00:00+00:00", client=other)
    later = task("2000-01-01T20:00:00+00:00")
    earlier = task("2000-01-02T00:00:00+10:00", client=technician)
    manager = task("1999-01-01T00:00:00+00:00", role="manager")

    other_plant, _, token = tenant(store)
    with TestClient(application) as foreign:
        foreign.cookies.set(COOKIE, token)
        request(foreign, other_plant, create(foreign, other_plant))

    def listing(client=technician, query=""):
        result = client.get(f"/api/v1/plants/{plant}/tasks" + query)
        assert result.status_code == 200, result.text
        return result.json()

    assert [item["id"] for item in listing()["items"]] == [earlier, later, future, undated]
    assert listing()["actionable_count"] == 3
    mine = listing(query="?assignment=mine&limit=1")
    assert [item["id"] for item in mine["items"]] == [earlier]
    assert mine["next_cursor"] is None and mine["actionable_count"] == 3
    available = listing(query="?assignment=available&limit=1")
    assert [item["id"] for item in available["items"]] == [later]
    assert available["next_cursor"] == 1 and available["actionable_count"] == 3
    tail = listing(query="?assignment=available&limit=1&cursor=1")
    assert [item["id"] for item in tail["items"]] == [undated]
    assert tail["next_cursor"] is None
    assert listing(admin)["actionable_count"] == 3
    assert listing(admin)["items"][0]["id"] == manager
    assert listing(viewer) == {"items": [], "next_cursor": None, "actionable_count": 0}
    assert technician.get(f"/api/v1/plants/{plant}/tasks?assignment=someone").status_code == 422
    assert technician.get(f"/api/v1/plants/{other_plant}/tasks?assignment=mine").status_code == 404
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("UPDATE memberships SET active=0 WHERE user_id=? AND plant_id=?", (user, plant))
    assert technician.get(f"/api/v1/plants/{plant}/tasks?assignment=available").status_code == 404


def test_unread_filter_paginates_unread_set_and_keeps_global_count(shared):
    _, _, admin, plant, invite = shared
    viewer, _, _ = invite("viewer")
    for _ in range(3):
        request(admin, plant, create(admin, plant, "materials"))
    all_notices = feed(admin, plant)
    read_id = all_notices["items"][0]["id"]
    assert post(admin, plant, "/notifications/read", {"notification_id": read_id}).status_code == 200
    first = feed(admin, plant, "?unread_only=true&limit=1")
    second = feed(admin, plant, "?unread_only=true&limit=1&cursor=1")
    assert first["next_cursor"] == 1 and second["next_cursor"] is None
    assert first["unread_count"] == second["unread_count"] == 2
    unread = first["items"] + second["items"]
    assert len({item["id"] for item in unread}) == 2
    assert all(not item["read"] and item["id"] != read_id for item in unread)
    assert len(feed(admin, plant)["items"]) == 3
    assert feed(viewer, plant, "?unread_only=true") == {
        "items": [],
        "unread_count": 0,
        "next_cursor": None,
    }
