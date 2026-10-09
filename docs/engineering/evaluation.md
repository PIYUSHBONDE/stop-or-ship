# Evaluation and claim boundaries

## Operational product foundation — 9 October 2026

Normal use now requires staff access and explicit plant selection. Equipment without current operational observations remains unknown. Historical imports and retained legacy cases cannot authorize current work or establish current equipment health. Model evaluation below describes historical datasets; it does not calibrate operational envelopes.

The current backend suite covers additive migration with populated accounts/history, read-only import preview, source permissions/versioning, immutable observation records, duplicate and stale/reordered submissions, reviewed constraints/procedures, authorization invalidation and post-repair verification. Five successive operational workflows are tested with a controlled UTC clock and isolated databases. This is a workflow test, not physical equipment validation.

The operational browser suite replaces the retired replay UI checks. Twenty-eight replay-dependent browser tests are explicitly skipped because their controls no longer exist; they are not reported as passing product checks. The active checks cover staff-only entry, 36 unknown assets, separate measured/rated/estimated output, historical preview/confirmation, citation details and focus return, narrow screens, dirty risk edits, refresh, approval, technician completion and three incoming 60-second post-repair windows. Final observed counts and durations are recorded in `docs/status.md`.

Dataset conversion was exercised against prepared artifacts: 19 UCI hydraulic records and 18 IMS records passed the strict CSV parser and compatible historical analysis. Original record IDs and features are retained; acquisition timestamps remain missing. This is a converter smoke check, not an independent detector evaluation.

Live hardware ingestion, live Gemini quality, distributed deployment and plant model accuracy remain unverified. Source connections currently mean authenticated submitted observations or imported files. See [telemetry source boundaries](../data/telemetry-sources.md).

## Measured data

The preparation script validates 2,205 complete cycles, sensor shapes, finite values, component labels, and the stable-condition flag. There are 1,449 stable cycles, only ten fully healthy stable cycles, and twenty stable isolated pump-fault cycles with the other components nominal.

A naive global chronological split contains no fully healthy training cycles. The implemented split preserves chronology within condition regimes and purges immediately adjacent cycles between partitions. Exact duplicate feature vectors are excluded. Six healthy cycles fit the baseline/scaler/detector. One distinct healthy validation cycle selects the anomaly threshold, with no training or test overlap. One calibration cycle is far too small to establish a robust healthy envelope; that limitation is explicit in the preparation report.

The persisted report is `backend/data/artifacts/detection-evaluation.json`. Its test subset has only 38 cycles: **one healthy and 37 abnormal**. With the expanded 27-feature detector, precision is 0.973684 and recall is 1.0, with confusion matrix `[[0,1],[0,37]]`. The only healthy held-out cycle is a false positive; false-alarm performance is therefore especially weak and cannot support a reliability claim. Those figures do not establish industrial accuracy, generalization, robust false-alarm performance, or time-to-failure prediction.

Replay examples are selected separately from model evaluation. Three-window incident persistence is a controlled replay property, not a measured real-world detection delay. All financial inputs and failure probabilities are synthetic configured assumptions.

## Software acceptance

Backend tests cover authenticated ownership, staff permissions, illegal transitions, schema validation, stale approvals, idempotent retries, shared cost arithmetic, hard constraints, superseded workers, sensor uncertainty, rejection/reopening, failed recovery, concurrent cases and confirmed-case retrieval. Configuration coverage includes graph validation, immutable revisions, stale/concurrent activation, configured equipment mapping, historical topology, consistent capacity rounding and scheduler write guards. Older browser results below describe the retired replay interface. Current operational results and environment limits are recorded in `docs/status.md`.

Run instructions are in `README.md`. Browser results are emitted to `web/test-results/results.json`; preview artifacts are in `docs/artifacts/`. Final observed validation results are recorded in `docs/status.md`.

## Rendering performance

The dedicated v2 scene uses instancing and automatic quality reduction. Production controls became usable in 482–486 ms after API readiness at 1600 × 1050. Two isolated five-second samples measured approximately 13.5 and 19.6 animation-frame callbacks per second. Both used SwiftShader software rendering, including Chromium with default launch options. This does not establish hardware GPU performance or satisfy the 30 FPS target. Re-run on the demo laptop with a hardware renderer and record the actual WebGL renderer.

The reproducible preview script is `web/scripts/capture-preview.mjs`; pass `--default-renderer` to avoid requesting SwiftShader explicitly. Its report records requested renderer, actual renderer when available, viewport and canvas dimensions.

## AI evaluation

The local investigator is scripted and its output is labelled in the UI. Local tests verify workflow and validation behaviour; they do not establish Gemini diagnostic accuracy or prompt-injection resistance.

Cloud-mode ADK configuration and Google SDK imports are checked locally. Actual model access, semantic retrieval, tool sequencing, grounding, abstention, retry behaviour, and diagnosis quality require cloud credentials and a live evaluation.

Before submission, record for each live scenario: ground-truth fault family, selected evidence IDs, ranked hypotheses, missing evidence, tool count, model ID, latency, citation support, and outcome. Evaluate known fault, conflicting sensors, insufficient evidence, absent sources, misleading retrieved instructions, and API/model failure. Keep model evaluation separate from the conventional detector report.

## IMS bearing replay

The reviewed second experiment has 984 four-channel snapshots. The prepared subset uses channel one, 20,480 samples at 20 kHz per record: 18 early records for reference, six distinct following records for the threshold, six following early replay candidates and twelve late replay candidates. RMS, kurtosis, crest factor and spectral centroid are extracted from complete snapshots. Checksums and IDs are retained in `bearing-report.json` and `bearing-replay.json`.

All selected records belong to one experiment. There is no independent-experiment test set, bearing classification score, calibrated failure probability or time-to-failure estimate. The endpoint outer-race failure annotation is not a fault label for every record. Early/late replay selection illustrates changing evidence; subsequent healthy replay illustrates verification and does not establish an observed repair effect. Source acceleration amplitude units are unspecified in the bundled README and are not converted to g or velocity.

The software suite now covers the equipment-specific approval-to-recovery loops, recurrence on each profile, archived case ownership, stale incident actions, failed-repair continuation and independent specialist failures. Specialist tests inject controlled model responses; they verify orchestration and validation, not actual Gemini behaviour.

## Previous coordinated replay acceptance

The 9 October coordinated monitoring release passed 86 backend tests and 33 browser checks. A subsequent focused browser check also passed with 36 configured assets, aligned monitoring, missing-data blocking, approved repair and verified memory. These are software acceptance results using prepared replay and generated context, not real plant classification or failure-probability validation. See `docs/status.md` for exact runs and the retrieval defect found and repaired during acceptance.

The eight-line template uses 36 example assets and configured nominal capacities. Historical sources retain their original measured record IDs, values and units. Reusing the same dataset on another asset does not provide an independent measured equipment population or evidence of transfer accuracy. Previously generated supporting signals are absent from the operational product.

Affected production is traced through validated dependency reachability. Percentage restrictions and delivery commitments scale from reviewed reference assumptions; these are deterministic operational models rather than validated physics. Dependency fractions do not implement general fractional flow, and per-incident comparisons do not solve joint repair scheduling. Legacy replay clocks are paused and their interfaces disabled by default. Hardware GPU performance for the expanded scene and live-model grounding on custom configurations remain unverified.
