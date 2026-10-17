# PlantSense

Plant reliability with configurable equipment, named staff access, observation-based incidents, evidence inspection, deterministic INR comparisons, human authorization and verified repair memory.

## Current product

Cloud updates: follow the [deployment quickstart](docs/operations/release-quickstart.md) for the existing Mumbai deployment. Routine releases preserve the database and use GitHub Actions.

- **Plant:** connected hydraulic-forming simulator with 3D/2D floor, line output, machine inspector and activity timeline. Configured layouts are preserved; reviewed operational observations have a separate view.
- **Operators:** live assignment IDs, experience-based dispatch and walk-to-cell preview.
- **Monitor:** machine cards, per-machine records/graphs, plus reviewed operational/historical sources.
- **Incidents:** persistent factory cases, role-based human requests and retained incident links, alongside the paginated browser/operational incident table.
- **Memory:** plant guide cards (address, what can break, what can be fixed) and confirmed repair memory.
- **Setup:** administrator-reviewed plant configuration and immutable revision history.

Operations and Maintenance are no longer in the rail. `/operations` goes to Plant. `/maintenance` still serves authorized repair when opened from an approved incident.

## Local admin sign-in

Open **http://127.0.0.1:3000/**, choose Continue with email, then use the work-email form.

| Role | Email | Password |
| --- | --- | --- |
| Administrator (this machine) | `akarshpriyadarshancp@gmail.com` | the passphrase set at first setup |
| Local operator | `operator@plantsense.local` | `testing-only strong passphrase!` |
| Product browser tests | `product-owner@example.test` | `testing-only strong passphrase!` |

There is no default password for a new plant. Staff sessions use expiring HttpOnly cookies; only password hashes are stored. These local accounts do not grant cloud access.

**Normal application use defaults to live Vertex AI with Gemini 3.8 Flash.** Evaluation reports are optional for prototype releases; set `PLANTSENSE_REQUIRE_RELEASE_GATES=true` to require matching reports. Cloud Run prototype releases explicitly disable that check. Live AI then runs without those evaluation results, so its performance is unvalidated. Missing credentials still block AI rather than substituting scripted answers. Scripted providers are restricted to explicitly isolated test execution; normal API and worker startup reject them. No PLC/historian connector or cloud staff identity/storage adapter is active. Historical imports do not establish current plant health or authorize operational work. Replay adapters remain for internal tests and are disabled by default.

## Run with Docker

Copy `.env.example` to `.env`, then set your local ADC JSON path and PostgreSQL credentials. It selects `compose.local.yaml`, which adds the Cloud SQL Auth Proxy and background worker. Run `gcloud auth application-default login` once. Compose loads `.env` automatically; it is ignored by Git and never copied into the images.

From the repository root, with Docker Desktop using Linux containers:

```powershell
docker compose up --build --wait
```

The stack starts the web app, API, Cloud SQL Auth Proxy and background case worker with live Vertex AI and PostgreSQL. Local live AI does not need evaluation reports. See the [container configuration guide](docs/operations/docker.md) for Cloud SQL connectivity and troubleshooting.

Open **http://127.0.0.1:3000/workspace**. Initial setup creates a named administrator and plant; later visits use that account's email and original passphrase. There is no default password. Staff sessions use expiring HttpOnly cookies; passwords are hashed. Existing accounts and plant history persist in the named volume. Do not delete that volume to update the app.

Administrators can invite staff and assign plant-scoped roles. Invitation links are copied manually; password recovery and invitation email delivery remain later release gates.

A fresh plant has no operational readings or automatically asserted operational health. The default Plant page runs a clearly labeled browser simulation. Open **Monitor → Add source**, review required units/envelopes/procedure, then accept observations or historical imports. See [source setup and CSV/API contracts](docs/data/telemetry-sources.md), [Docker controls](docs/operations/docker.md) and [security boundaries](SECURITY.md).

## Native development

Requirements: Python 3.11+, Node 22+ and npm.

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install uv==0.12.23
$env:UV_PROJECT_ENVIRONMENT = (Join-Path (Get-Location) '.venv')
Push-Location backend
../.venv/Scripts/uv.exe sync --frozen --extra dev
Pop-Location
npm.cmd --prefix web ci
npm.cmd --prefix web run build
```

Run separate terminals:

```powershell
.venv/Scripts/python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

```powershell
npm.cmd --prefix web run start
```

Local mode uses SQLite when `DATABASE_URL` is empty. Set `DATABASE_URL` to automatically use PostgreSQL; `PLANTSENSE_POSTGRES_DSN` overrides it. Local Vertex AI uses Application Default Credentials from `gcloud auth application-default login` and does not need evaluation reports by default. Cloud mode requires reports by default; the prototype release workflow explicitly disables that gate for API and worker. A Cloud SQL socket URL requires a local Cloud SQL connection method; see [local live AI](docs/operations/live-gemini.md).

