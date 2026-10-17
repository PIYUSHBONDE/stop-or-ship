# Mumbai pilot release

For routine code updates, start with the [deployment quickstart](release-quickstart.md). The initial provisioning/import commands below are not normal release steps.

Origin recovery: `python infra/gcp/pilot.py origins` updates only the API's trusted web origins from the exact HTTPS aliases recorded in Cloud Run service metadata. Both the numeric and hashed web URLs must permit sign-in. Keep external origins blocked; do not use wildcard origins or remove CSRF checks.

## Current rollout and architecture

The rollout resumed on 16 October 2026 with explicit approval for the seven service accounts, scoped permissions, private migration/report buckets and a one-concurrent-delivery queue. Consult `docs/status.md` for observed completion, image fingerprints and limitations; the preparation record below is historical.

| Component | Service and initial limit |
| --- | --- |
| Next.js web | Public Cloud Run `plantsense-web`, Mumbai, 512 MiB, min 0/max 1 |
| FastAPI API | Private Cloud Run `plantsense-api`, Mumbai, 1 GiB, min 0/max 1, concurrency 8 |
| Case/investigation worker | Private Cloud Run `plantsense-worker`, Mumbai, 1 GiB, min 0/max 1, concurrency 1 |
| PostgreSQL | Cloud SQL `plantsense-pilot`, PostgreSQL 16, single-zone `db-f1-micro`, 10 GB SSD, no automatic growth |
| Delivery/reconciliation | Cloud Tasks `plantsense-cases`, one concurrent delivery; authenticated Scheduler reconciliation every minute |
| Secrets | Secret Manager, Mumbai replicas, separate migration/application/read-only evidence DSNs |
| Migration backups/evaluation | Private Mumbai buckets; evaluations are optional for prototype deploys |
| Builds/images | Cloud Build and Artifact Registry in Mumbai; restricted submitter and executor identities |
| Models/voice | Vertex Gemini 3.8 Flash global; Google Speech-to-Text and Text-to-Speech |

Browser requests reach public web over HTTPS. Web obtains its runtime metadata identity token for private API invocation, separate from the staff cookie. API verifies current staff membership and uses the application database identity. Case transitions persist jobs before authenticated Cloud Tasks delivery. The worker rechecks policy, membership, revisions, budgets and lease ownership. Its MCP child receives only the separate read-only database credential and a scoped run capability. A minute-level reconciliation recovers missed deliveries; it never generates measurements or approvals.

The API identity additionally needs `roles/speech.client` for the existing transcription endpoint. Web cannot access database secrets or models. Migration alone reads its privileged DSN and private snapshot. Runtime roles cannot modify immutable evidence; the evidence role cannot read password hashes or authentication sessions. Tenant isolation remains service-enforced and tested; PostgreSQL row policies are not implemented in this pilot.

## Startup and release commands

Run from the repository root with the authenticated workstation account. Every helper targets only project `project-970d28ee-835b-4ca2-866` and region `asia-south1`. Never run the obsolete Firestore `deploy.ps1`.

1. Resume the existing SQL instance if stopped: `gcloud sql instances patch plantsense-pilot --activation-policy=ALWAYS --project=project-970d28ee-835b-4ca2-866`. Wait for RUNNABLE.
2. `python infra/gcp/pilot.py foundation` provisions the approved scoped resources; `database` configures the database and private DSN secrets. Credentials remain ignored under `.runtime/cloud-pilot`; never print or commit them. Missing local credentials with existing cloud secrets requires recovery rather than silent replacement.
3. Stop original source writers and drain active work. `snapshot` captures a consistent SQLite copy; known published seed passwords rotate only in that copy. Private login details are saved in `.runtime/cloud-pilot/login-credentials.txt`. An existing final snapshot is deliberately reused; do not mistake it for a later capture after new source writes.
4. Build a backend image and resolve its immutable digest. `restore --image IMAGE_DIGEST` restores the private backup into a temporary PostgreSQL schema, checks all-table hashes/counts and rolls it back. `migrate --image IMAGE_DIGEST` imports the verified source and grants restricted runtime roles. Both are one-shot private Cloud Run jobs.
5. `build --release --tag TAG` builds the backend and web images. Evaluation reports remain available for explicit model validation, but are not part of the prototype deploy path.
6. `deploy --tag TAG` performs the initial private API/worker and public web rollout. It sets capped instances, private invocation, Secure staff cookies, Cloud SQL connections and authenticated task reconciliation. `release-identity` grants the GitHub release identity resource-scoped deployment access and permission to use only web/API/worker runtime identities.
7. Verify sign-in, authorization, real model/voice requests, task resume and private-service rejection before publishing the automatic release workflow.

For local development, `PLANTSENSE_STORAGE=sqlite` remains available with the existing database. Runtime PostgreSQL startup never applies migrations. No reverse migration is automatic.

## GitHub continuous release

