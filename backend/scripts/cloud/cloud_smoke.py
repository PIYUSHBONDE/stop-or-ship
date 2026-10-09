"""Read-only project/auth check; optional bounded Gemini/embedding calls for deployment acceptance."""

import argparse
import json

import google.auth
from google.auth.transport.requests import AuthorizedSession

parser = argparse.ArgumentParser()
parser.add_argument("--project", required=True)
parser.add_argument("--model", default="gemini-3.5-flash")
parser.add_argument("--check-model", action="store_true")
args = parser.parse_args()
try:
    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    http = AuthorizedSession(credentials)
    response = http.get("https://cloudresourcemanager.googleapis.com/v1/projects/" + args.project, timeout=15)
    print(
        json.dumps(
            {
                "project": args.project,
                "project_access_status": response.status_code,
                "name": response.json().get("name") if response.ok else None,
            }
        )
    )
    response.raise_for_status()
    if args.check_model:
        from google import genai

        client = genai.Client(
            vertexai=True,
            credentials=credentials,
            project=args.project,
            location="global",
            http_options={"timeout": 15000, "retry_options": {"attempts": 1}},
        )
        result = client.models.generate_content(
            model=args.model,
            contents="Reply with exactly: PlantSense ready",
            config={"max_output_tokens": 32, "temperature": 0},
        )
        print(
            json.dumps(
                {"model": args.model, "text": result.text, "usage": result.usage_metadata.model_dump()}
            )
        )
except Exception as exc:
    # Credential exceptions can contain token data; report only their type, never their raw text.
    print(json.dumps({"cloud_check": "failed", "error_type": type(exc).__name__}))
    raise SystemExit(1) from None
