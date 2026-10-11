# PlantSense

Plant reliability with configurable equipment, named staff access, observation-based incidents, evidence inspection, deterministic INR comparisons, human authorization and verified repair memory.

## Current product

- **Plant:** dedicated 3D explorer and accessible 2D plan, adapting to reviewed two-to-eight-line configurations (up to 36 assets in supplied templates). Synthetic preview metrics, OOC flash and operators on the floor.
- **Operators:** live assignment IDs, experience-based dispatch and walk-to-cell preview.
- **Monitor:** machine cards, per-machine records/graphs, plus reviewed operational/historical sources.
- **Incidents:** paginated case table for preview OOC records and operational incidents.
- **Memory:** plant guide cards (address, what can break, what can be fixed) and confirmed repair memory.
- **Setup:** administrator-reviewed plant configuration and immutable revision history.

Operations and Maintenance are no longer in the rail. `/operations` goes to Plant. `/maintenance` still serves authorized repair when opened from an approved incident.

## Local admin sign-in

Open **http://127.0.0.1:3000/**, continue with Google or Microsoft, then use the work-email form.

| Role | Email | Password |
| --- | --- | --- |
| Administrator (this machine) | `akarshpriyadarshancp@gmail.com` | the passphrase set at first setup |
| Local operator | `operator@plantsense.local` | `testing-only strong passphrase!` |
| Product browser tests | `product-owner@example.test` | `testing-only strong passphrase!` |

There is no default password for a new plant. Staff sessions use expiring HttpOnly cookies; only password hashes are stored. These local accounts do not grant cloud access.

**AI remains explicitly scripted locally.** Live Gemini is wired separately but has not passed live evaluation. No PLC/historian connector or cloud staff identity/storage adapter is active. Historical imports do not establish current plant health or authorize operational work. Replay adapters remain for internal tests and are disabled by default.

## Run with Docker

From the repository root, with Docker Desktop using Linux containers:

```powershell
docker compose up --build --wait
python scripts/check_containers.py
```

Open **http://127.0.0.1:3000/workspace**. Initial setup creates a named administrator and plant; later visits use that account's email and original passphrase. There is no default password. Staff sessions use expiring HttpOnly cookies; passwords are hashed. Existing accounts and plant history persist in the named volume. Do not delete that volume to update the app.

Administrators can invite staff and assign plant-scoped roles. Invitation links are copied manually; password recovery and invitation email delivery remain later release gates.

A fresh plant has no readings or automatically asserted healthy condition. Open **Monitor → Add source**, review required units/envelopes/procedure, then accept observations or historical imports. See [source setup and CSV/API contracts](docs/data/telemetry-sources.md), [Docker controls](docs/operations/docker.md) and [security boundaries](SECURITY.md).

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

- Home is an SSO-style sign-in. Name, organization and plant are derived from the work email.
- Plant overlay generates labeled synthetic preview readings, control limits and OOC flash. Unconnected equipment stays unknown.
- Operators assign by experience and severity, walk to the cell and take at least two minutes to clear a preview OOC.
- Monitor is card-first. Click a machine for `/monitoring/{id}` records, trend graphs and case history.
- Each OOC case stores occurred, attended and fixed times, the operator note and metadata. Incidents shows a paginated table; the row arrow opens that record underneath.
- Memory is a plant-guide card list (floor address, what can break, what can be fixed, station guide). Click a card for `/memory/{id}`.
- Operations and Maintenance were removed from navigation. `/operations` goes to Plant. `/maintenance` remains for authorized repair opened from an approved incident.
- Preview records stay in a plant-scoped browser ledger. They do not write operational sources or authorize work.
