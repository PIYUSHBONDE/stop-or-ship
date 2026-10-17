"""Mumbai pilot operations. Credentials stay in ignored local files and Secret Manager."""

import argparse
import json
import re
import secrets
import shutil
import sqlite3
import subprocess
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

PROJECT = "project-970d28ee-835b-4ca2-866"
REGION = "asia-south1"
INSTANCE = "plantsense-pilot"
ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".runtime" / "cloud-pilot"
PRIVATE.mkdir(parents=True, exist_ok=True)
GCLOUD = shutil.which("gcloud.cmd") or shutil.which("gcloud")
SQL_CONNECTION = f"{PROJECT}:{REGION}:{INSTANCE}"
REGISTRY = f"{REGION}-docker.pkg.dev/{PROJECT}/plantsense"


def cloud(*args, allow_failure=False):
    result = subprocess.run(
        [GCLOUD, *args], cwd=ROOT, capture_output=True, text=True, check=False
    )
    if result.returncode and not allow_failure:
        print(result.stderr[-2500:], flush=True)
        raise RuntimeError("Google Cloud command failed: " + " ".join(args[:3]))
    return result.stdout.strip() if not result.returncode else None


def account(name):
    return f"plantsense-{name}@{PROJECT}.iam.gserviceaccount.com"


def bind_project(name, role):
    cloud(
        "projects",
        "add-iam-policy-binding",
        PROJECT,
        f"--member=serviceAccount:{account(name)}",
        f"--role={role}",
        "--condition=None",
        "--quiet",
    )


def foundation():
    for name in ("web", "api", "worker", "tasks", "reconcile", "migrate", "release"):
        if (
            cloud(
                "iam",
                "service-accounts",
                "describe",
                account(name),
                f"--project={PROJECT}",
                allow_failure=True,
            )
            is None
        ):
            cloud(
                "iam",
                "service-accounts",
                "create",
                f"plantsense-{name}",
                f"--project={PROJECT}",
            )
        print("Identity ready:", name, flush=True)
    for name in ("api", "worker", "migrate"):
        bind_project(name, "roles/cloudsql.client")
    for name in ("api", "worker"):
        bind_project(name, "roles/aiplatform.user")
    bind_project("api", "roles/speech.client")
    for name in ("api", "worker"):
        bind_project(name, "roles/cloudtasks.enqueuer")
        cloud(
            "iam",
            "service-accounts",
            "add-iam-policy-binding",
            account("tasks"),
            f"--project={PROJECT}",
            f"--member=serviceAccount:{account(name)}",
            "--role=roles/iam.serviceAccountUser",
            "--quiet",
        )
    for suffix, readers in (
        ("migration", ["migrate"]),
        ("releases", []),
    ):
        bucket = f"gs://{PROJECT}-plantsense-{suffix}"
        if (
            cloud(
                "storage",
                "buckets",
                "describe",
                bucket,
                f"--project={PROJECT}",
                allow_failure=True,
            )
            is None
        ):
            cloud(
                "storage",
                "buckets",
                "create",
                bucket,
                f"--project={PROJECT}",
                f"--location={REGION}",
                "--uniform-bucket-level-access",
                "--public-access-prevention",
            )
        for reader in readers:
            cloud(
                "storage",
                "buckets",
                "add-iam-policy-binding",
                bucket,
                f"--project={PROJECT}",
                f"--member=serviceAccount:{account(reader)}",
                "--role=roles/storage.objectViewer",
                *(
                    [
                        (
                            "--condition=expression=resource.name.startsWith("
                            f"'projects/_/buckets/{PROJECT}-plantsense-releases/objects/releases/'"
                            "),title=read-release-evaluation-reports"
                        )
                    ]
                    if reader == "build-submit"
                    else []
                ),
                "--quiet",
            )
    queue = "plantsense-cases"
    if (
        cloud(
            "tasks",
            "queues",
            "describe",
            queue,
            f"--location={REGION}",
            f"--project={PROJECT}",
            allow_failure=True,
        )
        is None
    ):
        cloud(
            "tasks",
            "queues",
            "create",
            queue,
            f"--location={REGION}",
            f"--project={PROJECT}",
        )
    cloud(
        "tasks",
        "queues",
        "update",
        queue,
        f"--location={REGION}",
        f"--project={PROJECT}",
        "--max-concurrent-dispatches=1",
        "--max-dispatches-per-second=1",
        "--max-attempts=3",
        "--min-backoff=10s",
        "--max-backoff=60s",
    )
    print("Mumbai foundation ready; no application traffic enabled", flush=True)


