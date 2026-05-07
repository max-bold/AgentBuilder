# Development

AgentBuilder has two separate frontends against the same backend API.

## Backend

```powershell
cd D:\Code\AgentBuilder
.\.venv\Scripts\Activate.ps1
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8101
```

Important endpoints:

- `POST /auth/register`
- `POST /auth/login`
- `GET /me`
- `GET /chat/simple/sessions`
- `POST /chat/simple/sessions/{session_id}/messages/stream`
- `GET /logs`
- `GET /skills`
- `GET /mcp/servers`

## Frontends

`dev_frontend` runs on `5273` and includes diagnostics.

`public_frontend` runs on `5274` and includes only login and chat.

Both Vite apps proxy `/api/*` to `http://127.0.0.1:8101/*`.

## Data Model

The database intentionally contains only generic runtime data:

- users
- chat sessions
- chat messages
- API logs

Application-specific business objects should be added by downstream projects, not to the base scaffold.
