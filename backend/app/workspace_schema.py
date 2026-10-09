"""Additive, versioned SQLite migration for the local shared-plant foundation."""

SCHEMA = """
CREATE TABLE IF NOT EXISTS workspace_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plant_monitoring (
 plant_id TEXT PRIMARY KEY REFERENCES plants(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS monitoring_revisions (
 plant_id TEXT NOT NULL REFERENCES plants(id), version INTEGER NOT NULL,
 created_at TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(plant_id,version));
CREATE TRIGGER IF NOT EXISTS monitoring_revision_no_update BEFORE UPDATE ON monitoring_revisions
 BEGIN SELECT RAISE(ABORT,'Monitoring mapping history cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS monitoring_revision_no_delete BEFORE DELETE ON monitoring_revisions
 BEGIN SELECT RAISE(ABORT,'Monitoring mapping history cannot be deleted'); END;
CREATE TABLE IF NOT EXISTS plants (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plant_configurations (
 plant_id TEXT NOT NULL REFERENCES plants(id), version INTEGER NOT NULL,
 data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(plant_id,version));
CREATE TRIGGER IF NOT EXISTS plant_configuration_no_update BEFORE UPDATE ON plant_configurations
 BEGIN SELECT RAISE(ABORT,'Configuration history cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS plant_configuration_no_delete BEFORE DELETE ON plant_configurations
 BEGIN SELECT RAISE(ABORT,'Configuration history cannot be deleted'); END;
CREATE TABLE IF NOT EXISTS plant_areas (
 plant_id TEXT NOT NULL REFERENCES plants(id), id TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(plant_id,id));
CREATE TABLE IF NOT EXISTS plant_assets (
 plant_id TEXT NOT NULL, id TEXT NOT NULL, area_id TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(plant_id,id), FOREIGN KEY(plant_id,area_id) REFERENCES plant_areas(plant_id,id));
CREATE TABLE IF NOT EXISTS plant_dependencies (
 plant_id TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(plant_id,source,target),
 FOREIGN KEY(plant_id,source) REFERENCES plant_assets(plant_id,id),
 FOREIGN KEY(plant_id,target) REFERENCES plant_assets(plant_id,id));
CREATE TABLE IF NOT EXISTS staff_users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS memberships (
 plant_id TEXT NOT NULL REFERENCES plants(id), user_id TEXT NOT NULL REFERENCES staff_users(id),
 role TEXT NOT NULL CHECK(role IN ('admin','manager','reliability','technician','viewer')),
 active INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(plant_id,user_id));
CREATE TABLE IF NOT EXISTS staff_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES staff_users(id), expires_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS invitations (
 token_hash TEXT PRIMARY KEY, plant_id TEXT NOT NULL REFERENCES plants(id), email TEXT NOT NULL,
 role TEXT NOT NULL, expires_at REAL NOT NULL, accepted_at TEXT, created_by TEXT NOT NULL REFERENCES staff_users(id));
CREATE TABLE IF NOT EXISTS auth_limits (bucket TEXT PRIMARY KEY, started_at REAL NOT NULL, attempts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plant_workflows (
 id TEXT PRIMARY KEY, plant_id TEXT NOT NULL REFERENCES plants(id), asset_id TEXT NOT NULL,
 created_at TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS plant_workflow_scope ON plant_workflows(plant_id,created_at);
CREATE TABLE IF NOT EXISTS plant_incidents (
 id TEXT PRIMARY KEY, workflow_id TEXT NOT NULL UNIQUE REFERENCES plant_workflows(id),
 plant_id TEXT NOT NULL REFERENCES plants(id), asset_id TEXT NOT NULL, state TEXT NOT NULL,
 calculation_version TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS plant_incident_scope ON plant_incidents(plant_id,state);
CREATE TABLE IF NOT EXISTS plant_orders (
 id TEXT NOT NULL, calculation_version TEXT NOT NULL, incident_id TEXT NOT NULL REFERENCES plant_incidents(id),
 plant_id TEXT NOT NULL REFERENCES plants(id), status TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(id,calculation_version));
CREATE TABLE IF NOT EXISTS plant_cases (
 id TEXT PRIMARY KEY, plant_id TEXT NOT NULL REFERENCES plants(id), verified_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS plant_audit (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 plant_id TEXT NOT NULL REFERENCES plants(id), at TEXT NOT NULL, actor_id TEXT,
 actor_name TEXT NOT NULL, action TEXT NOT NULL, incident_id TEXT,
 calculation_version TEXT, message TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS plant_audit_scope ON plant_audit(plant_id,sequence);
CREATE TRIGGER IF NOT EXISTS plant_audit_no_update BEFORE UPDATE ON plant_audit
 BEGIN SELECT RAISE(ABORT,'Audit records cannot be updated'); END;
CREATE TRIGGER IF NOT EXISTS plant_audit_no_delete BEFORE DELETE ON plant_audit
 BEGIN SELECT RAISE(ABORT,'Audit records cannot be deleted'); END;
"""


def migrate(db, at):
    db.executescript(SCHEMA)
    db.execute("INSERT OR IGNORE INTO workspace_migrations VALUES (1, ?)", (at,))
    from .workspace_catalog import seed_catalog

    for (plant_id,) in db.execute("SELECT id FROM plants").fetchall():
        seed_catalog(db, plant_id)
    db.execute("INSERT OR IGNORE INTO workspace_migrations VALUES (2, ?)", (at,))
    db.execute("INSERT OR IGNORE INTO workspace_migrations VALUES (3, ?)", (at,))
    db.execute("INSERT OR IGNORE INTO workspace_migrations VALUES (4, ?)", (at,))
