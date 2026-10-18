# PlantSense Technical Reference

System documentation for development and product reference

Snapshot: 16 October 2026. Repository: PIYUSHBONDE/stop-or-ship (private). Branch: f_statistics-main-integration. Source commit: 2e8f38a.

This document describes the implemented PlantSense application, its data, AI capabilities, workflows, deployment and current boundaries. It is a reference to the existing solution, not a proposed development plan. Credentials, private database connection strings and customer evidence are excluded.

## 1 Product and application screens

PlantSense combines a visual factory workspace with equipment monitoring, evidence-based investigation, human decisions and accountable case handling. The shared plant model connects equipment to production areas and downstream dependencies. The application distinguishes browser-generated process activity from accepted operational observations.

- Plant: full-screen 3D factory and 2D plan, equipment selection, search, machine inspector, production summaries and simulation controls. The automatic browser process supports degradation, operator dispatch, recovery and machine graphs.
- Operators: generated roster, active response, assignment selection, floor positions and saved response history. This roster is separate from authenticated staff and their human-task ownership.
- Monitor: equipment records, graphs, source configuration, observation quality and historical imports. Missing operational measurements remain unknown rather than being filled with screen values.
- Incidents: operational cases, linked equipment incidents, evidence, decisions and human requests. Browser-generated cases remain separately identified.
- Memory: equipment guides, scoped procedures and confirmed repair knowledge. Operational repair memory requires the existing verification workflow.
- Setup and Access: reviewed plant configurations, staff sign-in, plant membership, role permissions and administration.

The interface uses a left sidebar. The former top header, mobile bottom navigation and Plant simulation footer were consolidated into sidebar controls and panels. Operations redirects to Plant. Maintenance remains accessible through authorized incident workflow links. Ask PlantSense is a floating assistant with an expanded desktop view and a mobile sheet.

The integration branch began from the colleague's f_statistics implementation and selectively incorporated main's backend, assistant, authentication, contract and test work. The original main and f_statistics branches were preserved. Some source filenames still use “preview” for browser-generated functionality; those filenames do not imply that Plant requires a preview confirmation before running.

## 2 Architecture and request flow

The frontend is Next.js 16 with React 19 and TypeScript. Three.js, React Three Fiber and Drei render the factory. Current package dependencies do not include Plotly. Backend services use FastAPI, Python contracts, Google ADK and Vertex AI. Local persistence is SQLite; the deployed shared pilot uses PostgreSQL 16.

An authenticated browser calls the same-origin Next.js API proxy. The proxy forwards requests to FastAPI, retaining staff authentication and applying request limits. In Cloud Run it also obtains a service identity token for the private API. Staff authentication and Cloud Run service authentication are separate checks.

FastAPI resolves the actor and current plant membership before calling domain services. Services own workflow transitions, evidence validation, calculations and transactional persistence. The HTTP layer does not decide approvals or model policy. Browser polling and actions pass through usePlantSession so selection, requests and retries remain serialized.

Case automation persists a job before execution. A worker claims the job with a lease and fencing token, loads authorized evidence, executes compatible analysis stages and saves validated results. Model calls occur outside database transactions. A human waiting state releases execution resources. A valid task response schedules durable continuation of the same case.

In cloud, Cloud Tasks delivers to a private worker. Cloud Scheduler reconciles outstanding work every minute. Database job identity and transactional checks handle duplicate delivery; a queue delivery is not itself proof that a transition is authorized. Existing deterministic maintenance workflows remain authoritative even when AI is unavailable.

Key ownership boundaries are browser presentation, authenticated API, domain workflow, persistence, read-only model tools and external model services. Model responses are proposals. Server code decides whether a permitted coordination action may be applied.

## 3 Data model and evidence origins

Organization and plant establish tenant scope. A plant owns its configured areas, assets, typed dependency edges, sources, incidents, cases and policies. Staff users obtain plant access through memberships. Browser-generated samples and dispatch history live in a separate plant-scoped browser record.

