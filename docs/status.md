# Implementation status

Local implementation includes the whole plant, measured replay, runtime detector, explicitly scripted investigation, evidence inspection, option calculations, versioned approval, work order, repair verification, technician correction and subsequent case retrieval.

Google Cloud integration and reproducible deployment configuration are implemented. No active Google Cloud login was found; existing application-default credentials failed a read-only refresh check (`RefreshError`), so deployment, live Gemini/retrieval evaluation, budget provisioning and a public prototype URL remain pending. No public video upload was performed. The user built and started both local Docker services successfully and ran the container security/ownership checks; the web health endpoint was independently verified from this session. Full browser results are recorded below.

The proposal PDF and local recording are drafts. They must not be submitted as proof of a live Gemini integration. See the deployment acceptance gate and evaluation limitations before publication.

## Previous baseline validation

- Backend: **29 tests passed**; Ruff lint, import ordering and formatting checks passed.
- Browser: **14 tests passed**, including five consecutive complete primary workflows, refresh recovery, keyboard/dialog interaction, sensor uncertainty, failed recovery, rejection/reopening, delayed-polling protection, source inspection and proxy request boundaries. No failed or flaky tests in the final run.
- Frontend: production build, TypeScript checks, lint, formatting and OpenAPI client generation passed. The dependency audit reported zero vulnerabilities at the time of checking.
- Backend dependency lock validated; deployment PowerShell scripts passed syntax checks. CI and container execution have not been run remotely.
- Final API smoke check: healthy local service and all twelve assets returned after restart.
- Previous dashboard preview (6 October, before the v2 scene): usable controls in **543 ms** after API readiness; approximately **51.4 animation-frame callbacks/second** in Chromium software rendering. This is not a GPU frame-rate benchmark or a measurement on the judge's laptop.

## Engineering update — 6 October 2026

- Separated app composition, HTTP routes, authentication dependencies, task dispatch, read-only questions, and repair transitions. Tests inject isolated persistence through the app factory.
- Serialized client polling and user actions; coalesced session/identity bootstrap and retained approval idempotency keys for the same retry intent.
- Added strict request contracts, body size/time bounds, checked question citations, safe error request IDs, same-origin proxy writes, redirect rejection and browser security headers.
- Fenced worker callbacks by claim ownership, preserved evidence across retries, and made queued/expired investigations explicit recoverable failures.
- Enabled SQLite WAL; validated and warmed the detector before API readiness.
- Added pinned formatting tools and CI format gates, plus `AGENTS.md` and `docs/engineering.md` for future local development.

The 6 October browser run finished with ten passes and no failed or flaky tests. The backend suite has one upstream Starlette TestClient deprecation warning; it does not affect application requests.

## Review the prototype

After starting the local services, review the web application at **http://127.0.0.1:3000**, with API documentation at **http://127.0.0.1:8000/docs**. Restart instructions are in `README.md`; container instructions are in `docs/docker.md`.

Current v2 review artifacts: `plant-v2.png`, `memory-v2.png`, and `mobile-plant-v2.png`. The proposal and recording below still show the earlier dashboard and need refreshing after live AI validation.

Earlier review artifacts in `docs/artifacts/`: `plant-3d.png`, `investigation.png`, `verified-memory.png`, `PlantSense_Proposal_Draft.pdf`, and `plantsense-local-demo.webm`. The video is a 2:59.6 silent, captioned local rehearsal with a scripted investigator; it is not the final cloud submission video.

## Remaining release gates

1. Refresh Google Cloud login and application-default credentials, and confirm the intended billing-enabled project and Firebase configuration.
2. Run the supplied deployment scripts, provision budget alerts, seed vector retrieval and verify private worker authentication.
3. Evaluate live Gemini grounding, ambiguity, retrieval, timeout/retry handling and malicious document instructions. Local tests do not prove live-model performance.
4. Repeat acceptance on the public deployment, record the narrated three-minute final demonstration and replace draft submission links with public URLs.
5. Measure the dedicated plant scene on the demo laptop with hardware graphics available and reach the 30 FPS target; software rendering is currently below that target.

The conventional detector report is deliberately limited: six healthy training cycles and only one healthy cycle among 38 held-out examples. See `docs/evaluation.md` before quoting its precision or recall.

## Local v2 update — 7 October 2026

