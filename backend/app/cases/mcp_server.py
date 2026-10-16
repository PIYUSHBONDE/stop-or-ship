"""Private stdio MCP server. Launch configuration belongs to the trusted worker."""

import os

from mcp.server.fastmcp import FastMCP
from mcp.types import ToolAnnotations

from app.cases.tools import TOOL_NAMES, read_tool
from app.core import config


def create_server():
    server = FastMCP("PlantSense evidence", log_level="ERROR")
    capability = os.environ.get("PLANTSENSE_WORKER_CAPABILITY", "")

    def register(name):
        def tool() -> dict:
            """Read authorized case evidence. Scope is fixed by the worker, never supplied by the model."""
            return read_tool(config.DB, capability, name)

        def search(query: str = "") -> dict:
            """Search reviewed references and this plant's confirmed repairs; maximum 300 characters."""
            return read_tool(config.DB, capability, name, query)

        server.add_tool(
            search if name == "search_knowledge" else tool,
            name=name,
            description="Read " + name.replace("_", " ") + " for the authorized case only.",
            annotations=ToolAnnotations(
                readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False
            ),
        )

    for name in TOOL_NAMES:
        register(name)
    return server


if __name__ == "__main__":
    create_server().run(transport="stdio")