def credentials():
    path = PRIVATE / "credentials.json"
    if path.exists():
        return json.loads(path.read_text())
    if cloud(
        "secrets",
        "describe",
        "plantsense-migration-dsn",
        f"--project={PROJECT}",
        allow_failure=True,
    ):
        raise RuntimeError(
            "Existing database secrets require recovery; refusing to replace credentials"
        )
    values = {}
    for name, user in (
        ("migration", "postgres"),
        ("app", "plantsense_app"),
        ("evidence", "plantsense_evidence"),
    ):
        password = secrets.token_urlsafe(36)
        values[name] = (
            f"host=/cloudsql/{SQL_CONNECTION} dbname=plantsense user={user} password={password}"
        )
    path.write_text(json.dumps(values), encoding="utf-8")
    return values


def secret(name, content, readers):
    resource = "plantsense-" + name
    exists = cloud(
        "secrets", "describe", resource, f"--project={PROJECT}", allow_failure=True
    )
    if exists is None:
        cloud(
            "secrets",
            "create",
            resource,
            f"--project={PROJECT}",
            "--replication-policy=user-managed",
            f"--locations={REGION}",
        )
    versions = cloud(
        "secrets",
        "versions",
        "list",
        resource,
        f"--project={PROJECT}",
        "--filter=state:ENABLED",
        "--format=value(name)",
    )
    if not versions:
        file = PRIVATE / (resource + ".secret")
        file.write_text(content, encoding="utf-8")
        cloud(
            "secrets",
            "versions",
            "add",
            resource,
            f"--project={PROJECT}",
            f"--data-file={file}",
        )
    for reader in readers:
        cloud(
            "secrets",
            "add-iam-policy-binding",
            resource,
            f"--project={PROJECT}",
            f"--member=serviceAccount:{account(reader)}",
            "--role=roles/secretmanager.secretAccessor",
            "--quiet",
        )


def configure_database():
    values = credentials()
    state = cloud(
        "sql",
        "instances",
        "describe",
        INSTANCE,
        f"--project={PROJECT}",
        "--format=value(state)",
    )
    if state != "RUNNABLE":
        raise RuntimeError("Cloud SQL must finish provisioning before database setup")
    token = cloud("auth", "print-access-token")
    password = values["migration"].split("password=", 1)[1]
    request = Request(
        f"https://sqladmin.googleapis.com/sql/v1beta4/projects/{PROJECT}/instances/{INSTANCE}/users?name=postgres",
        data=json.dumps({"password": password}).encode(),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="PUT",
    )
    with urlopen(request, timeout=30) as response:
        operation = json.load(response)["name"]
    cloud(
        "sql", "operations", "wait", operation, f"--project={PROJECT}", "--timeout=300"
    )
    if (
        cloud(
            "sql",
            "databases",
            "describe",
            "plantsense",
            f"--instance={INSTANCE}",
            f"--project={PROJECT}",
            allow_failure=True,
        )
        is None
    ):
        cloud(
            "sql",
            "databases",
            "create",
            "plantsense",
            f"--instance={INSTANCE}",
            f"--project={PROJECT}",
        )
    secret("migration-dsn", values["migration"], ["migrate"])
    secret("app-dsn", values["app"], ["api", "worker", "migrate"])
    secret("evidence-dsn", values["evidence"], ["api", "worker", "migrate"])
    print("Database and private DSN secrets configured", flush=True)


