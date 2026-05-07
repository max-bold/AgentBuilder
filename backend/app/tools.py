from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import trafilatura
from sqlalchemy.orm import Session


ToolHandler = Callable[[dict[str, Any], Session], dict[str, Any]]


@dataclass(frozen=True)
class AgentTool:
    schema: dict[str, Any]
    handler: ToolHandler


def fetch_page_text(args: dict[str, Any], _: Session) -> dict[str, Any]:
    url = args.get("url")
    if not url:
        return {"error": "url is required"}
    downloaded = trafilatura.fetch_url(url)
    if not downloaded:
        return {"error": f"Failed to fetch {url}"}
    text = trafilatura.extract(downloaded, include_comments=False, include_tables=False) or ""
    return {"url": url, "text": text[:12000]}


AGENT_TOOLS: dict[str, AgentTool] = {
    "fetch_page_text": AgentTool(
        schema={
            "type": "function",
            "name": "fetch_page_text",
            "description": "Fetch a public web page and extract readable text for analysis.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string", "description": "Absolute URL to fetch."}},
                "required": ["url"],
            },
        },
        handler=fetch_page_text,
    ),
}
