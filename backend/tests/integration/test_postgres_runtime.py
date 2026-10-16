"""Opt-in real PostgreSQL checks. Default SQLite execution remains unchanged."""

import asyncio
import os
import sys
import uuid
from contextlib import ExitStack, closing
from pathlib import Path

import pytest

if not os.environ.get("PLANTSENSE_TEST_POSTGRES_DSN"):
    pytest.skip("Dedicated PostgreSQL acceptance requires an isolated DSN", allow_module_level=True)

import psycopg  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from psycopg import sql  # noqa: E402

from app.cases import jobs  # noqa: E402
from app.cases.worker import run_once  # noqa: E402
from app.main import create_app  # noqa: E402
from app.persistence.cloud_migrate import grant_roles  # noqa: E402
from app.persistence.postgres import PostgresStore, query_parameters  # noqa: E402
from tests.integration.test_case_foundation import (  # noqa: E402
    create,
    enable,
    test_case_scope_permissions_and_immutable_receipts,
)
from tests.integration.test_case_guards import (  # noqa: E402
    test_case_and_organization_budgets_survive_retries_and_revocation,
    test_concurrent_claims_have_one_owner_and_immutable_response,
)
from tests.integration.test_shared_plant import (  # noqa: E402
    test_concurrent_approval_one_order_and_attributed_audit,
    test_cross_plant_and_demo_tokens_do_not_authorize,
    test_named_identity_cookie_and_one_time_setup,
    test_shared_view_and_permission_matrix,
)

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "infra" / "postgres"))
from migrate import canonical, import_snapshot  # noqa: E402

# Imported tests intentionally exercise existing acceptance unchanged against this store.
REUSED_ACCEPTANCE = (
    test_case_and_organization_budgets_survive_retries_and_revocation,
    test_concurrent_claims_have_one_owner_and_immutable_response,
    test_concurrent_approval_one_order_and_attributed_audit,
    test_case_scope_permissions_and_immutable_receipts,
    test_cross_plant_and_demo_tokens_do_not_authorize,
    test_named_identity_cookie_and_one_time_setup,
    test_shared_view_and_permission_matrix,
)


def test_deployment_roles_allow_workflows_but_protect_credentials_and_evidence(pg_store):
    dsn = os.environ["PLANTSENSE_TEST_POSTGRES_DSN"]
    app_dsn = psycopg.conninfo.make_conninfo(dsn, user="plantsense_app", password="isolated-app")
    evidence_dsn = psycopg.conninfo.make_conninfo(
        dsn, user="plantsense_evidence", password="isolated-evidence"
    )
    with psycopg.connect(dsn, autocommit=True) as root:
        try:
            with root.transaction():
                grant_roles(root, pg_store.schema, app_dsn, evidence_dsn)
            restricted = PostgresStore(app_dsn, schema=pg_store.schema, evidence_dsn=evidence_dsn)
            restricted.check_ready()
            with TestClient(create_app(restricted, shared_runtime=False)) as client:
                response = client.post(
                    "/api/v1/access/setup",
                    json={
                        "email": "restricted@example.test",
                        "password": "isolated strong password!",
                        "display_name": "Restricted admin",
                        "organization_name": "Fixture",
                        "plant_name": "Fixture",
                    },
                )
                assert response.status_code == 200, response.text
                plant = response.json()["plants"][0]["id"]
                case = create(client, plant)
                assert client.get(f"/api/v1/plants/{plant}/cases/{case['id']}").status_code == 200
            with restricted.connection(readonly=True) as db:
                assert db.execute("SELECT id,enabled FROM staff_users").fetchone()[1] == 1
            with (
                pytest.raises(psycopg.errors.InsufficientPrivilege),
                restricted.connection(readonly=True) as db,
            ):
                db.execute("SELECT password_hash FROM staff_users")
            with pytest.raises(psycopg.errors.InsufficientPrivilege), restricted.connection() as db:
                db.execute("DELETE FROM issue_evidence")
        finally:
            for name in ("plantsense_app", "plantsense_evidence"):
                root.execute(sql.SQL("DROP OWNED BY {}").format(sql.Identifier(name)))
                root.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(name)))


@pytest.fixture
def pg_store():
    dsn = os.environ["PLANTSENSE_TEST_POSTGRES_DSN"]
    schema = "plantsense_test_" + uuid.uuid4().hex
    with psycopg.connect(dsn, autocommit=True) as connection:
        with closing(canonical()) as source:
            for version in range(1, 8):
                source.execute("INSERT INTO workspace_migrations VALUES (?,?)", (version, "fixture"))
            source.commit()
            import_snapshot(source, connection, schema)
        with connection.transaction():
            connection.execute(
                sql.SQL("SET LOCAL search_path TO {},pg_catalog").format(sql.Identifier(schema))
            )
            functions = Path(__file__).resolve().parents[2] / "app" / "persistence" / "postgres-functions.sql"
            connection.execute(functions.read_text())
        evidence_role = "evidence_" + uuid.uuid4().hex
        connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(evidence_role)))
        connection.execute(
            sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(
                sql.Identifier(schema), sql.Identifier(evidence_role)
            )
        )
        connection.execute(
            sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(
                sql.Identifier(schema), sql.Identifier(evidence_role)
            )
        )
        evidence_dsn = psycopg.conninfo.make_conninfo(dsn, user=evidence_role)
        yield PostgresStore(dsn, schema=schema, evidence_dsn=evidence_dsn)
        connection.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
        connection.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(evidence_role)))


