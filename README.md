# PlantSense

An operational copilot for maintenance and production decisions. PlantSense turns abnormal machine readings into a line-level repair recommendation, explains the evidence with Gemini on Vertex AI, and leaves approval, the repair record and recovery verification to named people.

Built for **Manufacturing: Intelligent Operations & Industrial Efficiency**, focused on reliability and line efficiency.

## Problem statement

Manufacturing lines lose output when one machine degrades, but the abnormal reading does not say whether to stop now, derate, or wait for a planned window. The same signal can be missing, stale, or conflicting, and a chart of it does not show which downstream line is exposed. Teams either keep running and miss a delivery target, or stop a healthy parallel line because the dependency is unclear. A general model asked to "diagnose the plant" invents a cause, a probability, or a saving, and a chat reply cannot be approved, repaired, or checked afterward.

PlantSense turns reviewed equipment observations and the plant's configured dependencies into an evidence-backed recommendation. It shows which line capacity is affected, compares stop-and-repair, repair at the planned window, derate, and continue, and keeps the cost and lost-output arithmetic in deterministic code rather than in the model. Gemini explains competing causes, missing checks, and the production consequence, and it cites the records it used. A named person approves that exact version. A technician records what was found and what was done. Recovery is accepted only after qualifying healthy observations, and that confirmed repair can be retrieved for the next similar case.

**Short form:** when a machine reading goes abnormal, a manufacturing team cannot tell which production line is exposed or whether to stop, derate, or defer. PlantSense uses those observations, their quality, and the plant's dependencies to recommend a repair decision, explains the evidence and the gaps with generative AI, and leaves approval, the repair record, and recovery verification to named people.

| Requirement word              | How PlantSense addresses it                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reliability                   | Abnormal observations, cause hypotheses, procedure checks, verified repair, later retrieval of that repair                                                     |
| Efficiency                    | A fault derates only its dependent line; the choice is lost units and downtime over the shift                                                                  |
| Supply and demand             | The cost comparison includes a configured delivery target and a penalty for units not made                                                                     |
| Data quality                  | Observations are fresh, missing, stale, or conflicting. Missing data stays unknown                                                                             |
| AI insight and recommendation | Gemini investigator, Reliability and Production specialists, and Ask PlantSense; the recommendation is one of four interventions tied to a calculation version |

PlantSense does not claim product-quality inspection, inventory or supplier planning, sustainability, or a measured saving.

## Live deployment

- **URL:** https://plantsense-web-nponfirhaa-el.a.run.app
- **Region:** Google Cloud `asia-south1` (Mumbai)

### Demo sign-in

| Email | Password |
| --- | --- |
| `product-owner@example.test` | `lTxXiVHAQqmuAQaPDc2T_bYBnnBr78wX` |

These are demonstration account on a simulated plant. Open the product link, choose **Local account sign-in**, enter the email and password, then choose **Open plant** on the workspace page. Please do not change the plant setup or staff accounts, so other reviewers see the same plant.

## What you can see in the app

- **Plant:** 3D factory and 2D floor plan of a hydraulic-forming reference plant. Line rate is shown against configured parts per hour. A pump fault slows or stops only its dependent press line; the parallel line keeps running.
- **Monitor:** machines grouped under each production line. Open a machine for its current readings, one chart per signal (pressure, flow, temperature and so on) and a cause stack: what is wrong, the signals it points at, the one task to do now, tasks already used, and other checks folded underneath.
- **Operators:** five named operators, assignment by experience and severity, walk to the cell, the operator comment beside the recorded fix and the tool's suggested task.
- **Incidents:** factory cases with retained evidence, uncertainty, specialist positions and a four-option comparison (stop and repair now, repair at the planned window, derate until the repair window, continue this shift) over an 8-hour horizon, costed in integer paise. The lowest-cost feasible option is recommended, and approval is bound to that exact calculation version.
- **Maintenance:** opened from an approved incident. The technician records the finding and the work done; recovery needs three qualifying healthy post-repair windows.
- **Memory:** a plant guide per station (floor address, what can break, what can be fixed, user guide) and confirmed repairs with the original diagnosis and technician corrections.
- **Ask PlantSense:** a read-only assistant beside every screen, with inspectable citations, saved cost cards and editable English voice transcripts with playback on request.
- **Notifications and My tasks:** All/Unread filters, category labels, case links, and tasks filtered by assigned-to-me or available-to-claim, sorted by deadline.
- **Setup:** administrator-reviewed plant configuration with immutable revision history. Five staff roles: admin, manager, reliability, technician and viewer.

