# Engineering conventions

## Product source boundaries

- Production-facing local execution defaults to `PLANTSENSE_INTERNAL_TEST_MODE=false`. Legacy anonymous/scenario/clock endpoints are unavailable. Tests opt into internal adapters explicitly; no request body can change the setting.
- `sources.py` owns source review, quality, immutable observation admission and transactional incident ingestion. `telemetry/imports.py` parses the fixed CSV contract and previews without writing. `api/sources.py` stays thin. `plant/snapshot.py` projects observations without generated values or inferred health.
- Historical analysis and legacy repair records are never operational authorizations. Keep original timestamps, record IDs, source revisions and provenance. Missing acquisition times stay missing. Receipts bind actor, plant, source version and normalized payload.
- Operational recovery counts complete, distinct post-completion windows only. Never generate replacement measurements or mutate a source after technician completion. Reviewed envelopes and procedures belong to administrators, not agents or imported files.
- Keep source/editor/import presentation modular, and use the shared serialized controller for every request. Show measured output separately from rated capacity and estimated impact. Legacy browser scenarios are explicitly archived; active acceptance exercises staff and source workflows.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `backend/app/main.py` | App factory, lifecycle, worker entry point, error boundary |
| `backend/app/api/sessions.py` | Versioned HTTP handlers and response contracts |
| `backend/app/api/dependencies.py` | Identity validation and request-scoped store injection |
| `backend/app/api/workspace.py` | Shared staff/plant HTTP contracts and dispatch |
| `backend/app/identity/staff_access.py` | Enrollment, invitations, memberships and transaction-local permissions |
| `backend/app/identity/staff_security.py` | Password derivation, token hashes and role permissions |
| `backend/app/persistence/workspace_schema.py` | Additive versioned SQLite migrations |
| `backend/app/plant/catalog.py` | Plant-scoped catalog seeding and reads |
| `backend/app/persistence/workspace_store.py` | Per-incident persistence, plant projections and retained audit |
| `backend/app/runtime/local_runtime.py` | Local browser-independent replay and investigation scheduling |
| `backend/app/api/middleware.py` | Request size/time bounds and request IDs |
| `backend/app/incidents/engine.py` | Replay, detection, approval and recovery state machine |
| `backend/app/incidents/workflow.py` | Human-controlled calculation and repair transitions |
| `backend/app/incidents/decision_rules.py` | Calculation revisions, authorization retirement and latched demo constraints |
| `backend/app/core/events.py` | Shared timestamps and compact workflow audit events |
| `backend/app/persistence/store.py` | Atomic SQLite/Firestore session persistence and AI budgets |
| `backend/app/runtime/dispatch.py` | Local background dispatch and authenticated Cloud Tasks |
| `backend/app/ai/agent.py` | Read-only evidence tools, bounded investigation and claim ownership |
| `backend/app/ai/questions.py` | Bounded session questions and source validation |
| `web/src/lib/api/client.ts` | Identity/bootstrap coordination, typed requests and deadlines |
| `web/src/lib/api/staff-client.ts` | Generated staff contracts and cookie-authenticated requests |
| `web/src/hooks/use-plant-session.ts` | Serialized polling/actions, reconnect state and approval retry keys |
| `web/src/components/` | Scene and reusable presentation components |
| `web/src/providers/plant-session-provider.tsx` | Shared session lifetime and selected equipment |
| `web/src/features/maintenance/` and `web/src/features/memory/` | Dedicated authorized work and verified memory presentation |
| `web/src/features/incidents/` | Dedicated incident workspace, dependency branches and intervention comparison |
| `web/src/features/incidents/lib/evidence-view-model.ts` | Saved-evidence normalization and readonly presentation types |
| `web/src/app/*/page.tsx` | Dedicated workspace routes |

Stores are created at application startup rather than import time. Trusted replay/model artifacts are validated and warmed before the API accepts traffic. Tests inject isolated stores through `create_app(store)`. SQLite uses WAL and explicit write transactions; callbacks must not perform external network operations inside a transaction.

## Security and reliability boundaries

Requests are limited to 64 KiB and backend body reads time out after ten seconds of inactivity. Request models reject unknown fields and invalid numbers. Text fields are normalized explicitly; passwords preserve every character. Validation errors omit supplied input, including passwords and invitation tokens. API responses are uncached and carry generated request IDs. Error responses omit exception details and credentials.

The frontend proxy forwards only the versioned API path and required headers to a configured backend. It rejects cross-origin writes, malformed paths, oversized bodies and non-JSON request bodies, and refuses backend redirects. Frontend headers prevent framing and object embedding. These controls complement bearer authentication; they do not replace it.

