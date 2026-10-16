"""Verify the local Compose runtime and its HTTP trust boundaries without model calls."""

import json
import os
import subprocess
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def docker(*args: str) -> str:
    result = subprocess.run(
        ["docker", *args],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
        timeout=20,
    )
    return result.stdout.strip()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def check_runtime(service: str, uid: str) -> dict:
    container = docker("compose", "ps", "-q", service)
    require(
        bool(container) and "\n" not in container,
        f"Expected one running {service} container",
    )
    inspected = json.loads(docker("inspect", container))[0]
    host = inspected["HostConfig"]
    require(
        inspected["State"].get("Health", {}).get("Status") == "healthy",
        f"{service} is unhealthy",
    )
    require(
        bool(inspected["Config"]["User"]), f"{service} has no explicit runtime user"
    )
    require(host["ReadonlyRootfs"], f"{service} root filesystem is writable")
    require(
        "ALL" in host.get("CapDrop", []), f"{service} has retained Linux capabilities"
    )
    require(
        any(
            opt
            in {"no-new-privileges", "no-new-privileges:true", "no-new-privileges=true"}
            for opt in host["SecurityOpt"]
        ),
        f"{service} permits privilege escalation",
    )
    require(not host["Privileged"], f"{service} is privileged")
    require(
        host["NetworkMode"] != "host" and host["PidMode"] != "host",
        f"{service} uses host namespaces",
    )
    require(
        host["Memory"] > 0 and host["PidsLimit"] > 0 and host["NanoCpus"] > 0,
        f"{service} lacks limits",
    )
    environment = dict(
        item.split("=", 1) for item in inspected["Config"].get("Env", []) if "=" in item
    )
    allowed_bind_paths = set()
    if service == "api" and environment.get("PLANTSENSE_AI_PROVIDER") == "vertex":
        require(
            environment.get("PLANTSENSE_MODE") == "local",
            "Vertex override is not local",
        )
    # Base Compose is manual-only until credentials and matching reports are supplied.
    # Any supplied Vertex configuration still requires the complete read-only mounts.
    if (
        service == "api"
        and environment.get("PLANTSENSE_AI_PROVIDER") == "vertex"
        and any(
            environment.get(key)
            for key in (
                "GOOGLE_APPLICATION_CREDENTIALS",
                "PLANTSENSE_AI_EVALUATION_FILE",
                "PLANTSENSE_ASSISTANT_EVALUATION_FILE",
            )
        )
    ):
        allowed_bind_paths = {
            "/run/secrets/google_adc.json",
            "/run/secrets/gemini_evaluation.json",
        }
        if environment.get("PLANTSENSE_ASSISTANT_EVALUATION_FILE"):
            require(
                environment["PLANTSENSE_ASSISTANT_EVALUATION_FILE"]
                == "/run/secrets/assistant_evaluation.json",
                "Unexpected assistant evaluation path",
            )
            allowed_bind_paths.add("/run/secrets/assistant_evaluation.json")
        require(
            environment.get("GOOGLE_APPLICATION_CREDENTIALS")
            == "/run/secrets/google_adc.json"
            and environment.get("PLANTSENSE_AI_EVALUATION_FILE")
            == "/run/secrets/gemini_evaluation.json",
            "Vertex override has unexpected credential or evaluation paths",
        )
    require(
        all(
            mount["Type"] != "bind"
            or (mount["Destination"] in allowed_bind_paths and not mount["RW"])
            for mount in inspected["Mounts"]
        ),
        f"{service} has an unexpected or writable host bind mount",
    )
    require(
        not allowed_bind_paths
        or allowed_bind_paths.issubset(
            {
                mount["Destination"]
                for mount in inspected["Mounts"]
                if mount["Type"] == "bind"
            }
        ),
        "Vertex override lacks its read-only credential or evaluation mount",
    )
    executable, expression = (
        ("python", "import os; print(os.geteuid())")
        if service == "api"
        else ("node", "console.log(process.getuid())")
    )
    actual_uid = docker(
        "compose",
        "exec",
        "-T",
        service,
        executable,
        "-c" if service == "api" else "-e",
        expression,
    )
    require(actual_uid == uid, f"{service} runs with an unexpected UID")
    return inspected


def check_http(base: str) -> None:
    def request(path: str, *, body=None, token=None, expected=200, origin=None):
        headers = {"Content-Type": "application/json"}
        if token:
            headers["Authorization"] = "Bearer " + token
        if body is not None:
            headers["Origin"] = origin or base
        req = Request(
            base + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=headers,
        )
        try:
            response = urlopen(req, timeout=15)
        except HTTPError as error:
            response = error
        with response:
            require(
                response.status == expected,
                f"{path}: expected HTTP {expected}, got {response.status}",
            )
            content = json.load(response)
            if path == "/health":
                require(
                    response.headers.get("X-Content-Type-Options") == "nosniff",
                    "Missing nosniff header",
                )
                require(
                    response.headers.get("X-Frame-Options") == "DENY",
                    "Missing frame protection",
                )
                require(
                    "no-store"
                    in {
                        directive.strip().lower()
                        for directive in response.headers.get(
                            "Cache-Control", ""
                        ).split(",")
                    },
                    "Health response is cached",
                )
            return content

    require(request("/health")["status"] == "ok", "Web health response is invalid")
    request("/api/v1/access/state")
    request("/api/v1/local-identity", body={}, expected=404)
    request("/api/v1/plants/unselected/snapshot", expected=401)
    request("/api/v1/plants/unselected/sources", expected=401)
    request(
        "/api/v1/access/sign-out",
        body={},
        origin="https://external.invalid",
        expected=403,
    )


def main() -> None:
    api = check_runtime("api", "10001")
    web = check_runtime("web", "1000")
    require(not api["HostConfig"].get("PortBindings"), "API exposes a host port")
    require(
        any(
            mount["Destination"] == "/var/lib/plantsense" and mount["RW"]
            for mount in api["Mounts"]
        ),
        "API lacks a writable persistent data volume",
    )
    ports = web["HostConfig"]["PortBindings"].get("8080/tcp", [])
    require(
        bool(ports) and all(port["HostIp"] == "127.0.0.1" for port in ports),
        "Web is not bound to loopback",
    )
    port = int(os.getenv("PLANTSENSE_WEB_PORT", "3000"))
    require(1 <= port <= 65535, "Invalid configured web port")
    check_http(f"http://127.0.0.1:{port}")
    print(
        "Container users, isolation, storage, health, headers and unauthenticated access boundaries passed"
    )


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        # Docker inspect output may contain credentials in other deployments. Never print it.
        detail = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        raise SystemExit(
            f"Container check failed: {detail}. Check the engine and stack configuration."
        ) from None
