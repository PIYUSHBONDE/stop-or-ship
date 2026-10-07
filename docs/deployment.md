# Google Cloud deployment

Cloud deployment has not been executed: the workstation has a configured project but no active `gcloud` account. Existing application-default credentials were also checked and failed to refresh (`RefreshError`). Docker Engine is also not running; Cloud Build can build images without a local Docker daemon.

## Prerequisites

1. Select the intended hackathon Google Cloud project with billing enabled. The deployment script always receives an explicit project; it does not assume the workstation's configured project is the intended one.
2. Authenticate with `gcloud auth login` and `gcloud auth application-default login`.
3. Add Firebase to that project, register a web app, and enable **Authentication → Sign-in method → Anonymous**. Obtain its public Firebase web API key.
4. Create the default Firestore **Native** database in `us-central1` (or a compatible existing location).
5. Verify `gemini-3.5-flash` access and billing in the chosen project. The model is configurable; changing it requires rerunning the live evaluation.
6. Ensure the build identity can build and push images: Cloud Build execution, Artifact Registry writer, Logs writer, and source-bucket access as required by that project's Cloud Build configuration. The deploying identity needs permission to provision the services and act as the service accounts.

Use dedicated service accounts. Do not commit service-account keys. Application-default credentials and Cloud Run service-account identity supply model/storage access. There is no secret Gemini key in the browser.

## Prepare and provision

From the repository root, prepare the dataset and run all local validation. Install the Firebase CLI in the project environment or invoke it through `npx firebase-tools`; then deploy `firebase.json`'s deny rules and indexes:

```powershell
npx.cmd firebase-tools deploy --only firestore --project YOUR_PROJECT_ID
```

This creates the 768-dimensional knowledge vector index and excludes bulky session payloads from indexing. Wait for the vector index to finish building.

With application-default credentials, seed the knowledge pack:

```powershell
$env:GOOGLE_CLOUD_PROJECT = 'YOUR_PROJECT_ID'
$env:GOOGLE_CLOUD_LOCATION = 'global'
Push-Location backend
..\.venv\Scripts\python.exe scripts/index_knowledge.py
Pop-Location
```

Archive the prepared data and source documents in a private bucket (replace the globally unique bucket name):

```powershell
gcloud storage buckets create gs://YOUR_PROJECT_ID-plantsense-data --location=us-central1 --uniform-bucket-level-access --public-access-prevention
gcloud storage cp backend/data/artifacts/replay.json backend/data/artifacts/detector.pkl backend/data/artifacts/detection-evaluation.json backend/data/knowledge.json gs://YOUR_PROJECT_ID-plantsense-data/
```

The runtime uses the versioned artifacts bundled into the backend image. The bucket is their source archive; this release does not hot-load arbitrary remote models.

Build and deploy the API, private worker and web services:

```powershell
.\infra\deploy.ps1 -Project YOUR_PROJECT_ID -FirebaseApiKey YOUR_PUBLIC_FIREBASE_WEB_KEY
```

The script provisions dedicated API/worker/task accounts, the task queue, and narrowly scoped task invocation. It limits services to zero minimum and two maximum instances. Image builds use the committed Python and npm locks. Firebase web configuration is supplied at build time; backend settings are runtime environment variables.

## Spending notifications

Enable `billingbudgets.googleapis.com`. With an account that can manage budgets, configure project-filtered notifications:

```powershell
.\.venv\Scripts\python.exe backend/scripts/create_budget.py --billing-account YOUR_BILLING_ACCOUNT_ID --project-number YOUR_PROJECT_NUMBER --currency INR --amount 5000
```

For an INR billing account this creates alerts at INR 1,000, 2,500, 4,000 and 5,000. For another billing currency, pass the appropriate currency and the separately verified equivalent amount; do not send INR to a non-INR account.

**Budget notifications do not stop spending.** The application also caps model/embedding calls at 60 per UTC day, three investigations and five questions per session, and bounded model output. Reset retains quotas. These controls do not cap all Firebase, build, hosting, or database charges. Monitor actual billing and lower the daily allowance if needed.

## Live acceptance gate

- Public web link opens without a form and restores the same anonymous session on refresh.
- Another browser identity cannot read or mutate that session.
- Direct unauthenticated worker calls fail at Cloud Run IAM; the API cannot expose the worker route.
- The incident triggers real ADK tool calls, model output passes schema/citation checks, and retrieved sources are visible.
- A timeout, exhausted quota, or unavailable index produces an incomplete investigation with retained evidence.
- Run the full approval/repair/memory flow five times with the deployed model; record latency and actual usage.
- Evaluate ambiguous sensor, unsupported-citation, missing-source and misleading-document scenarios against the live model before claiming cloud release readiness.
- Test the real demo laptop for five-second usability and 30 FPS; software-rendered browser measurements are not a GPU performance guarantee.

Record the final URL, image digests, model ID, test results, and budget status in `docs/status.md`. No public deployment link should be claimed until these checks pass.