def backup_source():
    from app.identity.staff_security import hash_password, verify_password

    final_path = PRIVATE / "source.db"
    path = PRIVATE / "source.capture.db"
    if final_path.exists():
        print("Reusing previously captured migration snapshot", flush=True)
        return
    # An interrupted capture is never a usable migration snapshot.
    path.unlink(missing_ok=True)
    source = ROOT / ".runtime" / "statistics-integration" / "plant-review-v1.db"
    original = sqlite3.connect(source.resolve().as_uri() + "?mode=ro", uri=True)
    target = sqlite3.connect(path)
    try:
        original.backup(target)
        if target.execute(
            "SELECT 1 FROM issue_jobs WHERE state IN ('queued','running')"
        ).fetchone():
            raise RuntimeError("Drain active cases before snapshot capture")
        rotated = []
        for identity, email, stored in target.execute(
            "SELECT id,email,password_hash FROM staff_users"
        ).fetchall():
            if verify_password("testing-only strong passphrase!", stored):
                password = secrets.token_urlsafe(24)
                target.execute(
                    "UPDATE staff_users SET password_hash=? WHERE id=?",
                    (hash_password(password), identity),
                )
                rotated.append(email + "\n" + password + "\n")
        target.commit()
        (PRIVATE / "login-credentials.txt").write_text(
            "\n".join(rotated), encoding="utf-8"
        )
        if target.execute("PRAGMA integrity_check").fetchone() != ("ok",):
            raise RuntimeError("Snapshot integrity check failed")
    finally:
        target.close()
        original.close()
    path.replace(final_path)
    print(
        "Consistent snapshot captured; known local seed passwords rotated in cloud copy only",
        flush=True,
    )


def submit_build(tag, release=False):
    config = (
        "infra/gcp/cloudbuild-release.yaml"
        if release
        else "infra/gcp/cloudbuild-backend.yaml"
    )
    substitutions = (
        f"_COMMIT_SHA={tag}" if release else f"_IMAGE={REGISTRY}/backend:{tag}"
    )
    result = cloud(
        "builds",
        "submit",
        ".",
        f"--project={PROJECT}",
        f"--region={REGION}",
        "--config=" + config,
        f"--service-account=projects/{PROJECT}/serviceAccounts/{account('build-exec')}",
        f"--gcs-source-staging-dir=gs://{PROJECT}-plantsense-build-source/source",
        "--substitutions=" + substitutions,
        "--suppress-logs",
        "--async",
        "--format=value(id)",
    )
    print("Cloud Build submitted:", result, flush=True)
    (PRIVATE / "build-id.txt").write_text(result)


def upload_reports():
    from app.ai.assistant_gate import require_assistant_evaluation
    from app.ai.evaluation_gate import fingerprint
    from app.cases.worker import require_case_evaluation
    from app.core import config

    reports = ROOT / ".runtime" / "mumbai-release"
    config.AI_EVALUATION_FILE = str(reports / "investigation.json")
    config.ASSISTANT_EVALUATION_FILE = str(reports / "assistant.json")
    config.CASES_EVALUATION_FILE = str(reports / "cases.json")
    require_assistant_evaluation(voice=True)
    require_case_evaluation()
    identity = fingerprint()
    for name in ("investigation", "assistant", "cases"):
        cloud(
            "storage",
            "cp",
            str(reports / f"{name}.json"),
            f"gs://{PROJECT}-plantsense-releases/releases/{identity}/{name}.json",
            f"--project={PROJECT}",
        )
    (PRIVATE / "fingerprint.txt").write_text(identity)
    print("Matching complete live reports uploaded:", identity, flush=True)


