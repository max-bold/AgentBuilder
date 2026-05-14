# Prompts

AgentBuilder uses two Markdown files under `prompts/` to shape model behavior:

```text
prompts/
  AGENT_INSTRUCTIONS.md
  ASSISTANT_PROMPT.md
```

Both files are read from the project root as UTF-8 text and stripped of leading and trailing whitespace before being sent to the OpenAI Responses API.

## Runtime Flow

Chat requests are assembled in `backend/app/agent.py` by `AgentClient._chat_payload()`:

```python
payload = {
    "model": self.settings.openai_model,
    "instructions": self._instructions(message),
    "input": self._first_turn_input(message, previous_agent_response_id is None),
    "previous_response_id": self._openai_response_id(previous_agent_response_id),
    "tools": self._tool_schemas(),
}
```

For a new chat, there is no previous agent response ID. The backend therefore prepends `ASSISTANT_PROMPT.md` to the first user message:

```text
<ASSISTANT_PROMPT.md>

---

User message:
<first user message>
```

For later turns, the backend sends the user's message as-is and links the request to the prior model state with `previous_response_id`.

## `AGENT_INSTRUCTIONS.md`

`AGENT_INSTRUCTIONS.md` is sent as the Responses API `instructions` field on normal user turns. Treat it as the always-on system policy for the assistant.

Keep this file short. It is attached to every model request that starts from a user message, so long content here has a direct token-window cost and can crowd out the chat, tool results, and retrieved context.

Put only stable, global behavior here:

- The assistant's role and operating environment.
- Hard rules that must apply to every user turn.
- Tool-use principles that should always be visible.
- Short fallback behavior for unavailable tools or missing files.
- The rule for explicit skill mentions, if the app keeps that feature.

Avoid putting large domain knowledge, examples, API references, product manuals, or long workflow recipes in this file. Prefer `ASSISTANT_PROMPT.md`, skills, tools, MCP servers, or external documents for that material.

If the file cannot be read, the backend sends this fallback instruction instead:

```text
prompts/AGENT_INSTRUCTIONS.md is missing.
```

## `ASSISTANT_PROMPT.md`

`ASSISTANT_PROMPT.md` is added only to the first user message of a new chat. It is not sent again on later user turns.

Use this file for the base context the assistant needs at chat creation time:

- Product or application background.
- Audience, tone, and answer style.
- Domain-specific assumptions.
- High-level workflows the assistant should remember throughout the conversation.
- Pointers to important tools, skills, or MCP capabilities.
- Constraints that are useful but too large for `AGENT_INSTRUCTIONS.md`.

Because later turns use `previous_response_id`, the model can rely on the initial prompt as part of the conversation state. Keep it focused, but it can be longer than `AGENT_INSTRUCTIONS.md`.

If the file is empty or cannot be read, the backend simply sends the first user message without a prepended assistant prompt.

## Skills and Explicit Mentions

When the user explicitly mentions a valid skill as `@skill-name`, `_instructions()` appends that skill's `SKILL.md` content after `AGENT_INSTRUCTIONS.md` for the current user request.

The appended block is separated with:

```text
---

# User-Forced Skills
```

This means explicit skill mentions increase the `instructions` size for that request. Keep `AGENT_INSTRUCTIONS.md` concise so forced-skill instructions still have room when needed.

## Tool Follow-Up Requests

When the model calls function or shell tools, the backend sends follow-up Responses API requests containing tool outputs and `previous_response_id`.

Those follow-up payloads are built by `_tool_followup_payload()` and do not include `AGENT_INSTRUCTIONS.md` or `ASSISTANT_PROMPT.md` directly. They rely on the previous response chain for conversation state.

## Editing Guidelines

Use this split when changing prompts:

- Put always-on, compact behavior in `AGENT_INSTRUCTIONS.md`.
- Put one-time chat bootstrap context in `ASSISTANT_PROMPT.md`.
- Put reusable task procedures in `skills/<name>/SKILL.md`.
- Put executable or deterministic behavior in backend tools or MCP servers.
- Put large references outside prompts and let the assistant access them through tools, skills, or retrieval.

After editing either prompt, start a new chat to validate first-turn behavior. Existing chats may continue from their stored `previous_response_id`, so they are not a clean test of prompt changes.
