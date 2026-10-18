# Local Gemini investigation

The normal Compose stack defaults to the explicitly scripted investigator. Live Vertex execution uses local SQLite and an explicit runtime override. It does not deploy cloud services or give the model control over approvals, source configuration, repair execution or verification.

## Evidence and authority

The worker executes a bounded read-only evidence plan: recent telemetry and baseline context, versioned dependencies and production impact, reviewed source procedure and permitted reference documents, plant-scoped verified repairs, and the deterministic calculation. Operational envelope midpoints are labelled configured reference values, not measured healthy baselines. Inventory without an adapter remains unknown. Reference procedures retain their original synthetic or public-data provenance.

The investigator receives this frozen evidence snapshot and returns a validated structured result. The evidence reviewer checks support before Reliability and Production receive separate copies of the same reviewed facts and calculation. Specialist calls are serialized: a local provider probe reproduced a timeout for one concurrent request while both serial requests completed. This observation does not establish the provider's internal cause. Specialist preferences remain advisory. Unavailable reviewers lower confidence and add an explicit limitation; partial specialist explanations are omitted. The calculation version considered by the specialists stays attached to their result.

Documents, questions and technician notes remain untrusted data. Model outputs cannot introduce evidence identities, impersonate both specialists, generate currency narratives (including paise), or assert safety assurance. A single supplied signal or sensor disagreement forces low confidence and independent inspection. Historical-origin analysis also enforces low confidence and an explicit warning that history does not establish current plant condition or authorize work. Citation validation establishes identity, not scientific validity. Verified history is context, not proof of the current fault.

Approval, role permissions, ownership, idempotency and historical-origin restrictions remain in the existing transactional workflow. The model never issues work orders. Operational recovery still needs three qualifying observations after technician completion.

## Bounds and accounting

Each incident retains at most eight model reservations across its two attempts. Live investigation has one 120-second overall deadline and a 135-second claim lease; scripted investigation retains its 60-second deadline. The investigator has at most five calls and a 60-second stage bound; the current server evidence plan normally needs one investigator call. Reviewer and specialist requests have 45-second stage bounds within the remaining overall deadline. A transient timeout or retryable provider status permits one stage retry, charged separately against the same eight-call and spending allowances. Schema, citation, permission and quota failures do not receive that retry. HTTP calls use a 45-second timeout and one SDK attempt; SDK automatic function calling is disabled. Output limits are 2,400 tokens for investigation and 600 for each review. Request context is capped at 48,000 UTF-8 bytes including a framing allowance. These bounds account for the real-response latency observed during local evaluation; they do not guarantee provider availability.

Default limits are sixty requests and **2,000,000 micro-USD (USD 2)** per UTC day, plus **750,000 micro-USD (USD 0.75)** per incident. SQLite reserves estimated spending transactionally before requests. The incident allowance survives retries, restarts and day boundaries. Observed prompt, response and reasoning tokens settle reservations; unknown usage retains the conservative charge. Reset and expired or replaced claims cannot reserve another request. Metering an issued request cannot overwrite a newer workflow claim. No prompts or credentials are stored in the usage ledger.

The model-usage panel shows token counts and estimated USD model costs separately from intervention costs in integer INR paise. Estimates assume standard global text pricing, no cache discounts, and reasoning at the output rate. They are not invoices or a provider-enforced billing ceiling. Provider tokenization, pricing changes and requests interrupted after dispatch remain estimation limits. Review rate settings before changing model or region.

## Evaluation and local activation

Use existing local Application Default Credentials. Renew them locally when needed; never paste credentials into chat or commit them. Set the intended quota project through the Google Cloud CLI.

```powershell
$env:PYTHONPATH = 'backend'
$env:PLANTSENSE_MODE = 'local'
$env:PLANTSENSE_AI_PROVIDER = 'vertex'
$env:GOOGLE_CLOUD_PROJECT = 'project-970d28ee-835b-4ca2-866'
.venv/Scripts/python.exe backend/scripts/evaluation/evaluate_gemini.py --output .runtime/gemini-evaluation.json
```

Evaluation creates its own database and never approves work. Five real-response cases cover sensor disagreement, historical origin, malicious text in verified repair context, a hard constraint and a sparse operational observation source. The fixtures include authored values and attributed replay; they do not establish physical plant performance. `--case <name>` diagnoses one fixture; a partial run cannot open the gate.

The local report must pass all five cases, contain observed provider usage for the investigator, reviewer and both specialists, account for every request, and match the evaluated implementation, provider, model and region. Failed requests retain explicit unknown usage and conservative charges, including requests preceding a successful bounded retry. Changes during a run invalidate its report. A stale, missing or failed report blocks model-client creation. The local report is a developer-controlled release artifact, not a tamper-proof attestation. Re-evaluate changed backend evidence, workflow or AI code. Reports and databases remain ignored runtime artifacts.

For native execution, set `PLANTSENSE_AI_EVALUATION_FILE` to the passing report's absolute path before starting the API. To use the local Docker override:

```powershell
$env:PLANTSENSE_ADC_FILE = Join-Path $env:APPDATA 'gcloud/application_default_credentials.json'
$env:PLANTSENSE_AI_EVALUATION_HOST_FILE = (Resolve-Path .runtime/gemini-evaluation.json).Path
docker compose -f compose.yaml -f compose.gemini.yaml up --build --wait
```

The override mounts ADC and the report read-only at runtime. Neither enters the build image. Use a separate Compose project and port for acceptance writes; the ordinary project preserves the existing named staff data volume. Return to the scripted default with `docker compose up --wait`. Never delete the data volume to switch providers.

## Reviewed primary sources

Reviewed on 9 October 2026: the [Google Gemini 3.5 Flash guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-5-flash) supports the selected stable model, `thinking_level` and GenerateContent, and deprecates sampling parameters. The [structured output guide](https://ai.google.dev/gemini-api/docs/structured-output) requires application-side semantic checks. ADK output schemas and callbacks use the locked `google-adk==2.11.0` and `google-genai==2.28.0` interfaces. [Standard global pricing](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing) supplies the default USD 1.50 input and USD 9.00 output rates per million tokens, including reasoning output. No cloud deployment or cloud storage validation is claimed.
