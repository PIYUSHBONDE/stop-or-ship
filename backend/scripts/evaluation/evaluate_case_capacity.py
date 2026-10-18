"""Isolated scripted queue/recovery exercise; never a production capacity claim."""

import argparse
import json
import os
import secrets
import subprocess
import sys
import time
import uuid
from pathlib import Path

from app.cases.service import create_case, update_policy
from app.contracts.cases import CaseCreate, PolicyUpdate
from app.contracts.workspace import SetupRequest
from app.identity.staff_access import access_state, issue_session, setup
from app.persistence.store import Store
from app.plant.catalog import seed_catalog


def evaluate(output):
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    path = output.parent / ("case-capacity-" + secrets.token_hex(6) + ".db")
    store = Store(str(path), cloud=False)
    token = setup(
        store,
        SetupRequest(
            email="capacity@example.test",
            password=secrets.token_urlsafe(24),
            display_name="Capacity fixture",
            organization_name="Fixture organization 1",
            plant_name="Fixture plant 1",
        ),
    )
    plant = access_state(store, token)["plants"][0]["id"]
    fixtures = [(plant, token)]
    with store.connection() as db:
        original_org, original_user = db.execute(
            "SELECT p.organization_id,m.user_id FROM plants p JOIN memberships m ON m.plant_id=p.id WHERE p.id=?",
            (plant,),
        ).fetchone()
        password_hash = db.execute(
            "SELECT password_hash FROM staff_users WHERE id=?", (original_user,)
        ).fetchone()[0]
        other_org, other_user = str(uuid.uuid4()), str(uuid.uuid4())
        db.execute("INSERT INTO organizations VALUES (?,?)", (other_org, "Fixture organization 2"))
        db.execute(
            "INSERT INTO staff_users VALUES (?,?,?,?,1)",
            (other_user, "capacity-2@example.test", "Capacity fixture 2", password_hash),
        )
        for index, (org, user) in enumerate(
            ((original_org, original_user), (other_org, other_user), (other_org, other_user))
        ):
            identity = str(uuid.uuid4())
            db.execute("INSERT INTO plants VALUES (?,?,?)", (identity, org, f"Fixture plant {index + 2}"))
            seed_catalog(db, identity)
            db.execute("INSERT INTO memberships VALUES (?,?,?,1)", (identity, user, "admin"))
            fixtures.append((identity, issue_session(db, user)))
    for identity, staff in fixtures:
        update_policy(
            store, staff, identity, PolicyUpdate(expected_version=0, enabled=True), str(uuid.uuid4())
        )
    for index in range(100):
        identity, staff = fixtures[index % 4]
        create_case(
            store,
            staff,
            identity,
            CaseCreate(
                title=f"Capacity fixture {index}",
                description="Authored production report; no physical factory claim.",
                category="production",
                asset_id="P-107",
            ),
            str(uuid.uuid4()),
        )
    env = {
        **os.environ,
        "PLANTSENSE_DB": str(path),
        "PLANTSENSE_AI_PROVIDER": "scripted",
        "PLANTSENSE_INTERNAL_TEST_MODE": "false",
        "PLANTSENSE_CASES_ENABLED": "true",
    }
    started = time.monotonic()
    log_path = output.with_suffix(".log")
    with log_path.open("w", encoding="utf-8") as log:
        workers = [
            subprocess.Popen(
                [sys.executable, "-m", "app.cases.worker", "--drain"],
                env=env,
                stdout=log,
                stderr=log,
                stdin=subprocess.DEVNULL,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            for _ in range(2)
        ]
        try:
            codes = [worker.wait(timeout=600) for worker in workers]
        finally:
            for worker in workers:
                if worker.poll() is None:
                    worker.terminate()
                    worker.wait(timeout=15)
    elapsed = time.monotonic() - started
    with store.connection() as db:
        completed = db.execute("SELECT count(*) FROM issue_jobs WHERE state='completed'").fetchone()[0]
        waiting = db.execute("SELECT count(*) FROM issue_cases WHERE phase='waiting_for_input'").fetchone()[0]
        tasks = db.execute("SELECT count(*) FROM issue_tasks WHERE state='open'").fetchone()[0]
        stages = db.execute("SELECT count(*) FROM issue_steps WHERE state='completed'").fetchone()[0]
        distribution = db.execute(
            "SELECT json_extract(data,'$.worker_id'),count(*) FROM issue_jobs WHERE state='completed' GROUP BY json_extract(data,'$.worker_id')"
        ).fetchall()
        observed = db.execute("SELECT count(*) FROM ai_usage").fetchone()[0]
        integrity = db.execute("PRAGMA integrity_check").fetchone()[0]
    report = {
        "passed": codes == [0, 0]
        and completed == waiting == tasks == 100
        and stages == 500
        and len(distribution) == 2
        and observed == 0
        and integrity == "ok",
        "organizations": 2,
        "plants": 4,
        "queued_cases": 100,
        "completed_jobs": completed,
        "waiting_for_input": waiting,
        "open_human_tasks": tasks,
        "completed_stages": stages,
        "worker_distribution": distribution,
        "worker_exit_codes": codes,
        "elapsed_seconds": round(elapsed, 2),
        "jobs_per_second": round(completed / elapsed, 3),
        "provider": "scripted",
        "real_model_responses": False,
        "fixture_basis": "Authored isolated local queue exercise; no cloud or industrial capacity claim",
        "database": str(path),
        "integrity": integrity,
    }
    output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report), flush=True)
    return report["passed"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    raise SystemExit(0 if evaluate(parser.parse_args().output) else 1)
