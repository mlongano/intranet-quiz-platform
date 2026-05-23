"""
Pure string / path helpers used across the platform.

Heavy lifting (grading, quiz sessions, images, snapshots) lives in services/.
Database access lives in db/.
"""

from __future__ import annotations

import json
import re
import unicodedata
from typing import Any

_SAFE = re.compile(r'[^a-zA-Z0-9_]')


def safe_id(raw: str) -> str:
    """Filesystem-safe identifier from an arbitrary string."""
    return _SAFE.sub('_', raw)


def sanitize_filename(filename: str) -> str:
    """Remove path traversal characters and non-printable chars from a filename."""
    safe = filename.replace('/', '_').replace('\\', '_').replace('..', '_')
    safe = re.sub(r'[^\w\s.-]', '', safe)
    return safe.strip('. ')


def slugify(text: str) -> str:
    """URL-friendly slug: lowercase ASCII, hyphens instead of spaces/punctuation."""
    text = unicodedata.normalize('NFKD', text).encode('ascii', 'ignore').decode('ascii')
    text = text.lower()
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'[^a-z0-9-]', '', text)
    text = re.sub(r'-+', '-', text)
    return text.strip('-') or 'untitled'


# ── JSON deserialisation guards ───────────────────────────────────────────────
# psycopg3 returns JSONB columns as Python dicts/lists, but callers that
# round-trip through other layers may receive strings. These normalise either.


def parse_json_field(value: Any) -> Any:
    """Return value unchanged if already a dict/list; parse if a JSON string."""
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        return json.loads(value)
    return value


def ensure_list(value: Any) -> list:
    """Guarantee a list: parse if string, return empty list for None/missing."""
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        return json.loads(value)
    return []


def ensure_dict(value: Any) -> dict:
    """Guarantee a dict: parse if string, return empty dict for None/missing."""
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        return json.loads(value)
    return {}
