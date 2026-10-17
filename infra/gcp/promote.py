"""Promote prototype images on existing services; never create IAM or migrate data."""

import argparse
import json
from urllib.request import urlopen

from pilot import PRIVATE, PROJECT, REGION, cloud, immutable_image


def describe(name):
    return json.loads(
        cloud(
            "run",
            "services",
            "describe",
            "plantsense-" + name,
            f"--project={PROJECT}",
            f"--region={REGION}",
            "--format=json",
        )
    )


def traffic(name, revisions):
    cloud(
        "run",
        "services",
        "update-traffic",
        "plantsense-" + name,
        f"--project={PROJECT}",
        f"--region={REGION}",
        "--to-revisions="
        + ",".join(f"{revision}={share}" for revision, share in revisions.items()),
        "--quiet",
    )


def promote(tag):
    previous = {}
    candidates = {}
    for name in ("worker", "api", "web"):
        state = describe(name)
        previous[name] = {
            entry["revisionName"]: entry["percent"]
            for entry in state["status"]["traffic"]
            if entry.get("percent", 0)
        }
    (PRIVATE / "previous-traffic.json").write_text(json.dumps(previous, indent=2))
    try:
        for name in ("worker", "api", "web"):
            image = immutable_image("web" if name == "web" else "backend", tag)
            command = [
                "run",
                "services",
                "update",
                "plantsense-" + name,
                f"--project={PROJECT}",
                f"--region={REGION}",
                "--image=" + image,
                "--no-traffic",
                "--tag=candidate",
                "--quiet",
            ]
            if name in {"worker", "api"}:
                command.append(
                    "--update-env-vars=PLANTSENSE_REQUIRE_RELEASE_GATES=false"
                )
            cloud(*command)
            state = describe(name)
            status = state["status"]
            if status["latestCreatedRevisionName"] != status["latestReadyRevisionName"]:
                raise RuntimeError("Candidate did not pass startup readiness")
            candidates[name] = status["latestReadyRevisionName"]
        # Backend startup checks include PostgreSQL readiness; prototype AI reports are optional.
        traffic("worker", {candidates["worker"]: 100})
        traffic("api", {candidates["api"]: 100})
        state = describe("web")
        candidate = next(
            entry["url"]
            for entry in state["status"]["traffic"]
            if entry.get("tag") == "candidate"
        )
        with urlopen(candidate + "/health", timeout=90) as response:
            if response.status != 200:
                raise RuntimeError("Candidate web health failed")
        with urlopen(candidate + "/api/v1/access/state", timeout=90) as response:
            if (
                response.status != 200
                or json.load(response).get("setup_required") is not False
            ):
                raise RuntimeError("Candidate private API/database connection failed")
        traffic("web", {candidates["web"]: 100})
    except Exception:
        for name, revisions in previous.items():
            traffic(name, revisions)
        raise
    print("Evaluated release promoted:", tag, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    arguments = parser.parse_args()
    promote(arguments.tag)
