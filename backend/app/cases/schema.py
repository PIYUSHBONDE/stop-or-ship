"""Expand-only migration. Existing incident/source/auth records are not rewritten."""

SQL = """
CREATE TABLE IF NOT EXISTS issue_cases (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, plant_id TEXT NOT NULL REFERENCES plants(id),
 category TEXT NOT NULL, asset_id TEXT, incident_id TEXT REFERENCES plant_incidents(id),
 phase TEXT NOT NULL, revision INTEGER NOT NULL, analysis_version INTEGER NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS issue_case_scope ON issue_cases(organization_id,plant_id,updated_at,id);
CREATE INDEX IF NOT EXISTS issue_case_incident ON issue_cases(plant_id,incident_id);
CREATE TABLE IF NOT EXISTS issue_tasks (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, plant_id TEXT NOT NULL REFERENCES plants(id),
 case_id TEXT NOT NULL REFERENCES issue_cases(id), request_key TEXT NOT NULL,
 target_role TEXT NOT NULL, owner_id TEXT REFERENCES staff_users(id), state TEXT NOT NULL,
 revision INTEGER NOT NULL, due_at TEXT, created_at TEXT NOT NULL, data TEXT NOT NULL,
 UNIQUE(case_id,request_key));
CREATE INDEX IF NOT EXISTS issue_task_inbox ON issue_tasks(organization_id,plant_id,target_role,state);
CREATE TABLE IF NOT EXISTS issue_evidence (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, plant_id TEXT NOT NULL REFERENCES plants(id),
 case_id TEXT NOT NULL REFERENCES issue_cases(id), task_id TEXT REFERENCES issue_tasks(id),
 actor_id TEXT REFERENCES staff_users(id), created_at TEXT NOT NULL, origin TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS issue_evidence_scope ON issue_evidence(case_id,created_at,id);
CREATE TABLE IF NOT EXISTS issue_policies (
 plant_id TEXT PRIMARY KEY REFERENCES plants(id), organization_id TEXT NOT NULL,
 version INTEGER NOT NULL, enabled INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS issue_runs (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, plant_id TEXT NOT NULL REFERENCES plants(id),
 case_id TEXT NOT NULL REFERENCES issue_cases(id), analysis_version INTEGER NOT NULL,
 policy_version INTEGER NOT NULL, initiated_by TEXT, provider TEXT NOT NULL, state TEXT NOT NULL,
 created_at TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(case_id,analysis_version));
CREATE TABLE IF NOT EXISTS issue_steps (
 run_id TEXT NOT NULL REFERENCES issue_runs(id), stage TEXT NOT NULL,
 organization_id TEXT NOT NULL, plant_id TEXT NOT NULL REFERENCES plants(id),
 state TEXT NOT NULL, input_hash TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(run_id,stage));
CREATE TABLE IF NOT EXISTS issue_jobs (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, plant_id TEXT NOT NULL REFERENCES plants(id),
 case_id TEXT NOT NULL REFERENCES issue_cases(id), run_id TEXT NOT NULL REFERENCES issue_runs(id),
 state TEXT NOT NULL, available_at REAL NOT NULL, lease_token TEXT, lease_until REAL NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS issue_job_claim ON issue_jobs(state,available_at,lease_until);
CREATE TABLE IF NOT EXISTS issue_receipts (
 organization_id TEXT NOT NULL, plant_id TEXT NOT NULL REFERENCES plants(id), actor_id TEXT NOT NULL,
 key TEXT NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(organization_id,plant_id,actor_id,key));
CREATE TABLE IF NOT EXISTS issue_events (
 sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, organization_id TEXT NOT NULL,
 plant_id TEXT NOT NULL REFERENCES plants(id), case_id TEXT REFERENCES issue_cases(id),
 actor_id TEXT, at TEXT NOT NULL, action TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS issue_event_scope ON issue_events(organization_id,plant_id,case_id,sequence);
CREATE TABLE IF NOT EXISTS issue_capabilities (
 token_hash TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES issue_runs(id),
 job_id TEXT NOT NULL REFERENCES issue_jobs(id), lease_token TEXT NOT NULL, expires_at REAL NOT NULL);
CREATE TRIGGER IF NOT EXISTS issue_evidence_no_update BEFORE UPDATE ON issue_evidence
 BEGIN SELECT RAISE(ABORT,'Case evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS issue_evidence_no_delete BEFORE DELETE ON issue_evidence
 BEGIN SELECT RAISE(ABORT,'Case evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS issue_event_no_update BEFORE UPDATE ON issue_events
 BEGIN SELECT RAISE(ABORT,'Case audit is immutable'); END;
CREATE TRIGGER IF NOT EXISTS issue_event_no_delete BEFORE DELETE ON issue_events
 BEGIN SELECT RAISE(ABORT,'Case audit is immutable'); END;
"""


def migrate(db, at):
    db.executescript(SQL)
    if not db.execute("SELECT 1 FROM workspace_migrations WHERE version=7").fetchone():
        import json

        from app.cases.service import sync_incident

        for plant_id, data in db.execute("SELECT plant_id,data FROM plant_incidents").fetchall():
            sync_incident(db, plant_id, json.loads(data), enqueue=False)
        db.execute("INSERT INTO workspace_migrations VALUES (7,?)", (at,))
