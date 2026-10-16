"""Only trusted worker code can select the executable, arguments and capability."""

import json
import os
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

from app.cases.jobs import mint_capability
from app.cases.tools import TOOL_NAMES
from app.core import config


async def collect(store, job):
    capability = mint_capability(store, job)
    env = {k: os.environ[k] for k in ("SYSTEMROOT", "PATH", "TEMP", "TMP") if k in os.environ}
    env.update(
        PLANTSENSE_WORKER_CAPABILITY=capability,
        PYTHONPATH=str(Path(__file__).resolve().parents[2]),
        PLANTSENSE_AI_PROVIDER=config.AI_PROVIDER,
        GEMINI_MODEL=config.MODEL,
        GOOGLE_CLOUD_LOCATION=config.LOCATION,
        PLANTSENSE_DATA_DIR=str(config.DATA),
    )
    if getattr(store, "dialect", "sqlite") == "postgres":
        if not store.evidence_dsn:
            raise RuntimeError("PostgreSQL MCP requires a separate evidence identity")
        env.update(
            PLANTSENSE_STORAGE="postgres",
            PLANTSENSE_POSTGRES_DSN=store.evidence_dsn,
            PLANTSENSE_POSTGRES_SCHEMA=store.schema,
        )
    else:
        env.update(PLANTSENSE_STORAGE="sqlite", PLANTSENSE_DB=str(Path(store.path).resolve()))
    # No provider credentials or browser cookies are forwarded to evidence tools.
    params = StdioServerParameters(command=sys.executable, args=["-m", "app.cases.mcp_server"], env=env)
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            available = await session.list_tools()
            if {t.name for t in available.tools} != set(TOOL_NAMES):
                raise ValueError("Unexpected MCP capability set")
            context = {}
            for name in TOOL_NAMES:
                arguments = (
                    {
                        "query": "diagnostic checks independent measurement production repair "
                        + " ".join(
                            a.get("name", "")
                            for a in context.get("equipment_context", {}).get("assets", [])[:1]
                        )
                    }
                    if name == "search_knowledge"
                    else {}
                )
                result = await session.call_tool(name, arguments)
                if result.isError:
                    raise ValueError("Read-only evidence unavailable")
                context[name] = json.loads(next(c.text for c in result.content if c.type == "text"))
            return context