- Identity: staff_users, memberships, staff_sessions, invitations and auth_limits. Roles are admin, manager, reliability, technician and viewer. Staff sessions expire after eight hours; the database stores a session hash rather than the browser token.
- Configuration: plants, plant_configurations, plant_areas, plant_assets and plant_dependencies. Configuration revisions preserve reviewed topology, capacity and diagnostic bindings. Equipment IDs connect screens, evidence and workflows.
- Sources: telemetry_sources, source_revisions, telemetry_records, source_checkpoints, ingestion_receipts and ingestion_budgets. These retain reviewed bindings, observation provenance, import/retry identity and bounded ingestion state.
- Monitoring: plant_monitoring and monitoring_revisions maintain monitoring configuration and version context.
- Maintenance domain: plant_workflows, plant_incidents, plant_orders, plant_cases and plant_audit retain workflow state, decisions, orders, verified cases and attributed audit history. plant_cases is distinct from the newer general issue_cases system.
- Issue coordination: issue_cases, issue_tasks, issue_evidence, issue_policies, issue_runs, issue_steps, issue_jobs, issue_receipts, issue_events and issue_capabilities support general cases, human work, durable analysis and scoped tool access.

Records combine indexed identity/scope/revision columns with serialized domain payloads. The storage model is not an entirely normalized set of individual signal or model-output columns. Migration 7 is additive after migration 6; it backfills existing operational incidents idempotently into linked cases without replacing their identifiers or history.

Evidence has different authority. Accepted current observations carry source revision, units, timestamp and quality. Historical datasets support analysis but do not establish current plant condition. Staff reports and technician responses retain author and origin; they are not automatically accepted measurements. Browser readings, operator movements and timer completion describe generated screen activity and do not verify a physical repair.

Current readings and saved detection values remain separate. Missing measurements are not zero. Configuration changes and new material evidence can invalidate compatibility with an earlier analysis or authorization. Currency calculations use integer paise and explicit units.

## 4 Monitoring and deterministic maintenance

Each asset belongs to a production area and participates in typed relationships such as drives, pressurizes, feeds, cools and powers. Line capacities and dependencies determine production impact. Overlapping losses on the same line are not blindly added; the model uses the limiting available capacity. Simultaneous incident scheduling still requires human judgment.

Operational observations pass validation for source binding, timestamps, units, completeness, freshness and retry identity. A reviewed source envelope supports operational diagnosis. Historical UCI or IMS data and legacy replay remain analysis inputs with their original provenance. The application does not establish a live hardware connection merely by showing a chart.

An equipment incident retains detection evidence and topology context. Investigation adds supported hypotheses and trade-offs. Intervention comparisons come from deterministic economics and decision rules. Human approval is tied to the exact calculation version and authenticated role. A stale calculation cannot silently reuse a previous approval.

Approved work proceeds through the existing work-order and technician workflow. Repair completion and verification are separate transitions. Verification requires the domain's qualifying post-repair observations, including three qualifying windows where applicable; elapsed time or an operator's statement alone does not establish verified recovery. Only qualifying outcomes enter confirmed operational repair memory.

Browser process data uses seeded simulation state, increasing ticks, active assignments and dispatch history. Versioned plant-scoped storage hydrates before generation or writes. Record IDs continue beyond saved ticks. Saved assignments retain original timestamps and reconcile completed elapsed work once. Legacy unfinished records without dispatch state remain historical interrupted records.

The browser provider shares state across route changes. One active writer per plant coordinates across tabs; followers consume persisted updates. Unavailable or invalid browser storage is handled without crashing and exposes persistence status. Browser history is tied to its origin and is not part of the PostgreSQL operational migration.

Chart-related source locations are web/src/features/monitoring/components/machine-records.tsx, web/src/features/monitoring/lib/preview-records.ts and web/src/features/plant/lib/process-simulation.ts. Plant topology and capacities are implemented under backend/app/plant. Source rules are documented in docs/data/telemetry-sources.md.

## 5 Assistant and voice

Ask PlantSense answers questions about selected equipment, production impact, current response and plant records. Ordinary responses target roughly 30 to 80 words, with longer answers when requested or necessary to explain uncertainty. The selected screen context leads ordinary screen questions; confirmed observations, spending, approval and repair questions require authoritative records.

Assistant requests may include bounded browser context: capture time, selected case, up to 36 equipment snapshots, eight readings per asset, five active assignments and ten recent cases. Text is bounded, nonfinite numbers are rejected and asset IDs are checked against the authenticated plant. The backend treats all submitted context as untrusted data.

