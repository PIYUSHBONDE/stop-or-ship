# Deploy PlantSense

Use this guide for routine updates to the existing Mumbai deployment. Initial provisioning and database import are already complete. Do not repeat them to release code.

## Normal release

1. Review and commit your changes locally. Do not include `.env`, credentials, databases or `.runtime` files.
2. Push to `f_statistics-main-integration`:

   ```powershell
   git push origin f_statistics-main-integration
   ```

3. Open [GitHub Actions](https://github.com/PIYUSHBONDE/stop-or-ship/actions/workflows/mumbai-release.yml) and select **Release PlantSense Mumbai** for that commit.
4. Watch validation, image build and promotion. A green image build alone does not mean deployment occurred. The summary must show **Traffic promotion and health checks: success**.
5. Open [PlantSense](https://plantsense-web-nponfirhaa-el.a.run.app), sign in, open Plant and a factory case. Confirm existing records remain accessible. Hard-refresh if the browser retains an old page.

The current workflow deploys automatically after checks pass. There is no configured approval step in the workflow. A GitHub environment with required reviewers would be an additional setup change; this guide does not claim that protection exists.

To redeploy the current branch without another commit: Actions, **Release PlantSense Mumbai**, **Run workflow**, select `f_statistics-main-integration`, then **Run workflow**. Workflow controls require the appropriate repository access and workflow availability. Commits containing `[skip ci]` do not start the normal push-triggered release; use the manual run when appropriate. Avoid redundant pushes while a release is running: release runs queue rather than cancelling an active rollout.

## What runs and where

| Stage | Location | What it does |
| --- | --- | --- |
| Validation | GitHub Actions | Backend/infrastructure tests, database compatibility, frontend unit tests, contracts, formatting, types, security checks and production build |
| Image build | Mumbai Cloud Build | Builds immutable web and backend images in Artifact Registry |
| Promotion | Mumbai Cloud Run | Creates worker/API/web candidates, checks readiness and web-to-private-API/database access, then switches traffic |
| Data | Existing Cloud SQL PostgreSQL | Retains staff, cases, findings and workflows across releases |

This is not an atomic three-service switch: worker and API switch before web. Changes must remain compatible with the preceding release. Failed promotion attempts restore the captured traffic map. Health checks do not replace checking sign-in and case access yourself.

Routine prototype releases do not download evaluation reports. Promotion explicitly disables report gates on the API and worker, so live AI can run without fresh evaluation proof. The standalone evaluation process remains available when you want to measure model behavior.

For the prototype, routine releases skip the three full packaged-container/browser jobs. Other validation and production startup/health/rollback gates still block release on failure. To run full browser coverage, open Actions, choose **Validate PlantSense**, and run it manually for the branch. Pull requests and other branches also retain the full suite. Skipping browser tests reduces release coverage; it does not establish that all browser flows passed.

## If a release fails

| Failed stage | Next step |
| --- | --- |
| Validation | Open the first failed test/check and its artifacts. Fix the cause, then push. Running deployment again does not fix a failing test. |
| Authentication or permissions | Inspect the keyless GitHub identity error. Do not add Owner/Editor roles or download service-account keys. |
| Image build | Open the Cloud Build link/logs from the build step. Fix the build error before retrying. |
| Promotion | Read the failing startup/health check and verify automatic rollback. Preserve the previous-traffic artifact. |
| Workflow green, app unchanged | Check that promotion says `success`, the branch/commit is correct, and automatic deployment is not paused. |

## Pause automatic release

In repository **Settings → Secrets and variables → Actions → Variables**, set:

- `PLANTSENSE_AUTO_DEPLOY_ENABLED=false`: validate/build, but do not promote traffic.
- `PLANTSENSE_RELEASE_BUILDS_ENABLED=false`: validate only; do not build or deploy images.

These switches affect future job/step evaluation; they do not stop a promotion already running. In the current workflow, unset values enable the corresponding action. Set a variable back to `true` to resume it. Changing these variables changes future release behavior; routine deployment does not require editing them.

## Roll back application code

Promotion automatically attempts to restore previous traffic when its checks fail. For a defect found afterward:

1. Pause future promotion using the variable above and ensure no release is currently switching traffic.
2. Download the release run's **mumbai-previous-traffic-COMMIT** artifact. It contains revision names and percentages, not credentials. Artifacts are retained for 30 days.
3. In [Cloud Run](https://console.cloud.google.com/run?project=project-970d28ee-835b-4ca2-866), select region `asia-south1`. For `plantsense-worker`, `plantsense-api` and `plantsense-web`, use **Manage traffic** to restore the exact revisions and percentages recorded in the file. Restore compatible worker/API revisions before web; inspect readiness and errors during the transition.
4. Verify sign-in, Plant and cases. Retain database writes; do not restore an old database merely to undo a UI release.

Do not roll back code across an incompatible schema change without its migration recovery plan. Database rollback is a separate, reviewed operation. The earlier manual release has its traffic snapshot under the ignored local `.runtime/cloud-pilot/previous-traffic.json`; new GitHub releases upload this file as an artifact.

## Commands to avoid for routine updates

Do not run `infra/gcp/deploy.ps1`: it is the obsolete Firestore deployment. Do not rerun `pilot.py foundation`, `database`, `snapshot`, `migrate` or initial `deploy` to update the app. Normal releases use the GitHub workflow and `promote.py`; they do not recreate infrastructure, rotate credentials or migrate data.

For architecture, scoped identities and separately reviewed migration procedures, see [Mumbai release operations](mumbai-release.md). For observed acceptance and limitations, see [implementation status](../status.md). This guide and workflow-summary changes have not themselves been pushed or executed in GitHub.
