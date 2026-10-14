# Ask PlantSense — local text and voice

Authenticated plant users can open **Ask PlantSense** in the application header. The panel provides read-only help for the displayed plant, equipment and incident. Incident and equipment references must agree. Equipment-only questions do not inherit the plant's latest unrelated incident.

One bounded Gemini request answers each question from authoritative snapshots, retained investigation evidence, reviewed source procedures and permitted operational repair memory. The assistant does not rerun investigation agents, approve work or create repair orders. Saved cost cards use integer paise from the deterministic calculation and display its exact version. Citations are inspectable; citation existence does not establish physical correctness.

The conversation retains six exchanges in the mounted tab, without a permanent chat archive. Reload, sign-out or plant/incident changes clear it. Screen or equipment navigation cancels recording/playback and discards outdated answers. Closing the panel also stops voice. Validated answers and duplicate request receipts have a bounded, fifteen-minute process cache. Restart or expiry prevents replay of a billed request; ask again with a new request intent. The ledger stores usage metadata, not questions, transcripts, audio or credential contents.

## Voice

Select **Record question**, speak in English, then **Stop recording**. Capture stops after fifteen seconds. Google Speech-to-Text V2 uses global `short`, `en-IN`, with mono 16 kHz PCM WAV. Review and edit the transcript, especially equipment IDs, numbers and units, then explicitly select **Send question**. Transcription never automatically sends a question or changes plant state.

Answers appear as text before playback. Select **Play answer** to request Google Text-to-Speech `en-IN-Wavenet-A` MP3. Playback uses a validated answer reference scoped to its staff user, plant, incident and equipment. Arbitrary synthesis text is rejected. Play/Stop controls and tab-local audio caching prevent repeat synthesis. Changed configuration/calculation versions require a fresh answer. The browser requests no camera or screen sharing; microphone permission is limited to this origin.

Denied microphone access, unsupported capture, silence, invalid WAV, unavailable services and exhausted allowances leave typed questions available. Audio and transcripts are sent to Google during the requested operations; PlantSense does not persist them. Provider retention and project policies remain separate from the application's local storage behavior.

The exact transcription route accepts at most 1 MiB of JSON; all other routes retain the 64 KiB request boundary. Decoded WAV duration, format, sample count and non-silence checks run before dispatch. Responses are bounded. Google calls use server-only ADC, explicit project quota headers, deadlines and no automatic speech retries.

## Allowances and estimates

Questions are limited to ten per staff user per UTC day across plants. Questions and speech share the existing sixty daily request and USD 2 daily spending limits. They do not consume investigation call counts or the USD 0.75 incident spending allowance. Reservations and ownership checks run transactionally before external dispatch; failed or unknown requests retain conservative estimated charges. Stable request keys prevent repeated billed calls across retries, cache expiry and process restarts.

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

The existing five-case investigation report and separate five-case assistant report must both match the backend fingerprint, provider and model. Voice additionally requires its own passing speech checks. Evaluation tooling can recheck speech alone with `--voice-only`; it preserves a matching passed text report and retains prior voice attempts. Never mark a failed report passing manually.

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

Questions include a captured browser simulation snapshot: at most 36 assets, eight readings per asset, five active assignments and ten recent cases. Selected synthetic cases are included. The server checks plant membership and asset IDs but does not attest browser values. Inspect the separate simulated-plant citation. Operational cost cards remain server-owned; synthetic cases never grant repair authorization.

The Operators screen is supported. Failed-question retries reuse the exact captured body and key. Changed fingerprints require fresh live evaluation reports. Scripted context tests do not establish live grounding or injection resistance.
