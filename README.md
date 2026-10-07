# PlantSense

An interactive simulated manufacturing plant with measured hydraulic replay, evidence-backed reliability investigation, deterministic INR option comparisons, human approval, repair verification, and session-scoped reliability memory.

**Local mode is a functional prototype with an explicitly scripted investigator.** Cloud mode wires Google ADK/Gemini, Firestore, Firebase identity, and Cloud Tasks. Cloud deployment and live model evaluation require an authenticated Google Cloud project; they are not claimed as completed.

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

For development use `npm.cmd run dev`. Alternatively, `scripts/start-local.ps1` starts development servers in hidden windows and prints their process IDs. Do not launch it if ports 3000/8000 are already occupied.

## Try the complete workflow

1. Open **Plant** for the full factory explorer. Use the asset list, camera presets and close-up controls, or switch to the keyboard-accessible 2D plan. Start **Pump degradation**. Six replay windows establish healthy context and persistent abnormality; use the step control to accelerate.
2. Open **Incidents** to inspect hypotheses, supporting/conflicting evidence, uncertainty, and affected dependencies. **Operations** retains a compact overview.
3. Compare interventions and inspect the assumptions. Changing the risk multiplier invalidates existing approval.
4. Approve an intervention and open **Maintenance** to start the work order. Delayed options advance simulated time to their maintenance window.
5. Enter the technician's observed cause, fix, parts, and outcome. Change the cause to **Valve bypass** to demonstrate a correction.
6. Complete repair; verify three healthy windows. The **fault persists** setting deliberately leaves the repair unverified.
7. Open **Memory** and replay a similar incident on the most recently verified equipment. The confirmed repair becomes cited context for the next investigation.

Pump, shared cooler and press-valve scenarios use attributed UCI test-rig replay. Shared cooling affects both lines; costs count each line once. The motor-bearing scenario supports measured IMS snapshots from NASA's archive, with a labelled synthetic fallback if those artifacts are missing. One incident is active at a time; resolved cases remain available as read-only history.

Prepare the bearing subset with installed UnRAR (86 MB compressed experiment, 42 extracted snapshots):

```powershell
.\.venv\Scripts\python.exe -u -X utf8 backend/scripts/prepare_bearings.py --download
```

Pass `--unrar` with your installed extraction executable when its path differs. Subsequent preparation uses the cached archive and works offline. The source README does not specify amplitude units: acceleration RMS stays in **source units**, while spectral centroid is in Hz. Replayed healthy windows after repair are illustrative examples, not a recorded maintenance intervention. Restart the API after preparing data.

The sensor scenario intentionally makes a single pressure signal inconsistent with otherwise healthy signals. The investigator requests independent confirmation rather than assigning a confirmed mechanical fault.

An unsuccessful verification can return to the approved repair; the failed outcome is retained and excluded from confirmed memory.

Reset clears the current simulated plant and memory, while retaining session usage quotas. Separate browser profiles receive separate sessions. Local identity tokens are stored in the browser; cloud mode uses Firebase anonymous authentication instead.

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

## Project guide

- `web/`: Next.js interface, procedural 3D equipment, accessible dialogs, generated API types, browser tests.
- `backend/`: FastAPI, transactional storage, replay/detection, ADK investigation, economics, repair verification, data preparation and tests.
- `infra/`: Cloud Run image builds, deployment script, Firestore rules and indexes.
- `docs/`: Architecture, deployment guide, evaluation, demo script, proposal and preview artifacts.

See [deployment instructions](docs/deployment.md), [architecture](docs/architecture.md), [evaluation](docs/evaluation.md), [engineering conventions](docs/engineering.md), and [demo narrative](docs/demo-script.md).

## AI providers for local work

Persistence and AI identity are separate settings. The default is `PLANTSENSE_MODE=local` with `PLANTSENSE_AI_PROVIDER=scripted`; no model credentials are needed for the demo. Local retrieval uses the reviewed knowledge pack and session memory.

When you choose to connect Gemini, set **server-side** `PLANTSENSE_AI_PROVIDER=gemini_api` and `GEMINI_API_KEY`, or use `PLANTSENSE_AI_PROVIDER=vertex` with `GOOGLE_CLOUD_PROJECT` and application-default credentials. `GEMINI_MODEL` selects the model; access to the configured default must be verified. Never put a Gemini key in a `NEXT_PUBLIC_` variable or commit an environment file. These providers have not been live-tested in this local release.

The investigator can call read-only tools for up to five model turns. Reliability and Production each receive the same immutable evidence and cost table, with one bounded response per specialist. An evidence reviewer gets one response. All stages and the single retry share an eight-call, sixty-second investigation budget. Failed role explanations leave the deterministic table available; failure to establish an investigation stays explicit. Model outputs cannot approve or create work orders.
