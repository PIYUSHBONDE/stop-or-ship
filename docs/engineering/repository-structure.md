# Repository structure

PlantSense keeps independently deployable web and API applications in one repository. Their names and service entry points remain stable.

```text
.
├── backend/
│   ├── app/
│   │   ├── main.py           # Composition and lifecycle; app.main:app
│   │   ├── api/              # Thin HTTP routes, dependencies, request boundary
│   │   ├── contracts/        # Pydantic request/response types
│   │   ├── core/             # Settings, shared time and event helpers
│   │   ├── identity/         # Staff authentication, roles, audit attribution
│   │   ├── plant/            # Configuration, catalog, dependencies, projection
│   │   ├── telemetry/        # Observations, imports, historical/legacy adapters
│   │   ├── incidents/        # Lifecycle, constraints, approval, costs, recovery
│   │   ├── ai/               # Investigator, specialist stages, retrieval, questions
│   │   ├── persistence/      # Stores and additive SQLite migrations
│   │   └── runtime/          # Dispatch and scheduler
│   ├── scripts/
│   │   ├── contracts/        # Export/check OpenAPI
│   │   ├── data/             # Prepare/convert attributed datasets
│   │   ├── cloud/            # Future cloud setup and smoke checks
│   │   └── submission/       # Draft proposal generation
│   ├── tests/
│   │   ├── unit/             # Isolated specialist orchestration
│   │   ├── integration/      # API, persistence, workflow, source regressions
│   │   └── support/          # Reusable fixtures and request helpers
│   └── data/                 # Reviewed knowledge; raw/artifacts ignored
├── web/
│   ├── src/
│   │   ├── app/              # Next.js routes and route composition
│   │   ├── features/         # access, plant, monitoring, operations, incidents,
│   │   │                     # maintenance, memory, setup
│   │   ├── components/       # Shared UI and layout primitives
│   │   ├── providers/        # Plant session lifetime and selected equipment
│   │   ├── hooks/            # Serialized requests, polling and actions
│   │   ├── lib/              # API clients, generated types, shared domain helpers
│   │   └── testing/fixtures/ # Explicitly authored evidence workshop fixtures
│   ├── contracts/            # Canonical OpenAPI JSON from FastAPI
│   ├── tests/                # unit, e2e, archived legacy UI coverage
│   ├── public/               # Static runtime assets and CSV template
│   └── scripts/              # Startup and retained capture/recording tools
├── infra/                    # gcp deployment definitions; firebase rules/indexes
├── scripts/                  # Cross-platform validation and local runtime helpers
├── docs/                     # Architecture, engineering, data, product, operations,
│                             # submission drafts, history and reviewed screenshots
└── .runtime/                 # Ignored local backups, exports and acceptance outputs
```

## Placement and imports

Backend imports use canonical `app.<package>.<module>` paths. Package initializers contain no side effects or wildcard re-exports. `app.main` composes the service; it does not own workflow rules. The reorganization preserves existing transaction boundaries and service relationships; folder changes alone do not remove all internal coupling.

Frontend `@/` resolves to `web/src/`. Keep workspace code inside its feature, shared UI under `components/ui`, and shared page framing under `components/layout`. Operations, Maintenance and Memory each own their workspace; none dispatches another workspace through a view flag. API access remains serialized through the shared controller.

`web/contracts/openapi.json` and `web/src/lib/generated/api-schema.ts` are generated and committed. Lint/format exclude generated outputs, while dedicated drift checks verify them. Configuration, lockfiles and `public/` remain at the web root as required by the installed Next.js version.

## Tests and retained history

Fixtures live in `backend/tests/support`, not in files containing tests. Operational integration tests carry the registered `operational` marker so the fixture disables internal replay adapters. Other retained backend regressions exercise those internal adapters.

`npm run test:unit` executes three evidence-normalization checks. `npm run test:e2e` runs the product browser checks. `web/tests/legacy` preserves 28 retired replay UI checks and is excluded from normal Playwright discovery; those checks are not product passes.

Current instructions live in this guide, [conventions](conventions.md), [telemetry sources](../data/telemetry-sources.md), [Docker](../operations/docker.md), and [status](../status.md). Previous implementation and replay reviews live in `docs/history/`. Existing recorded assets remain in `docs/artifacts/` with their original provenance.
