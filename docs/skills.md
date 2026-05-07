# Skills

AgentBuilder loads local Codex-style skills from `AGENT_SKILLS_DIR`, which defaults to `skills`.

Each skill is a directory with a required `SKILL.md` file:

```text
skills/
  summarize-text/
    SKILL.md
```

`SKILL.md` must start with YAML frontmatter:

```markdown
---
name: summarize-text
description: Summarize pasted text or tool output into concise decisions, facts, and next steps.
---

Use this skill when ...
```

Rules:

- `name` uses lowercase letters, numbers, and single hyphens.
- `name` matches the parent directory name.
- `description` is non-empty.

The backend exposes:

- `GET /skills`
- `POST /skills/refresh`
- `GET /skills/{skill_name}/content`

In chat, users can force a skill by mentioning it, for example:

```text
@summarize-text summarize this transcript
```

The developer frontend suggests valid skill names after typing `@`.
