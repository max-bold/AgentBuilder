from __future__ import annotations

import os

os.environ.setdefault("MCP_USE_ANONYMIZED_TELEMETRY", "false")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from mcp.server.fastmcp import FastMCP


mcp = FastMCP("test-empty")


if __name__ == "__main__":
    mcp.run(transport="stdio")