@pytest.fixture
def shared(pg_store):
    application = create_app(pg_store, shared_runtime=False)
    with ExitStack() as stack:
        admin = stack.enter_context(TestClient(application))
        response = admin.post(
            "/api/v1/access/setup",
            json={
                "email": "admin@example.test",
                "password": "testing-only strong passphrase!",
                "display_name": "Plant Administrator",
                "organization_name": "Test organization",
                "plant_name": "Test plant",
            },
        )
        assert response.status_code == 200, response.text
        plant = response.json()["plants"][0]["id"]

        def invite(role, email=None):
            email = email or role + "@example.test"
            receipt = admin.post(f"/api/v1/plants/{plant}/invitations", json={"email": email, "role": role})
            assert receipt.status_code == 200, receipt.text
            member = stack.enter_context(TestClient(application))
            accepted = member.post(
                "/api/v1/access/accept-invitation",
                json={
                    "email": email,
                    "password": "testing-only strong passphrase!",
                    "display_name": role,
                    "token": receipt.json()["token"],
                },
            )
            assert accepted.status_code == 200, accepted.text
            return member, accepted.json()["user"]["id"], receipt.json()["token"]

        yield pg_store, application, admin, plant, invite


def test_readonly_evidence_blocks_writes_and_rechecks_policy(shared):
    from fastapi import HTTPException

    store, _, admin, plant, _ = shared
    enable(admin, plant)
    create(admin, plant)
    job = jobs.claim(store)
    capability = jobs.mint_capability(store, job)
    with store.evidence_scope(capability) as (db, _, case):
        assert case["plant_id"] == plant
        assert db.execute("SELECT count(*) FROM plant_assets WHERE plant_id=?", (plant,)).fetchone()[0] > 0
        with pytest.raises(psycopg.errors.ReadOnlySqlTransaction):
            db.execute("DELETE FROM issue_cases")
    with store.connection() as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("UPDATE issue_policies SET enabled=0 WHERE plant_id=?", (plant,))
    with pytest.raises(HTTPException):
        with store.evidence_scope(capability):
            pytest.fail("Revoked automation accessed evidence")


def test_parameters_are_values_and_quoted_question_marks_are_preserved(pg_store):
    assert query_parameters("SELECT '?' AS value, ? AS argument") == "SELECT '?' AS value, %s AS argument"
    with pg_store.connection() as db:
        hostile = "'); DROP SCHEMA public CASCADE; --"
        assert db.execute("SELECT '100%'::text").fetchone() == ("100%",)
        assert db.execute("SELECT '?'::text, ?::text, '100%'::text", (hostile,)).fetchone() == (
            "?",
            hostile,
            "100%",
        )
        assert db.execute("SELECT ? IS NULL", (None,)).fetchone() == (True,)
        assert db.execute(
            "SELECT json_extract(json_set('{}','$.error',?),'$.error')", (hostile,)
        ).fetchone() == (hostile,)


def test_runtime_transaction_rollback(pg_store):
    with pytest.raises(RuntimeError):
        with pg_store.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("INSERT INTO budgets VALUES ('today',1)")
            raise RuntimeError("fixture rollback")
    with pg_store.connection() as db:
        assert db.execute("SELECT count(*) FROM budgets").fetchone() == (0,)


def test_real_stdio_mcp_human_response_and_resume(shared):
    from tests.integration.test_case_foundation import detail, post

    store, _, admin, plant, _ = shared
    enable(admin, plant)
    case = create(admin, plant)
    assert asyncio.run(run_once(store))
    state = detail(admin, plant, case["id"])
    assert state["case"]["phase"] == "waiting_for_input", state
    task = state["tasks"][0]
    claimed = post(admin, plant, f"/tasks/{task['id']}/claim", {"expected_revision": task["revision"]})
    assert claimed.status_code == 200, claimed.text
    response = post(
        admin,
        plant,
        f"/tasks/{task['id']}/respond",
        {
            "expected_revision": claimed.json()["revision"],
            "text": "Actual output is 65 parts/hour; further checks are needed.",
            "values": [],
        },
    )
    assert response.status_code == 200, response.text
    replacement = PostgresStore(store.dsn, schema=store.schema, evidence_dsn=store.evidence_dsn)
    assert asyncio.run(run_once(replacement))
    resumed = detail(admin, plant, case["id"])
    assert resumed["case"]["analysis_version"] == 2
    assert resumed["evidence"]
    assert resumed["case"]["phase"] in {"waiting_for_input", "awaiting_decision"}
