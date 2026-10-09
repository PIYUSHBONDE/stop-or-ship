# Security boundaries

## Current controls

Session ownership and incident/version checks are enforced by the API inside transactions. Approval retries are idempotent; superseded authorizations cannot create active work orders. Investigation tools are read-only, and documents and notes are untrusted evidence. Requests have size/time bounds; the web proxy rejects cross-origin writes and unexpected paths. Cloud identity validation checks Firebase token revocation.

Shared local plants use named staff accounts and server-owned roles. Passwords use salted scrypt (`N=131072`, `r=8`, `p=1`) with bounded hashing concurrency; credential endpoints apply persistent request limits. Passwords are not trimmed. Staff cookies are HttpOnly/SameSite Strict with an eight-hour absolute expiry, and token hashes are stored server-side. Cookies are Secure when the API receives HTTPS; the local loopback HTTP stack does not use that flag. Do not expose this local identity adapter publicly.

Membership is checked on every protected request and rechecked in the write transaction. Approvals record authenticated user IDs; shared request schemas reject supplied approver fields. Invitations are hashed, single-use and expire after 48 hours. Their issuer must still be an active administrator when they are accepted. Existing users must sign in to their own account to accept; an invitation cannot reset a password or reactivate an existing membership.

Audit records persist outside the compact workflow event buffer and commit with workflow writes. SQLite triggers prohibit audit updates/deletes through application SQL. Filesystem/database administrators remain trusted; this is not a tamper-proof ledger. Staff credentials, invitation secrets and validation input are excluded from error logs/responses.

Docker Compose is configured for localhost access, a private API, non-root processes, read-only root filesystems, dropped capabilities, no privilege escalation, bounded resources and separate persistent data. Build contexts and Git ignore rules exclude environment files, identity keys, raw datasets and local databases. Dependency versions are locked; base images and CI actions are pinned to immutable identifiers. CI includes dependency audits, a redacted secret scan and container checks.

## Production requirements

Normal execution disables legacy replay and anonymous endpoints. The internal adapter switch is for automated tests only. Current observations and historical imports retain explicit origins, source revisions and immutable original records; historical records cannot authorize operational work. Staff file submission does not attest physical acquisition or create a live hardware connection. Administrators must review operational envelopes and site procedures.

The shared local identity adapter is for development. A launch needs managed named identity, MFA/recovery and first-plant role policies, a cloud persistence adapter, reviewed site procedures, TLS, managed secrets, tested backups/retention and operational monitoring. Shared staff routes fail closed in cloud mode until that adapter exists. Isolated demo identity and editable approver labels confer no access to shared records. Cloud identity, private worker authentication and live AI behavior require deployment testing. Source and dependency checks do not certify the application as secure.

Never commit server API keys, service-account files or credentials. Keep secrets outside Docker build contexts and inject them through the deployment's secret manager. Only reviewed, locally prepared model artifacts may be loaded; do not load uploaded pickle files.

## Reporting

Report a suspected issue privately to the repository owner with reproduction steps and affected versions. Do not include credentials, plant data or unredacted logs in public issues. If a credential is exposed, revoke it promptly; deleting the current file does not remove it from Git history.
