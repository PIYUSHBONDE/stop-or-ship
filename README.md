# PlantSense

The shared plant now has a versioned configuration editor under **Setup**. Preview an eight-line, 36-asset hydraulic facility, then apply it as a plant administrator after resolving open cases. See [plant configuration](docs/plant-configuration.md) for the workflow and supported limits.

**Monitor** coordinates all configured equipment on one backend replay clock, with versioned source mappings, explicit data quality, automatic incident investigation and verified recovery. See [coordinated monitoring](docs/monitoring.md) for the local walkthrough and limits.

Plant intelligence with shared equipment records, named staff access, evidence-backed reliability investigation, deterministic INR option comparisons, human approval, repair verification and plant-scoped repair memory.

**Local mode is a functional prototype with an explicitly scripted investigator.** Cloud mode wires Google ADK/Gemini, Firestore, Firebase identity, and Cloud Tasks. Cloud deployment and live model evaluation require an authenticated Google Cloud project; they are not claimed as completed.

The shared staff foundation currently runs on local SQLite. Its cloud identity/storage adapter remains a separate release gate. Telemetry currently comes from attributed replay or labelled synthetic fallback; real plant ingestion is not implemented yet.

## Run locally on Windows

Requirements: Python 3.11+, Node 22+, npm. From the project root:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install uv==0.12.23
$env:UV_PROJECT_ENVIRONMENT = (Join-Path (Get-Location) '.venv')
Push-Location backend
..\.venv\Scripts\uv.exe sync --frozen --extra dev
Pop-Location
Push-Location web
npm.cmd ci
npm.cmd run build
Pop-Location
```

Prepare the public dataset (approximately 73 MB; requires internet):

```powershell
.\.venv\Scripts\python.exe -X utf8 backend/scripts/prepare_data.py
```

Without prepared artifacts, the app shows **Synthetic fallback · dataset not prepared**. It never labels that fallback as measured telemetry.

Start the two servers in separate terminals:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

```powershell
Set-Location web
npm.cmd run start
```

Open **http://127.0.0.1:3000**. API docs: http://127.0.0.1:8000/docs.

The application opens **Plant access** at `/workspace`. Create the initial administrator and plant, then choose **Open plant**. Administrators can invite staff, assign roles and inspect retained audit history. Use a unique passphrase of at least 15 characters. Invitation links are copied manually and expire after 48 hours; no email delivery or password recovery is provided yet.

Staff browsers share the same plant, incidents and verified cases. Passwords are hashed; staff session secrets use expiring HttpOnly cookies. Browser storage holds only the selected plant ID. See [shared plant review](docs/shared-plant-review.md) for roles, migration behavior and acceptance instructions.

For development use `npm.cmd run dev`. Alternatively, `scripts/start-local.ps1` starts development servers in hidden windows and prints their process IDs. Do not launch it if ports 3000/8000 are already occupied.

### Docker

With Docker running in Linux-container mode, run `docker compose up --build --wait` from the repository root and open **http://127.0.0.1:3000**. A fresh clone needs no dataset download or credentials. Staff and plant records persist in a named volume; the API is private to the container network.

See [Docker setup and validation](docs/docker.md) for alternate ports, measured-data preparation and container controls, and [security boundaries](SECURITY.md) for the current controls and production requirements.

## Try the complete workflow

1. Open **Plant** for the full factory explorer. Use the asset list, camera presets and close-up controls, or switch to the keyboard-accessible 2D plan. Start **Pump degradation**. Six replay windows establish healthy context and persistent abnormality; use the step control to accelerate.
2. Open **Incidents** to inspect hypotheses, supporting/conflicting evidence, uncertainty, and affected dependencies. **Operations** retains a compact overview.
3. Compare interventions and inspect the assumptions. Changing the risk multiplier invalidates existing approval.
4. Approve an intervention and open **Maintenance** to start the work order. Delayed options advance simulated time to their maintenance window.
5. Enter the technician's observed cause, fix, parts, and outcome. Change the cause to **Valve bypass** to demonstrate a correction.
6. Complete repair; verify three healthy windows. The **fault persists** setting deliberately leaves the repair unverified.
7. Open **Memory** and replay a similar incident on the most recently verified equipment. The confirmed repair becomes cited context for the next investigation.

Pump, shared cooler and press-valve scenarios use attributed UCI test-rig replay. Shared cooling affects both lines; costs count each line once. The motor-bearing scenario supports measured IMS snapshots from NASA's archive, with a labelled synthetic fallback if those artifacts are missing. Shared plants support concurrent incidents on distinct supported assets; each has its own investigation, calculation and work order. Resolved cases remain read-only. Plant capacity reflects overlapping dependency paths; each intervention table covers the selected case, and joint maintenance scheduling is not implemented.

Prepare the bearing subset with installed UnRAR (86 MB compressed experiment, 42 extracted snapshots):

```powershell
.\.venv\Scripts\python.exe -u -X utf8 backend/scripts/prepare_bearings.py --download
```

Pass `--unrar` with your installed extraction executable when its path differs. Subsequent preparation uses the cached archive and works offline. The source README does not specify amplitude units: acceleration RMS stays in **source units**, while spectral centroid is in Hz. Replayed healthy windows after repair are illustrative examples, not a recorded maintenance intervention. Restart the API after preparing data.

The sensor scenario intentionally makes a single pressure signal inconsistent with otherwise healthy signals. The investigator requests independent confirmation rather than assigning a confirmed mechanical fault.

An unsuccessful verification can return to the approved repair; the failed outcome is retained and excluded from confirmed memory.

**Open isolated demo** on the access page retains the earlier single-incident experience. Only this demo offers reset and browser-owned sessions. It cannot read or authorize shared plant records. Shared staff history has no reset action. The existing anonymous Firebase cloud adapter applies to the isolated demo; shared staff access fails closed in cloud mode pending its managed identity adapter.

## Validate

```powershell
Push-Location backend
..\.venv\Scripts\python.exe -m pytest -q
..\.venv\Scripts\ruff.exe check app scripts tests
..\.venv\Scripts\ruff.exe format --check app scripts tests
..\.venv\Scripts\python.exe scripts/export_openapi.py
Pop-Location
Push-Location web
npm.cmd run generate:api
npm.cmd run format:check
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npx.cmd playwright install chromium
# Start both servers before running browser tests:
npm.cmd run test:e2e
Pop-Location
```

Generated OpenAPI types power the typed session client and frontend view models. Commit `web/openapi.json`, `web/lib/api-schema.ts`, `web/package-lock.json`, and `backend/uv.lock` with the source.

Browser tests create synthetic staff accounts and plant records. Run them against a dedicated acceptance database/Compose project, rather than a plant containing operational records. The review guide includes an isolated Compose command. Shared browser tests expect an empty staff store or their own prior acceptance account.

## Project guide

- `web/`: Next.js interface, procedural 3D equipment, accessible dialogs, generated API types, browser tests.
- `backend/`: FastAPI, transactional storage, replay/detection, ADK investigation, economics, repair verification, data preparation and tests.
- `infra/`: Cloud Run image builds, deployment script, Firestore rules and indexes.
- `docs/`: Architecture, deployment guide, evaluation, demo script, proposal and preview artifacts.

See [deployment instructions](docs/deployment.md), [architecture](docs/architecture.md), [evaluation](docs/evaluation.md), [engineering conventions](docs/engineering.md), and [demo narrative](docs/demo-script.md).

## Milestone 1

The dedicated **Incidents** page opens a selected case at `/incidents?incident=<id>`. It shows persisted evidence, branching production impact, intervention costs, saved risk assumptions and versioned human approval. An unapplied risk edit must be recalculated or discarded. Historical cases are read-only; the authorized work-order link opens the matching case in Maintenance.

The `/evidence-preview` workshop runs with the frontend alone and makes no API calls; all of its examples are explicitly synthetic fixtures.

The implementation is on `milestone/incidents-approval`. See the [Milestone 1 review guide](docs/milestone-1-review.md) and [measured validation results](docs/status.md).

### Linux and macOS

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install uv==0.12.23
UV_PROJECT_ENVIRONMENT="$PWD/.venv" .venv/bin/uv sync --project backend --frozen --extra dev
cd web
npm ci
npm run build
```

