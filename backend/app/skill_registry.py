from __future__ import annotations

import threading
from pathlib import Path

from watchfiles import watch

from .skills import Skill, SkillValidation, load_valid_skills


class SkillRegistry:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._lock = threading.Lock()
        self._skills: list[Skill] = []
        self._validations: list[SkillValidation] = []
        self._watcher: threading.Thread | None = None
        self._stop = threading.Event()

    def reload(self) -> None:
        skills, validations = load_valid_skills(self.root)
        with self._lock:
            self._skills = skills
            self._validations = validations

    def snapshot(self) -> tuple[list[Skill], list[SkillValidation]]:
        with self._lock:
            return list(self._skills), list(self._validations)

    def start(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        self.reload()
        if self._watcher and self._watcher.is_alive():
            return
        self._stop.clear()
        self._watcher = threading.Thread(target=self._watch_loop, name="skill-registry-watch", daemon=True)
        self._watcher.start()

    def stop(self) -> None:
        self._stop.set()

    def _watch_loop(self) -> None:
        for _changes in watch(self.root, stop_event=self._stop, force_polling=True, poll_delay_ms=500):
            self.reload()
