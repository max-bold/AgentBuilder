import type {
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  McpServer,
  McpTool,
  SimpleChatResponse,
  SkillContent,
  SkillValidation,
  User,
} from "@/types"

const API_BASE = "/api"
const TOKEN_KEY = "agentbuilder_public_token"

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new ApiError(response.status, body.detail || response.statusText)
  }
  return response.json()
}

async function streamRequest(
  path: string,
  body: unknown,
  onEvent: (event: ChatStreamEvent) => void,
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    throw new ApiError(response.status, errorBody.detail || response.statusText)
  }
  if (!response.body) throw new ApiError(response.status, "Streaming is not supported by this browser")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      onEvent(JSON.parse(trimmed) as ChatStreamEvent)
    }
  }
  buffer += decoder.decode()
  const trimmed = buffer.trim()
  if (trimmed) onEvent(JSON.parse(trimmed) as ChatStreamEvent)
}

export const api = {
  login: (login: string, password: string) =>
    request<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ login, password }),
    }),
  register: (payload: { login: string; password: string; e_mail?: string }) =>
    request<{ token: string; user: User }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  me: () => request<User>("/me"),
  simpleChat: (message: string) =>
    request<SimpleChatResponse>("/chat/simple", {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  simpleChatHistory: () => request<ChatMessage[]>("/chat/simple"),
  simpleChatSessions: () => request<ChatSession[]>("/chat/simple/sessions"),
  createSimpleChatSession: () =>
    request<ChatSession>("/chat/simple/sessions", { method: "POST" }),
  renameSimpleChatSession: (sessionId: number, title: string) =>
    request<ChatSession>(`/chat/simple/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),
  deleteSimpleChatSession: (sessionId: number) =>
    request<{ ok: boolean }>(`/chat/simple/sessions/${sessionId}`, {
      method: "DELETE",
    }),
  simpleChatSessionMessage: (sessionId: number, message: string) =>
    request<SimpleChatResponse>(`/chat/simple/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({ message }),
    }),
  streamSimpleChatSessionMessage: (
    sessionId: number,
    message: string,
    onEvent: (event: ChatStreamEvent) => void,
  ) =>
    streamRequest(
      `/chat/simple/sessions/${sessionId}/messages/stream`,
      { message },
      onEvent,
    ),
  simpleChatSessionHistory: (sessionId: number) =>
    request<ChatMessage[]>(`/chat/simple/sessions/${sessionId}/messages`),
  skills: () => request<SkillValidation[]>("/skills"),
  refreshSkills: () =>
    request<SkillValidation[]>("/skills/refresh", { method: "POST" }),
  skillContent: (skillName: string) =>
    request<SkillContent>(`/skills/${encodeURIComponent(skillName)}/content`),
  mcpServers: () => request<McpServer[]>("/mcp/servers"),
  refreshMcp: () => request<McpServer[]>("/mcp/refresh", { method: "POST" }),
  mcpTools: (serverLabel: string) =>
    request<McpTool[]>(
      `/mcp/servers/${encodeURIComponent(serverLabel)}/tools`,
    ),
}
