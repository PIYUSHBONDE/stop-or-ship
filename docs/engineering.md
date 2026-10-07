# Engineering conventions

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `backend/app/main.py` | App factory, lifecycle, worker entry point, error boundary |
| `backend/app/api.py` | Versioned HTTP handlers and response contracts |
| `backend/app/dependencies.py` | Identity validation and request-scoped store injection |
| `backend/app/middleware.py` | Request size/time bounds and request IDs |
| `backend/app/engine.py` | Replay, detection, approval and recovery state machine |
| `backend/app/workflow.py` | Human-controlled calculation and repair transitions |
| `backend/app/decision_rules.py` | Calculation revisions, authorization retirement and latched demo constraints |
| `backend/app/events.py` | Shared timestamps and compact workflow audit events |
| `backend/app/store.py` | Atomic SQLite/Firestore session persistence and AI budgets |
| `backend/app/dispatch.py` | Local background dispatch and authenticated Cloud Tasks |
| `backend/app/agent.py` | Read-only evidence tools, bounded investigation and claim ownership |
| `backend/app/questions.py` | Bounded session questions and source validation |
| `web/lib/api.ts` | Identity/bootstrap coordination, typed requests and deadlines |
| `web/hooks/use-plant-session.ts` | Serialized polling/actions, reconnect state and approval retry keys |
| `web/components/` | Scene and reusable presentation components |
| `web/components/session-provider.tsx` | Shared session lifetime and selected equipment |
| `web/components/workflow/` | Separate investigation, decision, work-order and memory panels |
| `web/components/incidents/` | Dedicated incident workspace, dependency branches and intervention comparison |
| `web/lib/incident-view-model.ts` | Saved-evidence normalization and frozen readonly teammate contract |
| `web/app/*/page.tsx` | Dedicated workspace routes |

Stores are created at application startup rather than import time. Trusted replay/model artifacts are validated and warmed before the API accepts traffic. Tests inject isolated stores through `create_app(store)`. SQLite uses WAL and explicit write transactions; callbacks must not perform external network operations inside a transaction.

## Security and reliability boundaries

Requests are limited to 64 KiB and backend body reads time out after ten seconds of inactivity. Request models reject unknown fields, trim surrounding whitespace, and reject invalid numbers. API responses are uncached and carry generated request IDs. Error responses omit exception details and credentials.

The frontend proxy forwards only the versioned API path and required headers to a configured backend. It rejects cross-origin writes, malformed paths, oversized bodies and non-JSON request bodies, and refuses backend redirects. Frontend headers prevent framing and object embedding. These controls complement bearer authentication; they do not replace it.

Cloud identity checks revocation. Local identity is a demonstration token and local services bind to loopback. Broader network exposure of local mode requires a separate authentication design.

An investigation claim has a unique token. Progress, budget reservation, completion and failure must belong to that claim. Reset, timeout, or replacement invalidates old writes. A queued job that does not start becomes explicitly retryable. Local background tasks remain a prototype shortcut: they do not provide a durable queue or automatic restart recovery.

Polling and user actions share a single client request queue. Duplicate clicks are blocked immediately; approval retries reuse the same key for the same session, generation and payload. The server remains authoritative for ownership, transitions and approval versions.

Questions are read-only and session-scoped. Local answers use deterministic context; cloud answers use a structured schema with checked source IDs. Citation existence is validated; semantic support still needs live-model evaluation.

## Required checks

From `backend`, run `..\.venv\Scripts\ruff.exe check app scripts tests`, `ruff format --check app scripts tests`, and `python -m pytest -q` with the project's environment.

Export the OpenAPI contract using `backend/scripts/export_openapi.py`, then run `npm run generate:api` from `web`. Run `npm run format:check`, `npm run lint`, `npm run typecheck`, and `npm run build`. Start the API and production frontend, then run the browser tests for material workflow changes.

CI repeats these gates and checks for generated contract drift. Dependency installation uses the committed `uv.lock` and `package-lock.json`. Automated checks are evidence of the tested scope; container and cloud checks remain pending until those environments are available.

## v2 additions

Equipment configuration lives in `profiles.py`; presentation does not decide downstream impact. Archived incidents are immutable in the client. Stale incident headers are checked transactionally, and unverified repair attempts remain separate from confirmed cases. A live model can gather evidence and propose explanations; the cost engine and human workflow retain authority.

The IMS preparation utility verifies its reviewed archive checksum, restricts extracted record paths, checks finite values and exact snapshot/channel shapes, and retains provenance. Raw archives, extracted measurements and derived runtime artifacts are ignored by Git. Rebuild artifacts before starting the API, and restart after replacing them.

Use `PLANTSENSE_AI_PROVIDER` to choose scripted, Gemini API or Vertex identity independently of local/cloud persistence. All credentials remain server side. Do not present the scripted stages or stubbed specialist tests as live model evaluation.

## Milestone 1 collaboration

The integration branch is `milestone/incidents-approval`; evidence presentation work belongs on `feature/incident-evidence`. Shared contracts, fixtures, session logic and backend transitions are owned by the integration builder. The teammate owns `web/components/incidents/evidence/` and receives only prepared data and callbacks. Review their component changes before merging and repeat the combined acceptance checks. See `docs/teammate-handoff.md` for setup and screenshots.

Risk controls derive from the saved calculation. Unapplied edits block approval and require explicit recalculation or discard. Incident actions carry the displayed case ID through the shared controller; historical cases must not dispatch mutations against the active case. Specialist explanations carry their source calculation version and never determine feasibility or cost. A HTTP 409 triggers a serialized refresh so newly committed constraints become visible immediately.

Keep superseded authorizations inactive, retain their original approval/cost snapshot, and record why their version changed. Never allow retry receipts to create or reactivate work. Constraint changes discovered during approval must persist even when approval is rejected. Executed repair snapshots remain immutable; temperature and anomaly checks still gate recovery.
