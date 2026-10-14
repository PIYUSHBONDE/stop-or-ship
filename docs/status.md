# Implementation status

## Connected Plant simulator — 14 October 2026

The default Plant page now presents a hydraulic-forming reference factory using the configured layout and dependencies. It includes a simulation clock, production summary, line output, 3D/2D floor, equipment browser, unified inspector and activity timeline. Detailed readings are selected/hovered rather than cycling over unrelated equipment. The separate `?view=observations` page retains the operational inspector and source/authorization behavior without synthetic overlays.

A deterministic browser process model replaces recurring arbitrary OOC generation. A pump-pressure-loss scenario develops over eight simulated seconds, derates only its downstream production line, dispatches an operator, stops output for inspection/repair, checks recovery for thirty simulated seconds, restores output and returns the operator to station. Motor idle, running, degraded, stopped, under-repair and recovering states share the same model as readings and production. Only the primary pressure fault dispatches; dependent symptoms do not create unrelated jobs. Repair and recovery timestamps are separate, and reduced-motion settings preserve lifecycle timing.

Pause/resume, 1x/10x speed, pump selection and repeatable fault/reset controls run through the existing plant-scoped simulation owner. Web Locks keep one writer; BroadcastChannel commands receive acknowledgements or a visible timeout. Reset retains samples/cases and marks interrupted work. Old completed records remain; unfinished pre-process dispatch becomes interrupted history. Samples and cases retain their existing bounds and IDs remain monotonic. Activity events retain unique sequence IDs when virtual time is paused.

### Observed acceptance

- **21 frontend unit checks passed in 2.2 seconds**. New coverage verifies stable healthy operation, paused time, scheduled/explicit faults, dependency-based isolation, line shutdown, repair, recovery before case closure, and bounded activity IDs. Existing selection, timestamp, ledger migration, malformed storage and dispatch checks remain passing.
- **All 19 browser checks passed in one 5.3-minute run** against the production build on ports 3002/8002 with ignored `.runtime/statistics-integration/plant-process.db`. This includes the complete pressure-loss journey, independent-line output, cross-tab pause/resume, pause across refresh, reset/record retention, unique subsequent fault IDs, assistant/voice doubles, storage failures, unknown operational data, historical provenance, dirty decisions, authorized repair, three actual operational recovery windows, verified memory and WebGL/keyboard fallback.
- The connected-plant browser check compared backend incidents, sources and measured output before and after simulation and observed no simulation writes. The expanded 36-asset operational test now explicitly selects the operational view. A prior isolated two-check Plant journey run also passed in 46.8 seconds.
- Prettier, ESLint, explicit TypeScript checks, native production build, Ruff lint/format, and read-only OpenAPI/TypeScript drift checks passed. Backend code, contracts and lockfiles are unchanged, so backend unit tests were not rerun for this frontend-only iteration. One old ledger assertion was updated to account for recovery finishing thirty simulated seconds after repair completion.
- Desktop repair/restored-output and 430px mobile screenshots were visually inspected. The floor no longer duplicates a permanently pinned reading card; the mobile header hides the redundant operational badge. No private-key/provider-token patterns matched the inspected new/changed feature sources; this is not a security audit.

### Review and limits

A separate two-line review plant is running at **http://127.0.0.1:3002/**, backed by ignored `.runtime/statistics-integration/plant-review-v1.db` on API port 8002. It uses the documented product-test account and scripted AI. Acceptance records are retained in their separate database. Main staff data received no writes. Stop the standalone frontend before rebuilding; inspect occupied ports before starting other servers.

This first slice supports one pump-pressure-loss scenario at a time and requires a configured pump-to-press dependency path. Readings, output derating, repair durations and recovery are authored demonstration assumptions, not calibrated hydraulic physics or material-inventory modeling. Browser persistence remains origin-local. No continuous samples are invented for closed tabs. Live Gemini/voice evaluation, hardware acquisition, cloud deployment and other equipment fault families remain outside this iteration. Nothing was pushed or deployed to cloud.

## Simulation assignment and completion fixes — 14 October 2026

Completed-assignment deep links now resolve the requested historical assignment before falling back to the first active job. Explicit active selection and default active-job behavior remain unchanged.

New and unfinished synthetic cases now record completion at the end of the repair phases, before the operator returns to station. Reopening after elapsed simulated work uses the original timeline completion time rather than the reopening time. Already completed records retain their saved timestamps; this patch does not rewrite historical records.