Shared local access uses named staff, hashed expiring cookies and active plant memberships. Membership revocation is checked on each protected request and again inside workflow write transactions. Never accept approver identity from a shared request body. Keep private worker ownership separate from browser credentials. Local services bind to loopback; production exposure requires managed identity, TLS and its own deployment gate. Isolated demo tokens and its existing Firebase anonymous adapter remain separate.

An investigation claim has a unique token. Progress, budget reservation, completion and failure must belong to that claim. Reset, timeout, or replacement invalidates old writes. A queued job that does not start becomes explicitly retryable. Local background tasks remain a prototype shortcut: they do not provide a durable queue or automatic restart recovery.

Polling and user actions share a single client request queue. Duplicate clicks are blocked immediately; approval retries reuse the same key for the same session, generation and payload. The server remains authoritative for ownership, transitions and approval versions.

Navigation changes the controller context. A response from the prior plant or incident must not publish into the new context. Shared polling is read-only; replay writes come from authorized controls or the server scheduler. Do not add independent mutation requests to presentation components.

Questions are read-only and session-scoped. Local answers use deterministic context; cloud answers use a structured schema with checked source IDs. Citation existence is validated; semantic support still needs live-model evaluation.

## Required checks

From `backend`, run `..\.venv\Scripts\ruff.exe check app scripts tests`, `ruff format --check app scripts tests`, and `python -m pytest -q` with the project's environment.

Export the OpenAPI contract using `backend/scripts/contracts/export_openapi.py`, then run `npm run generate:api` from `web`. Run `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run build`. Start the API and production frontend, then run the browser tests for material workflow changes.

CI repeats these gates and checks for generated contract drift. Dependency installation uses the committed `uv.lock` and `package-lock.json`. Automated checks are evidence of the tested scope; observed container checks are recorded in `docs/status.md`; cloud execution remains a separate gate.

## v2 additions

Equipment configuration lives in `profiles.py`; presentation does not decide downstream impact. Archived incidents are immutable in the client. Stale incident headers are checked transactionally, and unverified repair attempts remain separate from confirmed cases. A live model can gather evidence and propose explanations; the cost engine and human workflow retain authority.

The IMS preparation utility verifies its reviewed archive checksum, restricts extracted record paths, checks finite values and exact snapshot/channel shapes, and retains provenance. Raw archives, extracted measurements and derived runtime artifacts are ignored by Git. Rebuild artifacts before starting the API, and restart after replacing them.

Use `PLANTSENSE_AI_PROVIDER` to choose scripted, Gemini API or Vertex identity independently of local/cloud persistence. All credentials remain server side. Live model-client creation requires a passing evaluation report matching the backend implementation, provider, model and region. Reserve request and estimated spend allowances before dispatch, settle observed usage or retain an explicit unknown charge, and fence workflow publication by the active claim. Keep source evidence read-only and shared calculations deterministic. Do not present the scripted stages or stubbed specialist tests as live model evaluation. See [local Gemini investigation](../operations/live-gemini.md).

## Incident decision rules

Risk controls derive from the saved calculation. Unapplied edits block approval and require explicit recalculation or discard. Incident actions carry the displayed case ID through the shared controller; historical cases must not dispatch mutations against the active case. Specialist explanations carry their source calculation version and never determine feasibility or cost. A HTTP 409 triggers a serialized refresh so newly committed constraints become visible immediately.

Keep superseded authorizations inactive, retain their original approval/cost snapshot, and record why their version changed. Never allow retry receipts to create or reactivate work. Constraint changes discovered during approval must persist even when approval is rejected. Executed repair snapshots remain immutable; temperature and anomaly checks still gate recovery.

## Legacy coordinated monitoring adapter

`telemetry/legacy_monitoring.py` owns the transactional clock/source checkpoints, `telemetry/legacy_quality.py` owns trusted local source adaptation, and `api/monitoring.py` owns thin HTTP contracts. Mapping changes are versioned, permission checked and audited. Observe original values and source IDs alongside replay timestamps; label any overridden values synthetic. Invalid observations cannot count toward detection or recovery and block new approval or repair start.

Use shared `usePlantSession` operations for monitoring settings and clock commands. All monitoring reads, polling and human mutations remain serialized. While monitoring is enabled, presentation directs users to the coordinated clock instead of issuing independent scenario/replay commands. Deferred repairs wait on that shared clock; no asset may advance it independently.

## Statistics integration boundaries

Automatic browser simulation is presentation data, never operational evidence. Persist simulation through its plant-scoped provider, with hydration before writes and one Web Lock writer. Preserve bounded records across migration. Keep interrupted legacy cases out of active counts. Assistant snapshots are untrusted, finite and bounded; validate their asset IDs against authenticated plant ownership and expose separate synthetic citations. Assistant requests stay serialized through `usePlantSession`.
