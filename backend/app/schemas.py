from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    login: str
    e_mail: EmailStr | None = None
    first_name: str | None = None
    last_name: str | None = None


class UserRegister(BaseModel):
    login: str
    password: str
    e_mail: EmailStr | None = None
    first_name: str | None = None
    last_name: str | None = None


class UserLogin(BaseModel):
    login: str
    password: str


class AuthResponse(BaseModel):
    token: str
    user: UserRead


class UserUpdate(BaseModel):
    e_mail: EmailStr | None = None
    first_name: str | None = None
    last_name: str | None = None


class ChatRequest(BaseModel):
    message: str


class ChatSessionUpdate(BaseModel):
    title: str


class ChatSessionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    title: str


class ChatResponse(BaseModel):
    response_id: str | None
    text: str


class LlmExchangeRead(BaseModel):
    request_json: str
    response_json: str | None = None
    error: str | None = None


class SimpleChatResponse(ChatResponse):
    exchanges: list[LlmExchangeRead] = []


class ChatMessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    scope_type: str
    scope_id: int
    role: str
    text: str
    response_id: str | None = None


class ApiLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    user_id: int | None
    scope_type: str | None
    scope_id: int | None
    provider: str
    request_json: str
    response_json: str | None
    error: str | None


class SkillValidationRead(BaseModel):
    path: str
    valid: bool
    name: str | None
    description: str | None
    errors: list[str]


class SkillContentRead(BaseModel):
    name: str
    path: str
    content: str


class McpServerStatusRead(BaseModel):
    server_label: str
    ok: bool
    tool_count: int
    error: str | None = None


class McpStatusRead(BaseModel):
    local: list[McpServerStatusRead]
    remote: list[dict]
    remote_statuses: list[McpServerStatusRead] = []


class McpServerRead(BaseModel):
    server_label: str
    server_description: str | None = None
    transport: str
    local: bool
    ok: bool | None = None
    tool_count: int | None = None
    error: str | None = None


class McpToolRead(BaseModel):
    server_label: str
    original_name: str
    function_name: str
    description: str | None = None
    input_schema: dict[str, Any]


class McpToolCallRequest(BaseModel):
    arguments: dict[str, Any] = {}


class McpToolCallResponse(BaseModel):
    server_label: str
    tool_name: str
    result: Any
