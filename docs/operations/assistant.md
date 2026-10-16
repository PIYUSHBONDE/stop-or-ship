# Ask PlantSense — local text and voice

Authenticated plant users can open the floating **Ask PlantSense** panel for read-only help with the displayed plant, equipment and incident. Incident and equipment references must agree. Machine and guide routes determine their own equipment; Operators follows the selected active or historical response. Equipment-only questions do not inherit the plant's latest unrelated incident. Conversation context sent to the model is limited to the same resolved selection.

One bounded Gemini request answers each question from authoritative snapshots, retained investigation evidence, reviewed source procedures and permitted operational repair memory. The assistant does not rerun investigation agents, approve work or create repair orders. Saved cost cards use integer paise from the deterministic calculation and display its exact version. Citations are inspectable; citation existence does not establish physical correctness.

The desktop panel can expand into a modal conversation without resizing the Plant canvas; Escape first collapses expansion. Mobile uses a modal sheet. Full replies support paragraphs, bold text and bullet lists, with all other content escaped. Screen data opens an explicit source/verification disclosure, and Sources retains capture time and raw evidence. Contextual machine/response/incident links come from application context, never model URLs. These UI features do not change authorization. Normal execution defaults to Vertex and Gemini 3.8 Flash with LOW thinking. Matching investigation, assistant and case reports validate the current local release; see `docs/status.md` for observed acceptance and activation.

The conversation retains six exchanges in the mounted tab, without a permanent chat archive. Reload, sign-out or plant/incident changes clear it. Screen or equipment navigation cancels recording/playback and discards outdated answers. Closing the panel also stops voice. Validated answers and duplicate request receipts have a bounded, fifteen-minute process cache. Restart or expiry prevents replay of a billed request; ask again with a new request intent. The ledger stores usage metadata, not questions, transcripts, audio or credential contents.

### Request recovery

The assistant cache reuses a stateless model client and closes it on application shutdown. This avoids repeating service-authentication and connection setup for every question. Its 50-second assistant deadline leaves time for the 60-second proxy and 65-second browser to return a typed error. Provider failures return 503, timeouts 504 and rejected model answers 502. Invalid citations, generated currency claims and safety assurances remain rejected. Known dispatched failures offer an explicit new request with a new key and the same captured payload; ambiguous retries retain the original identity. Drafts survive failures. There are no automatic additional assistant provider calls. Scripted answers are restricted to isolated tests; ordinary API/worker startup rejects scripted mode.

## Voice

Select **Record question**, speak in English, then **Stop recording**. Capture stops after fifteen seconds. Google Speech-to-Text V2 uses global `short`, `en-IN`, with mono 16 kHz PCM WAV. Review and edit the transcript, especially equipment IDs, numbers and units, then explicitly select **Send question**. Transcription never automatically sends a question or changes plant state.

Answers appear as text before playback. Select **Play answer** to request Google Text-to-Speech `en-IN-Wavenet-A` MP3. Playback uses a validated answer reference scoped to its staff user, plant, incident and equipment. Arbitrary synthesis text is rejected. Play/Stop controls and tab-local audio caching prevent repeat synthesis. Changed configuration/calculation versions require a fresh answer. The browser requests no camera or screen sharing; microphone permission is limited to this origin.

The speech formatter prepares spoken prose separately from the displayed answer. It removes emphasis markers, list markers, backticks and link URLs; parenthetical content remains as a spoken clause. Equipment identifiers have explicit digit spacing and common units are expanded, including degrees Celsius, litres per minute and parts per hour. Server-authored SSML paragraph elements provide pauses and the speaking rate is 0.96. All answer text is XML-escaped; model-authored SSML cannot insert audio, external resources or pauses. The voice and per-character price remain unchanged. Input is limited to 3,000 spoken characters and 5,000 UTF-8 payload bytes; longer answers require a shorter explanation rather than silently losing their ending. Reservations count the complete submitted SSML, including markup. See Google's [supported SSML](https://docs.cloud.google.com/text-to-speech/docs/ssml), [input limits](https://docs.cloud.google.com/text-to-speech/quotas) and [character accounting](https://cloud.google.com/text-to-speech/pricing). Deployment status and matching reports are recorded in `docs/status.md`.

Denied microphone access, unsupported capture, silence, invalid WAV, unavailable services and exhausted allowances leave typed questions available. Audio and transcripts are sent to Google during the requested operations; PlantSense does not persist them. Provider retention and project policies remain separate from the application's local storage behavior.

The exact transcription route accepts at most 1 MiB of JSON; all other routes retain the 64 KiB request boundary. Decoded WAV duration, format, sample count and non-silence checks run before dispatch. Responses are bounded. Google calls use server-only ADC, explicit project quota headers, deadlines and no automatic speech retries.

## Allowances and estimates

Assistant questions no longer have a separate ten-question per-user daily cap. Questions and speech still share the existing sixty daily request and USD 2 daily spending limits. They do not consume investigation call counts or the USD 0.75 incident spending allowance. Reservations and ownership checks run transactionally before external dispatch; failed or unknown requests retain conservative estimated charges. Stable request keys prevent repeated billed calls across retries, cache expiry and process restarts. Removing the question cap does not delete usage records or replenish the shared allowances.

The ten-question removal was initially activated through an explicit quota-only exception. That temporary release is superseded by the fully evaluated Gemini 3.8 release. Earlier failed reports remain failed and are retained as history; the current release uses ordinary matching live gates, including independent voice checks. Global call and spending limits remain unchanged.