Screen data appears as a separate citation source and disclosure control. It is not merged into authoritative evidence for calculations, approvals or repair verification. Questions about cause, safety or confirmed repair require explicit limits when evidence is insufficient. Automatic disclaimer paragraphs were removed in favor of context-specific explanations and source disclosure.

The floating desktop panel is approximately 440 pixels wide; expanded mode is centered and up to 820 pixels wide. Expansion preserves draft, conversation and selected context. Replies render safe paragraphs, bold text and bullets as React elements, without model HTML or arbitrary model-authored navigation links. Full answers remain visible in the scrollable conversation. Sources and technical details are collapsed by default.

History is tab-local rather than durable shared chat storage. Enter sends, Shift+Enter inserts a line break, and IME composition is protected. Requests are serialized through usePlantSession. A retry reuses the captured request payload and intent key. Errors preserve draft and retry intent; pending state does not invent streamed output.

Voice input uses Google transcription and presents an editable transcript before sending. Listen uses Google speech output with text preparation for formatting, punctuation and units. Voice activation is not autonomous. Real deployment checks exercised speech output and transcription; noisy shop-floor speech quality is not established.

The deployed model is Vertex Gemini 3.8 Flash. The former ten-question per-user daily assistant cap was removed; other request, concurrency and spending safeguards remain. Provider outages produce explicit failure, not an unlabelled scripted answer. Scripted providers exist only for explicitly isolated acceptance tests.

## 6 Investigation agents and retrieval

The application has two related AI paths: investigation attached to the existing incident domain, and durable general-case orchestration. Both preserve deterministic calculations and human authority. Google ADK supplies specialist execution; persisted domain records, rather than an in-memory model conversation, hold workflow truth.

Investigation gathers equipment evidence, source quality, dependencies and relevant historical knowledge. Specialist perspectives assess reliability and production implications. Evidence review checks whether conclusions are supported. Outputs retain evidence references and validated fields; partial useful results remain visible when another stage fails. A hypothesis is not automatically a verified physical root cause.

The case coordinator persists stage inputs, input hashes, evidence versions, validated results, usage and status. Compatible completed stages can be reused after restart. Material new evidence creates a new analysis version rather than rewriting historical evidence. User, case and organization budget controls persist across retries and resumptions.

Knowledge retrieval uses plant-scoped procedures and confirmed repair records. Equipment guides are reference material; prior repairs provide comparable evidence only within their actual scope and provenance. Historical records cannot authorize current interventions. The application does not maintain an unrestricted global knowledge pool shared between customer plants.

The private PlantSense MCP server uses trusted local stdio transport and allowlisted read-only tools. Tools expose equipment context and trends; dependency and production context; procedure and confirmed-repair search; case evidence and human responses; and deterministic intervention comparisons. Existing domain services provide these results.

Tool access is bound to the worker, organization, plant, run and active job lease. Model arguments do not establish tenant authority. Commands, credentials and connection configuration remain outside model control. The deployed evidence connection uses a restricted read-only database role. MCP is pinned to version 1.30.0 in the validated release.

Questions, documents, operator comments and technician notes are untrusted input. Their contents cannot redefine policy or grant approval. Models cannot operate equipment, approve spending, verify repairs or start physical work. Recorded tool activity and stage outcomes are visible; hidden chain-of-thought is not product evidence.

## 7 Cases and human requests

Equipment and production issues share the general case system. Other categories can be recorded for human triage, without implying specialized automation. Cases are created from explicit staff reports or accepted detection events. Conversational chat does not create a case unless the user takes the visible Start case action.

Server-owned phases are triage, investigating, waiting for input, awaiting decision, in progress, verifying, resolved, blocked and cancelled. Linked equipment cases derive progress from the authoritative incident workflow rather than creating a second approval or repair system. Standalone production cases require a manager-recorded outcome and supporting evidence; they do not create verified repair memory.

A human task records requested information, reason, target role, optional owner, optional due date and completion requirements. The role inbox shows eligible tasks for the current authenticated membership. A generated operator assignment in the visual simulation does not create a staff inbox task. A user with another role, plant or ownership context may legitimately see no open requests.

