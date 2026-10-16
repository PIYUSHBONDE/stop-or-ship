"""Opt-in PostgreSQL store for an already migrated schema.

No schema creation or application startup selection happens here. A deployment must
explicitly supply a server-owned DSN, schema and reviewed driver dependency.
"""

import re
from contextlib import contextmanager

from app.persistence.store import Store

WRITE_LOCK = 735682902


def query_parameters(statement):
    """Adapt trusted repository SQL, never values, to driver placeholders.

    The existing domain services use SQLite qmark parameters. Quoted strings and
    identifiers are preserved; parameter values always go through the driver.
    """
    result = []
    quote = None
    index = 0
    while index < len(statement):
        char = statement[index]
        if char == "%":
            result.append("%%")
        elif quote:
            result.append(char)
            if char == quote:
                if index + 1 < len(statement) and statement[index + 1] == quote:
                    result.append(quote)
                    index += 1
                else:
                    quote = None
        elif char in ("'", '"'):
            quote = char
            result.append(char)
        elif char == "?":
            # Optional asset IDs are tested for NULL before equality. PostgreSQL
            # otherwise cannot infer the type of a standalone NULL parameter.
            suffix = statement[index + 1 :]
            result.append("CAST(%s AS TEXT)" if re.match(r"\s+IS\s+NULL\b", suffix, re.I) else "%s")
        else:
            result.append(char)
        index += 1
    if quote:
        raise ValueError("Unterminated repository SQL literal")
    return "".join(result)


class Connection:
    """Small compatibility seam; business transitions remain in domain services."""

    def __init__(self, connection):
        self.raw = connection

    def execute(self, statement, parameters=()):
        if statement == "BEGIN IMMEDIATE":
            # Match SQLite's serialized writers for the initial small pilot.
            # Every database callback finishes before any model/network call.
            return self.raw.execute("SELECT pg_advisory_xact_lock(%s)", (WRITE_LOCK,))
        if statement.startswith("INSERT OR IGNORE INTO "):
            statement = statement.replace("INSERT OR IGNORE INTO ", "INSERT INTO ", 1)
            statement += " ON CONFLICT DO NOTHING"
        elif statement.startswith("INSERT OR REPLACE INTO budgets VALUES"):
            statement = statement.replace("INSERT OR REPLACE INTO ", "INSERT INTO ", 1)
            statement += " ON CONFLICT(day) DO UPDATE SET calls=EXCLUDED.calls"
        elif re.search(r"\b(?:PRAGMA|AUTOINCREMENT|INSERT OR)\b", statement):
            raise ValueError("Unsupported repository SQL for PostgreSQL")
        # PostgreSQL distinguishes target-table columns from EXCLUDED values.
        if statement.startswith("INSERT INTO auth_limits "):
            statement = statement.replace("SET attempts=attempts+1", "SET attempts=auth_limits.attempts+1")
        if statement.startswith("INSERT INTO ingestion_budgets "):
            statement = statement.replace("SET calls=calls+1", "SET calls=ingestion_budgets.calls+1")
        columns = {
            "plant_areas": "plant_id,id,data",
            "plant_assets": "plant_id,id,area_id,data",
            "plant_dependencies": "plant_id,source,target,data",
            "telemetry_records": "source_id,record_id,checksum,data,received_at",
        }
        for table, names in columns.items():
            statement = statement.replace(
                f"INSERT INTO {table} VALUES", f"INSERT INTO {table}({names}) VALUES"
            )
        return self.raw.execute(query_parameters(statement), parameters)


class PostgresStore(Store):
    """Preserves shared relational services without selecting historical Firestore."""

    dialect = "postgres"

    def __init__(self, dsn, *, schema="plantsense", evidence_dsn=""):
        if not dsn or not re.fullmatch(r"plantsense(?:_[a-z0-9_]+)?", schema):
            raise ValueError("A server-owned PostgreSQL DSN and dedicated schema are required")
        self.dsn = dsn
        self.schema = schema
        self.evidence_dsn = evidence_dsn
        # Existing shared-workflow code distinguishes relational storage from the
        # historical Firestore adapter through this flag, not deployment location.
        self.cloud = False

    @contextmanager
    def connection(self, *, readonly=False):
        import psycopg
        from psycopg import sql

        with psycopg.connect(
            self.evidence_dsn if readonly and self.evidence_dsn else self.dsn,
            autocommit=True,
            connect_timeout=10,
        ) as connection:
            with connection.transaction():
                if readonly:
                    connection.execute("SET TRANSACTION READ ONLY")
                connection.execute("SET LOCAL statement_timeout = '30s'")
                connection.execute("SET LOCAL lock_timeout = '20s'")
                connection.execute(
                    sql.SQL("SET LOCAL search_path TO {}, pg_catalog").format(sql.Identifier(self.schema))
                )
                yield Connection(connection)

    def check_ready(self):
        with self.connection(readonly=True) as db:
            versions = {row[0] for row in db.execute("SELECT version FROM workspace_migrations")}
            if versions != set(range(1, 8)):
                raise RuntimeError("PostgreSQL schema requires the reviewed migration")
            db.execute("SELECT json_extract('{}','$.missing'),json_set('{}','$.probe','ready')")
            for table in ("plant_areas", "plant_assets", "plant_dependencies", "telemetry_records"):
                db.execute(f"SELECT rowid FROM {table} LIMIT 0")

    @contextmanager
    def evidence_scope(self, capability):
        from app.cases.jobs import authorize_capability

        with self.connection(readonly=True) as db:
            _, run, case, _ = authorize_capability(db, capability)
            yield db, run, case
