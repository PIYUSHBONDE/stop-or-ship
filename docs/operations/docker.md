# Run PlantSense with Docker

## Start locally

Use Docker Desktop with Linux containers on Windows/macOS, or Docker Engine with Compose v2 on Linux. Docker must be running. Copy `.env.example` to `.env`, then set `PLANTSENSE_ADC_FILE`, `DATABASE_URL` and the evidence database DSN. On Windows, the example selects the local overlay through `COMPOSE_FILE`. Run `gcloud auth application-default login` once. Compose reads `.env` automatically; Git ignores it and Docker excludes it from build contexts.

From the repository root:

```sh
docker compose up --build --wait
```

Open **http://127.0.0.1:3000**. Compose starts the web app, private API, Cloud SQL Auth Proxy and case worker. The API uses Vertex AI and PostgreSQL from `.env`; local live AI needs no evaluation reports. `compose.local.yaml` gives the API and worker the same PostgreSQL DSNs and mounts ADC read-only.

The entry page is now `/workspace`. Set up the initial local administrator/plant, or sign in to an existing staff account. Shared plant history has no reset action. See [shared plant review](../history/shared-plant-review.md) for roles and a separate acceptance stack.

If the existing native frontend already uses port 3000, choose another port:

```powershell
$env:PLANTSENSE_WEB_PORT = '3010'
docker compose up --build --wait
```

On Linux/macOS:

```sh
PLANTSENSE_WEB_PORT=3010 docker compose up --build --wait
```

Inspect startup problems with `docker compose ps` and `docker compose logs --tail=100`. Stop with `docker compose down`. The named `plant-data` volume retains sessions and repair records across restarts. `docker compose down --volumes` permanently deletes that container stack's saved sessions; use it only when intentionally clearing that data.

The ADC file path in `PLANTSENSE_ADC_FILE` is mounted read-only into the API, worker and proxy. The proxy connects by the instance connection name and does not require a public IP allowlist. Use the app and evidence database passwords from Secret Manager in `.env`; never commit those values. Google recommends the [Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/connect-auth-proxy), which authenticates the connection and encrypts it. Named staff identity and roles are enforced locally; public or real-plant deployment requires managed identity, TLS and a separate deployment review. Compose derives allowed staff web origins from `PLANTSENSE_WEB_PORT`.

## Data and repeatable builds

A fresh clone builds without downloading datasets. Product equipment starts without readings and remains unknown. Prepared datasets support historical imports and analysis through the source guide; there is no synthetic fallback in product snapshots. Only `replay.json`, `detector.pkl` and `bearing-replay.json` are accepted from the prepared artifact directory. Raw measurements, local databases, environment files and other artifacts are excluded from Docker build contexts.

The backend image owns its packaged knowledge/replay files; the writable database is stored separately at `/var/lib/plantsense/local.db`. A rebuild updates replay artifacts without copying the host's database into the image. Do not mount untrusted pickle files or accept model-artifact uploads.

Python and Node base images are pinned by registry digest. Python dependencies install from `uv.lock` with `--frozen`; frontend dependencies install with `npm ci`. Both images use separate dependency/build and runtime stages. Update reviewed image digests when upstream security patches become available; a pinned digest does not update itself.

## Container controls

- Both services run as non-root users; application source and dependencies remain root-owned.
- Compose uses read-only root filesystems, drops Linux capabilities and prevents privilege escalation.
- Only the web service publishes a port, bound to `127.0.0.1`. The API has no host port mapping.
- SQLite has a persistent volume; temporary/cache files use bounded memory-backed filesystems.
- Health checks, graceful shutdown, an init process, resource limits and rotated logs are configured.
- Build contexts allow only required files. Gemini/service-account credentials are never build arguments or packaged files. Firebase browser configuration arguments are public client configuration, not server credentials.

These controls are defined in [compose.yaml](../../compose.yaml) and the two Dockerfiles. See [Docker build guidance](https://docs.docker.com/build/building/best-practices/) for digest pinning and runtime-image practices.

## Validation

`docker compose config --quiet` validates the configuration without starting containers. Runtime validation needs a working engine:

```sh
docker compose up --build --wait --wait-timeout 120
python scripts/check_containers.py
```

The check verifies the runtime user, read-only root, dropped capabilities, privilege restriction, private API, writable data volume, health routes, security headers, disabled anonymous endpoints and unauthenticated staff access boundaries through the proxy. It does not create accounts or modify plant records. Browser and backend tests separately verify authenticated ownership using isolated acceptance data. Set `PLANTSENSE_WEB_PORT` consistently if using another host port.

The CI container job builds from a clean checkout, runs those checks and repeats the browser workflows against Compose. Local results and unavailable checks are recorded in `docs/status.md`; configured CI is not proof of a completed CI run.

### Isolated browser acceptance

Browser checks create staff, plant configuration and observation records. Use a separate project and port, so the main `plantsense_plant-data` volume remains untouched. Choose a fresh project name for each acceptance run.

Windows:

```powershell
$env:COMPOSE_PROJECT_NAME = 'plantsense-acceptance-unique-run'
$env:PLANTSENSE_WEB_PORT = '3002'
docker compose up --build --wait --wait-timeout 120
.venv/Scripts/python.exe scripts/check_containers.py
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3002'
npm.cmd --prefix web run test:e2e
docker compose down
Remove-Item Env:COMPOSE_PROJECT_NAME, Env:PLANTSENSE_WEB_PORT, Env:PLAYWRIGHT_BASE_URL
```

Unix:

```sh
export COMPOSE_PROJECT_NAME=plantsense-acceptance-unique-run
export PLANTSENSE_WEB_PORT=3002
docker compose up --build --wait --wait-timeout 120
.venv/bin/python scripts/check_containers.py
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3002 npm --prefix web run test:e2e
docker compose down
unset COMPOSE_PROJECT_NAME PLANTSENSE_WEB_PORT
```

Stopping this project retains its acceptance volume. The ordinary `docker compose up` command uses the main project again after clearing these variables.