## How AI and Google Cloud are used

| Service                                          | Role                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloud Run                                        | Three services: public Next.js web, private FastAPI API and private case worker. The private services reject unauthenticated direct requests                                                                                                                                                                                                                          |
| Vertex AI Gemini (`gemini-3.8-flash`)            | Investigator, evidence reviewer, Reliability and Production specialists on Google ADK with read-only MCP tools, and Ask PlantSense                                                                                                                                                                                                                                    |
| Google speech                                    | Transcription and playback for reviewed voice questions                                                                                                                                                                                                                                                                                                               |
| Cloud SQL PostgreSQL 16                          | Plant configuration, sources, incidents, cases, approvals and audit history                                                                                                                                                                                                                                                                                           |
| Cloud Tasks and Cloud Scheduler                  | Durable case job delivery and a reconcile run every minute                                                                                                                                                                                                                                                                                                            |
| Secret Manager, Artifact Registry, Cloud Storage | Separate secrets, container images and private release reports                                                                                                                                                                                                                                                                                                        |
| Firestore and Firebase                           | Implemented adapters for sessions, AI usage budgets, vector search over procedure knowledge and anonymous Firebase identity (`backend/app/persistence/store.py`, `backend/app/persistence/ai_usage.py`, `backend/app/ai/knowledge.py`, `backend/app/api/dependencies.py`, `web/src/lib/api/client.ts`). The live deployment uses Cloud SQL and staff accounts instead |

AI proposes; server code decides what is allowed; people approve physical work. Costs and lost output come from `backend/app/incidents/economics.py`, never from the model.

## Simulated data

The Plant, Monitor, Operators and Memory screens run a clearly labelled browser simulation of a reference factory. The supported scenario is pump pressure loss: a developing fault derates only the downstream press line, an operator is dispatched, the line stops for repair, recovery is checked and output returns. Readings and output are authored demonstration values, not a calibrated hydraulic model.

Simulation state is plant-scoped and stored in the browser. It never becomes plant evidence, cannot authorize work and cannot verify a repair. Accepted operational observations, incidents, maintenance and verified repair memory remain separate. No PLC or historian connector is active.

## Recent changes

- **Monitor and machine pages:** machines grouped by production line; every signal on its own chart with no pager; current readings stated in plain words (at zero, below the limit, above the limit, inside the limit).
- **Cause stack:** a short stack of what is wrong, the signals it points at, the one task to do now and tasks already used. Other checks and branches sit behind a disclosure. The next task is suggested only when that specific task was recorded as completed.
- **Operators:** the operator comment, the recorded fix and the tool's suggested task appear side by side.
- **Notifications and My tasks:** filters, category labels, a sidebar badge for actionable tasks and deadline ordering.
- **Plant:** progress messages while the factory loads. Opening the plant from the workspace starts the simulation automatically; no preview URL flag is needed.
- **Navigation:** Operations and Maintenance are off the sidebar. `/operations` goes to Plant; `/maintenance` remains for authorized repair opened from an approved incident.

## Verified results

The 18 October 2026 release passed GitHub Actions validation, image build and promotion to Cloud Run. CI passed **194 backend tests**, **10 infrastructure tests** and **42 frontend unit tests**, with PostgreSQL migration and runtime checks, secret scanning, contract drift, formatting, lint, type checks and the production build. Public smoke checks returned 200 for the health endpoint, sign-in page and staff-access bootstrap.

The earlier cloud release recorded **211 backend and PostgreSQL tests**, **12 desktop and mobile browser checks** and live Gemini gates of **5 investigation, 6 assistant and 4 case fixtures** plus voice. Database migration verified **38 tables and 200 rows** by counts and SHA-256 checks. See [observed status](docs/status.md) for the full record.

