# AgentBuilder

AgentBuilder is a generic environment for debugging and running AI agents on the OpenAI Responses API.

It provides a backend, a developer UI, a public chat UI, local skills, MCP diagnostics, raw request/response logs, and a small set of neutral test tools. It is also a practical starting point for deploying your own AI application: replace the prompts, add domain tools and MCP servers, then ship the simplified public frontend.

## What is included

- FastAPI backend with auth, chat sessions, streaming, API logs, skills, and MCP bridge.
- `dev_frontend`: developer console with chats, raw Responses API exchanges, tool activity, Skills diagnostics, and MCP diagnostics.
- `public_frontend`: simplified end-user app with login and chats only.
- Local function tool: `fetch_page_text`.
- Test MCP servers:
  - `echo`: returns echo/add tool results.
  - `test-empty`: intentionally returns no tools for diagnostics testing.
- Local skills:
  - `summarize-text`
  - `inspect-mcp`
- Prompt split under `prompts/`:
  - `AGENT_INSTRUCTIONS.md` for compact always-on behavior.
  - `ASSISTANT_PROMPT.md` for first-turn application context.

## Quick start

Backend:

```powershell
cd D:\Code\AgentBuilder
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env_template .env
uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8101
```

Developer frontend:

```powershell
cd D:\Code\AgentBuilder\dev_frontend
npm install
npm run dev
```

Open `http://localhost:5273`.

Public frontend:

```powershell
cd D:\Code\AgentBuilder\public_frontend
npm install
npm run dev
```

Open `http://localhost:5274`.

Without `OPENAI_API_KEY`, chat runs in stub mode. After setting the key, the backend calls `client.responses.create`, stores `previous_response_id`, logs raw exchanges, and streams model/tool events to the frontend.

## Configuration

Copy `.env_template` to `.env` and adjust:

```env
DATABASE_URL=sqlite:///./agent_builder.db
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
MCP_SETTINGS_PATH=mcp_settings.json
AGENT_SKILLS_DIR=skills
CORS_ORIGINS=http://localhost:5273,http://127.0.0.1:5273,http://localhost:5274,http://127.0.0.1:5274
```

## Repository Layout

```text
backend/          FastAPI app and Responses API agent client
dev_frontend/     Debug UI for agent developers
public_frontend/  Minimal user-facing chat UI
docs/             Setup and extension notes
mcp_servers/      Local test MCP servers
prompts/          Base instructions sent to the model
skills/           Local Codex-style skills
```

## Extending

Use AgentBuilder as a scaffold for your own AI application:

1. Replace `prompts/AGENT_INSTRUCTIONS.md` and `prompts/ASSISTANT_PROMPT.md`.
2. Add domain-specific function tools in `backend/app/tools.py`.
3. Add or connect MCP servers in `mcp_settings.json`.
4. Add reusable workflows under `skills/<name>/SKILL.md`.
5. Keep `dev_frontend` for debugging and adapt `public_frontend` for real users.

See [docs/development.md](docs/development.md), [docs/mcp.md](docs/mcp.md), [docs/prompts.md](docs/prompts.md), and [docs/skills.md](docs/skills.md).