def migrate(image, *, restore=False):
    if not image or not image.startswith(REGISTRY + "/backend@sha256:"):
        raise ValueError(
            "Migration requires an immutable image from the PlantSense repository"
        )
    source = PRIVATE / "source.db"
    if not source.exists():
        raise RuntimeError("Capture a quiesced migration snapshot first")
    origin = f"gs://{PROJECT}-plantsense-migration/source.db"
    cloud("storage", "cp", str(source), origin, f"--project={PROJECT}")
    env = f"GOOGLE_CLOUD_PROJECT={PROJECT},PLANTSENSE_MODE=cloud,PLANTSENSE_STORAGE=postgres,PLANTSENSE_MIGRATION_SOURCE={origin}"
    secrets_env = "PLANTSENSE_MIGRATION_DSN=plantsense-migration-dsn:latest,PLANTSENSE_APP_DSN=plantsense-app-dsn:latest,PLANTSENSE_EVIDENCE_DSN=plantsense-evidence-dsn:latest"
    job_name = "plantsense-restore-check" if restore else "plantsense-migrate"
    arguments = ["--args=-m,app.persistence.cloud_migrate"]
    if restore:
        script = """import json, os, sys, tempfile
from pathlib import Path
import psycopg
from google.cloud import storage
from app.persistence.postgres_migration import import_snapshot, snapshot
try:
    bucket, name = os.environ["PLANTSENSE_MIGRATION_SOURCE"][5:].split("/", 1)
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / "source.db"
        storage.Client().bucket(bucket).blob(name).download_to_filename(path)
        with snapshot(path) as source, psycopg.connect(os.environ["PLANTSENSE_MIGRATION_DSN"], autocommit=True) as db:
            with db.transaction(force_rollback=True):
                proof = import_snapshot(source, db, "plantsense_restorecheck")
            assert db.execute("SELECT 1 FROM pg_namespace WHERE nspname='plantsense_restorecheck'").fetchone() is None
    print(json.dumps({"restore": "verified_and_rolled_back", "tables": proof["tables"], "rows": proof["rows"]}))
except Exception as error:
    print("Restore check failed: " + type(error).__name__, file=sys.stderr)
    raise SystemExit(1) from None
"""
        flags = PRIVATE / "restore-flags.json"
        flags.write_text(json.dumps({"--args": ["-c", script]}), encoding="utf-8")
        arguments = ["--flags-file=" + str(flags)]
        secrets_env = "PLANTSENSE_MIGRATION_DSN=plantsense-migration-dsn:latest"
    cloud(
        "run",
        "jobs",
        "deploy",
        job_name,
        f"--project={PROJECT}",
        f"--region={REGION}",
        "--image=" + image,
        "--service-account=" + account("migrate"),
        "--set-cloudsql-instances=" + SQL_CONNECTION,
        "--memory=1Gi",
        "--cpu=1",
        "--tasks=1",
        "--max-retries=0",
        "--task-timeout=600s",
        "--command=python",
        *arguments,
        "--set-env-vars=" + env,
        "--set-secrets=" + secrets_env,
        "--quiet",
    )
    cloud(
        "run",
        "jobs",
        "execute",
        job_name,
        f"--project={PROJECT}",
        f"--region={REGION}",
        "--wait",
        "--quiet",
    )
    print(
        "Private snapshot restore verified and rolled back"
        if restore
        else "Cloud migration job succeeded; source snapshot retained",
        flush=True,
    )


def release_environment(role, worker_url=""):
    return {
        "GOOGLE_CLOUD_PROJECT": PROJECT,
        "GOOGLE_CLOUD_LOCATION": "global",
        "GEMINI_MODEL": "gemini-3.8-flash",
        "PLANTSENSE_MODE": "cloud",
        "PLANTSENSE_STORAGE": "postgres",
        "PLANTSENSE_AI_PROVIDER": "vertex",
        "PLANTSENSE_INTERNAL_TEST_MODE": "false",
        "PLANTSENSE_REQUIRE_RELEASE_GATES": "true",
        "PLANTSENSE_AI_EVALUATION_FILE": "/app/release/investigation.json",
        "PLANTSENSE_ASSISTANT_EVALUATION_FILE": "/app/release/assistant.json",
        "PLANTSENSE_CASES_EVALUATION_FILE": "/app/release/cases.json",
        "DAILY_AI_LIMIT": "60",
        "DAILY_AI_SPEND_MICRO_USD": "2000000",
        "INVESTIGATION_AI_SPEND_MICRO_USD": "750000",
        "TASK_REGION": REGION,
        "TASK_QUEUE": "plantsense-cases",
        "TASK_SERVICE_ACCOUNT": account("tasks"),
        "WORKER_URL": worker_url,
        "SERVICE_ROLE": role,
    }


def service_url(name):
    return cloud(
        "run",
        "services",
        "describe",
        "plantsense-" + name,
        f"--project={PROJECT}",
        f"--region={REGION}",
        "--format=value(status.url)",
    )


