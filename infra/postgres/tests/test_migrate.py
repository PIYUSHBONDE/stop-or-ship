"""Real PostgreSQL acceptance, independent of application or cloud databases."""

import json
import os
import sqlite3
import uuid
from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest
from psycopg import sql

from migrate import canonical, import_snapshot, manifest, snapshot


@pytest.fixture
def source():
    db = canonical()
    db.execute("PRAGMA foreign_keys=ON")
    for version in range(1, 8):
        db.execute("INSERT INTO workspace_migrations VALUES (?,?)", (version, "2026-10-15T00:00:00Z"))
    for suffix in ("a", "b"):
        db.execute("INSERT INTO organizations VALUES (?,?)", (suffix, "Organization " + suffix))
        db.execute("INSERT INTO plants VALUES (?,?,?)", (suffix, suffix, "Plant " + suffix))
        db.execute(
            "INSERT INTO staff_users VALUES (?,?,?,?,1)", (suffix, suffix + "@example.test", suffix, "hash")
        )
        db.execute("INSERT INTO memberships VALUES (?,?,?,1)", (suffix, suffix, "admin"))
    for identifier in ("Z", "ä", "工場"):
        db.execute("INSERT INTO organizations VALUES (?,?)", (identifier, identifier))
    db.execute("INSERT INTO telemetry_sources VALUES ('s','a','pump','operational',1,'{}')")
    db.execute("INSERT INTO source_revisions VALUES ('s',1,'{\"units\":\"bar\"}')")
    db.execute("INSERT INTO telemetry_records VALUES ('s','reading','checksum','{\"pressure\":125}','now')")
    db.execute("INSERT INTO budgets VALUES ('2026-10-15',3)")
    db.execute("INSERT INTO staff_sessions VALUES ('token-hash','a',1780000000.123456)")
    db.execute("INSERT INTO plant_configurations VALUES ('a',1,'{\"label\":\"é 工場\"}','now')")
    db.execute(
        "INSERT INTO plant_audit(id,plant_id,at,actor_name,action,message) "
        "VALUES ('audit','a','now','System','test','not verified')"
    )
    db.execute(
        "INSERT INTO issue_cases VALUES ('case','a','a','production',NULL,NULL,"
        "'waiting_for_input',2,1,'now','now','a','{}')"
    )
    db.execute(
        "INSERT INTO issue_tasks VALUES ('task','a','a','case','request','reliability',NULL,"
        "'open',1,NULL,'now','{}')"
    )
    db.execute(
        "INSERT INTO issue_evidence VALUES ('evidence','a','a','case','task','a','now',"
        "'staff_report','{\"note\":\"125 bar; unverified\"}')"
    )
    db.execute(
        "INSERT INTO issue_events(id,organization_id,plant_id,case_id,at,action,data) "
        "VALUES ('event','a','a','case','now','created','{}')"
    )
    db.commit()
    yield db
    db.close()


@pytest.fixture
def target():
    dsn = os.environ.get("PLANTSENSE_TEST_POSTGRES_DSN")
    if not dsn:
        pytest.fail("Set PLANTSENSE_TEST_POSTGRES_DSN to an isolated test database")
    with psycopg.connect(dsn, autocommit=True) as connection:
        schema = "plantsense_test_" + uuid.uuid4().hex
        yield connection, schema
        connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))


def test_populated_import_exact_retry_and_identity(source, target):
    connection, schema = target
    before = manifest(source)
    result = import_snapshot(source, connection, schema)
    assert result["tables"] == len(before)
    assert result["rows"] == sum(p["count"] for p in before.values())
    assert not result["retry"]
    assert import_snapshot(source, connection, schema)["retry"]
    assert manifest(source) == before
    connection.execute(sql.SQL("SET search_path TO {},pg_catalog").format(sql.Identifier(schema)))
    assert connection.execute("SELECT count(*) FROM organizations").fetchone() == (5,)
    assert connection.execute("SELECT expires_at FROM staff_sessions").fetchone() == (1780000000.123456,)
    connection.execute(
        "INSERT INTO plant_audit(id,plant_id,at,actor_name,action,message) "
        "VALUES ('next','a','now','System','test','next')"
    )
    assert connection.execute("SELECT max(sequence) FROM plant_audit").fetchone() == (2,)


@pytest.mark.parametrize(
    "table",
    [
        "source_revisions",
        "telemetry_records",
        "plant_configurations",
        "plant_audit",
        "issue_evidence",
        "issue_events",
    ],
)
@pytest.mark.parametrize("operation", ["UPDATE", "DELETE"])
def test_immutable_records_survive_migration(source, target, table, operation):
    connection, schema = target
    import_snapshot(source, connection, schema)
    connection.execute(sql.SQL("SET search_path TO {},pg_catalog").format(sql.Identifier(schema)))
    query = sql.SQL("UPDATE {} SET data=data" if operation == "UPDATE" else "DELETE FROM {}")
    if table == "plant_audit" and operation == "UPDATE":
        query = sql.SQL("UPDATE {} SET message=message")
    with pytest.raises(psycopg.errors.CheckViolation):
        connection.execute(query.format(sql.Identifier(table)))