- Dedicated `/plant` factory explorer with a cutaway industrial hall, service pipes, original procedural floor texture, equipment activity, orbit cameras, close-ups, quality controls, searchable equipment, explicit status labels and a selectable 2D fallback.
- Shared session/navigation across Plant, Operations, Incidents, Maintenance and Memory; separate workflow presentation components. Browser refresh restores the session and navigation does not create a new identity.
- Equipment profiles cover hydraulic pump, shared cooler, press valve and drive-motor bearing. UCI replay includes nine signals and 27 detector features. The measured IMS subset is prepared with provenance, snapshot checksums and explicit source-unit labels.
- Dependency-based production and costs count unique affected lines. Finished-goods telemetry matches whole-plant output. Currency formatting preserves non-zero paise. Costs and probabilities remain synthetic configured assumptions.
- One active incident with retained read-only history, transaction-checked incident IDs, exact calculation versions and stable approval retry keys. Failed verification can continue the approved intervention; earlier outcomes remain retained and unverified cases remain excluded from memory. Recurrence targets the most recently verified equipment.
- Configurable scripted, Gemini API and Vertex providers, with credentials restricted to the backend. ADK investigator, independent Reliability/Production positions, evidence review and deterministic arbitration are implemented. Specialist outputs are stub-tested; no live Gemini quality, latency or cost is claimed.
- Local validation: 29 backend tests and 14 browser tests passed, including five complete primary runs, cross-workspace navigation, direct 3D equipment selection, mobile selection, WebGL fallback, equipment workflows, archived ownership and stale-action rejection. Ruff, Prettier, TypeScript, lint, OpenAPI generation and production build pass. Upstream Starlette and OpenTelemetry deprecation warnings remain.
- Final v2 production preview: controls usable in 482–486 ms after API readiness at 1600 × 1050. Two isolated Chromium runs measured 13.5 and 19.6 animation-frame callbacks/second; both used SwiftShader software rendering (the default renderer also fell back to SwiftShader). Automatic quality used a 0.7-resolution canvas without shadows. No browser errors were observed. These are short cadence measurements, not GPU benchmarks; the 30 FPS target is not met in this environment and actual GPU performance remains unverified. See `docs/artifacts/browser-performance-v2.json` and `browser-performance-v2-default.json`.
- Hydraulic threshold selection uses one independent healthy validation cycle; fitting and evaluation remain separate.
- Expanded hydraulic evaluation: 38 held-out cycles (one healthy, 37 abnormal), precision 0.973684, recall 1.0, confusion matrix `[[0,1],[0,37]]`. The healthy cycle was a false positive; these tiny and imbalanced counts do not establish robust detection.
- IMS replay uses a single experiment with 18 reference snapshots, six threshold snapshots, six early replay snapshots and twelve late snapshots. Independent-experiment evaluation is not performed. Recovery replay is illustrative, not a documented real repair.

Cloud deployment remains deferred at the user's request. Live model access, semantic claim-support evaluation, cloud vector queries, cloud worker security and submission refresh remain release gates. The local application is ready for review; it is not presented as a completed cloud hackathon submission.

## Milestone 1 implementation — 7 October 2026

The local incident-to-authorization implementation is ready for review.

- Dedicated `/incidents?incident=<id>` workspace with a case list, equipment identity, lifecycle/progress, hypotheses, conflicting evidence, missing information, source details, branching production impact, a four-option INR comparison and human approval.
- Historical/resolved cases remain read-only. Maintenance deep links validate the selected case, and the handoff is presented only after refreshing and checking the current authorized order/version.
- The configured temperature constraint is checked on every new replay window and before approval or repair start. Its first breach is latched with typed signal evidence, retires pre-execution authorization, updates the calculation revision and persists before a stale-command conflict is returned. Superseded orders remain inactive; retry receipts cannot reactivate them.
- Risk controls initialize from the saved calculation. Unapplied changes block approval and offer Recalculate/Discard. Specialist positions retain their calculation version; explanations are labelled stale after a revision.
- Original approval/cost snapshots remain recorded. Executed repairs retain their authorization snapshot; hot or abnormal windows cannot verify recovery. Three healthy windows release the demo latch while preserving the original trigger for review.
- Evidence normalization retains saved excerpts and provenance, keeps measured/synthetic/document/verified-case categories distinct and rejects document JSON as measured telemetry. Scoped components, seven synthetic fixtures and a frontend-only `/evidence-preview` workshop are provided.
- Git preserves the existing remote history with an imported reviewed baseline. Credentials, raw datasets, local databases, dependency caches and rehearsal recordings are excluded.

### Measured acceptance results

