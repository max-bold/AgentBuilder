import type { FormEvent, KeyboardEvent } from "react"
import { useEffect, useRef, useState } from "react"
import {
  Bot,
  Loader2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Trash2,
  UserRound,
} from "lucide-react"

import { ApiError, api, getToken, setToken } from "@/api"
import { Button } from "@/components/ui/button"
import type { ChatMessage, ChatSession, User } from "@/types"

function App() {
  const [user, setUser] = useState<User | null>(null)
  const [chatSessions, setChatSessions] = useState<ChatSession[]>([])
  const [activeChatId, setActiveChatId] = useState<number | null>(null)
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
    if (!user) return
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
    return () => {
      cancelled = true
    }
  }, [user])

  async function createChat() {
    setError("")
    try {
      const session = await api.createSimpleChatSession()
      setChatSessions((items) => [session, ...items])
      setActiveChatId(session.id)
    } catch (err) {
      setError(readError(err, "Failed to create chat"))
    }
  }

  async function renameChat(session: ChatSession, title: string) {
    const nextTitle = title.trim()
    if (!nextTitle || nextTitle === session.title) return
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

  async function promptRenameChat(session: ChatSession) {
    const title = window.prompt("Rename chat", session.title)
    if (title === null) return
    await renameChat(session, title)
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

  function logout() {
    setToken(null)
    setUser(null)
    setChatSessions([])
    setActiveChatId(null)
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
    <main className="grid min-h-svh bg-background text-foreground lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="border-b border-border bg-muted/25 px-4 py-3 lg:border-b-0 lg:border-r lg:py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">AgentBuilder</h1>
            <p className="truncate text-xs text-muted-foreground">{user.login}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">
            Chats
          </h2>
          <Button
            aria-label="Create chat"
            className="size-8"
            size="icon"
            variant="ghost"
            onClick={createChat}
          >
            <Plus className="size-4" />
          </Button>
        </div>
        <nav className="mt-2 space-y-1">
          {chatSessions.map((session) => (
            <SidebarChatItem
              active={activeChatId === session.id}
              key={session.id}
              session={session}
              onDelete={() => deleteChat(session)}
              onRename={() => promptRenameChat(session)}
              onSelect={() => setActiveChatId(session.id)}
            />
          ))}
        </nav>

        <Button
          className="mt-4 w-full justify-start"
          variant="ghost"
          onClick={logout}
        >
          <LogOut className="size-4" /> Logout
        </Button>
      </aside>

      <ChatPage
        chatId={activeChatId}
        chatTitle={
          chatSessions.find((session) => session.id === activeChatId)?.title ||
          "Chat"
        }
        onRenameChat={(title) => {
          const session = chatSessions.find((item) => item.id === activeChatId)
          if (session) void renameChat(session, title)
        }}
        onCreateChat={createChat}
        onMessageSent={touchChat}
      />
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
        className={`flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm transition ${
          active ? "bg-secondary text-secondary-foreground" : "hover:bg-muted"
        }`}
        onClick={onSelect}
        type="button"
      >
        <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{session.title}</span>
      </button>
      <Button
        aria-label={`${session.title} actions`}
        className="size-8"
        size="icon"
        variant="ghost"
        onClick={() => setMenuOpen((current) => !current)}
      >
        <MoreHorizontal className="size-4" />
      </Button>
      {menuOpen && (
        <div className="absolute right-0 top-9 z-20 w-40 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md">
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
  const [login, setLogin] = useState("user")
  const [email, setEmail] = useState("user@example.com")
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
            <h1 className="text-base font-semibold">AgentBuilder</h1>
            <p className="text-sm text-muted-foreground">Login and chat</p>
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
  onRenameChat,
  onCreateChat,
  onMessageSent,
}: {
  chatId: number | null
  chatTitle: string
  onRenameChat: (title: string) => void
  onCreateChat: () => void
  onMessageSent: (chatId: number) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [message, setMessage] = useState("")
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(chatTitle)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!chatId) {
      queueMicrotask(() => {
        if (!cancelled) setMessages([])
      })
      return
    }
    setError("")
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
  }, [messages, busy])

  useEffect(() => {
    if (!editingTitle) setDraftTitle(chatTitle)
  }, [chatTitle, editingTitle])

  async function submit(event: FormEvent) {
    event.preventDefault()
    const text = message.trim()
    if (!text || busy) return
    let targetChatId = chatId
    if (!targetChatId) {
      await onCreateChat()
      return
    }
    setMessage("")
    setError("")
    setMessages((items) => [...items, { role: "user", text }, { role: "agent", text: "" }])
    setBusy(true)
    try {
      await api.streamSimpleChatSessionMessage(targetChatId, text, (event) => {
        if (event.type === "text_delta") {
          setMessages((items) => updateLastAgent(items, (item) => ({ ...item, text: item.text + event.delta })))
        }
        if (event.type === "done") {
          setMessages((items) => updateLastAgent(items, (item) => ({ ...item, text: event.text, response_id: event.response_id })))
        }
        if (event.type === "error") setError(event.error)
      })
      onMessageSent(targetChatId)
    } catch (err) {
      setMessages((items) => items.filter((item, index) => item.text || index !== items.length - 1))
      setError(readError(err, "Agent request failed"))
    } finally {
      setBusy(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  function saveTitle() {
    const nextTitle = draftTitle.trim()
    setEditingTitle(false)
    if (nextTitle && nextTitle !== chatTitle) onRenameChat(nextTitle)
    else setDraftTitle(chatTitle)
  }

  function handleTitleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault()
      saveTitle()
    }
    if (event.key === "Escape") {
      event.preventDefault()
      setDraftTitle(chatTitle)
      setEditingTitle(false)
    }
  }

  return (
    <section className="grid min-h-svh grid-rows-[auto_minmax(0,1fr)_auto]">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-border px-4 py-3 md:px-6">
        <div className="min-w-0">
          {editingTitle ? (
            <input
              aria-label="Chat title"
              autoFocus
              className="h-8 max-w-full rounded-md border border-input bg-background px-2 text-base font-semibold outline-none focus:ring-2 focus:ring-ring"
              value={draftTitle}
              onBlur={saveTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={handleTitleKeyDown}
            />
          ) : (
            <button
              className="block max-w-full truncate rounded-sm text-left text-base font-semibold outline-none hover:text-primary focus:ring-2 focus:ring-ring"
              onClick={() => setEditingTitle(true)}
              type="button"
            >
              {chatTitle}
            </button>
          )}
          <p className="truncate text-sm text-muted-foreground">
            Responses API chat
          </p>
        </div>
      </header>

      <div ref={listRef} className="min-h-0 overflow-auto p-4 md:p-6">
        {error && <Notice tone="error">{error}</Notice>}
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.map((item, index) => (
            <article
              className={`max-w-[85%] rounded-lg border px-4 py-3 text-sm leading-6 ${
                item.role === "user"
                  ? "ml-auto border-primary/20 bg-primary text-primary-foreground"
                  : "border-border bg-card"
              }`}
              key={`${item.id || index}-${item.role}`}
            >
              <div className="whitespace-pre-wrap break-words">{item.text}</div>
            </article>
          ))}
          {!messages.length && (
            <div className="rounded-lg border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
              Start a conversation with the agent.
            </div>
          )}
          {busy && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Thinking
            </div>
          )}
        </div>
      </div>

      <form className="border-t border-border bg-background p-4 md:p-6" onSubmit={submit}>
        <div className="mx-auto grid max-w-3xl grid-cols-[minmax(0,1fr)_auto] gap-3">
          <textarea
            className="min-h-12 max-h-40 resize-none rounded-md border border-input bg-background px-3 py-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            placeholder="Message the agent..."
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
          />
          <Button className="h-12 self-end" disabled={busy || !message.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            Send
          </Button>
        </div>
      </form>
    </section>
  )
}

function updateLastAgent(
  messages: ChatMessage[],
  update: (message: ChatMessage) => ChatMessage,
) {
  const index = [...messages].reverse().findIndex((item) => item.role === "agent")
  if (index < 0) return messages
  const agentIndex = messages.length - 1 - index
  return messages.map((item, itemIndex) => (itemIndex === agentIndex ? update(item) : item))
}

function Notice({
  children,
  tone = "default",
}: {
  children: React.ReactNode
  tone?: "default" | "error"
}) {
  return (
    <div
      className={`mb-4 rounded-md border px-3 py-2 text-sm ${
        tone === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </div>
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

export default App
