import json
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from .agent import AgentClient
from .auth import get_current_user, hash_password, issue_token, verify_password
from .config import get_settings
from .database import Base, engine, get_db
from .mcp_bridge import LocalMcpRegistry
from .models import ApiLog, ChatMessage, ChatSession, User
from .skill_registry import SkillRegistry
from .schemas import (
    ApiLogRead,
    AuthResponse,
    ChatMessageRead,
    ChatRequest,
    ChatSessionRead,
    ChatSessionUpdate,
    McpServerRead,
    McpServerStatusRead,
    McpStatusRead,
    McpToolCallRequest,
    McpToolCallResponse,
    McpToolRead,
    SimpleChatResponse,
    SkillContentRead,
    SkillValidationRead,
    UserLogin,
    UserRead,
    UserRegister,
    UserUpdate,
)


Base.metadata.create_all(bind=engine)
settings = get_settings()
skill_registry = SkillRegistry(settings.agent_skills_dir)
mcp_registry = LocalMcpRegistry(settings.mcp_settings_path)


@asynccontextmanager
async def lifespan(_: FastAPI):
    skill_registry.start()
    mcp_registry.start()
    try:
        yield
    finally:
        mcp_registry.stop()
        skill_registry.stop()


app = FastAPI(title="AgentBuilder API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
agent_client = AgentClient(settings, skill_registry, mcp_registry)


def json_line(payload: dict) -> str:
    return json.dumps(payload, ensure_ascii=False, default=str) + "\n"


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/register", response_model=AuthResponse)
def register(payload: UserRegister, db: Session = Depends(get_db)) -> AuthResponse:
    query = db.query(User).filter(User.login == payload.login)
    if payload.e_mail:
        query = query.union(db.query(User).filter(User.e_mail == payload.e_mail))
    existing = query.first()
    if existing:
        raise HTTPException(status_code=409, detail="User already exists")
    user = User(
        login=payload.login,
        password_hash=hash_password(payload.password),
        token=issue_token(),
        e_mail=payload.e_mail,
        first_name=payload.first_name,
        last_name=payload.last_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return AuthResponse(token=user.token, user=UserRead.model_validate(user))


@app.post("/auth/login", response_model=AuthResponse)
def login(payload: UserLogin, db: Session = Depends(get_db)) -> AuthResponse:
    user = db.query(User).filter(User.login == payload.login).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return AuthResponse(token=user.token, user=UserRead.model_validate(user))


@app.get("/me", response_model=UserRead)
def me(user: User = Depends(get_current_user)) -> User:
    return user


@app.patch("/me", response_model=UserRead)
def update_me(payload: UserUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> User:
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return user


def _chat_session_or_404(db: Session, user: User, session_id: int) -> ChatSession:
    session = db.query(ChatSession).filter(ChatSession.id == session_id, ChatSession.owner_id == user.id).first()
    if not session:
        raise HTTPException(status_code=404, detail="Chat not found")
    return session


def _ensure_default_chat_session(db: Session, user: User) -> ChatSession:
    session = (
        db.query(ChatSession)
        .filter(ChatSession.owner_id == user.id)
        .order_by(ChatSession.id.asc())
        .first()
    )
    if session:
        return session
    session = ChatSession(owner_id=user.id, title="Chat 1")
    db.add(session)
    db.flush()
    db.commit()
    db.refresh(session)
    return session


@app.get("/chat/simple/sessions", response_model=list[ChatSessionRead])
def list_chat_sessions(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ChatSession]:
    _ensure_default_chat_session(db, user)
    return (
        db.query(ChatSession)
        .filter(ChatSession.owner_id == user.id)
        .order_by(ChatSession.updated_at.desc(), ChatSession.id.desc())
        .all()
    )


@app.post("/chat/simple/sessions", response_model=ChatSessionRead)
def create_chat_session(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatSession:
    count = db.query(ChatSession).filter(ChatSession.owner_id == user.id).count()
    session = ChatSession(owner_id=user.id, title=f"Chat {count + 1}")
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


@app.patch("/chat/simple/sessions/{session_id}", response_model=ChatSessionRead)
def update_chat_session(
    session_id: int,
    payload: ChatSessionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> ChatSession:
    session = _chat_session_or_404(db, user, session_id)
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Chat title cannot be empty")
    session.title = title[:200]
    db.commit()
    db.refresh(session)
    return session


@app.delete("/chat/simple/sessions/{session_id}")
def delete_chat_session(
    session_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict[str, bool]:
    session = _chat_session_or_404(db, user, session_id)
    db.query(ChatMessage).filter(ChatMessage.user_id == user.id, ChatMessage.scope_type == "simple", ChatMessage.scope_id == session.id).delete(synchronize_session=False)
    db.delete(session)
    db.commit()
    return {"ok": True}


@app.post("/chat/simple/sessions/{session_id}/messages", response_model=SimpleChatResponse)
def chat_session_message(
    session_id: int,
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SimpleChatResponse:
    session = _chat_session_or_404(db, user, session_id)
    db.add(ChatMessage(user_id=user.id, scope_type="simple", scope_id=session.id, role="user", text=payload.message))
    db.commit()
    response_id, text, exchanges = agent_client.send_simple(db=db, user=user, message=payload.message, session_id=session.id)
    db.add(ChatMessage(user_id=user.id, scope_type="simple", scope_id=session.id, role="agent", text=text, response_id=response_id))
    session.updated_at = datetime.utcnow()
    db.commit()
    return SimpleChatResponse(response_id=response_id, text=text, exchanges=exchanges)


@app.post("/chat/simple/sessions/{session_id}/messages/stream")
def chat_session_message_stream(
    session_id: int,
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    session = _chat_session_or_404(db, user, session_id)
    db.add(ChatMessage(user_id=user.id, scope_type="simple", scope_id=session.id, role="user", text=payload.message))
    db.commit()

    def events():
        final_event = None
        for event in agent_client.stream_simple(db=db, user=user, message=payload.message, session_id=session.id):
            if event.get("type") == "done":
                final_event = event
            yield json_line(event)
        if final_event:
            db.add(
                ChatMessage(
                    user_id=user.id,
                    scope_type="simple",
                    scope_id=session.id,
                    role="agent",
                    text=final_event.get("text", ""),
                    response_id=final_event.get("response_id"),
                )
            )
            session.updated_at = datetime.utcnow()
            db.commit()

    return StreamingResponse(events(), media_type="application/x-ndjson")


@app.get("/chat/simple/sessions/{session_id}/messages", response_model=list[ChatMessageRead])
def chat_session_history(
    session_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ChatMessage]:
    session = _chat_session_or_404(db, user, session_id)
    return (
        db.query(ChatMessage)
        .filter(ChatMessage.scope_type == "simple", ChatMessage.scope_id == session.id, ChatMessage.user_id == user.id)
        .order_by(ChatMessage.id.asc())
        .all()
    )


@app.post("/chat/simple", response_model=SimpleChatResponse)
def simple_chat(
    payload: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> SimpleChatResponse:
    session = _ensure_default_chat_session(db, user)
    return chat_session_message(session.id, payload, db, user)


@app.get("/chat/simple", response_model=list[ChatMessageRead])
def simple_chat_history(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[ChatMessage]:
    session = _ensure_default_chat_session(db, user)
    return chat_session_history(session.id, db, user)


@app.get("/logs", response_model=list[ApiLogRead])
def list_logs(db: Session = Depends(get_db), user: User = Depends(get_current_user)) -> list[ApiLog]:
    return db.query(ApiLog).filter(ApiLog.user_id == user.id).order_by(ApiLog.id.desc()).limit(100).all()


@app.get("/skills", response_model=list[SkillValidationRead])
def list_skills(user: User = Depends(get_current_user)) -> list[SkillValidationRead]:
    _skills, validations = agent_client._valid_skills_snapshot()
    return [SkillValidationRead(**validation.__dict__) for validation in validations]


@app.post("/skills/refresh", response_model=list[SkillValidationRead])
def refresh_skills(user: User = Depends(get_current_user)) -> list[SkillValidationRead]:
    if agent_client.skill_registry:
        agent_client.skill_registry.reload()
    _skills, validations = agent_client._valid_skills_snapshot()
    return [SkillValidationRead(**validation.__dict__) for validation in validations]


@app.get("/skills/{skill_name}/content", response_model=SkillContentRead)
def get_skill_content(skill_name: str, user: User = Depends(get_current_user)) -> SkillContentRead:
    skills, _validations = agent_client._valid_skills_snapshot()
    skill = next((item for item in skills if item.name == skill_name), None)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found")
    skill_file = skill.path / "SKILL.md"
    try:
        content = skill_file.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read SKILL.md: {exc}") from exc
    return SkillContentRead(name=skill.name, path=str(skill_file), content=content)


def _agent_mcp_registry() -> LocalMcpRegistry:
    if not agent_client.mcp_registry:
        raise HTTPException(status_code=503, detail="Agent MCP registry is not configured")
    return agent_client.mcp_registry


@app.get("/mcp/status", response_model=McpStatusRead)
def mcp_status(user: User = Depends(get_current_user)) -> McpStatusRead:
    registry = _agent_mcp_registry()
    snapshot = registry.snapshot()
    return McpStatusRead(
        local=[McpServerStatusRead(**status.__dict__) for status in snapshot.statuses],
        remote=snapshot.remote_servers,
        remote_statuses=[McpServerStatusRead(**status.__dict__) for status in snapshot.remote_statuses],
    )


@app.get("/mcp/servers", response_model=list[McpServerRead])
def list_mcp_servers(user: User = Depends(get_current_user)) -> list[McpServerRead]:
    return _mcp_servers_snapshot()


@app.post("/mcp/refresh", response_model=list[McpServerRead])
def refresh_mcp(user: User = Depends(get_current_user)) -> list[McpServerRead]:
    registry = _agent_mcp_registry()
    registry.reload()
    return _mcp_servers_snapshot()


def _mcp_servers_snapshot() -> list[McpServerRead]:
    registry = _agent_mcp_registry()
    snapshot = registry.snapshot()
    statuses = {status.server_label: status for status in snapshot.statuses}
    local_labels = {tool.server_label for tool in snapshot.tools}
    local_labels.update(statuses.keys())
    servers = []
    for label in sorted(local_labels):
        status = statuses.get(label)
        config = next((server for server in snapshot.local_servers if server.server_label == label), None)
        description = config.server_description if config else next((tool.server_description for tool in snapshot.tools if tool.server_label == label), None)
        servers.append(
            McpServerRead(
                server_label=label,
                server_description=description,
                transport=config.transport if config else "stdio",
                local=True,
                ok=status.ok if status else None,
                tool_count=status.tool_count if status else None,
                error=status.error if status else None,
            )
        )
    for server in snapshot.remote_servers:
        label = server.get("server_label")
        if not label:
            continue
        status = next((item for item in snapshot.remote_statuses if item.server_label == label), None)
        servers.append(
            McpServerRead(
                server_label=label,
                server_description=server.get("server_description"),
                transport=server.get("transport", "sse" if server.get("server_url") else "remote"),
                local=False,
                ok=status.ok if status else None,
                tool_count=status.tool_count if status else None,
                error=status.error if status else None,
            )
        )
    return servers


@app.get("/mcp/servers/{server_label}/tools", response_model=list[McpToolRead])
def list_mcp_server_tools(server_label: str, user: User = Depends(get_current_user)) -> list[McpToolRead]:
    registry = _agent_mcp_registry()
    snapshot = registry.snapshot()
    statuses = {status.server_label: status for status in [*snapshot.statuses, *snapshot.remote_statuses]}
    all_tools = [*snapshot.tools, *snapshot.remote_tools]
    if server_label not in statuses and not any(tool.server_label == server_label for tool in all_tools):
        raise HTTPException(status_code=404, detail="MCP server not found")
    status = statuses.get(server_label)
    if status and not status.ok:
        raise HTTPException(status_code=503, detail=status.error or "MCP server is unavailable")
    return [
        McpToolRead(
            server_label=tool.server_label,
            original_name=tool.original_name,
            function_name=tool.function_name,
            description=tool.description,
            input_schema=tool.input_schema,
        )
        for tool in all_tools
        if tool.server_label == server_label
    ]


@app.post("/mcp/servers/{server_label}/tools/{tool_name}/call", response_model=McpToolCallResponse)
def call_mcp_server_tool(
    server_label: str,
    tool_name: str,
    payload: McpToolCallRequest,
    user: User = Depends(get_current_user),
) -> McpToolCallResponse:
    registry = _agent_mcp_registry()
    snapshot = registry.snapshot()
    status = next((item for item in [*snapshot.statuses, *snapshot.remote_statuses] if item.server_label == server_label), None)
    all_tools = [*snapshot.tools, *snapshot.remote_tools]
    if not status and not any(tool.server_label == server_label for tool in all_tools):
        raise HTTPException(status_code=404, detail="MCP server not found")
    if status and not status.ok:
        raise HTTPException(status_code=503, detail=status.error or "MCP server is unavailable")
    tool = next(
        (
            item
            for item in all_tools
            if item.server_label == server_label and tool_name in {item.original_name, item.function_name}
        ),
        None,
    )
    if not tool:
        raise HTTPException(status_code=404, detail="MCP tool not found")
    try:
        result = registry.call_diagnostic_tool(server_label, tool_name, payload.arguments)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return McpToolCallResponse(server_label=server_label, tool_name=tool.original_name, result=result)
