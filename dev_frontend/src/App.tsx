import type { FormEvent, KeyboardEvent, ReactNode } from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCcw,
  Send,
  Server,
  TerminalSquare,
  Trash2,
  UserRound,
  XCircle,
} from "lucide-react"

import { ApiError, api, getToken, setToken } from "@/api"
import { Button } from "@/components/ui/button"
import type {
  ChatMessage,
  ChatSession,
  ChatStreamEvent,
  LlmExchange,
  McpServer,
  McpTool,
  SkillContent,
  SkillValidation,
  User,
} from "@/types"

type View = "chat" | "skills" | "mcp"

type ToolActivity = {
  id: number
  kind: "call" | "result" | "status"
  name: string
  status: string
  description?: string
  detail?: string
}

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [view, setView] = useState<View>("chat")
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [activeChatId, setActiveChatId] = useState<number | null>(null)
  const [chatsExpanded, setChatsExpanded] = useState(true)
  const [chatListLoading, setChatListLoading] = useState(false)
  const [booting, setBooting] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    let cancelled = false
    async function boot() {
      if (!getToken()) {
        setBooting(false)
        return
      }
      try {
        const currentUser = await api.me()
        if (!cancelled) setUser(currentUser)
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) setToken(null)
        else if (!cancelled) setError(readError(err, "Failed to load profile"))
      } finally {
        if (!cancelled) setBooting(false)
      }
    }
    boot()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!user) {
      return
    }
    queueMicrotask(() => {
      if (!cancelled) setChatListLoading(true)
    })
    api
      .simpleChatSessions()
      .then((sessions) => {
        if (cancelled) return
        setChatSessions(sessions)
        setActiveChatId((current) =>
          current && sessions.some((session) => session.id === current)
            ? current
            : sessions[0]?.id || null,
        )
      })
      .catch((err) => {
        if (!cancelled) setError(readError(err, "Failed to load chats"))
      })
      .finally(() => {
        if (!cancelled) setChatListLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [user])

  function logout() {
    setToken(null)
    setUser(null)
    setView("chat")
    setChatSessions([])
    setActiveChatId(null)
    setChatsExpanded(true)
  }

  async function createChat() {
    setError("")
    try {
      const session = await api.createSimpleChatSession()
      setChatSessions((items) => [session, ...items])
      setActiveChatId(session.id)
      setView("chat")
      setChatsExpanded(true)
    } catch (err) {
      setError(readError(err, "Failed to create chat"))
    }
  }

  async function renameChat(session: ChatSession) {
    const title = window.prompt("Rename chat", session.title)
    if (title === null) return
    const nextTitle = title.trim()
    if (!nextTitle) return
    setError("")
    try {
      const updated = await api.renameSimpleChatSession(session.id, nextTitle)
      setChatSessions((items) =>
        items.map((item) => (item.id === updated.id ? updated : item)),
      )
    } catch (err) {
      setError(readError(err, "Failed to rename chat"))
    }
  }

  async function deleteChat(session: ChatSession) {
    if (!window.confirm(`Delete "${session.title}"?`)) return
    setError("")
    try {
      await api.deleteSimpleChatSession(session.id)
      const next = chatSessions.filter((item) => item.id !== session.id)
      setChatSessions(next)
      if (activeChatId === session.id) setActiveChatId(next[0]?.id || null)
    } catch (err) {
      setError(readError(err, "Failed to delete chat"))
    }
  }

  function touchChat(sessionId: number) {
    const now = new Date().toISOString()
    setChatSessions((items) =>
      items
        .map((item) =>
          item.id === sessionId ? { ...item, updated_at: now } : item,
        )
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    )
  }

  if (booting) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </main>
    )
  }

  if (!user) return <AuthPage onAuthed={setUser} initialError={error} />

  return (
    <main className="grid min-h-svh bg-background text-foreground lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="border-b border-border bg-muted/25 px-4 py-3 lg:border-b-0 lg:border-r lg:py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <TerminalSquare className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">AgentBuilder Dev</h1>
            <p className="truncate text-xs text-muted-foreground">{user.login}</p>
          </div>
        </div>

        <nav className="mt-5 grid grid-cols-3 gap-2 lg:grid-cols-1">
          <div className="col-span-3 min-w-0 lg:col-span-1 lg:space-y-1">
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2rem] gap-1">
              <NavButton
                active={view === "chat"}
                onClick={() => setChatsExpanded((current) => !current)}
              >
                {chatsExpanded ? (
                  <ChevronDown className="size-4" />
                ) : (
                  <ChevronRight className="size-4" />
                )}
                <Bot className="size-4" /> Chats
              </NavButton>
              <Button
                aria-label="Create chat"
                className="size-8 justify-self-end"
                size="icon"
                variant="ghost"
                onClick={createChat}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            {chatsExpanded && (
              <div className="mt-2 space-y-1 border-l border-border pl-3">
                {chatSessions.map((session) => (
                  <SidebarChatItem
                    active={view === "chat" && activeChatId === session.id}
                    key={session.id}
                    session={session}
                    onDelete={() => deleteChat(session)}
                    onRename={() => renameChat(session)}
                    onSelect={() => {
                      setActiveChatId(session.id)
                      setView("chat")
                    }}
                  />
                ))}
                {chatListLoading && (
                  <div className="px-2 py-1 text-xs text-muted-foreground">
                    Loading chats...
                  </div>
                )}
              </div>
            )}
          </div>
          <NavButton
            active={view === "skills"}
            onClick={() => {
              setView("skills")
              setChatsExpanded(false)
            }}
          >
            <FileText className="size-4" /> Skills
          </NavButton>
          <NavButton
            active={view === "mcp"}
            onClick={() => {
              setView("mcp")
              setChatsExpanded(false)
            }}
          >
            <Server className="size-4" /> MCP
          </NavButton>
        </nav>

        <Button
          className="mt-4 w-full justify-start"
          variant="ghost"
          onClick={logout}
        >
          <LogOut className="size-4" /> Logout
        </Button>
      </aside>

      <section className="min-w-0">
        {view === "chat" && (
          <ChatPage
            chatId={activeChatId}
            chatTitle={
              chatSessions.find((session) => session.id === activeChatId)?.title ||
              "Model Chat"
            }
            onMessageSent={touchChat}
            onCreateChat={createChat}
          />
        )}
        {view === "skills" && <SkillsPage />}
        {view === "mcp" && <McpPage />}
      </section>
    </main>
  )
}