### Observed acceptance

- **19 frontend unit checks passed in 2.7 seconds**. Two focused regressions also passed in 1.5 seconds after adding an explicit 161,000 ms high-severity completion assertion. Coverage includes historical selection alongside an active job, completion while returning, reopening after a day and preservation of existing completed timestamps.
- **Two isolated production-browser regressions passed in 37.0 seconds**. An authored elapsed assignment retained its exact timeline completion through refresh and remained selected when a new active job appeared. Existing simulation navigation, refresh and cross-tab handoff also passed.
- Prettier, ESLint, TypeScript and the native production build passed. No backend or API contracts changed, so backend tests were not rerun for this frontend-only patch.
- Acceptance used ports 3002/8002 and the separate ignored `.runtime/statistics-integration/dispatch-fixes.db`. Test servers are stopped; main staff data received no acceptance writes.

Live Gemini and Google voice remain pending matching evaluation reports. This patch does not activate live providers or deploy cloud services.

## Statistics/main integration — 14 October 2026

Created `codex/statistics-main-integration` from `f_statistics` at `d05c512`. Main remains at `2de8d47`; neither existing branch was replaced. The branch retains automatic synthetic plant readings, OOC overlays, Operators navigation, machine records, incident tables, Operations redirect and guide-first Memory. Local sign-in labels now describe email/password authentication. The top bar labels the simulated plant.

Ported main's Gemini safeguards, usage quotas, contextual assistant, voice, serialized requests, authentication-test reuse and CI cache fix. Python assistant contracts now accept bounded synthetic context and the Operators screen. Ownership-checked reads validate its asset IDs; separate browser-simulation citations preserve the operational evidence boundary. The client retries the same captured body and key even while simulation advances. Source OpenAPI and generated TypeScript changed together.

A versioned plant-scoped browser record preserves the seed, tick, samples, cases, active dispatch and history. Hydration precedes writes; one Web Lock writer publishes updates to follower tabs and transfers ownership when closed. Legacy records remain retained, with unfinished legacy cases labeled interrupted and excluded from active counts. Invalid/unavailable storage or coordination falls back to clearly labeled in-memory execution. Saved elapsed assignments reconcile once; reopening does not fabricate missed samples.

### Observed acceptance

- **132 backend tests passed in 307.02 seconds**, including assistant synthetic-context ownership, bounded/finite inputs, separate citations, exact retries and no work-order side effects. Main's populated migration and workflow regressions remain included. Two upstream deprecation warnings and a Windows pytest cache permission warning remain.
- **18 frontend unit checks passed in the final 2.0-second run**, covering legacy preservation, interrupted cases, malformed storage, monotonic ticks across refresh and single completion of elapsed dispatch.
- Ruff lint/format, Prettier, ESLint, explicit TypeScript checks, read-only OpenAPI/TypeScript drift checks and the final native production build passed. Dependency lockfiles are unchanged.
- **15 full-suite browser checks passed in 4.7 minutes**, including assistant/citations/voice doubles, exact captured-request retries, source provenance, dirty decisions, authorized repair, three real recovery windows, verified memory and WebGL fallback. After final malformed-record validation and interrupted-case copy changes, **three focused simulation browser checks passed in 31.0 seconds**: navigation/refresh/cross-tab handoff, unavailable storage and invalid case metadata retained without rendering errors.
- Focused browser verification passed the assistant drawer at 430px without DOM errors and simulation navigation/refresh/cross-tab ownership. Browser diagnostics identified a Drei HTML overlay root teardown conflict when the connected event target changed. Pinning the overlay portal to the canvas parent fixed the reproduced failure; temporary DOM instrumentation was removed. An initial machine-card test used link role instead of its existing list-item role; the selector was corrected.
- The first acceptance API rejected port 3002 because its default staff origin allowlist only included port 3000. The isolated API now explicitly allows its own frontend origin; production security defaults are unchanged.

Acceptance used ports 3002/8002 with `.runtime/statistics-integration/acceptance-final.db`. It used scripted AI and speech doubles; the isolated servers are stopped. Main staff data received no acceptance writes. The 430px assistant screenshot was visually inspected. This implementation changes evaluation fingerprints: earlier main Gemini/voice reports cannot activate or validate it. Live synthetic grounding, physical accuracy, hardware acquisition and cloud execution remain unevaluated. Browser persistence is origin-local; unavailable Web Locks or storage cannot provide shared durable simulation. Local development only; no cloud deployment or push occurred.

