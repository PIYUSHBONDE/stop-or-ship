# PlantSense

Plant reliability with configurable equipment, named staff access, observation-based incidents, evidence inspection, deterministic INR comparisons, human authorization and verified repair memory.

## Current product

- **Plant:** dedicated 3D explorer and accessible 2D plan, adapting to reviewed two-to-eight-line configurations (up to 36 assets in supplied templates).
- **Monitor:** reviewed operational/historical sources, freshness, units, record provenance, CSV validation, read-only preview and explicit import confirmation.
- **Operations:** measured output, rated capacity and estimated dependency impact shown separately. Unconnected equipment remains unknown.
- **Incidents:** retained evidence, uncertainty, specialist positions, intervention assumptions and versioned approval.
- **Maintenance:** authorized work, UTC eligibility, technician outcomes and recovery from three qualifying post-repair observation windows.
- **Memory:** confirmed operational repairs with original diagnosis and technician corrections.
- **Setup:** administrator-reviewed plant configuration and immutable revision history.

**AI remains explicitly scripted locally.** Live Gemini is wired separately but has not passed live evaluation. No PLC/historian connector or cloud staff identity/storage adapter is active. Historical imports do not establish current plant health or authorize operational work. Replay adapters remain for internal tests and are disabled by default.

## Run with Docker

From the repository root, with Docker Desktop using Linux containers:

```powershell
docker compose up --build --wait
python scripts/check_containers.py
```

Open **http://127.0.0.1:3000/workspace**. Initial setup creates a named administrator and plant; later visits use that account's email and original passphrase. There is no default password. Staff sessions use expiring HttpOnly cookies; passwords are hashed. Existing accounts and plant history persist in the named volume. Do not delete that volume to update the app.

Administrators can invite staff and assign plant-scoped roles. Invitation links are copied manually; password recovery and invitation email delivery remain later release gates.

A fresh plant has no readings or automatically asserted healthy condition. Open **Monitor → Add source**, review required units/envelopes/procedure, then accept observations or historical imports. See [source setup and CSV/API contracts](docs/telemetry-sources.md), [Docker controls](docs/docker.md) and [security boundaries](SECURITY.md).

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

Unix uses `.venv/bin/python`, `.venv/bin/uv` and `npm` in place of Windows executables. Development frontend: `npm.cmd --prefix web run dev`. Inspect occupied ports before launching additional servers. Containers expose only the web service on laptop loopback; the API remains private.

## Historical datasets

Existing preparation scripts support attributed UCI hydraulic and IMS bearing artifacts. They are optional for historical analysis, and no synthetic fallback populates the product when artifacts are missing. The [source guide](docs/telemetry-sources.md) explains conversion into bounded imports, preserved source IDs/features, attribution, missing timestamps and detector limits. Raw datasets and converted batches must remain outside Git.

## Validation

```powershell
.venv/Scripts/python.exe -m pytest backend/tests -q
.venv/Scripts/python.exe -m ruff check backend scripts/check_containers.py
.venv/Scripts/python.exe -m ruff format --check backend scripts/check_containers.py
$env:PYTHONPATH='backend'
.venv/Scripts/python.exe backend/scripts/export_openapi.py
npm.cmd --prefix web run generate:api
npm.cmd --prefix web run format:check
npm.cmd --prefix web run typecheck
npm.cmd --prefix web run lint
npm.cmd --prefix web run build
npm.cmd --prefix web run test:e2e
```

Use an isolated acceptance database/Compose project for browser tests; tests create staff accounts and import explicitly authored values. Internal backend regression fixtures enable legacy adapters intentionally. Archived replay UI tests are skipped because those controls are no longer product features; active browser acceptance covers staff access, sources, evidence and operational repair verification.

## Project guide

- `web/`: Next.js, generated contracts, accessible plant/evidence interfaces and browser acceptance.
- `backend/`: FastAPI, staff permissions, immutable source/observation storage, diagnosis, deterministic economics, work orders and repair verification.
- `infra/`: future Google Cloud deployment configuration.
- `docs/`: [architecture](docs/architecture.md), [engineering](docs/engineering.md), [observed status](docs/status.md), [evaluation limits](docs/evaluation.md) and [source contracts](docs/telemetry-sources.md).

Development remains local. Draft proposals/recordings and earlier screenshots represent earlier iterations and must not be presented as proof of live Gemini or physical plant validation.