The workflow is restricted to `f_statistics-main-integration`, immutable repository/owner IDs, its exact workflow path, and push/manual events. Initial publication must follow migration and service acceptance. Public identity resource names are pinned in the workflow; no repository secrets, downloaded keys or manual variables are required. Set repository variable `PLANTSENSE_RELEASE_BUILDS_ENABLED=false` to stop builds, or `PLANTSENSE_AUTO_DEPLOY_ENABLED=false` to stop promotion.

Prototype releases run CI application/database tests, dependency/security audits, contract checks and the production build. The three packaged-container/browser jobs are deferred on the release path; run **Validate PlantSense** manually for full coverage. Pull requests and other branches keep full validation. Release builds and promotes application images without fetching evaluation reports. The API and worker set `PLANTSENSE_REQUIRE_RELEASE_GATES=false`; live AI therefore runs without release evaluation proof. Set it to `true` for deployments that must enforce matching live reports.

The build identity stages source and writes images but cannot read plant data or deploy. A separate keyless release identity updates only the three existing services using designated runtime accounts. `promote.py` deploys candidates without traffic, checks startup readiness, promotes API/worker, checks the candidate web's private API connection, then promotes web. Failure restores previous revision traffic. It never configures IAM, increases resource limits, changes secrets or migrates the database. A schema change needs a separately reviewed, backward-compatible migration.

## Backup and rollback boundaries

Cloud SQL retains three scheduled backups and deletion protection; PITR and HA are disabled at this price tier. Retain the original SQLite database and private migration snapshot. Before activation, prove restore/import against the snapshot without writing the source. Native Cloud SQL backup restoration is a separate operational drill unless explicitly recorded as passed.

After PostgreSQL accepts new writes, switching to the original SQLite copy would lose those writes. Roll back application traffic to compatible previous image revisions; database recovery requires a write freeze and tested restore/reconciliation. Do not automatically downgrade the schema or delete records. Pause SQL only when the application is intentionally unavailable; storage/backup charges can continue while stopped.

The existing application caps remain 60 global AI calls/day, estimated USD 2/day, and USD 0.75/investigation. These are application estimates, not billing-account hard caps. Mumbai hosting does not establish India-only residency for global Gemini/voice processing. The shared-CPU, single-instance pilot is neither highly available nor a production-capacity proof.

## Historical preparation record

## Approved target and current state

The user selected Cloud Run and Cloud SQL PostgreSQL at pilot sizing, in Mumbai (`asia-south1`). The existing Vertex project is `project-970d28ee-835b-4ca2-866`. Every cloud command must pass this project explicitly; the workstation default points elsewhere. This is a deployment target, not a claim that the application has been deployed.

On 15 October 2026, authenticated inspection confirmed billing enabled and no Cloud Run services in Mumbai or Cloud SQL instances in this project. Required Run, SQL Admin, Tasks, Scheduler, Build, Artifact Registry, Secret Manager and IAM APIs were enabled. No database, application service or release image was created by that operation.

The Git remote is `https://github.com/PIYUSHBONDE/stop-or-ship.git`. The user confirmed it is private. GitHub connector access now succeeds: repository ID `1402708267`, owner ID `80165705`. Never extract or print local Git credentials as a workaround. The identity bootstrap script `infra/gcp/setup-github-identity.ps1` passed syntax parsing, but its execution was rejected at the permission prompt before starting. No trust was created by that attempt. Once execution is authorized, it creates only the restricted trust and submitter identity; build/deploy/data permissions remain separate.

## Release preparation

Build resources have also been provisioned by `infra/gcp/setup-build-resources.ps1`: Mumbai repository `plantsense`, private source bucket `project-970d28ee-835b-4ca2-866-plantsense-build-source`, and executor `plantsense-build-exec@project-970d28ee-835b-4ca2-866.iam.gserviceaccount.com`. The bucket deletes source objects after three days and disables soft delete because these are temporary build archives, not plant backups. Build submission/execution identities have only the scoped roles listed in the script. Use `projects/project-970d28ee-835b-4ca2-866/serviceAccounts/plantsense-build-exec@project-970d28ee-835b-4ca2-866.iam.gserviceaccount.com` for `PLANTSENSE_CLOUD_BUILD_ACCOUNT`. No cloud build or OIDC acceptance has run. Keep the build-enable variable unset until repository workflow publication and readiness checks are complete.

The user authorized a retry of `infra/gcp/setup-github-identity.ps1`, and it completed successfully. The pool/provider and submitter identity now exist. Use `projects/408867906527/locations/global/workloadIdentityPools/plantsense-github/providers/github-release` for `PLANTSENSE_WIF_PROVIDER` and `plantsense-build-submit@project-970d28ee-835b-4ca2-866.iam.gserviceaccount.com` for `PLANTSENSE_BUILD_SUBMITTER`. The repository-ID principal set can impersonate only that account, subject to provider restrictions. No build/deploy/data roles were granted, and no service-account keys were created. OIDC execution from GitHub has not yet been tested. The first rejected attempt described above remains historical.

