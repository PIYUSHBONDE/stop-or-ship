"""One-shot privileged Cloud Run job. Never exposed through application HTTP."""

import json
import os
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import psycopg
from google.cloud import storage
from psycopg import sql
from psycopg.conninfo import conninfo_to_dict

from app.core import config
from app.persistence.postgres_migration import import_snapshot, snapshot


def grant_roles(connection, schema, app_dsn, evidence_dsn):
    roles = [conninfo_to_dict(app_dsn), conninfo_to_dict(evidence_dsn)]
    if [r.get("user") for r in roles] != ["plantsense_app", "plantsense_evidence"]:
        raise ValueError("Unexpected runtime database identities")
    for role in roles:
        name = role["user"]
        if not connection.execute("SELECT 1 FROM pg_roles WHERE rolname=%s", (name,)).fetchone():
            connection.execute(sql.SQL("CREATE ROLE {} LOGIN").format(sql.Identifier(name)))
        connection.execute(
            sql.SQL("ALTER ROLE {} PASSWORD {}").format(sql.Identifier(name), sql.Literal(role["password"]))
        )
        connection.execute(
            sql.SQL("GRANT USAGE ON SCHEMA {} TO {}").format(sql.Identifier(schema), sql.Identifier(name))
        )
    app = sql.Identifier("plantsense_app")
    evidence = sql.Identifier("plantsense_evidence")
    scope = sql.Identifier(schema)
    connection.execute(sql.SQL("REVOKE ALL ON SCHEMA {} FROM PUBLIC").format(scope))
    connection.execute(
        sql.SQL("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA {} TO {}").format(scope, app)
    )
    connection.execute(sql.SQL("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA {} TO {}").format(scope, app))
    connection.execute(sql.SQL("GRANT SELECT ON ALL TABLES IN SCHEMA {} TO {}").format(scope, evidence))
    for table in ("staff_users", "staff_sessions", "invitations", "auth_limits"):
        connection.execute(
            sql.SQL("REVOKE ALL ON {}.{} FROM {}").format(scope, sql.Identifier(table), evidence)
        )
    connection.execute(sql.SQL("GRANT SELECT(id,enabled) ON {}.staff_users TO {}").format(scope, evidence))
    for table in (
        "source_revisions",
        "telemetry_records",
        "plant_configurations",
        "monitoring_revisions",
        "plant_audit",
        "issue_evidence",
        "issue_events",
    ):
        connection.execute(
            sql.SQL("REVOKE UPDATE,DELETE ON {}.{} FROM {}").format(scope, sql.Identifier(table), app)
        )


def main():
    origin = os.environ["PLANTSENSE_MIGRATION_SOURCE"]
    if not origin.startswith("gs://"):
        raise ValueError("Migration source must be a private object")
    bucket, name = origin[5:].split("/", 1)
    with TemporaryDirectory(prefix="plantsense-cutover-") as temporary:
        path = Path(temporary) / "source.db"
        storage.Client(project=config.PROJECT).bucket(bucket).blob(name).download_to_filename(path)
        with (
            snapshot(path) as source,
            psycopg.connect(os.environ["PLANTSENSE_MIGRATION_DSN"], autocommit=True) as connection,
        ):
            result = import_snapshot(source, connection, config.POSTGRES_SCHEMA)
            with connection.transaction():
                grant_roles(
                    connection,
                    config.POSTGRES_SCHEMA,
                    os.environ["PLANTSENSE_APP_DSN"],
                    os.environ["PLANTSENSE_EVIDENCE_DSN"],
                )
            print(
                json.dumps(
                    {
                        "migration": "verified",
                        "tables": result["tables"],
                        "rows": result["rows"],
                        "retry": result["retry"],
                    }
                ),
                flush=True,
            )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("Migration failed: " + type(error).__name__, file=sys.stderr)
        raise SystemExit(1) from None
