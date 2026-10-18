# PostgreSQL migration rehearsal

This tooling imports a consistent copy of a current version-7 SQLite database into a **new, empty PostgreSQL schema**. The importer lives in `backend/app/persistence/postgres_migration.py`; `migrate.py` remains a CLI compatibility wrapper. Cloud provisioning and rollout use the separate [Mumbai runbook](../../docs/operations/mumbai-release.md).

Tooling dependencies are isolated and pinned by this directory's `uv.lock`. The runtime adapter and importer are also packaged in the backend and covered by its release fingerprint. Any backend dependency change requires fresh matching live reports before activation.

## Local acceptance

Use a disposable PostgreSQL 16 database containing fixture data only. Check ports before starting it. The observed local rehearsal used the existing official image pinned in the CI migration job, loopback port 55432, and a temporary container without plant mounts. Trust authentication is restricted to isolated test fixtures; do not use it for Cloud SQL or shared environments.

From the repository root:

```powershell
$env:UV_PROJECT_ENVIRONMENT = (Join-Path (Get-Location) '.runtime/postgres-tools')
.venv/Scripts/uv.exe sync --extra runtime-test --project infra/postgres --frozen
$env:PLANTSENSE_TEST_POSTGRES_DSN = 'postgresql://postgres@127.0.0.1:55432/plantsense_test'
.runtime/postgres-tools/Scripts/python.exe -m pytest infra/postgres -q
.runtime/postgres-tools/Scripts/python.exe -m pytest backend/tests/integration/test_postgres_runtime.py -q
.venv/Scripts/ruff.exe check infra/postgres
.venv/Scripts/ruff.exe format --check infra/postgres
```

The GitHub reusable CI workflow includes a separate PostgreSQL migration job. Its fixture server is not an application database. CI publication/execution has not yet been verified.

## Opt-in runtime adapter

`backend/app/persistence/postgres.py` supplies `PostgresStore`; `create_store()` selects it with `PLANTSENSE_STORAGE=postgres`. Cloud mode requires PostgreSQL and a separate read-only evidence DSN. Initialize the reviewed schema with the importer, which installs the canonical `backend/app/persistence/postgres-functions.sql`. The SQL functions are repeatable and preserve original JSON text in stored records.

The adapter retains existing services and parameter binding, uses explicit transactions with bounded connection/statement/lock timeouts, and serializes writers with a database advisory lock. This deliberately matches SQLite's conservative writer semantics for the first pilot; it is not a claim of production throughput. The driver is installed through this directory's separately locked `runtime-test` environment, not the currently deployed backend lockfile.

Catalog insertion order and telemetry pagination previously depended on SQLite's implicit `rowid`. The PostgreSQL importer now adds explicit identity-backed `rowid` columns to those four tables, copies original IDs (including gaps), verifies them alongside original values, and advances their sequences. The adapter names original columns on inserts so the extra identity column does not change domain payloads. Existing schemas created by the earlier experimental importer without these columns are not silently upgraded; use a new isolated target or a separately reviewed migration.

The runtime acceptance reuses existing staff, approval, permission, case and concurrent-claim tests unchanged with an injected PostgreSQL fixture. `PostgresStore.evidence_scope()` validates worker capability/policy and uses a database-enforced read-only transaction. This tests the scope boundary; the existing stdio MCP client/server still use the SQLite path and have not been switched to this adapter.

Before cloud activation, wire startup storage selection and stdio MCP credential handling, declare the driver in the backend lockfile, include the adapter/runtime migration in the release fingerprint, implement restricted runtime/evidence identities, and run the full release gates with matching live reports. Do not enable PostgreSQL merely by setting the historical `PLANTSENSE_MODE=cloud`; that path still selects the old Firestore adapter. Cloud SQL backup/restore and full worker restart/resume acceptance remain outstanding.

## Import behavior and boundaries

- Source files open read-only. SQLite's backup API captures WAL changes into a private temporary snapshot; integrity and foreign keys are checked there.
- The importer accepts only the reviewed table/column shape and completed migrations 1–7. Drain case jobs, investigations and outstanding AI reservations first. Actual cutover also requires stopping all source writers; snapshot consistency alone does not prevent later divergence.
- PostgreSQL schema comes from repository-owned DDL, never SQL stored in the submitted file. Table creation follows foreign-key order. Original unique/check constraints and immutable evidence/audit triggers are retained. SQLite double-precision values remain double precision. Original JSON text, password hashes, timestamps and identifiers are copied without reinterpretation.
- Import runs in one transaction under an advisory lock. All 38 tables receive count/SHA-256 verification before commit, with explicit binary text ordering across database locales. Sequence high-water marks are retained. Failures roll back schema creation and imported rows.
- A receipt permits an exact retry. Another snapshot, a changed target, or an unrelated nonempty target fails without replacing its records. Concurrent deliveries serialize; one imports and the other verifies the receipt.
- The CLI prints totals only. Driver failures omit SQL values, DSNs and private record contents. Provide the target DSN through `PLANTSENSE_MIGRATION_DSN` using a protected environment or secret, never Git or command arguments. Run `migrate.py --source PATH_TO_BACKUP --schema plantsense` only against the explicitly selected target.
- The target identity must have schema-creation rights for the migration. It must not become the application's runtime identity. Runtime roles, tenant isolation and read-only MCP access still need separate implementation and acceptance.

No production import has been performed. The current rehearsal uses fixtures, not a copy of the user's live plant database. Fresh-target retries and rollback are tested; restoration from Cloud SQL backup and migration performance on large datasets are not established.

## Rollback

Before cutover, preserve a consistent original SQLite backup and keep application services on their validated release. A failed import leaves the original untouched and rolls back PostgreSQL changes. An import can be abandoned without changing the application.

After PostgreSQL starts accepting application writes, pointing back to the old SQLite snapshot would lose those later writes. That rollback requires a separately tested restore/data-reconciliation procedure and a write freeze. This tool does not implement reverse migration or authorize deletion of either database.