Eligible staff claim ownership transactionally. Responses preserve author and immutable evidence. Authorization and revisions are checked before the case resumes. Stable idempotency receipts prevent duplicate submissions from resuming analysis twice. New evidence does not silently reinstate superseded approval.

Only administrators enable or revise automation policies. Existing plants start with automation disabled. Enabled policy may record findings, request role-based information and escalate overdue requests internally. Requests without due dates do not automatically escalate. An overdue request escalates once to the manager inbox; elapsed time is never approval or task completion.

Durable jobs use stable identity, leases, fencing, checkpoints and bounded retry. A browser can close while a case waits for human input. On continuation the worker rechecks membership and policy. Revoked access, changed policy, exhausted budget or provider failure leaves an explicit bounded outcome and preserves manual workflows.

API suffixes under the plant-scoped router include GET/POST /cases; GET /cases/{case_id}; POST /cases/{case_id}/tasks; GET /tasks; POST /tasks/{task_id}/claim and /respond; POST case /resolve, /cancel, /link-incident and /analysis; and GET/POST /automation-policy. Python contracts define the exact bodies, revisions and response shapes.

## 8 Cloud deployment and release status

The shared pilot is deployed in Google Cloud project project-970d28ee-835b-4ca2-866, region asia-south1, Mumbai. Public web URLs are https://plantsense-web-nponfirhaa-el.a.run.app and https://plantsense-web-408867906527.asia-south1.run.app. Exact origin configuration accepts both aliases and rejects unrelated origins.

- Cloud Run web hosts Next.js and the same-origin proxy. It is public and uses 512 MiB memory.
- Cloud Run API hosts authenticated FastAPI services. It is private and uses 1 GiB memory.
- Cloud Run worker executes private case delivery and reconciliation. It uses 1 GiB memory and concurrency 1. The API uses concurrency 8. Deployed revisions use minimum 0 and maximum 1 instance.
- Cloud SQL plantsense-pilot runs PostgreSQL 16 Enterprise, db-f1-micro, single zone, with 10 GB SSD, no automatic storage growth, three retained backups, no PITR and deletion protection. It remains running when Cloud Run scales to zero.
- Cloud Tasks plantsense-cases limits delivery to one concurrent request, one dispatch per second and three attempts. Scheduler invokes reconciliation every minute using service identity.
- Secret Manager holds separate application, migration and evidence connection secrets. Artifact Registry stores images. Private buckets hold migration material, release reports and temporary build sources.
- Dedicated web, API, worker, task-delivery, reconciliation, migration and release identities separate privileges. Build identities use keyless GitHub federation. No downloaded service-account keys are required.

Vertex Gemini and voice use global processing, so Mumbai hosting is not an India-only data residency guarantee. Authentication remains local staff email/password. Managed SSO, password recovery and invitation email delivery are not implemented. Repository access, Google Cloud IAM and application plant membership are separate permissions.

Migration preserved original SQLite and proved 38 tables and 200 rows through counts and SHA-256 checks in a temporary PostgreSQL restore rehearsal and the actual import. Published seed passwords were rotated in the cloud copy. Native Cloud SQL backup restoration has not yet been exercised.

The GitHub release workflow is .github/workflows/mumbai-release.yml on the integration branch. It checks CI and matching private live evaluation reports before promotion, uses immutable images and candidate readiness checks, and restores prior traffic on rollout failure. Changed backend fingerprints require fresh reports. The latest recorded status has not yet verified a complete first automatic GitHub rollout; the live manually validated release is available.

## 9 Source map and developer reference

Paths below are relative to the repository root. They identify current ownership, not a list of assigned changes.