## Plant synthetic preview overlay — current iteration

The plant explorer now generates a session-scoped synthetic preview for every asset at runtime. Hover and a 2.5-second scan show labeled preview readings above equipment. Preview metrics also compare against synthetic control limits; out-of-control cells flash on the floor. A labeled operator roster then assigns by experience and severity, walks to the cell, and clears the excursion. `/operators` monitors those assignment IDs live. `/monitoring` shows machine cards; each card opens `/monitoring/{asset}` for graphs and case history. Preview OOC cases store occurred, attended and fixed times plus the operator note and appear on `/incidents`. `/memory` is the plant guide. Operations and Maintenance are removed from the rail. Preview repairs stay on the cell for at least two minutes before they clear. Those values do not write sources, change condition, or authorize work. Unconnected equipment remains unknown.

### Observed acceptance

- Frontend unit checks cover deterministic preview generation for all equipment types, OOC envelope breaches, operator assignment by experience and severity, and per-machine preview record storage.
- Operational inspector copy still states that unconnected equipment has no current data.
- `/maintenance` again renders the authorized-repair workspace so “Open authorized work order” can reach **Start approved repair**. It stays off the rail.
- Local `scripts/validate.py --build` passed: Ruff, OpenAPI, Prettier, TypeScript, ESLint, **97** backend tests, **16** frontend unit checks, and the Next.js production build. Isolated browser acceptance was not a clean pass on this Windows host.

## Home SSO landing — completed iteration

The public home route is now a staff sign-in landing instead of an immediate workspace redirect. Google and Microsoft continue into a two-field work-email form. Initial administrator name, organization and plant are derived from the email, so those enrollment fields are no longer shown. Cloud identity providers are not connected; the local staff cookie session remains authoritative.

### Observed acceptance

- TypeScript, ESLint, Prettier and **4 frontend unit checks** passed, including email-to-identity derivation for `product-owner@example.test`.
- Playwright against the native local app at `http://127.0.0.1:3000/` showed Continue with Google/Microsoft, then Email/Password/Sign in on desktop and a 390px viewport. No anonymous demo control is present.
- Product browser acceptance was not re-run against an isolated Compose stack in this iteration.

AI remains explicitly scripted. Managed SSO is still a later identity gate.

## Operational product foundation — completed iteration

The main application now requires staff access and uses versioned observation sources and historical import preview/commit. Replay controls, anonymous demo entry, generated supporting readings and selectable post-repair recovery have been removed from product pages. Missing current data remains unknown; measured output, rated capacity and configured impact estimates are separate.

Operational observations use reviewed envelopes, immutable original records, bounded batches and server-owned quality/detection. Historical and legacy records cannot authorize work or verify operational repairs. Maintenance eligibility is UTC-based, and technician completion waits for incoming post-repair observations. Additive migration 5 pauses legacy clocks and preserves accounts, original evidence and approvals. Current AI remains explicitly scripted.

### Observed acceptance

- **97 backend tests passed in 277.14 seconds** in the final backend run, including five consecutive operational incident-to-verified-memory workflows with controlled UTC time and isolated databases. Two upstream deprecation warnings remain. Coverage includes populated migration, source permissions/versioning, bounded preview/commit, immutable records, duplicates/conflicts, incomplete/stale/reordered windows, reviewed envelope breaches, procedure gates, historical isolation, stale authorization and verification gaps.
- Ruff lint/format, TypeScript, ESLint and Prettier passed. Repeating OpenAPI and TypeScript generation left both contract hashes unchanged. Credential-pattern inspection of changed files found no matching private keys/provider tokens; this is not a complete security audit.
- Dataset converter smoke checks preserved and parsed **19 UCI hydraulic records and 18 IMS records**, in bounded batches. Compatible historical analysis was available, original features/IDs were retained and no acquisition timestamps were invented. Exports stayed in ignored runtime directories.
- Production Docker builds passed. The read-only container checker passed non-root execution, isolation/storage boundaries, health, security headers, blocked anonymous entry and unauthenticated staff access.
- **10 active browser checks passed in one final 3.5-minute run** against the production images, including staff access, 36 unknown assets, historical preview/commit, evidence units/focus return, narrow layout, dirty decisions, refresh, authorized repair, incoming post-repair windows, confirmed technician correction and WebGL failure/keyboard access. Twenty-eight retired replay UI checks were explicitly skipped; they are not counted as passes. Equipment motion is disabled in operational scenes because condition readings do not attest that equipment is running.
- Earlier browser attempts exposed an equipment-label accessibility issue and an incorrect evidence-button test selector; both were fixed. Read-only incident authorization messaging and recovery messages were corrected during final review. Screenshots of the unknown-data plant, separated production measures, 430px Monitor and confirmed correction memory were visually inspected.
- Final acceptance used `plantsense-product-acceptance-v3-20261009` on port 3002 with its own database volume. The main staff database was not used for acceptance writes. A pre-migration SQLite backup passed integrity checking and was saved in ignored `.runtime/pre-product-foundation.db`.
- Applied the tested release to the main local Docker stack on port 3000; both containers are healthy and the read-only container checks pass. The web health endpoint returns `ok`, account setup remains retained (`setup_required: false`) and migration versions 1–5 are present. Before/after counts match: one staff user, one plant, zero main-plant incidents and six audit records. Populated legacy incident preservation is covered separately in the migration test. Acceptance containers/networks were stopped without deleting their volumes.