- **39 backend tests passed**. The new tests cover late temperature breaches, committed conflicts, inactive superseded orders, unchanged executed authorization, unit checks, incident guards and temperature-aware recovery. Existing ownership, concurrent approval, worker, economics and repair tests remain passing.
- **29 browser tests passed in the final run (5.2 minutes)**, including five consecutive complete dedicated Incidents → authorized Maintenance → repair verification → memory workflows. Saved risk/selection refresh, dirty-edit blocking, stale approval refresh, cooling branches, historical guards, incomplete-investigation presentation, safe source text, keyboard focus and 430 px layouts passed. The existing plant/3D fallback and downstream regressions passed as well.
- An earlier run had two ambiguous alert selectors matching Next.js's route announcer. Those selectors were corrected; the final full run had no failed or retried tests.
- Ruff lint and formatting, Prettier formatting, TypeScript checks, ESLint and the production Next.js build passed. OpenAPI and generated TypeScript were regenerated; repeat generation produced identical SHA-256 hashes. `git diff --check` passed.
- Source review found no obvious private-key, Gemini-key or GitHub-token patterns. This is a limited source check, not a security certification.
- Browser screenshots are saved as `evidence-workshop.png`, `evidence-details.png`, `evidence-mobile.png`, `incidents-milestone-1.png` and `incidents-mobile.png` under `docs/artifacts/`. Desktop and mobile examples were visually inspected.
- Upstream Starlette/OpenTelemetry/Three.js deprecation warnings remain. Browser CLI also reports a color-environment warning; neither caused acceptance failures.

See `docs/milestone-1-review.md` for the acceptance walkthrough. Local servers bind to loopback on ports 3000/8000. Cloud deployment, live Gemini and cloud retrieval validation, remote CI results and GPU performance remain separate gates. This milestone does not redesign the remaining Operations, Maintenance or Memory workspaces, and it does not establish hackathon submission readiness.

## Docker and source security — 7 October 2026

- Added a local `compose.yaml` with a private API and web access bound to localhost. Sessions use a named database volume. Both services have non-root users, read-only root filesystems, dropped Linux capabilities, privilege restrictions, health checks, process/memory/CPU limits and rotated logs.
- Python and Node images use verified registry digests and separate build/runtime stages. Application code remains root-owned; only database and bounded cache/temporary storage are writable. Frozen dependency locks and allowlisted build contexts exclude credentials, host databases, raw datasets and runtime caches. A fresh clone is configured to build with the labelled synthetic fallback when measured artifacts are absent.
- Added `SECURITY.md`, Docker instructions and a runtime check for container isolation, health/security headers, cross-origin write rejection and session ownership. CI now includes production dependency audits, a checksum-verified Gitleaks binary, full-history secret scanning, clean-checkout container builds and browser workflows against Compose. CI actions are pinned to verified commit IDs.

### Observed checks and remaining gates

- **39 backend tests passed** again, with the two existing upstream deprecation warnings. The first attempt could not create SQLite test databases in the sandbox's default temporary directory; rerunning with a writable, ignored workspace temporary directory passed without application changes.
- Production npm and locked Python dependency audits reported **no known vulnerabilities** at the time of checking. Gitleaks reported no leaks across all six commits, including packaging commit `3ecd72e`.
- Compose configuration, workflow/Compose YAML parsing, Ruff lint/formatting, Prettier formatting, TypeScript checks, ESLint and `git diff --check` passed.
- The native Windows production build attempt was initially blocked before compilation by access denial during SWC path canonicalization. The subsequent user-run Docker build completed both production images successfully, with a reported combined build time of 157.1 seconds; API and web containers became healthy.
- The current sandbox cannot access Docker Desktop's Linux-engine pipe. The user therefore ran `python scripts/check_containers.py` from their laptop terminal: container users, isolation, storage, health, security headers and session ownership all passed. The new web `/health` response was independently confirmed at localhost from this session. This verifies the local operator-built stack; clean-checkout CI jobs have not been observed running.
- **29 browser tests passed against the running Docker stack in 5.9 minutes**, with no failures or retries in the final run. These include five consecutive dedicated incident-to-approved-work-order-to-verified-repair runs, saved selection/risk after refresh, stale approval rejection, historical guards, cooling branches, evidence focus/mobile layouts, 3D selection/fallback, failed recovery, uncertainty and cross-origin request rejection. The first launch attempt selected an empty sandbox browser cache; using the existing installed Playwright browser resolved that setup issue. Test reports remain in the ignored `web/test-results/` directory; baseline screenshots were retained.
- Git's credential helper remains restricted in this session, and automatic approval review previously rejected unsandboxed execution. After the user's terminal work, the local `origin/milestone/incidents-approval` tracking reference matches packaging commit `3ecd72e`. Live GitHub CI status has not been inspected.

These are checks of the implemented scope, not production security certification. Cloud deployment remains deferred.
