# Skills

AgentBuilder loads local Codex-style skills from `AGENT_SKILLS_DIR`, which defaults to `skills`.

A skill is a reusable package of instructions and optional local resources for tasks that repeat often: domain workflows, file-processing recipes, diagnostic procedures, scripts, references, and templates. In this project a skill is not a separate HTTP endpoint or Python handler. It is a folder that the backend validates, registers, exposes to the model, and, when needed, lets the model read or execute through the local shell tool.

## Directory Layout

Each skill must live under the configured skills root:

```text
skills/
  summarize-text/
    SKILL.md
```

By default that root is the repository `skills/` directory, because `backend/app/config.py` sets:

```python
agent_skills_dir: Path = Path("skills")
```

You can override it with `AGENT_SKILLS_DIR`, but the backend scans only that one configured root. A skill placed elsewhere is just an ordinary folder: `SkillRegistry` will not discover it, `/skills` will not return it, the frontend will not suggest it after `@`, and `_skill_shell_tool()` will not include it in the Responses API request. As a result, the LLM will not see the skill metadata and cannot decide to use it unless the user manually provides the contents in the chat.

## `SKILL.md`

`SKILL.md` must start with YAML frontmatter:

```markdown
---
name: summarize-text
description: Summarize pasted text or tool output into concise decisions, facts, and next steps.
---

Use this skill when the user asks to summarize, condense, brief, or extract key points from a text.

Procedure:

1. Identify the main topic and purpose of the text.
2. Extract concrete facts, decisions, risks, and next actions.
3. Keep the summary shorter than the source.
4. Preserve uncertainty and source limitations.
```

Validation rules are implemented in `backend/app/skills.py`:

- `SKILL.md` must be UTF-8.
- The file must start with `---\n` YAML frontmatter and close it with another `---`.
- `name` is required, non-empty, at most 64 characters, and must use lowercase letters, numbers, and single hyphens.
- `name` must match the parent directory name.
- `description` is required, non-empty, and at most 1024 characters.
- Optional `license` must be a string.
- Optional `compatibility` must be a string from 1 to 500 characters.
- Optional `metadata` must be a YAML mapping.
- Optional `allowed-tools` must be a string.

The current project only uses `name`, `description`, `path`, `body`, and raw frontmatter in the runtime registry. Other fields are validated for shape but are not used by the chat orchestration yet.

## Creating Skills

Use the same design principles as Codex `skill-creator` / skill-builder workflows:

1. Start from real examples. Write down the prompts that should trigger the skill and the outputs the agent should produce.
2. Keep `description` explicit. It is the primary always-visible signal the model receives before it decides whether a skill is useful.
3. Keep `SKILL.md` focused on the core procedure. Put long reference material in `references/`, deterministic code in `scripts/`, and reusable templates or media in `assets/`.
4. Add scripts only when they remove repeated fragile work. Test scripts directly before relying on them from a skill.
5. Avoid extra docs inside the skill folder unless the skill actually needs them as references. `README.md`, changelogs, and setup notes usually add noise.
6. Validate by using the developer UI Skills page or `GET /skills`; invalid skills remain visible as validation records but are not exposed as readable skill content to the model.

Recommended shape for a larger skill:

```text
skills/
  report-builder/
    SKILL.md
    scripts/
      render_report.py
    references/
      schema.md
    assets/
      template.docx
```

The important context-window rule is progressive disclosure:

- `name` and `description` are loaded into the model request as metadata.
- The full `SKILL.md` should be loaded only when the skill is actually needed.
- References, scripts, and assets should be read or executed only when the active workflow requires them.

## Runtime Lifecycle

### 1. Creation

A developer creates `skills/<skill-name>/SKILL.md`. The folder name and frontmatter `name` must match exactly. The body should describe the procedure the model should follow, including when to inspect optional `scripts/`, `references/`, or `assets/`.

For example:

```text
skills/inspect-mcp/SKILL.md
```

contains a `name: inspect-mcp`, a diagnostic description, and a procedure for reporting MCP server status.

### 2. Scanning The Folder

At application startup, `backend/app/main.py` creates:

```python
skill_registry = SkillRegistry(settings.agent_skills_dir)
```

During FastAPI lifespan startup, `skill_registry.start()` runs. `SkillRegistry.start()` creates the root directory if it does not exist, calls `reload()`, and starts a background watcher.