def invoke_binding(service, member):
    cloud(
        "run",
        "services",
        "add-iam-policy-binding",
        "plantsense-" + service,
        f"--project={PROJECT}",
        f"--region={REGION}",
        f"--member={member}",
        "--role=roles/run.invoker",
        "--quiet",
    )


def web_origins(description):
    aliases = json.loads(
        description.get("metadata", {})
        .get("annotations", {})
        .get("run.googleapis.com/urls", "[]")
    )
    origins = {description["status"]["url"], *aliases}
    for origin in origins:
        parsed = urlsplit(origin)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or not parsed.hostname.endswith(".run.app")
            or "*" in parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.port
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("Unexpected Cloud Run web origin")
    return ",".join(sorted(origin.rstrip("/") for origin in origins))


def configure_web_origins():
    description = json.loads(
        cloud(
            "run",
            "services",
            "describe",
            "plantsense-web",
            f"--project={PROJECT}",
            f"--region={REGION}",
            "--format=json",
        )
    )
    flags = PRIVATE / "web-origin-flags.json"
    flags.write_text(
        json.dumps(
            {
                "--update-env-vars": {
                    "PLANTSENSE_STAFF_WEB_ORIGINS": web_origins(description)
                }
            }
        ),
        encoding="utf-8",
    )
    cloud(
        "run",
        "services",
        "update",
        "plantsense-api",
        f"--project={PROJECT}",
        f"--region={REGION}",
        "--flags-file=" + str(flags),
        "--quiet",
    )
    print("Verified Cloud Run web aliases configured", flush=True)


def immutable_image(component, tag):
    if not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}", tag):
        raise ValueError("Invalid release tag")
    image = f"{REGISTRY}/{component}:{tag}"
    digest = cloud(
        "artifacts",
        "docker",
        "images",
        "describe",
        image,
        f"--project={PROJECT}",
        "--format=value(image_summary.digest)",
    )
    if not digest or not re.fullmatch(r"sha256:[a-f0-9]{64}", digest):
        raise RuntimeError("Release image digest unavailable")
    return f"{REGISTRY}/{component}@{digest}"