`.github/workflows/mumbai-release.yml` runs on pushes to `f_statistics-main-integration` and supports manual execution on that branch. It calls the existing complete CI workflow. The standalone CI workflow excludes pushes to this branch to avoid running its expensive checks twice; pull-request validation remains enabled. Other branches retain push validation.

Cloud image builds remain disabled unless repository variable `PLANTSENSE_RELEASE_BUILDS_ENABLED` is exactly `true`. After all reusable CI jobs succeed, enabled builds use pinned Google authentication/setup actions and short-lived Workload Identity Federation credentials. They submit the two Docker builds to Mumbai, tagged with the exact commit SHA. No uploaded artifact or model-authored value chooses the checkout ref or cloud command. Builds do not run migrations, activate AI or switch traffic.

Configure these repository variables only after the private repository identity has been verified:

| Variable | Value |
| --- | --- |
| `PLANTSENSE_WIF_PROVIDER` | Full provider resource name for the dedicated GitHub identity pool |
| `PLANTSENSE_BUILD_SUBMITTER` | Dedicated service account permitted to submit builds |
| `PLANTSENSE_CLOUD_BUILD_ACCOUNT` | `projects/project-970d28ee-835b-4ca2-866/serviceAccounts/ACCOUNT@project-970d28ee-835b-4ca2-866.iam.gserviceaccount.com` |
| `PLANTSENSE_BUILD_SOURCE_BUCKET` | `project-970d28ee-835b-4ca2-866-plantsense-build-source`, created in Mumbai with a short source-archive lifecycle |
| `PLANTSENSE_RELEASE_BUILDS_ENABLED` | `true` only when the preceding resources and permissions are ready |

Bind the provider to immutable GitHub repository and owner IDs, the deployment branch, and the expected workflow path. Do not trust every repository belonging to an owner, pull-request refs, or a repository name alone. Grant the submitter permission to use only the chosen build execution identity. The build identity needs access to the release image repository, source staging objects, and build logs; it does not need operational database, evidence, model, secret, or application-deployment permissions. Use a dedicated source staging bucket and verify the actual submitter/build-account access before the first build.

`.gcloudignore` includes `.gitignore` and explicitly excludes runtime databases/reports and temporary GitHub credential files. No runtime data or secrets should enter build source archives. The backend runtime image now includes its dependency manifest and lockfile because the AI release fingerprint reads them.

## Remaining deployment gates

1. Implement and locally test PostgreSQL persistence, preserving immutable evidence, audit, tenant checks, transaction semantics, claims and approval versions. Keep SQLite and the original database intact for rollback.
2. Add private web-to-API identity tokens, separate from staff authentication. Retain current staff sign-in and UI. Do not provision anonymous Firebase authentication.
3. Add authenticated task-driven case execution, durable outbox dispatch and scheduled reconciliation. Retain fencing and bounded retries. Worker waiting states must release Cloud Run requests.
4. Verify small-instance memory, connection limits, timeouts and cold starts with isolated containers. Cloud Run instances cannot persist SQLite files.
5. Provision single-zone shared Cloud SQL with backups and bounded storage, private API/worker identities, Tasks, a private evidence bucket, secrets and monitoring. Start application minimum instances at zero and maximum API/worker instances at one. Do not promise a shared-CPU database SLA or high availability.
6. Perform a consistent, backed-up data migration with entity counts, referential integrity and workflow checks. Local passwords and data must never enter Git, build archives or workflow logs. Do not expose a public initial-admin setup race.
7. Evaluate the actual release source with fresh matching assistant, investigation and case reports. Preserve required voice gates. Changing the hosting region does not establish that Gemini global processing remains in India.
8. Extend the release workflow to deploy immutable image digests without traffic, run migration and authenticated smoke checks, then promote traffic only after all gates pass. Until this exists, successful image builds do not automatically update the application.

## Cost and rollback

The earlier USD 50–80 monthly envelope was a light-usage planning estimate based on US-region pricing, not an exact Mumbai quote or a hard cap. Reprice the chosen SQL tier and storage in Mumbai before provisioning. Include model, speech, database backup, network, build, registry, Tasks, Scheduler and log costs. Keep the existing application spend limits until an explicit replacement is chosen; do not silently increase spending. Budget alerts alone are not a spending cap.

Before any database migration, test restoration to a separate database. Application rollback selects the previous validated image digest and matching reports; database changes must remain backward compatible. Do not delete old data, revisions, images or the original branches as part of deployment preparation. A build-only rollback disables the release-build variable and leaves existing application traffic untouched.

References: [Google's deployment-pipeline identity guidance](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines), [Cloud Run locations](https://docs.cloud.google.com/run/docs/locations), [Cloud SQL locations](https://docs.cloud.google.com/sql/docs/postgres/locations).
