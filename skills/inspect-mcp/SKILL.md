---
name: inspect-mcp
description: Inspect configured MCP servers and report available tools and diagnostic failures.
---

Use this skill when the user asks to inspect, verify, diagnose, or list MCP servers and their tools.

Procedure:

1. Read the MCP tools and server diagnostics exposed in the current agent context.
2. Return one section per server.
3. Include server label, description, status, and available tool names.
4. If a server is unreachable or returns no tools, report the observed error.
5. Do not invent tools or successful connections.
