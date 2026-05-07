# Agent Notes

AgentBuilder is a generic OpenAI Responses API agent runtime. Keep the repository domain-neutral.

## Architecture

- Backend: FastAPI in `backend/app`.
- Model integration: `backend/app/agent.py`.
- Function tools: `backend/app/tools.py`.
- Persistent data: SQLAlchemy models in `backend/app/models.py`.
- Developer UI: `dev_frontend`.
- Public UI: `public_frontend`.
- Skills: `skills/<skill-name>/SKILL.md`.
- MCP config: `mcp_settings.json`.

## Constraints

- Do not reintroduce project-specific business entities into the generic scaffold.
- Keep `dev_frontend` focused on debugging: raw exchanges, tool activity, skills, MCP.
- Keep `public_frontend` focused on end-user chat: auth, chat list, messages.
- Prefer adding domain behavior as replaceable tools, prompts, MCP servers, or skills.
- Preserve stub mode when `OPENAI_API_KEY` is not configured.

## Verification

Run backend import checks:

```powershell
python -m compileall backend
```

Run frontend builds:

```powershell
cd dev_frontend; npm run build
cd ..\public_frontend; npm run build
```

Run the backend on port `8101`, then use `dev_frontend` on `5273` and `public_frontend` on `5274`.