def test_constraints_and_foreign_keys(source, target):
    connection, schema = target
    import_snapshot(source, connection, schema)
    connection.execute(sql.SQL("SET search_path TO {},pg_catalog").format(sql.Identifier(schema)))
    with pytest.raises(psycopg.errors.CheckViolation):
        connection.execute("UPDATE memberships SET role='superadmin'")
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        connection.execute("INSERT INTO plants VALUES ('bad','missing','bad')")
    with pytest.raises(psycopg.errors.UniqueViolation):
        connection.execute(
            "INSERT INTO telemetry_sources VALUES ('duplicate','a','pump','operational',1,'{}')"
        )


def test_modified_retry_fails_without_overwrite(source, target):
    connection, schema = target
    import_snapshot(source, connection, schema)
    source.execute("UPDATE organizations SET name='changed' WHERE id='a'")
    with pytest.raises(ValueError, match="different source"):
        import_snapshot(source, connection, schema)
    value = connection.execute(
        sql.SQL("SELECT name FROM {}.organizations WHERE id='a'").format(sql.Identifier(schema))
    ).fetchone()
    assert value == ("Organization a",)


def test_failed_copy_rolls_back_entire_schema(source, target):
    connection, schema = target
    source.execute("INSERT INTO sessions VALUES (NULL,'owner','{}')")
    with pytest.raises(psycopg.errors.NotNullViolation):
        import_snapshot(source, connection, schema)
    assert not connection.execute("SELECT 1 FROM pg_namespace WHERE nspname=%s", (schema,)).fetchone()


def test_unknown_source_table_rejected(source, target):
    source.execute("CREATE TABLE injected_table (data TEXT)")
    with pytest.raises(ValueError, match="Source tables"):
        import_snapshot(source, *target)


def test_active_reservation_rejected(source, target):
    source.execute("INSERT INTO ai_usage VALUES ('request','today',?)", (json.dumps({"status": "reserved"}),))
    with pytest.raises(ValueError, match="reservations"):
        import_snapshot(source, *target)


def test_snapshot_preserves_source_and_includes_wal(tmp_path):
    path = tmp_path / "source.db"
    with sqlite3.connect(path) as original:
        original.execute("PRAGMA journal_mode=WAL")
        original.execute("CREATE TABLE sample (data TEXT)")
        original.execute("INSERT INTO sample VALUES ('retained')")
        original.commit()
        with snapshot(path) as copy:
            assert copy.execute("SELECT data FROM sample").fetchone() == ("retained",)
            with pytest.raises(sqlite3.OperationalError):
                copy.execute("DELETE FROM sample")
        assert original.execute("SELECT count(*) FROM sample").fetchone() == (1,)
    original.close()


def test_sequence_high_water_preserved(source, target):
    connection, schema = target
    source.execute("UPDATE sqlite_sequence SET seq=1000 WHERE name='plant_audit'")
    import_snapshot(source, connection, schema)
    connection.execute(sql.SQL("SET search_path TO {},pg_catalog").format(sql.Identifier(schema)))
    connection.execute(
        "INSERT INTO plant_audit(id,plant_id,at,actor_name,action,message) "
        "VALUES ('next','a','now','System','test','next')"
    )
    assert connection.execute("SELECT max(sequence) FROM plant_audit").fetchone() == (1001,)


def test_telemetry_cursor_ids_preserved_with_gaps(source, target):
    source.execute(
        "INSERT INTO telemetry_records(rowid,source_id,record_id,checksum,data,received_at) "
        "VALUES (99,'s','second','checksum','{}','now')"
    )
    connection, schema = target
    import_snapshot(source, connection, schema)
    connection.execute(sql.SQL("SET search_path TO {},pg_catalog").format(sql.Identifier(schema)))
    assert connection.execute("SELECT rowid FROM telemetry_records ORDER BY rowid").fetchall() == [
        (1,),
        (99,),
    ]
    connection.execute(
        "INSERT INTO telemetry_records(source_id,record_id,checksum,data,received_at) "
        "VALUES ('s','third','checksum','{}','now')"
    )
    assert connection.execute("SELECT max(rowid) FROM telemetry_records").fetchone() == (100,)


def test_existing_target_never_overwritten(source, target):
    connection, schema = target
    connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
    connection.execute(sql.SQL("CREATE TABLE {}.retained (data TEXT)").format(sql.Identifier(schema)))
    with pytest.raises(ValueError, match="not empty"):
        import_snapshot(source, connection, schema)
    assert connection.execute(
        "SELECT tablename FROM pg_tables WHERE schemaname=%s", (schema,)
    ).fetchall() == [("retained",)]


def test_concurrent_delivery_imports_once(source, target, tmp_path):
    _, schema = target
    path = tmp_path / "fixture.db"
    with sqlite3.connect(path) as backup:
        source.backup(backup)
    backup.close()

    def run():
        with (
            snapshot(path) as copied,
            psycopg.connect(os.environ["PLANTSENSE_TEST_POSTGRES_DSN"], autocommit=True) as connection,
        ):
            return import_snapshot(copied, connection, schema)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(), range(2)))
    assert sorted(result["retry"] for result in results) == [False, True]