Start the API from the repository root in one terminal:

```sh
.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

Start the frontend from `web` in a second terminal with `npm run start`, or use `npm run dev` during development. Dataset preparation is optional; unavailable measured data is labelled as a synthetic fallback. Runtime execution on Linux/macOS is covered by the supplied setup commands and CI configuration; local validation in this workspace uses Windows.

## AI providers for local work

Persistence and AI identity are separate settings. The default is `PLANTSENSE_MODE=local` with `PLANTSENSE_AI_PROVIDER=scripted`; no model credentials are needed for the demo. Local retrieval uses the reviewed knowledge pack and session memory.

When you choose to connect Gemini, set **server-side** `PLANTSENSE_AI_PROVIDER=gemini_api` and `GEMINI_API_KEY`, or use `PLANTSENSE_AI_PROVIDER=vertex` with `GOOGLE_CLOUD_PROJECT` and application-default credentials. `GEMINI_MODEL` selects the model; access to the configured default must be verified. Never put a Gemini key in a `NEXT_PUBLIC_` variable or commit an environment file. These providers have not been live-tested in this local release.

The investigator can call read-only tools for up to five model turns. Reliability and Production each receive the same immutable evidence and cost table, with one bounded response per specialist. An evidence reviewer gets one response. All stages and the single retry share an eight-call, sixty-second investigation budget. Failed role explanations leave the deterministic table available; failure to establish an investigation stays explicit. Model outputs cannot approve or create work orders.
