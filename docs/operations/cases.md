# Local cases, workers and recovery

This feature runs locally. It requires the locked backend dependencies, including `mcp==1.28.0`, and the generated frontend client. Never reuse acceptance fixtures against the review database. No cloud provisioning is needed.

## Startup

Inspect listening ports first. Back up an existing database before first startup with migration 7. Set the **same absolute database path and provider** in API and worker terminals. Use an unused frontend/API port pair and matching allowed web origin.

```powershell
$env:PLANTSENSE_MODE='local'
$env:PLANTSENSE_AI_PROVIDER='vertex'
$env:GEMINI_MODEL='gemini-3.8-flash'
$env:GOOGLE_CLOUD_PROJECT='<your existing Vertex project>'
$env:GOOGLE_CLOUD_LOCATION='global'
$env:PLANTSENSE_AI_EVALUATION_FILE='<absolute matching investigation report path>'
$env:PLANTSENSE_ASSISTANT_EVALUATION_FILE='<absolute matching assistant report path>'
$env:PLANTSENSE_CASES_EVALUATION_FILE='<absolute matching case report path>'
$env:PLANTSENSE_INTERNAL_TEST_MODE='false'
$env:PLANTSENSE_DB='D:\Projects\AI Builders Cup\.runtime\local-cases.db'
$env:PLANTSENSE_STAFF_WEB_ORIGINS='http://127.0.0.1:3000'
.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

In a second terminal, repeat the mode/provider/database settings, then:

```powershell
$env:PYTHONPATH='backend'
.venv/Scripts/python.exe -m app.cases.worker
```

`--once` processes at most one available job. `--drain` processes available jobs and exits when none remain. A worker waiting for human evidence does not remain assigned to that case. Run frontend with `API_BASE_URL=http://127.0.0.1:8000`. Stop every standalone frontend before `npm.cmd --prefix web run build` on Windows.

Sign in, select the plant, then open **Incidents → Factory cases and human requests**. Staff can explicitly report an issue, including through chat's **Start case** form. Administrators alone can enable plant coordination. **Requests** opens the role inbox; claim a task before responding. Review existing incident links for equipment actions. Managers record production outcomes with supporting evidence. Generated Operators assignments remain separate from authenticated staff tasks.

Normal application execution requires live AI. Scripted providers are available only for isolated tests; ordinary API and worker startup reject scripted mode. Preserve configured budgets and all three matching report paths. Failed gates block new AI coordination without disabling manual tasks. Evaluation programs under `backend/scripts/evaluation/` use isolated databases and never enable a plant policy by themselves in the review database. Keep `PLANTSENSE_INTERNAL_TEST_MODE=false` for assistant evaluation so the missing-readings fixture cannot inherit synthetic replay readings. Do not substitute a scripted report for live acceptance.

The optional trusted server setting `ASSISTANT_API_BASE_URL` routes only existing assistant question/transcription/speech endpoints to a separately validated local release. All other requests continue to `API_BASE_URL`. This supports preserving the previously validated assistant while candidate case automation is gated; it does not validate the candidate. Both services must use the intended same plant database and unchanged identity semantics. Restrict both to loopback.

## Failure and reconciliation

- A worker crash leaves its lease until expiry. Another worker claims the stable job identity, increments the attempt count and reuses compatible checkpoints. Old fencing tokens cannot publish.
- Provider failures retain useful earlier stages and expose a blocked run with a sanitized error class. An authorized retry retains the run, spend and two-attempt limit. New material evidence creates a new revision; it never resets lifetime case spending.
- Membership revocation, disabled policies, changed policy versions and provider mismatch stop later protected work. Explicit review is required before restarting compatible analysis.
- Requests without due dates do not escalate. An overdue request creates at most one manager follow-up. Check staff availability manually; automatic reassignment is not implemented.
- Missing or stale observations stay missing/stale. A staff response does not create telemetry, intervention authorization or verified memory.

## Backup and restore

Stop the case worker and API before restoration. Use Python's SQLite backup API for consistent snapshots, including WAL content; do not copy only a live `.db` file. Keep backups outside Git and restrict filesystem access. The example below creates a new backup and refuses to overwrite an existing file.

```python
import sqlite3
from pathlib import Path

source = Path(r"D:\Projects\AI Builders Cup\.runtime\local-cases.db")
target = source.with_name("local-cases.before-update.db")
if not source.is_file() or target.exists():
    raise RuntimeError("Check source and choose a new backup filename")
with sqlite3.connect(source) as original, sqlite3.connect(target) as backup:
    original.backup(backup)
    assert backup.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
```

Rehearse restore by opening a new database path from the backup and running integrity/foreign-key checks, membership/record count comparisons and a scoped read. Never test restoration by overwriting the active review database. For an actual rollback, stop all writers, preserve the failed database separately, restore the verified backup into the configured path and restart the known release. Restoring a pre-update snapshot loses subsequent writes; reconcile them before committing to that rollback.

## Disable or roll back the feature

Set `PLANTSENSE_CASES_ENABLED=false` in API and worker, then restart both. Case endpoints return 404 and the case worker does not process jobs. Existing operational incident behavior remains available; all new tables and history remain stored. Disable plant policies before rolling back application code. An older application ignores additive tables; do not run downgrade SQL or delete migration history. Re-enable only after a backup, compatibility checks and any required live reports. Pre-migration restore is an emergency option requiring explicit reconciliation of newer writes.

## Production work still required

See the [architecture blueprint](../architecture/case-foundation.md): PostgreSQL, managed identity, private Cloud Run workers, duplicate-safe Cloud Tasks delivery, versioned Cloud Storage evidence, tenant retrieval/cache controls, monitoring, restore objectives and commissioned plant data. The observed 100-case scripted laptop exercise is not a production capacity estimate.
