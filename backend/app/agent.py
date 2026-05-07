from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any, Iterator, cast
from uuid import uuid4

import httpx
from openai import BadRequestError, OpenAI
from openai.types.responses import ToolParam
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .mcp_bridge import LocalMcpRegistry
from .models import ApiLog, ChatMessage, User
from .skill_registry import SkillRegistry
from .skills import Skill, load_valid_skills
from .tools import AGENT_TOOLS

LlmExchange = dict[str, str | None]
StreamEvent = dict[str, Any]
FORCED_SKILL_RE = re.compile(r"(?<![\w-])@([a-z0-9]+(?:-[a-z0-9]+)*)")


class AgentClient:
    def __init__(
        self,
        settings: Settings | None = None,
        skill_registry: SkillRegistry | None = None,
        mcp_registry: LocalMcpRegistry | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.skill_registry = skill_registry
        self.mcp_registry = mcp_registry
        self.project_root = Path.cwd().resolve()

    def _client(self) -> OpenAI | None:
        if not self.settings.openai_api_key:
            return None
        http_client = None
        if self.settings.socks_proxy_url:
            http_client = httpx.Client(proxy=self.settings.socks_proxy_url, timeout=120)
        return OpenAI(api_key=self.settings.openai_api_key, http_client=http_client)

    def _valid_skills_snapshot(self):
        if self.skill_registry:
            return self.skill_registry.snapshot()
        return load_valid_skills(self.settings.agent_skills_dir)

    def _mcp_server_configs(self) -> list[dict[str, Any]]:
        if self.mcp_registry:
            return self.mcp_registry.remote_tool_configs()
        if not self.settings.mcp_settings_path.exists():
            return []
        try:
            settings = json.loads(self.settings.mcp_settings_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        remote = settings.get("remote", []) if isinstance(settings, dict) else settings
        return [server for server in remote if isinstance(server, dict)]

    def _mcp_tools(self) -> list[ToolParam]:
        tools: list[dict[str, Any]] = []
        for server in self._mcp_server_configs():
            tool = dict(server)
            tool.setdefault("type", "mcp")
            tool.setdefault("require_approval", "never")
            if "server_label" not in tool:
                continue
            if "server_url" not in tool and "connector_id" not in tool:
                continue
            tools.append(tool)
        return cast(list[ToolParam], tools)

    def _tool_schemas(self) -> list[ToolParam]:
        local_tools = [cast(ToolParam, tool.schema) for tool in AGENT_TOOLS.values()]
        skill_tool = self._skill_shell_tool()
        if skill_tool:
            local_tools.append(skill_tool)
        if self.mcp_registry:
            local_tools.extend(cast(list[ToolParam], self.mcp_registry.tool_schemas()))
        return local_tools + self._mcp_tools()

    def _skill_shell_tool(self) -> ToolParam | None:
        skills, _validations = self._valid_skills_snapshot()
        if not skills:
            return None
        return cast(
            ToolParam,
            {
                "type": "shell",
                "environment": {
                    "type": "local",
                    "skills": [
                        {
                            "name": skill.name,
                            "description": skill.description,
                            "path": str(skill.path.resolve()),
                        }
                        for skill in skills
                    ],
                },
            },
        )

    def send_simple(self, *, db: Session, user: User, message: str, session_id: int | None = None) -> tuple[str | None, str, list[LlmExchange]]:
        scope_id = session_id or user.id
        payload = self._chat_payload(db, user, message, scope_id)
        log = self._log_request(db, user, scope_id, payload)
        exchanges: list[LlmExchange] = [{"request_json": json.dumps(payload, ensure_ascii=False, default=str), "response_json": None, "error": None}]

        client = self._client()
        if client is None:
            response_id = f"stub-{uuid4()}"
            text = self._stub_reply(message)
            log.response_json = json.dumps({"id": response_id, "output_text": text}, ensure_ascii=False)
            exchanges[0]["response_json"] = log.response_json
            db.commit()
            return response_id, text, exchanges

        try:
            response = self._create_response(client, payload)
            exchanges[0]["response_json"] = response.model_dump_json()
            response = self._resolve_tool_calls(client, db, response, previous_response_id=response.id, exchanges=exchanges)
            text = getattr(response, "output_text", "") or "Done. The model returned an empty text response."
            log.response_json = response.model_dump_json()
            db.commit()
            return response.id, text, exchanges
        except Exception as exc:
            log.error = str(exc)
            exchanges[-1]["error"] = str(exc)
            db.commit()
            raise

    def stream_simple(
        self,
        *,
        db: Session,
        user: User,
        message: str,
        session_id: int | None = None,
    ) -> Iterator[StreamEvent]:
        scope_id = session_id or user.id
        payload = self._chat_payload(db, user, message, scope_id)
        log = self._log_request(db, user, scope_id, payload)
        exchanges: list[LlmExchange] = [{"request_json": json.dumps(payload, ensure_ascii=False, default=str), "response_json": None, "error": None}]
        yield {"type": "exchange", "index": 0, "exchange": exchanges[0]}

        client = self._client()
        if client is None:
            response_id = f"stub-{uuid4()}"
            text = self._stub_reply(message)
            log.response_json = json.dumps({"id": response_id, "output_text": text}, ensure_ascii=False)
            exchanges[0]["response_json"] = log.response_json
            db.commit()
            yield {"type": "text_delta", "delta": text}
            yield {"type": "exchange", "index": 0, "exchange": exchanges[0]}
            yield {"type": "done", "response_id": response_id, "text": text, "exchanges": exchanges}
            return

        collected_text: list[str] = []
        try:
            response = yield from self._stream_response(client, payload, exchanges, 0, collected_text)
            response = yield from self._resolve_tool_calls_stream(
                client,
                db,
                response,
                previous_response_id=response.id,
                exchanges=exchanges,
                collected_text=collected_text,
                depth=0,
            )
            text = "".join(collected_text) or getattr(response, "output_text", "") or "Done. The model returned an empty text response."
            log.response_json = response.model_dump_json()
            db.commit()
            yield {"type": "done", "response_id": response.id, "text": text, "exchanges": exchanges}
        except Exception as exc:
            log.error = str(exc)
            exchanges[-1]["error"] = str(exc)
            db.commit()
            yield {"type": "error", "error": str(exc), "exchanges": exchanges}

    def _chat_payload(self, db: Session, user: User, message: str, scope_id: int) -> dict[str, Any]:
        previous_agent_response_id = (
            db.query(ChatMessage.response_id)
            .filter(
                ChatMessage.user_id == user.id,
                ChatMessage.scope_type == "simple",
                ChatMessage.scope_id == scope_id,
                ChatMessage.role == "agent",
                ChatMessage.response_id.isnot(None),
            )
            .order_by(ChatMessage.id.desc())
            .limit(1)
            .scalar()
        )
        payload: dict[str, Any] = {
            "model": self.settings.openai_model,
            "instructions": self._instructions(message),
            "input": self._first_turn_input(message, previous_agent_response_id is None),
            "previous_response_id": self._openai_response_id(previous_agent_response_id),
            "tools": self._tool_schemas(),
        }
        return {key: value for key, value in payload.items() if value not in (None, [], "")}

    @staticmethod
    def _log_request(db: Session, user: User, scope_id: int, payload: dict[str, Any]) -> ApiLog:
        log = ApiLog(
            user_id=user.id,
            scope_type="simple",
            scope_id=scope_id,
            request_json=json.dumps(payload, ensure_ascii=False, default=str),
        )
        db.add(log)
        db.commit()
        return log

    def _create_response(self, client: OpenAI, payload: dict[str, Any]) -> Any:
        try:
            return client.responses.create(**payload)
        except BadRequestError as exc:
            fallback_payload = self._fallback_payload(payload, str(exc))
            if fallback_payload != payload:
                return client.responses.create(**fallback_payload)
            raise

    def _create_response_stream(self, client: OpenAI, payload: dict[str, Any]) -> Any:
        stream_payload = dict(payload)
        stream_payload["stream"] = True
        try:
            return client.responses.create(**stream_payload)
        except BadRequestError as exc:
            fallback_payload = self._fallback_payload(stream_payload, str(exc))
            if fallback_payload != stream_payload:
                return client.responses.create(**fallback_payload)
            raise

    def _fallback_payload(self, payload: dict[str, Any], error_text: str) -> dict[str, Any]:
        if "No tool output found for shell call" in error_text or "Invalid 'previous_response_id'" in error_text:
            fallback = dict(payload)
            fallback.pop("previous_response_id", None)
            return fallback
        if "Tool 'shell' is not supported" in error_text:
            return self._without_shell_tools(payload)
        return payload

    @staticmethod
    def _without_shell_tools(payload: dict[str, Any]) -> dict[str, Any]:
        tools = payload.get("tools")
        if not isinstance(tools, list):
            return payload
        filtered = [tool for tool in tools if not (isinstance(tool, dict) and tool.get("type") == "shell")]
        fallback = dict(payload)
        if filtered:
            fallback["tools"] = filtered
        else:
            fallback.pop("tools", None)
        return fallback

    def _stream_response(
        self,
        client: OpenAI,
        payload: dict[str, Any],
        exchanges: list[LlmExchange],
        exchange_index: int,
        collected_text: list[str],
    ) -> Iterator[StreamEvent]:
        final_response = None
        stream = self._create_response_stream(client, payload)
        yield {"type": "status", "label": "Model response started"}
        for event in stream:
            event_type = getattr(event, "type", "")
            if event_type == "response.output_text.delta":
                delta = getattr(event, "delta", "")
                if delta:
                    collected_text.append(delta)
                    yield {"type": "text_delta", "delta": delta}
            elif event_type == "response.output_item.added":
                tool_event = self._tool_call_event(getattr(event, "item", None), "queued")
                if tool_event:
                    yield tool_event
            elif event_type == "response.output_item.done":
                tool_event = self._tool_call_event(getattr(event, "item", None), "ready")
                if tool_event:
                    yield tool_event
            elif event_type.endswith((".in_progress", ".completed", ".failed", ".searching")):
                yield {"type": "tool_call", "status": event_type.rsplit(".", 1)[-1], "name": self._event_tool_name(event), "description": event_type}
            elif event_type == "response.completed":
                final_response = getattr(event, "response", None)
        if final_response is None:
            raise RuntimeError("Streaming response completed without final response payload.")
        exchanges[exchange_index]["response_json"] = final_response.model_dump_json()
        yield {"type": "exchange", "index": exchange_index, "exchange": exchanges[exchange_index]}
        return final_response

    def _resolve_tool_calls(
        self,
        client: OpenAI,
        db: Session,
        response: Any,
        previous_response_id: str,
        exchanges: list[LlmExchange] | None = None,
        depth: int = 0,
    ) -> Any:
        output_items = getattr(response, "output", [])
        function_calls = [item for item in output_items if getattr(item, "type", None) == "function_call"]
        shell_calls = [item for item in output_items if getattr(item, "type", None) == "shell_call"]
        if (not function_calls and not shell_calls) or depth >= 8:
            return response
        outputs = [self._function_call_output(call, db) for call in function_calls]
        outputs.extend(self._shell_call_output(call) for call in shell_calls)
        payload = self._tool_followup_payload(previous_response_id, outputs)
        next_response = self._create_response(client, payload)
        if exchanges is not None:
            exchanges.append(
                {
                    "request_json": json.dumps(payload, ensure_ascii=False, default=str),
                    "response_json": next_response.model_dump_json(),
                    "error": None,
                }
            )
        return self._resolve_tool_calls(client, db, next_response, previous_response_id=next_response.id, exchanges=exchanges, depth=depth + 1)

    def _resolve_tool_calls_stream(
        self,
        client: OpenAI,
        db: Session,
        response: Any,
        previous_response_id: str,
        exchanges: list[LlmExchange],
        collected_text: list[str],
        depth: int = 0,
    ) -> Iterator[StreamEvent]:
        output_items = getattr(response, "output", [])
        function_calls = [item for item in output_items if getattr(item, "type", None) == "function_call"]
        shell_calls = [item for item in output_items if getattr(item, "type", None) == "shell_call"]
        if (not function_calls and not shell_calls) or depth >= 8:
            return response

        outputs = []
        for call in function_calls:
            args = self._json_or_text(getattr(call, "arguments", "")) or {}
            yield {"type": "tool_call", "status": "running", "name": call.name, "arguments": args, "description": self._tool_description(call.name)}
            output = self._function_call_output(call, db)
            yield {"type": "tool_result", "status": "done", "name": call.name, "result": output.get("output")}
            outputs.append(output)
        for call in shell_calls:
            yield {"type": "tool_call", "status": "running", "name": "shell", "arguments": self._shell_call_summary(call), "description": "Shell command"}
            output = self._shell_call_output(call)
            yield {"type": "tool_result", "status": "done", "name": "shell", "result": output.get("output")}
            outputs.append(output)

        payload = self._tool_followup_payload(previous_response_id, outputs)
        exchanges.append({"request_json": json.dumps(payload, ensure_ascii=False, default=str), "response_json": None, "error": None})
        exchange_index = len(exchanges) - 1
        yield {"type": "exchange", "index": exchange_index, "exchange": exchanges[exchange_index]}
        next_response = yield from self._stream_response(client, payload, exchanges, exchange_index, collected_text)
        return (yield from self._resolve_tool_calls_stream(client, db, next_response, next_response.id, exchanges, collected_text, depth + 1))

    def _function_call_output(self, call: Any, db: Session) -> dict[str, Any]:
        args = self._json_or_text(getattr(call, "arguments", "")) or {}
        tool = AGENT_TOOLS.get(call.name)
        if tool:
            result = tool.handler(args, db)
        elif self.mcp_registry:
            try:
                result = self.mcp_registry.call_tool(call.name, args)
            except Exception as exc:
                result = {"error": str(exc)}
        else:
            result = {"error": f"Unknown tool {call.name}"}
        return {"type": "function_call_output", "call_id": call.call_id, "output": json.dumps(result, ensure_ascii=False)}

    def _tool_followup_payload(self, previous_response_id: str, outputs: list[dict[str, Any]]) -> dict[str, Any]:
        payload = {
            "model": self.settings.openai_model,
            "previous_response_id": previous_response_id,
            "input": outputs,
            "tools": self._tool_schemas(),
        }
        return {key: value for key, value in payload.items() if value not in (None, [], "")}

    def _tool_call_event(self, item: Any, status: str) -> StreamEvent | None:
        item_type = getattr(item, "type", None)
        if item_type == "function_call":
            return {
                "type": "tool_call",
                "status": status,
                "name": getattr(item, "name", "function"),
                "arguments": self._json_or_text(getattr(item, "arguments", "")),
                "description": self._tool_description(getattr(item, "name", "")),
            }
        if item_type == "shell_call":
            return {"type": "tool_call", "status": status, "name": "shell", "arguments": self._shell_call_summary(item), "description": "Shell command"}
        return None

    def _tool_description(self, name: str) -> str:
        tool = AGENT_TOOLS.get(name)
        if tool:
            return str(tool.schema.get("description") or name)
        if self.mcp_registry:
            mcp_tool = next((item for item in self.mcp_registry.snapshot().tools if item.function_name == name), None)
            if mcp_tool:
                return mcp_tool.description or mcp_tool.original_name
        return name

    @staticmethod
    def _event_tool_name(event: Any) -> str:
        for key in ("name", "tool_name", "server_label", "item_id"):
            value = getattr(event, key, None)
            if value:
                return str(value)
        return "tool"

    def _shell_call_output(self, call: Any) -> dict[str, Any]:
        action = getattr(call, "action", None)
        commands = self._action_value(action, "commands") or []
        if isinstance(commands, str):
            commands = [commands]
        timeout_ms = self._action_value(action, "timeout_ms") or 10_000
        max_output_length = self._action_value(action, "max_output_length")
        output = [self._run_shell_command(str(command), timeout_ms) for command in commands]
        payload: dict[str, Any] = {"type": "shell_call_output", "call_id": call.call_id, "output": output}
        if max_output_length is not None:
            payload["max_output_length"] = max_output_length
        return payload

    def _shell_call_summary(self, call: Any) -> dict[str, Any]:
        action = getattr(call, "action", None)
        return {"commands": self._action_value(action, "commands") or [], "timeout_ms": self._action_value(action, "timeout_ms")}

    @staticmethod
    def _action_value(action: Any, key: str) -> Any:
        if isinstance(action, dict):
            return action.get(key)
        return getattr(action, key, None)

    def _command_scope_error(self, command: str) -> str | None:
        normalized = command.replace("\\", "/")
        if re.search(r"(^|[\s'\"`/])\.\.([/]|$)", normalized):
            return "Command rejected: relative parent path '..' is outside the project scope."
        for raw_path in re.findall(r"(?<![\w-])([A-Za-z]:[\\/][^'\"\s|;&<>]*)", command):
            try:
                resolved = Path(raw_path).resolve()
            except OSError:
                return f"Command rejected: invalid absolute path {raw_path!r}."
            if resolved != self.project_root and self.project_root not in resolved.parents:
                return f"Command rejected: path {raw_path!r} is outside project root {self.project_root}."
        return None

    def _run_shell_command(self, command: str, timeout_ms: Any) -> dict[str, Any]:
        scope_error = self._command_scope_error(command)
        if scope_error:
            return {"stdout": "", "stderr": scope_error, "outcome": {"type": "exit", "exit_code": 126}}
        try:
            timeout = max(1.0, min(float(timeout_ms) / 1000, 120.0))
        except (TypeError, ValueError):
            timeout = 10.0
        try:
            completed = subprocess.run(
                ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
                cwd=self.project_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
            )
            return {"stdout": completed.stdout, "stderr": completed.stderr, "outcome": {"type": "exit", "exit_code": completed.returncode}}
        except subprocess.TimeoutExpired as exc:
            return {"stdout": self._coerce_process_output(exc.stdout), "stderr": self._coerce_process_output(exc.stderr), "outcome": {"type": "timeout"}}
        except Exception as exc:
            return {"stdout": "", "stderr": str(exc), "outcome": {"type": "exit", "exit_code": 1}}

    @staticmethod
    def _coerce_process_output(value: Any) -> str:
        if value is None:
            return ""
        if isinstance(value, bytes):
            return value.decode("utf-8", errors="replace")
        return str(value)

    @staticmethod
    def _json_or_text(value: str) -> Any:
        if not value:
            return None
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value

    @staticmethod
    def _openai_response_id(response_id: str | None) -> str | None:
        if response_id and response_id.startswith("resp"):
            return response_id
        return None

    def _first_turn_input(self, message: str, is_first_turn: bool) -> str:
        if not is_first_turn:
            return message
        base_prompt = self._read_prompt_file("prompts/ASSISTANT_PROMPT.md")
        if not base_prompt:
            return message
        return f"{base_prompt}\n\n---\n\nUser message:\n{message}"

    def _instructions(self, message: str | None = None) -> str:
        instructions = self._read_prompt_file("prompts/AGENT_INSTRUCTIONS.md")
        base = instructions or "prompts/AGENT_INSTRUCTIONS.md is missing."
        forced_skills = self._forced_skills_for_message(message or "")
        if not forced_skills:
            return base
        skill_blocks = []
        for skill in forced_skills:
            skill_file = skill.path / "SKILL.md"
            try:
                content = skill_file.read_text(encoding="utf-8").strip()
            except OSError:
                content = skill.body.strip()
            skill_blocks.append(
                f"## @{skill.name}\n\n"
                "The user explicitly requested this skill by mentioning it in the chat. "
                "Follow this SKILL.md for the current user request.\n\n"
                f"```markdown\n{content}\n```"
            )
        return f"{base}\n\n---\n\n# User-Forced Skills\n\n" + "\n\n".join(skill_blocks)

    def _forced_skills_for_message(self, message: str) -> list[Skill]:
        if "@" not in message:
            return []
        requested_names = list(dict.fromkeys(FORCED_SKILL_RE.findall(message.lower())))
        if not requested_names:
            return []
        skills, _validations = self._valid_skills_snapshot()
        by_name = {skill.name: skill for skill in skills}
        return [by_name[name] for name in requested_names if name in by_name]

    def _read_prompt_file(self, filename: str) -> str:
        path = self.project_root / filename
        try:
            return path.read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    @staticmethod
    def _stub_reply(message: str) -> str:
        return (
            f"Stub mode without OPENAI_API_KEY. I received your request: {message}\n\n"
            "After configuring the key this endpoint will call the OpenAI Responses API, keep previous_response_id, "
            "log raw request/response exchanges, and expose configured function tools, skills, and MCP tools."
        )