The current ignored local restart helper is `.runtime/start_live_ai.ps1`, run from the repository root in separate terminals with `-Role api`, `-Role assistant` and `-Role worker`, after checking ports and stopping their previous processes. It verifies all three matching release reports before startup. The frontend retains `ASSISTANT_API_BASE_URL=http://127.0.0.1:8004` and ordinary `API_BASE_URL=http://127.0.0.1:8002`. Both browser hostnames, `127.0.0.1:3002` and `localhost:3002`, are allowed. The older `.runtime/start_quota_assistant.ps1` and frozen release remain a local assistant rollback option only; never extend its exception to new code. No database restoration or usage deletion is needed to change the serving assistant release.

Reviewed standard estimates are [USD 0.016 per transcription minute](https://cloud.google.com/speech-to-text/pricing), rounded to whole seconds, and [USD 4 per million WaveNet synthesis characters](https://cloud.google.com/text-to-speech/pricing). Free tiers, credits and discounts are not assumed. Text token estimates use the existing model prices. These are estimates, not provider invoices.

## Evaluate and activate locally

Enable `speech.googleapis.com` and `texttospeech.googleapis.com` in the existing project, with billing and appropriate ADC permissions. The APIs were enabled during local acceptance; enabling an API does not deploy the application. The gcloud CLI's active account and ADC are separate identities. Do not print ADC or bearer tokens.

From the repository root:

```powershell
$env:PYTHONPATH='backend'
$env:PLANTSENSE_AI_PROVIDER='vertex'
$env:GOOGLE_CLOUD_PROJECT='project-970d28ee-835b-4ca2-866'
.venv/Scripts/python.exe backend/scripts/evaluation/evaluate_gemini.py --output .runtime/gemini-assistant-investigation-evaluation.json
.venv/Scripts/python.exe backend/scripts/evaluation/evaluate_assistant.py --output .runtime/assistant-evaluation.json --audio .runtime/assistant-voice-fixture-v3.wav
```

The WAV argument is a labelled local speech fixture, not a recorded industrial validation dataset. Acceptance used the spoken phrase “Pump P one zero seven pressure one hundred twenty five bar temperature sixty degrees Celsius.” Obtain an equivalent mono 16 kHz WAV before repeating this command. Reports, fixture audio, MP3 output and evaluation databases stay ignored in `.runtime`.

The existing five-case investigation report and separate six-case assistant report must both match the backend fingerprint, provider and model. Voice additionally requires its own passing speech checks. Evaluation tooling can recheck speech alone with `--voice-only`; it preserves a matching passed text report and retains prior voice attempts. Never mark a failed report passing manually.

For a complete investigation report with transient failed cases, `evaluate_gemini.py --output <report> --retry-failed` reruns only failed cases under the same fingerprint/provider/model, retains prior attempts and checks all five final case results. It refuses stale or partial reports. This evaluation command does not add production model retries or relax validation.

After checks and an integrity-checked main database backup:

```powershell
$env:PLANTSENSE_ADC_FILE=Join-Path $env:APPDATA 'gcloud/application_default_credentials.json'
$env:PLANTSENSE_AI_EVALUATION_HOST_FILE=Join-Path (Get-Location) '.runtime/gemini-assistant-investigation-evaluation.json'
$env:PLANTSENSE_ASSISTANT_EVALUATION_HOST_FILE=Join-Path (Get-Location) '.runtime/assistant-evaluation.json'
docker compose -f compose.yaml -f compose.gemini.yaml -f compose.assistant.yaml up --build --wait
.venv/Scripts/python.exe scripts/check_containers.py
```

Both reports and ADC mount read-only. Base Compose remains explicitly scripted and has no voice activation report. Use separate Compose projects/ports and database volumes for browser acceptance. Explicit live browser acceptance runs from `web` with `npm.cmd exec -- playwright test tests/live/assistant.spec.ts`; it is outside normal scripted test discovery. Keep acceptance fixtures out of the main staff database.

## Observed limitations

Clear continuous Indian-English synthetic speech preserved P-107, 125 bar and 60 degrees Celsius in evaluation. Two earlier desktop synthetic fixtures lost identifiers or numbers, including a transcription of 125 bar as 25 bar. Passing one clear fixture does not establish noisy-site, accent or identifier accuracy. Transcript correction and explicit sending remain required. No autonomous workflow actions, avatar, industrial diagnostic accuracy or cloud application deployment are claimed. See [observed acceptance](../status.md).

## Synthetic screen context

Questions include a captured browser simulation snapshot: at most 36 assets, eight readings per asset, five active assignments and ten recent cases. Selected, assigned and affected equipment take priority within the bound. Assignments include the synthetic operator name, craft and experience. Machine modes and current simulated time, phase, pause/speed, affected equipment and line output/capacity are exposed through a separate process citation. The server checks plant membership, asset IDs and line ownership but does not attest browser values. Operational cost cards remain server-owned; synthetic cases never grant repair authorization.

The Operators screen is supported. Failed-question retries reuse the exact captured body and key. Changed fingerprints require fresh live evaluation reports. Scripted context tests do not establish live grounding or injection resistance.

## Case dossier context

Operational incident requests exclude browser simulation. Saved synthetic case evidence has a separate citation from current screen readings; the server validates selected case/equipment, affected asset IDs and line ownership. Detection facts remain historical even after readings recover. Scenario timers do not confirm a physical cause or operational repair. The six-case text gate includes a synthetic-case/injected-note fixture. Run investigator and assistant evaluations sequentially to avoid competing for provider quota.
