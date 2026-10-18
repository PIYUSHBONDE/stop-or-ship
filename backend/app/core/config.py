import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INTERNAL_TEST_MODE = os.getenv("PLANTSENSE_INTERNAL_TEST_MODE", "false").lower() == "true"
MODE = os.getenv("PLANTSENSE_MODE", "local")
if MODE not in {"local", "cloud"}:
    raise RuntimeError("PLANTSENSE_MODE must be local or cloud")
POSTGRES_DSN = os.getenv("PLANTSENSE_POSTGRES_DSN", os.getenv("DATABASE_URL", ""))
POSTGRES_EVIDENCE_DSN = os.getenv("PLANTSENSE_POSTGRES_EVIDENCE_DSN", "")
STORAGE = os.getenv("PLANTSENSE_STORAGE", "postgres" if MODE == "cloud" or POSTGRES_DSN else "sqlite")
POSTGRES_SCHEMA = os.getenv("PLANTSENSE_POSTGRES_SCHEMA", "plantsense")
if STORAGE not in {"sqlite", "postgres"}:
    raise RuntimeError("PLANTSENSE_STORAGE must be sqlite or postgres")
PROJECT = os.getenv("GOOGLE_CLOUD_PROJECT", "")
LOCATION = os.getenv("GOOGLE_CLOUD_LOCATION", "global")
EMBEDDING_LOCATION = os.getenv("EMBEDDING_LOCATION", "us-central1")
MODEL = os.getenv("GEMINI_MODEL", "gemini-3.8-flash")
AI_PROVIDER = os.getenv("PLANTSENSE_AI_PROVIDER", "scripted" if INTERNAL_TEST_MODE else "vertex")
if AI_PROVIDER not in {"scripted", "gemini_api", "vertex"}:
    raise RuntimeError("PLANTSENSE_AI_PROVIDER must be scripted, gemini_api or vertex")
DATA = Path(os.getenv("PLANTSENSE_DATA_DIR", str(ROOT / "data")))
DB = os.getenv("PLANTSENSE_DB", str(DATA / "local.db"))
DAILY_LIMIT = int(os.getenv("DAILY_AI_LIMIT", "60"))
DAILY_AI_SPEND_MICRO_USD = int(os.getenv("DAILY_AI_SPEND_MICRO_USD", "2000000"))
INVESTIGATION_AI_SPEND_MICRO_USD = int(os.getenv("INVESTIGATION_AI_SPEND_MICRO_USD", "750000"))
AI_EVALUATION_FILE = os.getenv("PLANTSENSE_AI_EVALUATION_FILE", "")
ASSISTANT_EVALUATION_FILE = os.getenv("PLANTSENSE_ASSISTANT_EVALUATION_FILE", "")
# Standard global text pricing, reviewed 2026-10-09. These are estimates, not invoices.
AI_INPUT_MICRO_USD_PER_MILLION = int(os.getenv("AI_INPUT_MICRO_USD_PER_MILLION", "1500000"))
AI_OUTPUT_MICRO_USD_PER_MILLION = int(os.getenv("AI_OUTPUT_MICRO_USD_PER_MILLION", "9000000"))
WORKER_URL = os.getenv("WORKER_URL", "")
TASK_REGION = os.getenv("TASK_REGION", "us-central1")
TASK_QUEUE = os.getenv("TASK_QUEUE", "plantsense-investigations")
TASK_ACCOUNT = os.getenv("TASK_SERVICE_ACCOUNT", "")
SERVICE_ROLE = os.getenv("SERVICE_ROLE", "api")
REQUIRE_RELEASE_GATES = (
    os.getenv("PLANTSENSE_REQUIRE_RELEASE_GATES", "true" if MODE == "cloud" else "false").lower() == "true"
)
STAFF_WEB_ORIGINS = tuple(
    os.getenv("PLANTSENSE_STAFF_WEB_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
)
if SERVICE_ROLE not in {"api", "worker"}:
    raise RuntimeError("SERVICE_ROLE must be api or worker")
if DAILY_LIMIT < 0:
    raise RuntimeError("DAILY_AI_LIMIT must be non-negative")
if (
    min(
        DAILY_AI_SPEND_MICRO_USD,
        INVESTIGATION_AI_SPEND_MICRO_USD,
        AI_INPUT_MICRO_USD_PER_MILLION,
        AI_OUTPUT_MICRO_USD_PER_MILLION,
    )
    < 0
):
    raise RuntimeError("AI spending limits and pricing must be non-negative")
if MODE == "cloud" and not PROJECT:
    raise RuntimeError("GOOGLE_CLOUD_PROJECT is required in cloud mode")
