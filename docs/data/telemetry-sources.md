# Plant observations and historical imports

The normal application requires named staff access and never generates plant measurements. Existing replay adapters are reserved for internal regression tests. Neither a dataset import nor a staff-submitted file establishes a live hardware connection.

## Configure and review

Open **Monitor → Add source** as an administrator. Choose configured equipment and either operational observations or historical dataset imports. Review required signals, units, lower/upper operating limits and a maintenance procedure. Optional **Require stop on breach** makes an explicitly reviewed envelope a latched authorization constraint. No default 85 °C limit or demo procedure is applied to operational equipment.

Without reviewed limits, observations may be displayed but cannot assert healthy equipment, create automatic operational diagnoses or verify repairs. Equipment profiles currently support pump, cooler, press valve and motor bearing investigation; other equipment can supply observations and production measurements.

Only one operational source is allowed per asset. Source identity and equipment mapping cannot change; configuration revisions are retained with reviewer and timestamp. Changing a source invalidates previous authorization, clears its persistent-window context and requires a new complete observation. Historical sources can coexist with an operational source.

## CSV contract

Download the template from Monitor. Exact columns:

```text
asset_id,record_id,window_start,observed_at,signal_id,value,unit,std,p95
```

Each row is one signal. Rows with the same record ID form one window and must share timestamps. `std` and `p95` are optional original cycle features in the signal's unit. Use one source's equipment ID throughout a batch; no arbitrary column or unit conversion occurs.

- Maximum ten windows / 320 signal rows / 50,000 UTF-8 file bytes per preview; the API retains its 64 KiB total request boundary. Submit larger files as sequential batches.
- Values must be finite; IDs, units, unique signals and configured required signals are validated. Supported hydraulic units are bar, L/min, °C, W, mm/s, %, kW; bearing acceleration remains in `source units`, dimensionless features and Hz. Production output uses parts/h.
- Preview is read-only. Confirmation binds the normalized batch checksum and source revision, with a stable retry key. Conflicting duplicate record IDs reject the entire batch. Exact duplicate records do not advance detection or recovery.
- Original observation data, record IDs, checksums, source revision, attribution, transformations and receipt times are retained. Source records can be paged through the authenticated records API.
- Historical acquisition timestamps may be blank. Import time is not substituted for acquisition time. Example files contain explicitly authored illustrative values, not measured data.

Operational windows require offset-aware start/end timestamps exactly 60 seconds apart. Their end must be within 180 seconds of server time and no more than 30 seconds ahead. Overlapping/reordered windows are rejected atomically. Gaps break consecutive-window detection and verification. Source health expires after 180 seconds even with no browser open; polling never advances observations.

## Dataset conversion

Prepare the existing attributed artifacts using the repository's dataset preparation scripts, then export without running a scenario:

```powershell
$env:PYTHONPATH='backend'
.venv/Scripts/python.exe backend/scripts/data/convert_telemetry.py backend/data/artifacts/replay.json .runtime/hydraulic-import --asset-id P-107 --profile pump
.venv/Scripts/python.exe backend/scripts/data/convert_telemetry.py backend/data/artifacts/bearing-replay.json .runtime/bearing-import --asset-id M-107 --profile bearing
```

Unix: `PYTHONPATH=backend .venv/bin/python backend/scripts/data/convert_telemetry.py ...`. Keep exported batches in ignored `.runtime/` directories. Copy the manifest's dataset identity and transformation description into source configuration, alongside the original dataset attribution. Prepared selections are analysis order, not a reconstructed plant timeline.

Compatible UCI records with all required mean/std/p95 features use the existing trusted detector artifact. Compatible IMS features use its prepared baseline. Missing artifacts/features show unavailable model analysis; there is no generated fallback. Reviewed historical envelopes may provide separate limit-based analysis. These dataset models are not calibrated plant baselines.

## Workflow and API

Staff-cookie authenticated `/api/v1/plants/{id}/sources` reads/creates sources; POST `/{source_id}` saves an expected revision. POST `/{source_id}/observations` accepts up to ten operational windows. It requires `expected_version`, `windows` and `Idempotency-Key`; each window has `record_id`, `window_start`, `observed_at` and signal `values`. Import preview/commit lives at `/{source_id}/imports/{preview|commit}`; commit additionally requires `preview_checksum` and `Idempotency-Key`. GET `/{source_id}/records` provides bounded history. All actions are plant-scoped and permission checked inside write transactions.

Three consecutive complete abnormal windows create one incident and dispatch the bounded investigator. Three dispatches per plant per UTC day are allowed; excess cases retain evidence as incomplete investigations. Current AI remains explicitly scripted. Configured production/economic estimates are separate from measured output and live inventory.

Historical imports support evidence inspection and comparisons but cannot authorize operational work, verify current repairs or enter operational memory. Legacy replay cases remain read-only, preserving original evidence and approvals.

Operational approval requires current complete data, reviewed limits/procedure and the exact calculation version. Deferred eligibility is recorded in UTC, not advanced by file submission. Work authorization does not operate equipment or attest physical isolation. Technician completion records the repair and waits for incoming data: three distinct complete healthy windows starting after completion are required. Stale, missing, abnormal or incomplete observations cannot confirm recovery.

## Local boundaries

SQLite and staff cookies remain the local persistence/identity implementation. PLC/historian connectors, service credentials, distributed durable dispatch, cloud identity/storage, live Gemini evaluation and plant-specific model validation remain later gates. Raw high-frequency acquisition and arbitrary CSV mapping are not implemented.
