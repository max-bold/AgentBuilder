from __future__ import annotations

import asyncio
import json
import re
import sys
import threading
import time
from contextlib import asynccontextmanager
from concurrent.futures import Future
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
from mcp import ClientSession
from mcp.client.sse import sse_client
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.client.streamable_http import streamable_http_client


def _safe_name(value: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_]", "_", value)
    safe = re.sub(r"_+", "_", safe).strip("_")
    return safe or "tool"


def _stdio_command(command: str) -> str:
    return sys.executable if Path(command).name.lower() in {"python", "python.exe"} else command


@dataclass(frozen=True)
class McpServerConfig:
    server_label: str
    server_description: str | None = None
    transport: str = "stdio"
    command: str | None = None
    args: list[str] | None = None
    env: dict[str, str] | None = None
    cwd: str | None = None
    server_url: str | None = None
    headers: dict[str, str] | None = None


@dataclass(frozen=True)
class McpTool:
    server_label: str
    server_description: str | None
    original_name: str
    function_name: str
    description: str | None
    input_schema: dict[str, Any]


@dataclass(frozen=True)
class McpServerStatus:
    server_label: str
    ok: bool
    tool_count: int
    error: str | None = None


@dataclass(frozen=True)
class McpSnapshot:
    tools: list[McpTool]
    statuses: list[McpServerStatus]
    remote_servers: list[dict[str, Any]]
    remote_tools: list[McpTool]
    remote_statuses: list[McpServerStatus]
    local_servers: list[McpServerConfig]


def load_mcp_settings(path: Path) -> tuple[list[McpServerConfig], list[dict[str, Any]]]:
    if not path.exists():
        return [], []
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return [], [item for item in data if isinstance(item, dict)]
    local = []
    for item in data.get("local", []):
        if not isinstance(item, dict) or "server_label" not in item:
            continue
        local.append(
            McpServerConfig(
                server_label=item["server_label"],
                server_description=item.get("server_description"),
                transport=item.get("transport", "stdio"),
                command=item.get("command"),
                args=item.get("args"),
                env=item.get("env"),
                cwd=item.get("cwd"),
                server_url=item.get("server_url"),
                headers=item.get("headers"),
            )
        )
    remote = [item for item in data.get("remote", []) if isinstance(item, dict)]
    return local, remote


def _remote_config(item: dict[str, Any]) -> McpServerConfig | None:
    label = item.get("server_label")
    if not label:
        return None
    return McpServerConfig(
        server_label=label,
        server_description=item.get("server_description"),
        transport=item.get("transport") or ("sse" if item.get("server_url") else "http"),
        server_url=item.get("server_url"),
        headers=item.get("headers"),
    )


