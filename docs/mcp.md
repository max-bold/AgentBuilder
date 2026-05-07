# MCP

AgentBuilder reads MCP configuration from `mcp_settings.json` by default. Override it with:

```env
MCP_SETTINGS_PATH=mcp_settings.json
```

The same registry is used by the agent and diagnostic endpoints. This keeps the UI aligned with what the agent can actually call.

## Bundled Servers

`echo` is a local stdio MCP server with two tools:

- `echo(message)`: returns the message and a UTC timestamp.
- `add(a, b)`: returns the sum.

`test-empty` starts correctly but intentionally returns an empty tools list. Diagnostics should mark it as failed with `Server returned empty tools list`.

`broken-remote` is intentionally invalid and exists to test remote error reporting.

## Diagnostic Endpoints

All endpoints require the same bearer token as chat:

```text
GET  /mcp/status
GET  /mcp/servers
POST /mcp/refresh
GET  /mcp/servers/{server_label}/tools
POST /mcp/servers/{server_label}/tools/{tool_name}/call
```

Example:

```powershell
Invoke-RestMethod `
  -Uri "http://127.0.0.1:8101/mcp/servers/echo/tools/echo/call" `
  -Method Post `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body (@{ arguments = @{ message = "hello" } } | ConvertTo-Json -Depth 5)
```
