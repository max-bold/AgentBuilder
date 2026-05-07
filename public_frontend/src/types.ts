export type User = {
  id: number
  login: string
  e_mail?: string | null
  first_name?: string | null
  last_name?: string | null
}

export type ChatMessage = {
  id?: number
  created_at?: string
  role: "user" | "agent"
  text: string
  response_id?: string | null
}

export type ChatSession = {
  id: number
  created_at: string
  updated_at: string
  title: string
}

export type LlmExchange = {
  request_json: string
  response_json?: string | null
  error?: string | null
}

export type SimpleChatResponse = {
  response_id: string | null
  text: string
  exchanges: LlmExchange[]
}

export type ChatStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_call"; name?: string; status?: string; description?: string; arguments?: unknown }
  | { type: "tool_result"; name?: string; status?: string; result?: unknown }
  | { type: "status"; label: string }
  | { type: "exchange"; index: number; exchange: LlmExchange }
  | { type: "done"; response_id: string | null; text: string; exchanges: LlmExchange[] }
  | { type: "error"; error: string; exchanges?: LlmExchange[] }

export type SkillValidation = {
  path: string
  valid: boolean
  name?: string | null
  description?: string | null
  errors: string[]
}

export type SkillContent = {
  name: string
  path: string
  content: string
}

export type McpServer = {
  server_label: string
  server_description?: string | null
  transport: string
  local: boolean
  ok?: boolean | null
  tool_count?: number | null
  error?: string | null
}

export type McpTool = {
  server_label: string
  original_name: string
  function_name: string
  description?: string | null
  input_schema: Record<string, unknown>
}