## Run with Docker

Copy `.env.example` to `.env`, then set your local ADC JSON path and PostgreSQL credentials. It selects `compose.local.yaml`, which adds the Cloud SQL Auth Proxy and background worker. Run `gcloud auth application-default login` once. Compose loads `.env` automatically; it is ignored by Git and never copied into the images.

From the repository root, with Docker Desktop using Linux containers:

```powershell
docker compose up --build --wait
```

The stack starts the web app, API, Cloud SQL Auth Proxy and background case worker with live Vertex AI and PostgreSQL. Local live AI does not need evaluation reports. See the [container configuration guide](docs/operations/docker.md) for Cloud SQL connectivity and troubleshooting.

Open **http://127.0.0.1:3000/workspace**. Initial setup creates a named administrator and plant; later visits use that account's email and original passphrase. There is no default password. Staff sessions use expiring HttpOnly cookies; passwords are hashed. Existing accounts and plant history persist in the named volume. Do not delete that volume to update the app.

Administrators can invite staff and assign plant-scoped roles. Invitation links are copied manually; password recovery and invitation email delivery are not part of this release.

A fresh plant has no operational readings or automatically asserted operational health. Open **Monitor → Add source**, review required units, envelopes and procedure, then accept observations or historical imports. See [source setup and CSV/API contracts](docs/data/telemetry-sources.md), [Docker controls](docs/operations/docker.md) and [security boundaries](SECURITY.md).

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

Factory case coordination also needs a separate local worker using the same database and provider environment: set `PYTHONPATH=backend`, then run `.venv/Scripts/python.exe -m app.cases.worker` (Unix: `.venv/bin/python`). Automation starts disabled for every plant. Manual reports, claims and responses remain available without live AI. See [case startup, backup and rollback](docs/operations/cases.md) and the [production architecture blueprint](docs/architecture/case-foundation.md).

## Historical datasets

Existing preparation scripts support attributed UCI hydraulic and IMS bearing artifacts. They are optional for historical analysis, and no synthetic fallback populates the product when artifacts are missing. The [source guide](docs/data/telemetry-sources.md) explains conversion into bounded imports, preserved source IDs and features, attribution, missing timestamps and detector limits. Raw datasets and converted batches must remain outside Git. Historical imports do not establish current plant health or authorize operational work.

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

Use an isolated acceptance database or Compose project for browser tests; tests create staff accounts and import explicitly authored values. Internal backend regression fixtures enable legacy adapters intentionally. Archived replay UI tests are skipped because those controls are no longer product features; active browser acceptance covers staff access, sources, evidence and operational repair verification.

Run `.venv/Scripts/python.exe scripts/validate.py` (Unix: `.venv/bin/python`) for portable local validation. Add `--skip-tests` for static checks only.

## Project guide

- `web/src/`: Next.js routes, dedicated features, shared UI, providers and typed API clients. `web/contracts/` holds generated OpenAPI; `web/tests/` separates unit, product browser and archived legacy checks.
- `backend/app/`: capability packages for HTTP, contracts, identity, plant, telemetry, incidents, AI, persistence and runtime. `backend/tests/` separates tests from shared fixtures; `backend/scripts/` groups data, contract, cloud and submission utilities.
- `infra/gcp/`: Cloud Run, Cloud SQL, Cloud Tasks and Scheduler deployment definitions. `infra/firebase/`: Firestore rules and indexes for the Firestore adapter.
- `docs/`: [architecture](docs/architecture/overview.md), [engineering](docs/engineering/conventions.md), [observed status](docs/status.md), [evaluation limits](docs/engineering/evaluation.md) and [source contracts](docs/data/telemetry-sources.md).

Earlier draft proposals, recordings and screenshots show previous iterations and are not proof of current live Gemini behaviour or physical plant validation.

See [repository structure](docs/engineering/repository-structure.md), [contributing](CONTRIBUTING.md) and the [documentation index](docs/README.md).
