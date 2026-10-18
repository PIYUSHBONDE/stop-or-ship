# Local cases, workers and recovery

This feature runs locally. It requires the locked backend dependencies, including `mcp==1.28.0`, and the generated frontend client. Never reuse acceptance fixtures against the review database. No cloud provisioning is needed.

## Startup

Inspect listening ports first. Back up an existing database before first startup with migration 7. Set the **same database URL and provider** in API and worker terminals. Use an unused frontend/API port pair and matching allowed web origin. Local mode skips evaluation report files unless `PLANTSENSE_REQUIRE_RELEASE_GATES=true`. Cloud mode requires them by default; prototype deployment sets this variable to `false` explicitly.

```powershell
$env:PLANTSENSE_MODE='local'
$env:PLANTSENSE_AI_PROVIDER='vertex'
$env:GEMINI_MODEL='gemini-3.8-flash'
$env:GOOGLE_CLOUD_PROJECT='<your existing Vertex project>'
$env:GOOGLE_CLOUD_LOCATION='global'
$env:PLANTSENSE_INTERNAL_TEST_MODE='false'
$env:DATABASE_URL='<postgresql://user:password@host:5432/database>'
$env:PLANTSENSE_STAFF_WEB_ORIGINS='http://127.0.0.1:3000'
.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

In a second terminal, repeat the mode/provider/database settings, then:

```powershell
$env:PYTHONPATH='backend'
.venv/Scripts/python.exe -m app.cases.worker
```

`--once` processes at most one available job. `--drain` processes available jobs and exits when none remain. A worker waiting for human evidence does not remain assigned to that case. Run frontend with `API_BASE_URL=http://127.0.0.1:8000`. Stop every standalone frontend before `npm.cmd --prefix web run build` on Windows.

Sign in, select the plant, then open **Incidents → Factory cases and human requests**. Staff can explicitly report an issue, including through chat's **Start case** form. Administrators alone can enable plant coordination. **My tasks** opens the role inbox; claim a task before responding. Review existing incident links for equipment actions. Managers record production outcomes with supporting evidence. Generated Operators assignments remain separate from authenticated staff tasks.

Normal application execution requires live AI. Scripted providers are available only for isolated tests; ordinary API and worker startup reject scripted mode. Local mode skips release evaluation reports by default; set `PLANTSENSE_REQUIRE_RELEASE_GATES=true` when validating a local release. Cloud mode requires matching reports by default; prototype Cloud Run releases explicitly set `PLANTSENSE_REQUIRE_RELEASE_GATES=false`. With that setting, live AI runs without evaluation reports and has no release evaluation claim. Set the variable to `true` to enforce matching investigation, assistant and case reports. Evaluation programs under `backend/scripts/evaluation/` use isolated databases and never enable a plant policy by themselves in the review database. Keep `PLANTSENSE_INTERNAL_TEST_MODE=false` for assistant evaluation so the missing-readings fixture cannot inherit synthetic replay readings. Do not substitute a scripted report for live acceptance.

The optional trusted server setting `ASSISTANT_API_BASE_URL` routes only existing assistant question/transcription/speech endpoints to a separately validated local release. All other requests continue to `API_BASE_URL`. This supports preserving the previously validated assistant while candidate case automation is gated; it does not validate the candidate. Both services must use the intended same plant database and unchanged identity semantics. Restrict both to loopback.

## Notifications and recorded recurrence

Open **Notifications** in the sidebar. The unread count and read acknowledgements belong to the signed-in person and selected plant. Eligible staff receive open or claimed requests they can act on. Reviewers receive review-ready cases, blockers and recurring equipment issues. A case reporter can also see their own review-ready or blocked case. Viewers receive no actionable notifications. Reading an item does not claim a task, resume analysis, approve work or verify a repair. Use its case link to review evidence and take an explicitly authorized action. Read status survives refresh and service restart; other tabs update on their next poll.

Recurring-issue items require at least three recorded equipment cases for one asset in the last 30 days and an open case. Linked duplicate incidents count once. Staff reports remain unverified reports; browser-generated cases do not contribute. The feed removes cancelled, closed or superseded actionable items and retains their history in the case. This is an actionable inbox, not a permanent notification archive. There is no email, SMS, browser push or external delivery.

In a saved analysis, expand **Equipment issue history**, **Possible causes and evidence**, **How the assessment changed**, or **Compare previous verified repairs**. These sections show captured records, the investigator's cited proposals, distinct saved revisions and verified historical outcomes. Empty or malformed evidence is not substituted with generated content. New history enters subsequent analyses; existing saved snapshots remain unchanged. Recurrence adds one read-only MCP collection to the existing four specialist stages, without increasing model-call or spending limits. Live evaluation reports remain available for validating AI changes. Prototype releases can run live AI without those reports; do not describe that execution as evaluated.

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
