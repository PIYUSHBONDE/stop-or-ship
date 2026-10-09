# Shared plant foundation review

This change runs locally and retains replay/synthetic/scripted-AI labels. It introduces shared access and workflow accountability. It does not connect a real plant or certify a production launch.

## Review locally

1. Build/start the Docker stack using `docker compose up --build --wait`. Open `http://127.0.0.1:3000/workspace`.
2. On a store without staff, create the initial administrator, organization and plant. Set a unique passphrase of at least 15 characters. Existing demo sessions remain separate.
3. Open the plant. Its twelve equipment records, areas and dependencies are stored under the plant, seeded from the current reviewed layout. Configuration editing is a later milestone.
4. Under **Plant access**, invite a viewer or technician and copy the invitation link privately. Accept in a separate browser profile with that invited email. The link expires after 48 hours and can be used once; no email is sent automatically.
5. As the administrator/manager, start pump degradation, pause and step six windows. Then start shared cooling and step six windows. Both cases remain available in Incidents. Select either through its case link; refresh retains selection.
6. A viewer sees both cases and evidence but cannot recalculate, approve or record repairs. A reliability engineer can recalculate/retry; a technician can execute an already approved work order.
7. Approve a feasible current comparison. The approver is your signed-in identity and cannot be edited. Maintenance opens the selected case's authorized work order. Record repair observations and verify three healthy replay windows.
8. Return to Plant access and refresh audit history. Inspect actor, action, case and calculation version. Load older pages; earlier records survive browser refresh/API restart.
9. Revoke a staff membership. Their next protected request is denied, including actions already presented in a stale browser. The last active administrator cannot be removed or demoted.

Existing users joining another plant must be signed in to that account before accepting an invitation. Existing memberships are changed by an administrator, not overwritten by new invitations.

## Current roles

| Action | Admin | Manager | Reliability | Technician | Viewer |
| --- | --- | --- | --- | --- | --- |
| View plant, evidence, cases and audit | Yes | Yes | Yes | Yes | Yes |
| Control local replay/source | Yes | Yes | No | No | No |
| Recalculate / retry investigation | Yes | Yes | Yes | No | No |
| Approve / reject / reopen proposal | Yes | Yes | No | No | No |
| Execute approved repair | Yes | Yes | No | Yes | No |
| Invite staff / change memberships | Yes | No | No | No | No |

These are initial development roles. The first plant must review separation of duties before launch.

## Persistence and migration

SQLite migrations are additive and recorded in `workspace_migrations`. They create separate plant, catalog, staff, membership, incident, order, case and audit records without deleting old demo sessions. Private execution state is per workflow. Existing plant equipment names/configuration are not overwritten at restart. Plant-owned records are scoped by plant ID; organization ownership comes from the plant record.

Staff passwords use salted scrypt, and opaque staff/invitation tokens are stored as hashes. Eight-hour HttpOnly sessions are revoked at sign-out; each request checks active membership. Browser storage contains the selected plant ID. There is no shared-plant reset button or automatic promotion of demo approvals into staff-authorized records.

Concurrent cases merge capacity along dependency branches without counting a line twice. Each intervention table still covers one selected case. Joint outage planning, resource conflicts and fleet-wide scheduling remain later work.

## Isolated acceptance environment

Browser checks create synthetic users, invitations, incidents and repairs. Do not run them on operational records. For a fresh isolated Docker project on Windows:

```powershell
$env:PLANTSENSE_WEB_PORT = '3002'
$env:COMPOSE_PROJECT_NAME = 'plantsense-acceptance'
docker compose -p plantsense-acceptance up --build --wait
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3002'
Push-Location web
npm.cmd run test:e2e
Pop-Location
python scripts/check_containers.py
docker compose -p plantsense-acceptance down
Remove-Item Env:PLANTSENSE_WEB_PORT, Env:PLAYWRIGHT_BASE_URL, Env:COMPOSE_PROJECT_NAME
```

`down` keeps that project's data volume. Shared browser tests expect an empty staff store or their own acceptance account; repeat runs after an interrupted test may require a fresh acceptance project name. Set `COMPOSE_PROJECT_NAME` and `PLANTSENSE_WEB_PORT` together so the container checker uses the same stack. Native tests can instead use a separate `PLANTSENSE_DB` path before API startup and the corresponding `PLANTSENSE_STAFF_WEB_ORIGINS` when changing the frontend port.

## Remaining production gates

- Managed identity with MFA/recovery, reviewed operator roles and first-plant onboarding.
- Shared cloud persistence/migrations/indexes and plant configuration APIs.
- Real data import/connector, signal mapping, unit checks, source health and quality reporting.
- Durable jobs, checkpoint/reconciliation and crash/retry tests on the deployment stack.
- Live Gemini and scoped retrieval evaluation; shared free-form questions are currently disabled.
- Joint intervention scheduling, bounded historical queries/load testing, monitoring, backup restoration and release/rollback exercises.

Observed checks are recorded in `status.md`: 57 backend tests, the production Docker build, container security checks and all 31 browser tests passed locally. Mobile and audit screenshots were visually reviewed. The earlier sandbox blockers were resolved for container acceptance through permitted commands. Local scripted recovery is evidence of the tested workflow, not actual machinery recovery.
