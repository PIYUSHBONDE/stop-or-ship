"""Run portable repository checks; browser acceptance requires an isolated app URL."""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(label, command, cwd=ROOT, environment=None):
    print(f"\n{label}", flush=True)
    subprocess.run(command, cwd=cwd, env=environment, check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--skip-tests", action="store_true", help="Run only static and contract checks"
    )
    parser.add_argument(
        "--build", action="store_true", help="Also build the production frontend"
    )
    parser.add_argument(
        "--containers",
        action="store_true",
        help="Check an already-running Compose stack",
    )
    parser.add_argument(
        "--browser-url",
        help="Run browser acceptance against an isolated test deployment",
    )
    args = parser.parse_args()
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        parser.error("npm is unavailable; install the documented Node runtime first")
    environment = dict(os.environ, PYTHONPATH=str(ROOT / "backend"))
    run("Python lint", [sys.executable, "-m", "ruff", "check", "backend", "scripts"])
    run(
        "Python formatting",
        [sys.executable, "-m", "ruff", "format", "--check", "backend", "scripts"],
    )
    run(
        "OpenAPI contract",
        [sys.executable, "backend/scripts/contracts/export_openapi.py", "--check"],
        environment=environment,
    )
    for name in ["check:api", "format:check", "typecheck", "lint"]:
        run(name, [npm, "run", name], cwd=ROOT / "web")
    if not args.skip_tests:
        run(
            "Backend regression",
            [sys.executable, "-m", "pytest", "backend/tests", "-q"],
        )
        run("Frontend unit checks", [npm, "run", "test:unit"], cwd=ROOT / "web")
    if args.build:
        run("Production frontend", [npm, "run", "build"], cwd=ROOT / "web")
    if args.containers:
        run("Container boundaries", [sys.executable, "scripts/check_containers.py"])
    if args.browser_url:
        run(
            "Browser acceptance (writes test fixtures)",
            [npm, "run", "test:e2e"],
            cwd=ROOT / "web",
            environment=dict(os.environ, PLAYWRIGHT_BASE_URL=args.browser_url),
        )
    print("\nRequested validation checks passed", flush=True)


if __name__ == "__main__":
    main()
