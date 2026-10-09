# Run PlantSense with Docker

## Start locally

Use Docker Desktop with Linux containers on Windows/macOS, or Docker Engine with Compose v2 on Linux. Docker must be running. From the repository root:

```sh
docker compose up --build --wait
```

Open **http://127.0.0.1:3000**. The web service proxies requests to the private API container. Both services must be healthy before startup completes.

The entry page is now `/workspace`. Set up the initial local administrator/plant, or sign in to an existing staff account. Shared plant history has no reset action. See [shared plant review](shared-plant-review.md) for roles and a separate acceptance stack.

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

The stack uses local persistence and the scripted investigator by default. It requires no cloud credentials. Named staff identity and roles are enforced locally; this identity adapter is intended for localhost development. Public or real-plant deployment requires managed identity, TLS and a separate deployment review. Compose derives allowed staff web origins from `PLANTSENSE_WEB_PORT`.

## Data and repeatable builds

A fresh clone builds without downloading datasets. Missing measured data is labelled as a synthetic fallback. To use downloaded measured data, follow the preparation steps in the root README before building the API image, then rebuild the stack. Only `replay.json`, `detector.pkl` and `bearing-replay.json` are accepted from the prepared artifact directory. Raw measurements, local databases, environment files and other artifacts are excluded from Docker build contexts.

The backend image owns its packaged knowledge/replay files; the writable database is stored separately at `/var/lib/plantsense/local.db`. A rebuild updates replay artifacts without copying the host's database into the image. Do not mount untrusted pickle files or accept model-artifact uploads.

Python and Node base images are pinned by registry digest. Python dependencies install from `uv.lock` with `--frozen`; frontend dependencies install with `npm ci`. Both images use separate dependency/build and runtime stages. Update reviewed image digests when upstream security patches become available; a pinned digest does not update itself.

## Container controls

- Both services run as non-root users; application source and dependencies remain root-owned.
- Compose uses read-only root filesystems, drops Linux capabilities and prevents privilege escalation.
- Only the web service publishes a port, bound to `127.0.0.1`. The API has no host port mapping.
- SQLite has a persistent volume; temporary/cache files use bounded memory-backed filesystems.
- Health checks, graceful shutdown, an init process, resource limits and rotated logs are configured.
- Build contexts allow only required files. Gemini/service-account credentials are never build arguments or packaged files. Firebase browser configuration arguments are public client configuration, not server credentials.

These controls are defined in [compose.yaml](../compose.yaml) and the two Dockerfiles. See [Docker build guidance](https://docs.docker.com/build/building/best-practices/) for digest pinning and runtime-image practices.

## Validation

`docker compose config --quiet` validates the configuration without starting containers. Runtime validation needs a working engine:

```sh
docker compose up --build --wait --wait-timeout 120
python scripts/check_containers.py
```

The check verifies the runtime user, read-only root, dropped capabilities, privilege restriction, private API, writable data volume, health routes, security headers and session ownership through the proxy. It uses only synthetic test context and creates an isolated session. Set `PLANTSENSE_WEB_PORT` consistently if using another host port.

The CI container job builds from a clean checkout, runs those checks and repeats the browser workflows against Compose. Local results and unavailable checks are recorded in `docs/status.md`; configured CI is not proof of a completed CI run.