The reload path is:

```text
SkillRegistry.reload()
  -> load_valid_skills(root)
     -> discover_skill_dirs(root)
     -> validate_skill_dir(path)
     -> parse_skill_file(path / "SKILL.md")
```

`discover_skill_dirs()` only looks at direct child directories of the configured root. It does not recursively search arbitrary folders.

### 3. Local Skill Registry

`SkillRegistry` keeps two in-memory lists protected by a lock:

- `_skills`: valid skills that can be exposed to the agent.
- `_validations`: validation records for every discovered skill directory, including invalid ones and their errors.

The registry can be refreshed three ways:

- automatically at backend startup;
- automatically by the `watchfiles.watch()` loop when files under the skills root change;
- manually through `POST /skills/refresh`.

`GET /skills` returns validation records. `GET /skills/{skill_name}/content` returns the raw `SKILL.md` only for a valid registered skill.

### 4. Passing Skills To The LLM

Every chat request is built in `AgentClient._chat_payload()` with:

```python
"instructions": self._instructions(message),
"input": self._first_turn_input(message, previous_agent_response_id is None),
"tools": self._tool_schemas(),
```

`_tool_schemas()` includes normal function tools, MCP tools, and, when at least one valid skill exists, a local shell tool from `_skill_shell_tool()`:

```json
{
  "type": "shell",
  "environment": {
    "type": "local",
    "skills": [
      {
        "name": "summarize-text",
        "description": "...",
        "path": "D:\\Code\\AgentBuilder\\skills\\summarize-text"
      }
    ]
  }
}
```

This is the normal skill discovery path for the model: the model sees the list of valid skills, their descriptions, and their absolute paths.

There is also a forced path. If the user mentions `@skill-name`, `_instructions()` finds valid requested skills with `_forced_skills_for_message()` and appends the full `SKILL.md` contents to the request instructions under `# User-Forced Skills`. The developer frontend supports this by suggesting valid skill names after typing `@`.

### 5. LLM Decides Whether To Use A Skill

The model decides from the user request, base instructions, available tools, and skill metadata.

Current backend behavior:

- Explicit `@skill-name` forces the full `SKILL.md` into the model instructions for that turn.
- Without `@skill-name`, the backend does not inject skill bodies by keyword. Although `select_relevant_skills()` exists in `backend/app/skills.py`, it is not currently called from `AgentClient`.
- For non-forced skills, the model receives metadata through the shell tool environment and can choose to inspect the skill path or run supporting commands.

### 6. Invoking A Skill

There is no dedicated `call_skill()` function in the backend. A skill is invoked through the model's tool behavior:

1. The model selects a relevant skill from the metadata or receives a forced skill body.
2. If it needs the skill file or bundled resources, it emits a `shell_call`.
3. The backend executes the requested command in `AgentClient._shell_call_output()`.

Shell execution is intentionally scoped:

- commands run with PowerShell from the project root;
- commands time out between 1 and 120 seconds;
- absolute paths outside the project root are rejected by `_command_scope_error()`;
- relative parent traversal with `..` is rejected.

So "using a skill" means the model follows the skill instructions and may read files or run scripts from the registered skill directory via the local shell tool.

### 7. Returning Results To The LLM

After a tool call, AgentBuilder wraps the result as a Responses API tool output:

```json
{
  "type": "shell_call_output",
  "call_id": "...",
  "output": [
    {
      "stdout": "...",
      "stderr": "...",
      "outcome": {
        "type": "exit",
        "exit_code": 0
      }
    }
  ]
}
```

Then `_tool_followup_payload()` sends another request with:

```python
"previous_response_id": previous_response_id,
"input": outputs,
"tools": self._tool_schemas(),
```

The model receives the shell output, continues reasoning, may request more tools, or returns the final answer. `_resolve_tool_calls()` repeats this loop up to depth 8. In streaming mode, `_resolve_tool_calls_stream()` also emits frontend activity events such as `tool_call`, `tool_result`, and raw exchange updates.

## API Surface

The backend exposes:

- `GET /skills`
- `POST /skills/refresh`
- `GET /skills/{skill_name}/content`

In chat, users can force a skill by mentioning it:

```text
@summarize-text summarize this transcript
```

The developer frontend suggests valid skill names after typing `@`.
