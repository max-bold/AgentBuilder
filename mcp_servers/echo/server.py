from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

os.environ.setdefault("MCP_USE_ANONYMIZED_TELEMETRY", "false")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")

from mcp.server.fastmcp import FastMCP


mcp = FastMCP("echo")


@mcp.tool()
def echo(message: str) -> dict[str, Any]:
    """Return the provided message with a timestamp."""
    return {
        "message": message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@mcp.tool()
def add(a: float, b: float) -> dict[str, float]:
    """Add two numbers and return the result."""
    return {"result": a + b}


if __name__ == "__main__":
    mcp.run(transport="stdio")
