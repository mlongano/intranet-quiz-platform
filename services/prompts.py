"""Versioned, immutable grading prompts.

A prompt lives at ``prompts/<name>/v<N>-<sha8>.md`` where ``sha8`` is the first
8 characters of the SHA-256 of the file body. Editing a published prompt is not
allowed: a new wording means a new file with a new version, so a recorded
``prompt_version`` always identifies exactly one text.

That matters because the grading worker must be reproducible. A job stores the
*snapshot* of the prompt it was enqueued with, so changing or deleting a file
afterwards cannot alter a job already in the queue, and a historical evaluation
can still be explained months later.

The ``LLM_OPEN_QUESTION_*_PROMPT_PATH`` environment overrides keep working for
deployments that point at their own file; such a prompt is versioned as
``custom-<sha8>`` since it is not part of the repository's version history.
"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
PROMPT_DIR = BASE_DIR / 'prompts'

SYSTEM_PROMPT_NAME = 'open-question-system'
USER_PROMPT_NAME = 'open-question-user'

# v<major>-<sha8>.md — the major number orders releases, the hash identifies content.
_VERSION_FILE = re.compile(r'^v(\d+)-([0-9a-f]{8})\.md$')


def content_hash(text: str) -> str:
    """First 8 hex characters of the SHA-256 of *text*."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()[:8]


def _env_override(name: str) -> Path | None:
    env_var = {
        SYSTEM_PROMPT_NAME: 'LLM_OPEN_QUESTION_SYSTEM_PROMPT_PATH',
        USER_PROMPT_NAME: 'LLM_OPEN_QUESTION_USER_PROMPT_PATH',
    }.get(name)
    raw = os.getenv(env_var or '') if env_var else None
    if not raw:
        return None
    path = Path(raw).expanduser()
    return path if path.is_absolute() else BASE_DIR / path


def _latest_version_file(name: str) -> Path:
    directory = PROMPT_DIR / name
    if not directory.is_dir():
        raise FileNotFoundError(f"Prompt directory not found: {directory}")

    candidates = []
    for entry in directory.iterdir():
        match = _VERSION_FILE.match(entry.name)
        if match:
            candidates.append((int(match.group(1)), entry))
    if not candidates:
        raise FileNotFoundError(
            f"No versioned prompt (v<N>-<sha8>.md) in {directory}"
        )
    return max(candidates, key=lambda pair: pair[0])[1]


def load_active_prompt(name: str) -> tuple[str, str]:
    """Return ``(version, text)`` for the prompt currently in use.

    An environment override wins over the repository files and is reported as
    ``custom-<sha8>`` so it can never be confused with a released version.
    """
    override = _env_override(name)
    if override is not None:
        text = override.read_text(encoding='utf-8')
        return f"custom-{content_hash(text)}", text

    path = _latest_version_file(name)
    text = path.read_text(encoding='utf-8')
    version = path.stem  # e.g. "v1-52b7d507"

    expected = version.split('-', 1)[1]
    actual = content_hash(text)
    if expected != actual:
        raise ValueError(
            f"Prompt {path} has been modified after publication: "
            f"name claims {expected}, content hashes to {actual}. "
            f"Publish a new version instead of editing a released prompt."
        )
    return version, text


def load_prompt_version(name: str, version: str) -> str:
    """Read one specific published version. Raises if it no longer exists.

    Callers that need a guaranteed-available text should use the job's stored
    snapshot rather than this function: a version can legitimately disappear
    from a checkout, which is exactly why snapshots exist.
    """
    path = PROMPT_DIR / name / f"{version}.md"
    if not path.is_file():
        raise FileNotFoundError(f"Prompt version not found: {path}")
    return path.read_text(encoding='utf-8')


def active_prompt_set() -> dict:
    """Resolve both prompts at once, for storing on a grading job.

    Returns ``{'version', 'system', 'user'}`` where ``version`` combines the two
    file versions — the pair is what actually determines a grading result.
    """
    system_version, system_text = load_active_prompt(SYSTEM_PROMPT_NAME)
    user_version, user_text = load_active_prompt(USER_PROMPT_NAME)
    return {
        'version': f"{system_version}+{user_version}",
        'system': system_text,
        'user': user_text,
    }
