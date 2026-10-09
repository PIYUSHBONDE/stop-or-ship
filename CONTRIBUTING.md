# Contributing to PlantSense

Start with [setup](README.md), [repository structure](docs/engineering/repository-structure.md), [engineering conventions](docs/engineering/conventions.md), and [current status](docs/status.md).

## Development workflow

1. Use a focused branch and the committed Python/Node lockfiles. Keep one change coherent and reviewable.
2. Place code in the owning backend package or frontend feature. Routes handle transport; workflow services own transitions; AI tools remain read-only.
3. Update Python contracts first when changing an API. Export OpenAPI and regenerate its TypeScript types together. Generated files are never edited by hand.
4. Use isolated databases and a separate Compose project for browser acceptance. Browser tests enroll staff and import test data; never point them at a personal or operational plant database.
5. Run the relevant checks, update observed results in `docs/status.md`, and commit code, contract changes and documentation together.

## Portable validation

Windows:

```powershell
.venv/Scripts/python.exe scripts/validate.py
```

Unix:

```sh
.venv/bin/python scripts/validate.py
```

The command runs lint, formatting, read-only contract drift checks, type checks, backend regression and frontend unit checks. Use `--skip-tests` for a quick static check, `--build` for a native production frontend build, and `--containers` to inspect an already-running Compose stack.

For browser acceptance, first start an isolated application using the [Docker guide](docs/operations/docker.md). Then pass its explicit URL, for example `--browser-url http://127.0.0.1:3002`. That suite writes fixtures. The default validation command does not run browser acceptance against the user's plant.

After installing web dependencies, install the browser once from `web/` with `npx playwright install chromium`. Linux hosts also need Chromium system dependencies; CI uses `npx playwright install --with-deps chromium`.

## Contracts

```powershell
$env:PYTHONPATH='backend'
.venv/Scripts/python.exe backend/scripts/contracts/export_openapi.py
npm.cmd --prefix web run generate:api
```

Unix uses `PYTHONPATH=backend .venv/bin/python ...` and `npm`. `export_openapi.py --check` and `npm run check:api` detect drift without rewriting either generated contract.

## Review expectations

- Retain plant ownership, server-side role checks, transactional approval guards and stable retry intent.
- Preserve original measurement provenance. Missing data remains unknown; historical evidence never authorizes current work.
- Keep currency in integer paise and configured assumptions visible.
- Cover concrete workflow or security risks with tests; do not mirror implementation details.
- Keep credentials, databases, raw datasets, model artifacts and temporary exports outside Git. Use `.runtime/` for local acceptance outputs.
- Report actual checks and limitations. Passing local scripted tests does not establish live Gemini or physical plant performance.
