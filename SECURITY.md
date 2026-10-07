# Security boundaries

## Current controls

Session ownership and incident/version checks are enforced by the API inside transactions. Approval retries are idempotent; superseded authorizations cannot create active work orders. Investigation tools are read-only, and documents and notes are untrusted evidence. Requests have size/time bounds; the web proxy rejects cross-origin writes and unexpected paths. Cloud identity validation checks Firebase token revocation.

Docker Compose is configured for localhost access, a private API, non-root processes, read-only root filesystems, dropped capabilities, no privilege escalation, bounded resources and separate persistent data. Build contexts and Git ignore rules exclude environment files, identity keys, raw datasets and local databases. Dependency versions are locked; base images and CI actions are pinned to immutable identifiers. CI includes dependency audits, a redacted secret scan and container checks.

## Production requirements

Local identity tokens and the approver display field do not provide production operator roles or site access management. A real plant deployment needs authenticated operator identity, role-based authorization, reviewed site procedures, TLS, secrets managed outside images, backups/retention and operational monitoring. Cloud identity, private worker authentication and live AI behavior require deployment testing. Source and dependency checks do not certify the application as secure.

Never commit server API keys, service-account files or credentials. Keep secrets outside Docker build contexts and inject them through the deployment's secret manager. Only reviewed, locally prepared model artifacts may be loaded; do not load uploaded pickle files.

## Reporting

Report a suspected issue privately to the repository owner with reproduction steps and affected versions. Do not include credentials, plant data or unredacted logs in public issues. If a credential is exposed, revoke it promptly; deleting the current file does not remove it from Git history.