function SidebarChatItem({
  active,
  session,
  onDelete,
  onRename,
  onSelect,
}: {
  active: boolean
  session: ChatSession
  onDelete: () => void
  onRename: () => void
  onSelect: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="relative flex min-w-0 items-center gap-1">
      <button
        className={`flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg px-2 text-left text-sm transition ${
          active ? "bg-secondary text-secondary-foreground" : "hover:bg-muted"
        }`}
        onClick={onSelect}
        type="button"
      >
        <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{session.title}</span>
      </button>
      <Button
        aria-label={`${session.title} actions`}
        className="size-7"
        size="icon-sm"
        variant="ghost"
        onClick={() => setMenuOpen((current) => !current)}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {menuOpen && (
        <div className="absolute right-0 top-8 z-20 w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
          <button
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm hover:bg-muted"
            onClick={() => {
              setMenuOpen(false)
              onRename()
            }}
            type="button"
          >
            <Pencil className="size-3.5" /> Rename
          </button>
          <button
            className="flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm text-destructive hover:bg-destructive/10"
            onClick={() => {
              setMenuOpen(false)
              onDelete()
            }}
            type="button"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

function AuthPage({
  onAuthed,
  initialError,
}: {
  onAuthed: (user: User) => void
  initialError?: string
}) {
  const [mode, setMode] = useState<"login" | "register">("login")
  const [login, setLogin] = useState("developer")
  const [email, setEmail] = useState("developer@example.com")
  const [password, setPassword] = useState("password")
  const [error, setError] = useState(initialError || "")
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError("")
    try {
      const result =
        mode === "login"
          ? await api.login(login, password)
          : await api.register({ login, password, e_mail: email })
      setToken(result.token)
      onAuthed(result.user)
    } catch (err) {
      setError(readError(err, "Authentication failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/30 p-4">
      <form
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-sm"
        onSubmit={submit}
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <UserRound className="size-5" />
          </div>
          <div>
            <h1 className="text-base font-semibold">AgentBuilder Dev</h1>
            <p className="text-sm text-muted-foreground">Login, chat, and inspect agent runs</p>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 rounded-md bg-muted p-1">
          <button
            type="button"
            className={tabClass(mode === "login")}
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={tabClass(mode === "register")}
            onClick={() => setMode("register")}
          >
            Register
          </button>
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <label className="mt-4 block text-sm font-medium">
          Login
          <input
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            value={login}
            onChange={(event) => setLogin(event.target.value)}
            required
          />
        </label>
        {mode === "register" && (
          <label className="mt-4 block text-sm font-medium">
            Email
            <input
              className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        )}
        <label className="mt-4 block text-sm font-medium">
          Password
          <input
            className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>
        <Button className="mt-5 w-full" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {mode === "login" ? "Sign in" : "Create account"}
        </Button>
      </form>
    </main>
  )
}

function ChatPage({
  chatId,
  chatTitle,
  onCreateChat,
  onMessageSent,
}: {
  chatId: number | null
  chatTitle: string
  onCreateChat: () => void
  onMessageSent: (chatId: number) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [exchanges, setExchanges] = useState<LlmExchange[]>([])
  const [toolEvents, setToolEvents] = useState<ToolActivity[]>([])
  const [message, setMessage] = useState("")
  const [skills, setSkills] = useState<SkillValidation[]>([])
  const [skillMenuIndex, setSkillMenuIndex] = useState(0)
  const [cursorPosition, setCursorPosition] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const listRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const latestToolEvent = toolEvents[toolEvents.length - 1]
  const busyStatus = latestToolEvent
    ? chatStatusText(latestToolEvent)
    : "Thinking"
  const validSkills = useMemo(
    () => skills.filter((skill) => skill.valid && skill.name),
    [skills],
  )
  const activeSkillMention = useMemo(
    () => findActiveSkillMention(message, cursorPosition),
    [message, cursorPosition],
  )
  const skillSuggestions = useMemo(() => {
    if (!activeSkillMention) return []
    const query = activeSkillMention.query.toLowerCase()
    return validSkills
      .filter((skill) => skill.name!.toLowerCase().includes(query))
      .slice(0, 8)
  }, [activeSkillMention, validSkills])
  const showSkillSuggestions = !!activeSkillMention && !!skillSuggestions.length

  useEffect(() => {
    let cancelled = false
    if (!chatId) {
      queueMicrotask(() => {
        if (!cancelled) setMessages([])
      })
      return
    }
    queueMicrotask(() => {
      if (!cancelled) {
        setError("")
        setExchanges([])
        setToolEvents([])
      }
    })
    api
      .simpleChatSessionHistory(chatId)
      .then((history) => {
        if (!cancelled) setMessages(history)
      })
      .catch((err) => {
        if (!cancelled) setError(readError(err, "Failed to load chat history"))
      })
    return () => {
      cancelled = true
    }
  }, [chatId])

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, busy, toolEvents])

  useEffect(() => {
    let cancelled = false
    api
      .skills()
      .then((items) => {
        if (!cancelled) setSkills(items)
      })
      .catch(() => {
        if (!cancelled) setSkills([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setSkillMenuIndex(0)
  }, [activeSkillMention?.query])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = message.trim()
    if (!text || busy || !chatId) return
    setMessage("")
    setError("")
    setExchanges([])
    setToolEvents([])
    setMessages((items) => [...items, { role: "user", text }, { role: "agent", text: "" }])
    setBusy(true)
    try {
      await api.streamSimpleChatSessionMessage(chatId, text, (event) => {
        handleStreamEvent(event)
      })
      onMessageSent(chatId)
    } catch (err) {
      setMessages((items) => items.filter((item, index) => item.text || index !== items.length - 1))
      setError(readError(err, "Agent request failed"))
    } finally {
      setBusy(false)
    }
  }

  function refreshCursorPosition(element: HTMLTextAreaElement) {
    setCursorPosition(element.selectionStart)
  }

  function insertSkillMention(skillName: string) {
    if (!activeSkillMention) return
    const before = message.slice(0, activeSkillMention.start)
    const after = message.slice(activeSkillMention.end)
    const separator = after && /^\s/.test(after) ? "" : " "
    const nextMessage = `${before}@${skillName}${separator}${after}`
    const nextCursor = before.length + skillName.length + 1 + separator.length
    setMessage(nextMessage)
    setCursorPosition(nextCursor)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (showSkillSuggestions) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setSkillMenuIndex((current) => (current + 1) % skillSuggestions.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setSkillMenuIndex(
          (current) => (current - 1 + skillSuggestions.length) % skillSuggestions.length,
        )
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        const skill = skillSuggestions[skillMenuIndex]
        if (skill?.name) insertSkillMention(skill.name)
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setCursorPosition(-1)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  function updateStreamingAgent(
    update: (message: ChatMessage) => ChatMessage,
  ) {
    setMessages((items) => {
      const index = [...items].reverse().findIndex((item) => item.role === "agent")
      if (index < 0) return items
      const agentIndex = items.length - 1 - index
      return items.map((item, itemIndex) => (itemIndex === agentIndex ? update(item) : item))
    })
  }

  function handleStreamEvent(event: ChatStreamEvent) {
    if (event.type === "text_delta") {
      updateStreamingAgent((item) => ({ ...item, text: `${item.text}${event.delta}` }))
      return
    }
    if (event.type === "exchange") {
      setExchanges((items) => {
        const next = [...items]
        next[event.index] = event.exchange
        return next
      })
      return
    }
    if (event.type === "tool_call") {
      setToolEvents((items) => [
        ...items,
        {
          id: items.length + 1,
          kind: "call",
          name: event.name || "tool",
          status: event.status || "queued",
          description: event.description,
          detail: formatEventDetail(event.arguments),
        },
      ])
      return
    }
    if (event.type === "tool_result") {
      setToolEvents((items) => [
        ...items,
        {
          id: items.length + 1,
          kind: "result",
          name: event.name || "tool",
          status: event.status || "done",
          detail: formatEventDetail(event.result),
        },
      ])
      return
    }
    if (event.type === "status") {
      setToolEvents((items) => [
        ...items,
        {
          id: items.length + 1,
          kind: "status",
          name: event.label,
          status: "active",
        },
      ])
      return
    }
    if (event.type === "done") {
      setExchanges(event.exchanges || [])
      updateStreamingAgent((item) => ({
        ...item,
        text: event.text || item.text,
        response_id: event.response_id,
      }))
      return
    }
    if (event.type === "error") {
      if (event.exchanges) setExchanges(event.exchanges)
      throw new Error(event.error)
    }
  }

  return (
    <div className="flex h-svh flex-col">
      <PageHeader
        title={chatTitle}
        subtitle="Plain authenticated dialog with the agent runtime."
      />
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,44vw)]">
        <div className="flex min-h-0 flex-col border-border lg:border-r">
          {!chatId && (
            <div className="px-4 pt-4 md:px-6">
              <Notice>
                No chats yet.{" "}
                <button
                  className="font-medium text-foreground underline underline-offset-4"
                  onClick={onCreateChat}
                  type="button"
                >
                  Create one
                </button>
                .
              </Notice>
            </div>
          )}
          {error && (
            <div className="px-4 pt-4 md:px-6">
              <Notice tone="error">{error}</Notice>
            </div>
          )}
          <div
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 md:px-6"
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-3">
              {!messages.length && !busy && (
                <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  Start a debug dialog with the model.
                </div>
              )}
              {messages.map((item, index) => (
                <div
                  className={`max-w-[82%] whitespace-pre-wrap rounded-md px-2.5 py-1.5 text-sm leading-5 ${
                    item.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "mr-auto border border-border bg-card"
                  }`}
                  key={`${item.id || index}-${item.role}`}
                >
                  {item.text}
                </div>
              ))}
              {busy && (
                <div className="mr-auto flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  <span className="min-w-0 truncate">{busyStatus}</span>
                </div>
              )}
            </div>
          </div>
          <form className="border-t border-border p-4 md:p-6" onSubmit={submit}>
            <div className="mx-auto flex max-w-3xl gap-2">
              <div className="relative min-w-0 flex-1">
                {showSkillSuggestions && (
                  <div className="absolute bottom-full left-0 z-30 mb-2 max-h-72 w-full overflow-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
                    {skillSuggestions.map((skill, index) => (
                      <button
                        className={`block w-full rounded-sm px-3 py-2 text-left text-sm ${
                          index === skillMenuIndex ? "bg-muted" : "hover:bg-muted"
                        }`}
                        key={skill.name}
                        onMouseDown={(event) => {
                          event.preventDefault()
                          if (skill.name) insertSkillMention(skill.name)
                        }}
                        type="button"
                      >
                        <span className="block font-medium">@{skill.name}</span>
                        {skill.description && (
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                            {skill.description}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                <textarea
                  ref={textareaRef}
                  className="min-h-12 w-full resize-none rounded-md border border-input bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  rows={1}
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value)
                    refreshCursorPosition(event.currentTarget)
                  }}
                  onClick={(event) => refreshCursorPosition(event.currentTarget)}
                  onKeyDown={handleComposerKeyDown}
                  onKeyUp={(event) => {
                    if (event.key !== "Escape") refreshCursorPosition(event.currentTarget)
                  }}
                  onSelect={(event) => refreshCursorPosition(event.currentTarget)}
                  placeholder="Message the agent..."
                />
              </div>
              <Button className="h-12 w-12" disabled={busy || !message.trim() || !chatId}>
                <Send className="size-4" />
              </Button>
            </div>
          </form>
        </div>
        <RawTracePanel exchanges={exchanges} busy={busy} toolEvents={toolEvents} />
      </div>
    </div>
  )
}

function RawTracePanel({
  exchanges,
  busy,
  toolEvents,
}: {
  exchanges: LlmExchange[]
  busy: boolean
  toolEvents: ToolActivity[]
}) {
  return (
    <aside className="min-h-0 overflow-y-auto bg-muted/20 p-4 md:p-6">
      <div className="mb-4">
        <h2 className="text-sm font-semibold">Raw LLM Traffic</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Requests and responses for the latest user message.
        </p>
      </div>
      <ToolActivityList events={toolEvents} busy={busy} />
      {!exchanges.length && (
        <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
          {busy ? "Waiting for the first LLM response..." : "Send a message to inspect raw traffic."}
        </div>
      )}
      <div className="space-y-4">
        {exchanges.map((exchange, index) => (
          <article
            className="rounded-lg border border-border bg-card p-3"
            key={index}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Exchange {index + 1}</h3>
              {exchange.error && (
                <span className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
                  error
                </span>
              )}
            </div>
            <RawBlock label="Request" value={exchange.request_json} />
            <RawBlock label="Response" value={exchange.response_json || ""} />
            {exchange.error && <RawBlock label="Error" value={exchange.error} />}
          </article>
        ))}
      </div>
    </aside>
  )
}

function ToolActivityList({
  events,
  busy,
}: {
  events: ToolActivity[]
  busy: boolean
}) {
  if (!events.length) return null
  return (
    <div className="mb-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Activity
        </h3>
        {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div className="space-y-2">
        {events.map((event) => (
          <article
            className="rounded-lg border border-border bg-background p-3 text-xs"
            key={event.id}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{event.name}</div>
                {event.description && (
                  <div className="mt-0.5 truncate text-muted-foreground">
                    {event.description}
                  </div>
                )}
              </div>
              <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                {event.status}
              </span>
            </div>
            {event.detail && (
              <pre className="mt-2 max-h-24 overflow-auto whitespace-pre-wrap rounded-md bg-muted/60 p-2 leading-4">
                {event.detail}
              </pre>
            )}
          </article>
        ))}
      </div>
    </div>
  )
}

function RawBlock({ label, value }: { label: string; value: string }) {
  return (
    <section className="mt-3 min-w-0">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <pre className="max-h-80 min-w-0 overflow-auto whitespace-pre rounded-md bg-background p-3 text-xs leading-5">
        {formatJson(value)}
      </pre>
    </section>
  )
}

function SkillsPage() {
  const [skills, setSkills] = useState<SkillValidation[]>([])
  const [contentByName, setContentByName] = useState<Record<string, SkillContent>>(
    {},
  )
  const [selectedPath, setSelectedPath] = useState("")
  const [loading, setLoading] = useState(true)
  const [contentLoading, setContentLoading] = useState(false)
  const [error, setError] = useState("")

  async function load(showSpinner = true, refresh = false) {
    if (showSpinner) setLoading(true)
    setError("")
    try {
      const items = refresh ? await api.refreshSkills() : await api.skills()
      setSkills(items)
      if (refresh) setContentByName({})
      setSelectedPath((current) => {
        if (current && items.some((skill) => skill.path === current)) return current
        return items.find((skill) => skill.valid && skill.name)?.path || items[0]?.path || ""
      })
    } catch (err) {
      setError(readError(err, "Failed to load skills"))
    } finally {
      setLoading(false)
    }
  }

  async function selectSkill(skill: SkillValidation) {
    setSelectedPath(skill.path)
    if (!skill.valid || !skill.name || contentByName[skill.name]) return
    setContentLoading(true)
    try {
      const content = await api.skillContent(skill.name)
      setContentByName((current) => ({ ...current, [skill.name!]: content }))
    } catch (err) {
      setError(readError(err, "Failed to read SKILL.md"))
    } finally {
      setContentLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    api
      .skills()
      .then((items) => {
        if (cancelled) return
        setSkills(items)
        setSelectedPath(items.find((skill) => skill.valid && skill.name)?.path || items[0]?.path || "")
      })
      .catch((err) => {
        if (!cancelled) setError(readError(err, "Failed to load skills"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const validCount = useMemo(
    () => skills.filter((skill) => skill.valid).length,
    [skills],
  )
  const selectedSkill = skills.find((skill) => skill.path === selectedPath)
  const selectedContent = selectedSkill?.name
    ? contentByName[selectedSkill.name]
    : undefined

  useEffect(() => {
    let cancelled = false
    async function loadSelectedContent() {
      if (!selectedSkill?.valid || !selectedSkill.name || contentByName[selectedSkill.name]) return
      setContentLoading(true)
      try {
        const content = await api.skillContent(selectedSkill.name)
        if (!cancelled) {
          setContentByName((current) => ({ ...current, [selectedSkill.name!]: content }))
        }
      } catch (err) {
        if (!cancelled) setError(readError(err, "Failed to read SKILL.md"))
      } finally {
        if (!cancelled) setContentLoading(false)
      }
    }
    loadSelectedContent()
    return () => {
      cancelled = true
    }
  }, [selectedSkill?.name, selectedSkill?.valid, contentByName])

  return (
    <div>
      <PageHeader
        title="Skills Diagnostics"
        subtitle={`${validCount}/${skills.length} skills valid`}
        action={
          <Button variant="outline" onClick={() => load(true, true)} disabled={loading}>
            <RefreshCcw className="size-4" /> Refresh
          </Button>
        }
      />
      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-3">
          {error && <Notice tone="error">{error}</Notice>}
          {loading && <Notice>Loading skills...</Notice>}
          {skills.map((skill) => (
            <button
              className={`w-full rounded-lg border p-4 text-left transition ${
                selectedPath === skill.path
                  ? "border-primary bg-muted"
                  : "border-border bg-card hover:bg-muted/60"
              }`}
              key={skill.path}
              onClick={() => selectSkill(skill)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-semibold">
                    {skill.name || "Unnamed skill"}
                  </h2>
                  <p className="mt-1 break-all text-xs text-muted-foreground">
                    {skill.path}
                  </p>
                </div>
                <Status ok={skill.valid} good="valid" bad="invalid" />
              </div>
              {skill.description && (
                <p className="mt-3 text-sm text-muted-foreground">
                  {skill.description}
                </p>
              )}
              {!!skill.errors.length && (
                <pre className="mt-3 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs text-destructive">
                  {skill.errors.join("\n")}
                </pre>
              )}
            </button>
          ))}
          {!skills.length && !loading && (
            <p className="text-sm text-muted-foreground">No skills found.</p>
          )}
        </section>

        <section className="min-w-0 rounded-lg border border-border bg-card p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-sm font-semibold">
                {selectedSkill?.name || "No skill selected"}
              </h2>
              {selectedSkill && (
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {selectedSkill.path}
                </p>
              )}
            </div>
            {selectedSkill && (
              <Status ok={selectedSkill.valid} good="valid" bad="invalid" />
            )}
          </div>
          {contentLoading && <Notice>Loading SKILL.md...</Notice>}
          {selectedSkill?.valid && selectedContent && (
            <pre className="max-h-[calc(100svh-180px)] min-w-0 overflow-auto whitespace-pre rounded-md bg-muted p-3 text-xs leading-5">
              {selectedContent.content}
            </pre>
          )}
          {selectedSkill && !selectedSkill.valid && (
            <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
              Invalid skills do not expose readable SKILL.md content.
            </div>
          )}
          {!selectedSkill && !loading && (
            <div className="rounded-lg border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
              Select a skill to read its SKILL.md.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function McpPage() {
  const [servers, setServers] = useState<McpServer[]>([])
  const [tools, setTools] = useState<McpTool[]>([])
  const [selectedLabel, setSelectedLabel] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  async function load(showSpinner = true, refresh = false) {
    if (showSpinner) setLoading(true)
    setError("")
    try {
      const nextServers = refresh ? await api.refreshMcp() : await api.mcpServers()
      setServers(nextServers)
      if (refresh) setTools([])
      setSelectedLabel((current) =>
        current && nextServers.some((server) => server.server_label === current)
          ? current
          : nextServers[0]?.server_label || "",
      )
    } catch (err) {
      setError(readError(err, "Failed to load MCP servers"))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    api
      .mcpServers()
      .then((nextServers) => {
        if (cancelled) return
        setServers(nextServers)
        setSelectedLabel((current) => current || nextServers[0]?.server_label || "")
      })
      .catch((err) => {
        if (!cancelled) setError(readError(err, "Failed to load MCP servers"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const server = servers.find((item) => item.server_label === selectedLabel)
    if (!server || server.ok === false) {
      queueMicrotask(() => {
        if (!cancelled) setTools([])
      })
      return
    }
    api
      .mcpTools(server.server_label)
      .then((items) => {
        if (!cancelled) setTools(items)
      })
      .catch((err) => {
        if (cancelled) return
        setTools([])
        setError(readError(err, "Failed to load MCP tools"))
      })
    return () => {
      cancelled = true
    }
  }, [selectedLabel, servers])

  const selected = servers.find((server) => server.server_label === selectedLabel)

  return (
    <div>
      <PageHeader
        title="MCP Diagnostics"
        subtitle={`${servers.length} configured servers`}
        action={
          <Button variant="outline" onClick={() => load(true, true)} disabled={loading}>
            <RefreshCcw className="size-4" /> Refresh
          </Button>
        }
      />
      <div className="grid gap-4 p-4 md:p-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="space-y-3">
          {error && <Notice tone="error">{error}</Notice>}
          {loading && <Notice>Loading MCP diagnostics...</Notice>}
          {servers.map((server) => (
            <button
              className={`w-full rounded-lg border p-4 text-left transition ${
                selectedLabel === server.server_label
                  ? "border-primary bg-muted"
                  : "border-border bg-card hover:bg-muted/60"
              }`}
              key={server.server_label}
              onClick={() => setSelectedLabel(server.server_label)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="break-words text-sm font-semibold">
                    {server.server_label}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {server.server_description || server.transport}
                  </p>
                </div>
                <Status ok={!!server.ok} good="ok" bad="fail" />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>{server.local ? "local" : "remote"}</span>
                <span>{server.transport}</span>
                <span>{server.tool_count ?? 0} tools</span>
              </div>
              {server.error && (
                <p className="mt-3 break-words text-xs text-destructive">
                  {server.error}
                </p>
              )}
            </button>
          ))}
        </section>

        <section className="min-w-0 rounded-lg border border-border bg-card p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold">
                {selected?.server_label || "No server selected"}
              </h2>
              {selected && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {selected.local ? "Local bridge" : "Remote server"} ·{" "}
                  {selected.transport}
                </p>
              )}
            </div>
            {selected && <Status ok={!!selected.ok} good="available" bad="failed" />}
          </div>
          <div className="space-y-3">
            {tools.map((tool) => (
              <article
                className="rounded-md border border-border bg-background p-3"
                key={tool.function_name}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">{tool.original_name}</h3>
                  <code className="text-xs text-muted-foreground">
                    {tool.function_name}
                  </code>
                </div>
                {tool.description && <ToolDescription text={tool.description} />}
                <pre className="mt-3 max-h-64 min-w-0 overflow-auto whitespace-pre rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(tool.input_schema, null, 2)}
                </pre>
              </article>
            ))}
            {!tools.length && (
              <p className="text-sm text-muted-foreground">
                No tools available for this server.
              </p>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function ToolDescription({ text }: { text: string }) {
  return (
    <div className="mt-2 text-sm leading-6 text-muted-foreground">
      {text.split("\n").map((line, index) => {
        const trimmed = line.trimStart()
        const listLine = trimmed.startsWith("- ") || /^\d+\.\s/.test(trimmed)
        if (!line.trim()) return <span className="block h-2" key={index} />
        return (
          <span
            className={`block break-words ${listLine ? "-indent-4 pl-4" : ""}`}
            key={index}
          >
            {line}
          </span>
        )
      })}
    </div>
  )
}

function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle: string
  action?: ReactNode
}) {
  return (
    <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </header>
  )
}

function NavButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      className="w-full justify-start"
      variant={active ? "secondary" : "ghost"}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function Notice({
  children,
  tone = "default",
}: {
  children: ReactNode
  tone?: "default" | "error"
}) {
  return (
    <div
      className={`rounded-md border px-3 py-2 text-sm ${
        tone === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </div>
  )
}

function Status({
  ok,
  good,
  bad,
}: {
  ok: boolean
  good: string
  bad: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
        ok
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
          : "bg-destructive/10 text-destructive"
      }`}
    >
      {ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {ok ? good : bad}
    </span>
  )
}

function tabClass(active: boolean) {
  return `rounded-sm px-3 py-2 text-sm transition ${
    active ? "bg-background shadow-sm" : "text-muted-foreground"
  }`
}

function readError(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback
}

function formatJson(value: string) {
  if (!value) return "No response captured yet."
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  } catch {
    return value
  }
}

function formatEventDetail(value: unknown) {
  if (value == null || value === "") return ""
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function findActiveSkillMention(message: string, cursorPosition: number) {
  if (cursorPosition < 0) return null
  const beforeCursor = message.slice(0, cursorPosition)
  const match = /(^|[\s([{])@([a-zA-Z0-9-]*)$/.exec(beforeCursor)
  if (!match) return null
  const prefixLength = match[1].length
  const start = cursorPosition - match[0].length + prefixLength
  return {
    start,
    end: cursorPosition,
    query: match[2],
  }
}

function chatStatusText(event: ToolActivity) {
  if (event.kind === "status") return event.name
  const label = event.kind === "result" ? "Tool finished" : "Calling tool"
  const status = event.status ? ` · ${event.status}` : ""
  return `${label}: ${event.name}${status}`
}

export default App