- backend/app/main.py: composition and startup gates. backend/app/api: thin HTTP routes. backend/app/contracts: Python request/response schemas.
- backend/app/identity/staff_access.py and staff_security.py: staff identity, memberships and security. backend/app/plant: configuration, catalog, topology and snapshots.
- backend/app/telemetry: source validation, imports and historical adapters. backend/app/incidents: engine, workflow, decision rules and economics.
- backend/app/ai/assistant.py: conversational grounding. agent.py and agent_workflow.py: investigation. knowledge.py: retrieval. speech.py: voice. evaluation_gate.py and assistant_gate.py: activation gates.
- backend/app/cases/service.py, jobs.py and worker.py: case transitions and durable processing. agent.py: persisted specialist analysis. tools.py, mcp_client.py and mcp_server.py: scoped read-only tools. schema.py: migration 7.
- backend/app/persistence/workspace_schema.py: shared schema and earlier migrations. PostgreSQL adapter and migration modules live alongside it. infra/postgres contains migration and runtime acceptance tooling.
- web/src/hooks/use-plant-session.ts and web/src/providers/plant-session-provider.tsx: serialized shared session. web/src/app/api/[...path]/route.ts: same-origin cloud-aware proxy.
- web/src/features/plant: scene, plan, inspectors and process generation. web/src/features/operators/lib/simulation-state.ts and preview-dispatch-provider.tsx: persisted browser dispatch state.
- web/src/features/monitoring: records, charts and sources. web/src/features/incidents: evidence and decisions. web/src/features/cases: case intake, details, role inbox and human replies.
- web/src/features/assistant: panel, safe answer formatting, context and recording. web/src/features/memory: guides and repair memory. web/src/features/access: local sign-in and staff workspace.
- infra/gcp/pilot.py and promote.py: deployment orchestration and controlled promotion. docs/status.md: dated observed results. docs/architecture/case-foundation.md: case architecture. docs/operations/cases.md: worker runbook.

Line/component data currently comes from area, asset and dependency configuration plus monitoring records. Operator history has two distinct stores: browser-generated dispatch history and authenticated case/task evidence. Investigation findings retain analysis versions and evidence support. Comment text is evidence rather than an automatically accepted procedure or user-profile change. Monitoring currently supports once-only overdue human-task escalation; a comprehensive configurable escalation matrix is not established functionality.

## 10 Local operation and validation reference

The repository uses Python 3.11 or later, Node.js 22 or later, uv 0.12.23 and committed dependency locks. Backend setup uses uv sync --project backend --frozen --extra dev with the selected virtual environment. Frontend setup uses npm ci in web. Secrets are supplied privately through local environment or cloud services; no credentials belong in source control or this document.

For native local execution, FastAPI runs through python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000. The frontend uses npm run dev in web. A separate case worker runs python -m app.cases.worker with PYTHONPATH=backend and the same database/provider settings as the API. Ports must be checked before starting another instance. On Windows, the standalone frontend must be stopped before rebuilding because it can lock .next/standalone files.

Python contracts are exported by backend/scripts/contracts/export_openapi.py to web/contracts/openapi.json. npm run generate:api in web regenerates web/src/lib/generated/api-schema.ts. Source and generated contracts are maintained together. The export --check and npm run check:api detect drift.

Backend validation uses pytest and Ruff. Frontend scripts include test:unit, test:e2e, format:check, lint, typecheck and build. PostgreSQL and infrastructure regression checks are separate from browser tests. Explicit scripted providers are used only in isolated fixtures and do not establish live Gemini performance.

The recorded cloud release passed 211 backend/PostgreSQL tests, 28 frontend unit tests, 12 focused desktop/mobile browser tests, formatting, lint, types/build, contract drift and dependency audits. Ten infrastructure regressions subsequently passed for exact web origins and rollout/container behavior. These are observed release results, not proof that every future commit passes.

Fresh live gates passed five investigation fixtures, six assistant fixtures, voice and four case fixtures including human resume. The validated backend fingerprint is 3d0a0ea04bd290e7af7dd67f634826d72947ef22497a614bcb48225e003676bb. Deployed smoke checks covered staff sign-in, a cited Gemini response, speech playback, transcription and authenticated reconciliation. Private API and worker rejected unauthenticated direct access.

Current limits include pilot sizing without HA or established production throughput; service-enforced tenant isolation without PostgreSQL row policies; no factory hardware integration; no autonomous equipment control; no verified general physical-cause accuracy; no noisy-factory voice benchmark; no completed native cloud backup restoration drill; and pending confirmation of the first full automatic GitHub release. Earlier Firestore architecture sections are historical; PostgreSQL is the current shared deployment store.

The root AGENTS.md, README.md, docs/status.md, docs/architecture/overview.md and docs/engineering/conventions.md define repository conventions. Dated status entries qualify older architecture prose. This document records the system at the stated snapshot; implementation details and runtime availability can change after that commit.
