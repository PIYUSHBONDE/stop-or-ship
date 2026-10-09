# 0001: Organize application code by capability

Date: 9 October 2026. Status: accepted for local development.

## Context

The growing backend had HTTP handlers, authentication, telemetry, persistence and AI code in one flat package. Frontend workspaces mixed dedicated features with a shared Operations view switch. Test fixtures were imported from test-case modules. Documentation combined current instructions and previous replay milestones.

## Decision

Keep `backend/` and `web/` as the deployable application roots. Group Python modules into capability packages with explicit imports. Move Next.js application code into `web/src/`, retaining configuration and public assets at the root. Give each workspace a feature directory and share only UI framing and primitives.

Separate canonical OpenAPI input, generated TypeScript, tests, fixtures, operational documentation and historical records. Keep `app.main:app`, public routes, storage locations and Compose service/volume identity unchanged. Add portable validation and read-only contract drift checks.

## Consequences

The repository is easier to navigate and ownership is clearer. Internal imports and tooling paths change, so full backend regression, production container builds and product browser acceptance are required. Existing transaction/service coupling is preserved; this decision does not claim a complete domain-layer redesign. Future Gemini implementation belongs in `backend/app/ai/` and must continue using read-only tools and the existing authoritative workflow engine.