def deploy_services(tag):
    backend, web = immutable_image("backend", tag), immutable_image("web", tag)
    runtime_secrets = "PLANTSENSE_POSTGRES_DSN=plantsense-app-dsn:latest,PLANTSENSE_POSTGRES_EVIDENCE_DSN=plantsense-evidence-dsn:latest"
    # Private services must pass their complete matching release gates before web exposure.
    for role in ("worker", "api"):
        print("Deploying private service:", role, flush=True)
        environment = release_environment(
            role, service_url("worker") if role == "api" else ""
        )
        env_path = PRIVATE / f"{role}-environment.json"
        env_path.write_text(json.dumps(environment), encoding="utf-8")
        cloud(
            "run",
            "deploy",
            "plantsense-" + role,
            f"--project={PROJECT}",
            f"--region={REGION}",
            "--image=" + backend,
            "--service-account=" + account(role),
            "--set-cloudsql-instances=" + SQL_CONNECTION,
            "--set-secrets=" + runtime_secrets,
            "--env-vars-file=" + str(env_path),
            "--min-instances=0",
            "--max-instances=1",
            "--cpu=1",
            "--memory=1Gi",
            "--concurrency=" + ("1" if role == "worker" else "8"),
            "--timeout=600s",
            "--no-allow-unauthenticated",
            "--quiet",
        )
    worker_url = service_url("worker")
    cloud(
        "run",
        "services",
        "update",
        "plantsense-worker",
        f"--project={PROJECT}",
        f"--region={REGION}",
        "--update-env-vars=WORKER_URL=" + worker_url,
        "--quiet",
    )
    invoke_binding("api", "serviceAccount:" + account("web"))
    invoke_binding("worker", "serviceAccount:" + account("tasks"))
    invoke_binding("worker", "serviceAccount:" + account("reconcile"))
    print("Deploying web with private API access", flush=True)
    cloud(
        "run",
        "deploy",
        "plantsense-web",
        f"--project={PROJECT}",
        f"--region={REGION}",
        "--image=" + web,
        "--service-account=" + account("web"),
        "--set-env-vars=PLANTSENSE_CLOUD_AUTH=true,API_BASE_URL=" + service_url("api"),
        "--min-instances=0",
        "--max-instances=1",
        "--cpu=1",
        "--memory=512Mi",
        "--concurrency=20",
        "--timeout=600s",
        "--no-allow-unauthenticated",
        "--quiet",
    )
    web_url = service_url("web")
    configure_web_origins()
    schedule = "plantsense-reconcile"
    exists = cloud(
        "scheduler",
        "jobs",
        "describe",
        schedule,
        f"--project={PROJECT}",
        f"--location={REGION}",
        allow_failure=True,
    )
    cloud(
        "scheduler",
        "jobs",
        "update" if exists else "create",
        "http",
        schedule,
        f"--project={PROJECT}",
        f"--location={REGION}",
        "--schedule=* * * * *",
        "--time-zone=UTC",
        "--uri=" + worker_url + "/internal/cases/reconcile",
        "--http-method=POST",
        "--oidc-service-account-email=" + account("reconcile"),
        "--oidc-token-audience=" + worker_url,
        "--attempt-deadline=180s",
        "--max-retry-attempts=1",
        "--quiet",
    )
    # No initial-admin race: the verified migration must contain existing staff.
    invoke_binding("web", "allUsers")
    (PRIVATE / "release.json").write_text(
        json.dumps(
            {
                "tag": tag,
                "backend": backend,
                "web": web,
                "url": web_url,
                "worker": worker_url,
                "api": service_url("api"),
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print("Application deployed:", web_url, flush=True)


def release_identity():
    member = "principalSet://iam.googleapis.com/projects/408867906527/locations/global/workloadIdentityPools/plantsense-github/attribute.repository_id/1402708267"
    cloud(
        "iam",
        "service-accounts",
        "add-iam-policy-binding",
        account("release"),
        f"--project={PROJECT}",
        "--member=" + member,
        "--role=roles/iam.workloadIdentityUser",
        "--quiet",
    )
    for name in ("web", "api", "worker"):
        cloud(
            "iam",
            "service-accounts",
            "add-iam-policy-binding",
            account(name),
            f"--project={PROJECT}",
            "--member=serviceAccount:" + account("release"),
            "--role=roles/iam.serviceAccountUser",
            "--quiet",
        )
        cloud(
            "run",
            "services",
            "add-iam-policy-binding",
            "plantsense-" + name,
            f"--project={PROJECT}",
            f"--region={REGION}",
            "--member=serviceAccount:" + account("release"),
            "--role=roles/run.developer",
            "--quiet",
        )
    cloud(
        "artifacts",
        "repositories",
        "add-iam-policy-binding",
        "plantsense",
        f"--project={PROJECT}",
        f"--location={REGION}",
        "--member=serviceAccount:" + account("release"),
        "--role=roles/artifactregistry.reader",
        "--quiet",
    )
    print(
        "Restricted GitHub release identity ready; no database/secret/model grants",
        flush=True,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "stage",
        choices=[
            "foundation",
            "database",
            "snapshot",
            "build",
            "migrate",
            "deploy",
            "reports",
            "release-identity",
            "restore",
            "origins",
        ],
    )
    parser.add_argument("--image")
    parser.add_argument("--tag", default="migration-bootstrap")
    parser.add_argument("--release", action="store_true")
    args = parser.parse_args()
    try:
        if args.stage == "foundation":
            foundation()
        elif args.stage == "database":
            configure_database()
        elif args.stage == "snapshot":
            backup_source()
        elif args.stage == "build":
            submit_build(args.tag, release=args.release)
        elif args.stage == "migrate":
            migrate(args.image)
        elif args.stage == "restore":
            migrate(args.image, restore=True)
        elif args.stage == "deploy":
            deploy_services(args.tag)
        elif args.stage == "reports":
            upload_reports()
        elif args.stage == "release-identity":
            release_identity()
        elif args.stage == "origins":
            configure_web_origins()
    except Exception as error:  # noqa: BLE001 -- Never print driver/HTTP credential payloads.
        print("Pilot operation failed:", type(error).__name__, flush=True)
        raise SystemExit(1) from None
