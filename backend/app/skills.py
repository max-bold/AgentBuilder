from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


SKILL_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
STOPWORDS = {
    "and",
    "the",
    "for",
    "with",
    "that",
    "this",
    "from",
    "into",
    "надо",
    "нужно",
    "как",
    "что",
    "для",
    "или",
    "при",
}


@dataclass(frozen=True)
class SkillValidation:
    path: str
    valid: bool
    name: str | None
    description: str | None
    errors: list[str]


@dataclass(frozen=True)
class Skill:
    name: str
    description: str
    path: Path
    body: str
    frontmatter: dict[str, Any]


def parse_skill_file(path: Path) -> tuple[dict[str, Any], str, list[str]]:
    errors: list[str] = []
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return {}, "", ["SKILL.md must be UTF-8 encoded"]
    if not text.startswith("---\n"):
        return {}, text, ["SKILL.md must start with YAML frontmatter delimited by ---"]
    try:
        _, frontmatter_text, body = text.split("---", 2)
    except ValueError:
        return {}, text, ["SKILL.md frontmatter must be closed with ---"]
    try:
        frontmatter = yaml.safe_load(frontmatter_text) or {}
    except yaml.YAMLError as exc:
        return {}, body, [f"Invalid YAML frontmatter: {exc}"]
    if not isinstance(frontmatter, dict):
        errors.append("Frontmatter must be a YAML mapping")
        frontmatter = {}
    return frontmatter, body.strip(), errors


def validate_skill_dir(path: Path) -> SkillValidation:
    errors: list[str] = []
    skill_file = path / "SKILL.md"
    if not path.is_dir():
        return SkillValidation(str(path), False, None, None, ["Skill must be a directory"])
    if not skill_file.exists():
        return SkillValidation(str(path), False, None, None, ["Missing required SKILL.md"])

    frontmatter, _body, parse_errors = parse_skill_file(skill_file)
    errors.extend(parse_errors)
    name = frontmatter.get("name")
    description = frontmatter.get("description")

    if not isinstance(name, str) or not name:
        errors.append("Required field 'name' must be a non-empty string")
        name = None
    else:
        if len(name) > 64:
            errors.append("Field 'name' must be at most 64 characters")
        if not SKILL_NAME_RE.match(name):
            errors.append("Field 'name' must use lowercase letters, numbers, and single hyphens only")
        if name != path.name:
            errors.append("Field 'name' must match the parent directory name")

    if not isinstance(description, str) or not description.strip():
        errors.append("Required field 'description' must be a non-empty string")
        description = None
    elif len(description) > 1024:
        errors.append("Field 'description' must be at most 1024 characters")

    license_value = frontmatter.get("license")
    if license_value is not None and not isinstance(license_value, str):
        errors.append("Optional field 'license' must be a string")

    compatibility = frontmatter.get("compatibility")
    if compatibility is not None:
        if not isinstance(compatibility, str):
            errors.append("Optional field 'compatibility' must be a string")
        elif not compatibility or len(compatibility) > 500:
            errors.append("Optional field 'compatibility' must be 1-500 characters")

    metadata = frontmatter.get("metadata")
    if metadata is not None and not isinstance(metadata, dict):
        errors.append("Optional field 'metadata' must be a mapping")

    allowed_tools = frontmatter.get("allowed-tools")
    if allowed_tools is not None and not isinstance(allowed_tools, str):
        errors.append("Optional field 'allowed-tools' must be a string")

    return SkillValidation(str(path), not errors, name, description, errors)


def discover_skill_dirs(root: Path) -> list[Path]:
    if not root.exists():
        return []
    return sorted(path for path in root.iterdir() if path.is_dir())


def load_valid_skills(root: Path) -> tuple[list[Skill], list[SkillValidation]]:
    skills: list[Skill] = []
    validations: list[SkillValidation] = []
    for path in discover_skill_dirs(root):
        validation = validate_skill_dir(path)
        validations.append(validation)
        if not validation.valid or not validation.name or not validation.description:
            continue
        frontmatter, body, _errors = parse_skill_file(path / "SKILL.md")
        skills.append(
            Skill(
                name=validation.name,
                description=validation.description,
                path=path,
                body=body,
                frontmatter=frontmatter,
            )
        )
    return skills, validations


def select_relevant_skills(skills: list[Skill], query: str, limit: int = 3) -> list[Skill]:
    query_terms = {
        term
        for term in re.findall(r"[a-zA-Zа-яА-Я0-9]+", query.lower())
        if len(term) > 2 and term not in STOPWORDS
    }
    scored: list[tuple[int, Skill]] = []
    for skill in skills:
        haystack = f"{skill.name} {skill.description}".lower()
        explicit = skill.name.lower() in query.lower()
        score = 100 if explicit else 0
        score += sum(1 for term in query_terms if term in haystack)
        if score:
            scored.append((score, skill))
    scored.sort(key=lambda item: (-item[0], item[1].name))
    return [skill for _score, skill in scored[:limit]]