AI remains explicitly scripted. Live hardware acquisition, live Gemini evaluation, cloud staff identity/storage, distributed dispatch and physical plant model validation remain separate release gates. See [source boundaries](data/telemetry-sources.md).


## Repository organization — current iteration

Backend modules are organized into capability packages, with stable `app.main:app` composition. Next.js routes/features live in `web/src`; shared UI, providers, clients, generated types and test fixtures have explicit homes. Maintenance and Memory no longer render through the Operations view switch. Three unused dashboard panels were removed.

Shared Python fixtures now live in `tests/support`; unit and integration suites remain discoverable. Frontend unit, product browser and archived legacy checks are separate. OpenAPI drift checks are read-only. Docker contexts, CI, Firebase/cloud paths and dataset/tool root calculations are updated. Portable checks run through `scripts/validate.py`; onboarding is documented in `CONTRIBUTING.md` and the [repository guide](engineering/repository-structure.md).

### Observed acceptance

- **97 backend tests passed in 231.15 seconds** after moving modules and extracting shared fixtures. The suite retains the five consecutive operational incident-to-verified-memory workflows. All 97 tests remain discoverable after moving operational marker registration into the test configuration hook; the source validation boundary check also passed separately.
- **3 frontend unit checks passed in 1.3 seconds**, and **7 product browser checks passed in 215.75 seconds** against isolated production containers. Archived replay UI checks are excluded from normal discovery, with zero skipped tests in this browser run. Coverage includes evidence dialogs/focus, narrow layout, staff access, unknown equipment, historical import boundaries, dirty decisions, refresh, authorized repair, incoming recovery, confirmed correction memory and WebGL fallback.
- Portable static validation passed Ruff lint/format, frontend formatting, TypeScript/route generation, ESLint and read-only contract checks. Comparing all 38 moved backend module bodies found no business-rule changes; the sole non-import difference adjusts the configuration's directory root. OpenAPI and generated TypeScript content match the previous release, and dependency lockfiles remain unchanged.
- Production Docker builds and the isolated container checker passed. The initial cold API dependency download timed out; the final API build reused the existing unchanged locked dependency layer and rebuilt the moved application source. The web production compilation passed. Windows native route generation required expanded process access and removal of stale generated route caches; those caches remain ignored.
- Relocated converters preserved **19 hydraulic and 18 bearing records** in bounded batches, with source IDs, checksums and missing acquisition timestamps retained. All tracked Markdown relative links resolve; the relocated deployment script passes PowerShell syntax parsing. No cloud commands were executed.
- The isolated acceptance project was `plantsense-structure-acceptance-20261009` on port 3002. Operations, 430px Monitor and confirmed Memory screenshots were visually inspected. Staged path/credential-pattern checks found no runtime exports, raw datasets, databases or matching private-key/provider-token patterns; this is not a complete security audit.
- The verified images are running in the main local stack on port 3000. Both services are healthy, the read-only container checker passes and account setup remains retained. Before/after counts match: one staff user, one plant, zero incidents/orders and six audit records; migration versions 1–5 are unchanged. Acceptance containers and their network were stopped without deleting the volume.

Local storage/schema, public routes, provider defaults and Compose volume identity remain unchanged by this iteration. AI remains explicitly scripted; live Gemini is the next approved implementation priority. No cloud deployment claim is made.

Earlier implementation and replay acceptance records are retained in [history](history/implementation-status.md).