Unix setup:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install uv==0.12.23
export UV_PROJECT_ENVIRONMENT="$PWD/.venv"
.venv/bin/uv sync --frozen --extra dev --project backend
npm --prefix web ci
npm --prefix web run build
```

Start the API with `.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000`, and the frontend in a separate terminal with `npm --prefix web run start`. Development frontend: `npm --prefix web run dev` (Windows: `npm.cmd`). Inspect occupied ports before launching additional servers. Containers expose only the web service on laptop loopback; the API remains private.

Factory case coordination also needs a separate local worker using the same database/provider environment: set `PYTHONPATH=backend`, then run `.venv/Scripts/python.exe -m app.cases.worker` (Unix: `.venv/bin/python`). Automation starts disabled for every plant. Manual reports, claims and responses remain available without live AI. See [case startup, backup and rollback](docs/operations/cases.md) and the [production architecture blueprint](docs/architecture/case-foundation.md). The earlier provisional shared Firestore target is superseded by Cloud SQL PostgreSQL; no cloud migration is performed here.

## Historical datasets

Existing preparation scripts support attributed UCI hydraulic and IMS bearing artifacts. They are optional for historical analysis, and no synthetic fallback populates the product when artifacts are missing. The [source guide](docs/data/telemetry-sources.md) explains conversion into bounded imports, preserved source IDs/features, attribution, missing timestamps and detector limits. Raw datasets and converted batches must remain outside Git.

## Validation

```powershell
.venv/Scripts/python.exe -m pytest backend/tests -q
.venv/Scripts/python.exe -m ruff check backend scripts
.venv/Scripts/python.exe -m ruff format --check backend scripts
$env:PYTHONPATH='backend'
.venv/Scripts/python.exe backend/scripts/contracts/export_openapi.py
npm.cmd --prefix web run generate:api
npm.cmd --prefix web run format:check
npm.cmd --prefix web run typecheck
npm.cmd --prefix web run lint
npm.cmd --prefix web run build
npm.cmd --prefix web run test:unit
# Run browser acceptance only against an isolated test deployment.
$env:PLAYWRIGHT_BASE_URL='http://127.0.0.1:3002'
npm.cmd --prefix web run test:e2e
```

Use an isolated acceptance database/Compose project for browser tests; tests create staff accounts and import explicitly authored values. Internal backend regression fixtures enable legacy adapters intentionally. Archived replay UI tests are skipped because those controls are no longer product features; active browser acceptance covers staff access, sources, evidence and operational repair verification.

## Project guide

- `web/src/`: Next.js routes, dedicated features, shared UI, providers and typed API clients. `web/contracts/` holds generated OpenAPI; `web/tests/` separates unit, product browser and archived legacy checks.
- `backend/app/`: capability packages for HTTP, contracts, identity, plant, telemetry, incidents, AI, persistence and runtime. `backend/tests/` separates tests from shared fixtures; `backend/scripts/` groups data, contract, cloud and submission utilities.
- `infra/gcp/` and `infra/firebase/`: future deployment definitions and storage access configuration.
- `docs/`: [architecture](docs/architecture/overview.md), [engineering](docs/engineering/conventions.md), [observed status](docs/status.md), [evaluation limits](docs/engineering/evaluation.md) and [source contracts](docs/data/telemetry-sources.md).

Development remains local. Draft proposals/recordings and earlier screenshots represent earlier iterations and must not be presented as proof of live Gemini or physical plant validation.

See [repository structure](docs/engineering/repository-structure.md), [contributing](CONTRIBUTING.md), and the [documentation index](docs/README.md). Run `.venv/Scripts/python.exe scripts/validate.py` (Unix: `.venv/bin/python`) for portable local validation. Add `--skip-tests` for static checks only.

## Recent local changes

- Home is a local staff sign-in. Name, organization and plant are derived from the work email.
- Plant simulation connects machine modes, synthetic readings, line throughput and operator response. Unconnected equipment stays unknown.
- Operators assign by experience and severity, walk to the cell and take at least two minutes to clear a preview OOC.
- Monitor is card-first. Click a machine for `/monitoring/{id}` records, trend graphs and case history.
- Each OOC case stores occurred, attended and fixed times, the operator note and metadata. Incidents shows a paginated table; the row arrow opens that record underneath.
- Memory is a plant-guide card list (floor address, what can break, what can be fixed, station guide). Click a card for `/memory/{id}`.
- Operations and Maintenance were removed from navigation. `/operations` goes to Plant. `/maintenance` remains for authorized repair opened from an approved incident.
- Preview records stay in a plant-scoped browser ledger. They do not write operational sources or authorize work.

## Statistics integration branch

The simulated plant starts automatically; no preview URL flag is required. Operators, machine graphs, incident tables and plant guides retain the statistics branch layout. The top bar labels the simulated plant, while backend observations and repair authorization remain separate.

The read-only assistant can inspect explicitly synthetic browser snapshots through a separate citation. Browser simulation cannot establish measured plant health or authorize operational work. See [assistant configuration](docs/operations/assistant.md) and [Gemini gates](docs/operations/live-gemini.md).

Simulation state is plant-scoped and browser-local. Seed, tick, samples, cases and dispatch survive refresh. A Web Lock elects one writing tab; other tabs follow saved updates. Legacy unfinished cases without dispatch state are marked interrupted. Storage or coordination failure falls back to a labeled in-memory simulation. Closing all tabs pauses generation; reopening reconciles elapsed simulated assignments without inventing missed samples.

## Connected Plant simulator

Plant opens as a hydraulic-forming reference factory using the configured equipment graph. Material enters forming presses, conveyors transfer formed components, and shared utilities support production. The supported scenario is pump pressure loss: a developing fault derates only downstream press lines, dispatches an operator, stops the line for inspection/repair, verifies recovery for 30 simulated seconds and restores output. Normal readings remain within synthetic reference envelopes.

Use **Start pump pressure loss**, **Pause/Resume**, **1x/10x speed**, and **Reset scenario**. Reset retains records and marks interrupted work. The writing browser tab serializes controls across tabs. Simulation speed changes simulated durations; it is not physical repair timing. Output derating and readings are authored demonstration assumptions, not a calibrated hydraulic model. The scenario requires a configured pump with a dependency path to a press.

Open **Reviewed operational observations** from Plant to inspect backend observations and authorization. Simulation does not submit observations or change work orders. Old browser samples and completed cases are retained; unfinished pre-process dispatch cases become interrupted history when adopted by the new controller.