@asynccontextmanager
async def _session(config: McpServerConfig) -> AsyncIterator[ClientSession]:
    transport = config.transport.lower()
    if transport == "stdio":
        if not config.command:
            raise ValueError("stdio MCP server requires command")
        params = StdioServerParameters(
            command=_stdio_command(config.command),
            args=config.args or [],
            env=config.env,
            cwd=config.cwd,
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session
    elif transport == "sse":
        if not config.server_url:
            raise ValueError("sse MCP server requires server_url")
        async with sse_client(config.server_url, headers=config.headers) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session
    elif transport in {"http", "streamable_http"}:
        if not config.server_url:
            raise ValueError("http MCP server requires server_url")
        async with httpx.AsyncClient(headers=config.headers) as http_client:
            async with streamable_http_client(config.server_url, http_client=http_client) as (read, write, _get_session_id):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    yield session
    else:
        raise ValueError(f"Unsupported MCP transport: {config.transport}")


async def _list_server_tools(config: McpServerConfig) -> list[McpTool]:
    async with _session(config) as session:
        result = await session.list_tools()
    tools = []
    for tool in result.tools:
        original_name = tool.name
        tools.append(
            McpTool(
                server_label=config.server_label,
                server_description=config.server_description,
                original_name=original_name,
                function_name=f"mcp__{_safe_name(config.server_label)}__{_safe_name(original_name)}",
                description=tool.description,
                input_schema=tool.inputSchema or {"type": "object", "properties": {}},
            )
        )
    return tools


async def _call_server_tool(config: McpServerConfig, tool_name: str, arguments: dict[str, Any]) -> Any:
    async with _session(config) as session:
        result = await session.call_tool(tool_name, arguments)
    if hasattr(result, "model_dump"):
        return result.model_dump(mode="json")
    return str(result)


def _run_async(coro: Any, timeout_seconds: float | None = None) -> Any:
    async def run_with_timeout() -> Any:
        if timeout_seconds is None:
            return await coro
        return await asyncio.wait_for(coro, timeout=timeout_seconds)

    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(run_with_timeout())

    future: Future[Any] = Future()

    def runner() -> None:
        try:
            future.set_result(asyncio.run(run_with_timeout()))
        except BaseException as exc:
            future.set_exception(exc)

    thread = threading.Thread(target=runner, name="local-mcp-async-runner", daemon=True)
    thread.start()
    thread.join()
    return future.result()


def _format_single_error(exc: BaseException) -> str:
    if isinstance(exc, TimeoutError):
        return "Timed out while connecting to MCP server"
    if isinstance(exc, httpx.HTTPStatusError):
        response = exc.response
        body = response.text.strip()
        detail = f"HTTP {response.status_code} {response.reason_phrase} from {response.url}"
        if body:
            detail = f"{detail}: {body[:500]}"
        return detail
    if isinstance(exc, httpx.RequestError):
        request = exc.request
        text = str(exc)
        detail = f"{exc.__class__.__name__} while requesting {request.method} {request.url}"
        if text:
            detail = f"{detail}: {text}"
        cause = exc.__cause__ or exc.__context__
        if cause:
            detail = f"{detail}; caused by {cause.__class__.__name__}: {cause}"
        return detail
    text = str(exc)
    return f"{exc.__class__.__name__}: {text}" if text else exc.__class__.__name__


def _flatten_errors(exc: BaseException, depth: int = 0) -> list[str]:
    if depth > 4:
        return [_format_single_error(exc)]
    if isinstance(exc, BaseExceptionGroup):
        lines: list[str] = []
        for index, nested in enumerate(exc.exceptions, start=1):
            for line in _flatten_errors(nested, depth + 1):
                lines.append(f"{index}. {line}" if depth == 0 else line)
        return lines or [_format_single_error(exc)]
    return [_format_single_error(exc)]


def _error_text(exc: Exception) -> str:
    lines = _flatten_errors(exc)
    return "\n".join(dict.fromkeys(lines))


EMPTY_TOOLS_ERROR = "Server returned empty tools list"


class LocalMcpRegistry:
    def __init__(self, settings_path: Path, poll_interval_seconds: float = 5.0) -> None:
        self.settings_path = settings_path
        self.poll_interval_seconds = poll_interval_seconds
        self._lock = threading.Lock()
        self._local_servers: list[McpServerConfig] = []
        self._remote_server_configs: list[McpServerConfig] = []
        self._remote_servers: list[dict[str, Any]] = []
        self._tools: list[McpTool] = []
        self._remote_tools: list[McpTool] = []
        self._statuses: list[McpServerStatus] = []
        self._remote_statuses: list[McpServerStatus] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self.reload()
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._watch_loop, name="local-mcp-registry", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def snapshot(self) -> McpSnapshot:
        with self._lock:
            return McpSnapshot(
                list(self._tools),
                list(self._statuses),
                list(self._remote_servers),
                list(self._remote_tools),
                list(self._remote_statuses),
                list(self._local_servers),
            )

    def reload(self) -> None:
        local_servers, remote_servers = load_mcp_settings(self.settings_path)
        tools: list[McpTool] = []
        statuses: list[McpServerStatus] = []
        for server in local_servers:
            try:
                server_tools = _run_async(_list_server_tools(server))
                if server_tools:
                    tools.extend(server_tools)
                    statuses.append(McpServerStatus(server.server_label, True, len(server_tools)))
                else:
                    statuses.append(McpServerStatus(server.server_label, False, 0, EMPTY_TOOLS_ERROR))
            except Exception as exc:
                statuses.append(McpServerStatus(server.server_label, False, 0, _error_text(exc)))
        remote_server_configs = [config for item in remote_servers if (config := _remote_config(item))]
        remote_tools: list[McpTool] = []
        remote_statuses: list[McpServerStatus] = []
        for server in remote_server_configs:
            try:
                server_tools = _run_async(_list_server_tools(server), timeout_seconds=15)
                if server_tools:
                    remote_tools.extend(server_tools)
                    remote_statuses.append(McpServerStatus(server.server_label, True, len(server_tools)))
                else:
                    remote_statuses.append(McpServerStatus(server.server_label, False, 0, EMPTY_TOOLS_ERROR))
            except Exception as exc:
                remote_statuses.append(McpServerStatus(server.server_label, False, 0, _error_text(exc)))
        with self._lock:
            self._local_servers = local_servers
            self._remote_server_configs = remote_server_configs
            self._remote_servers = remote_servers
            self._tools = tools
            self._remote_tools = remote_tools
            self._statuses = statuses
            self._remote_statuses = remote_statuses

    def tool_schemas(self) -> list[dict[str, Any]]:
        return [
            {
                "type": "function",
                "name": tool.function_name,
                "description": f"[MCP:{tool.server_label}] {tool.description or tool.original_name}",
                "parameters": tool.input_schema,
            }
            for tool in self.snapshot().tools
        ]

    def remote_tool_configs(self) -> list[dict[str, Any]]:
        snapshot = self.snapshot()
        healthy_labels = {status.server_label for status in snapshot.remote_statuses if status.ok}
        return [server for server in snapshot.remote_servers if server.get("server_label") in healthy_labels]

    def call_tool(self, function_name: str, arguments: dict[str, Any]) -> Any:
        snapshot = self.snapshot()
        tool = next((item for item in snapshot.tools if item.function_name == function_name), None)
        if not tool:
            raise ValueError(f"Unknown local MCP function: {function_name}")
        server = next((item for item in self._local_servers if item.server_label == tool.server_label), None)
        if not server:
            raise ValueError(f"Local MCP server not found: {tool.server_label}")
        return _run_async(_call_server_tool(server, tool.original_name, arguments))

    def call_diagnostic_tool(self, server_label: str, tool_name: str, arguments: dict[str, Any]) -> Any:
        snapshot = self.snapshot()
        tool = next(
            (
                item
                for item in [*snapshot.tools, *snapshot.remote_tools]
                if item.server_label == server_label and tool_name in {item.original_name, item.function_name}
            ),
            None,
        )
        if not tool:
            raise ValueError(f"MCP tool not found: {server_label}/{tool_name}")
        server = next((item for item in self._local_servers if item.server_label == server_label), None)
        if not server:
            server = next((item for item in self._remote_server_configs if item.server_label == server_label), None)
        if not server:
            raise ValueError(f"MCP server not found: {server_label}")
        return _run_async(_call_server_tool(server, tool.original_name, arguments), timeout_seconds=60)

    def _watch_loop(self) -> None:
        last_signature = self.settings_path.read_text(encoding="utf-8") if self.settings_path.exists() else ""
        while not self._stop.wait(self.poll_interval_seconds):
            try:
                signature = self.settings_path.read_text(encoding="utf-8") if self.settings_path.exists() else ""
                if signature != last_signature:
                    self.reload()
                    last_signature = signature
            except Exception:
                self.reload()
