"""
Pure string / path helpers used across the platform.

Heavy lifting (grading, quiz sessions, images, snapshots) lives in services/.
Database access lives in db/.
"""

import re
import unicodedata

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
