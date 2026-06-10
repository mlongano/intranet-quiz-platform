"""In-process sliding-window limiter for credential endpoints.

Waitress runs a single process (8 threads), so a lock-guarded dict is enough;
state is per-container and resets on restart, which is acceptable for an
intranet brute-force guard. Keyed on the submitted identifier (e.g. email),
whether or not the account exists, so probing leaks nothing.
"""

from __future__ import annotations

import os
import threading
import time
from collections import defaultdict, deque

_lock = threading.Lock()
_failures: dict[str, deque[float]] = defaultdict(deque)


def _window_seconds() -> int:
    return int(os.getenv('LOGIN_RATE_WINDOW_SECONDS', '900'))


def _max_failures() -> int:
    return int(os.getenv('LOGIN_RATE_MAX_FAILURES', '10'))


def _prune(key: str, now: float) -> None:
    cutoff = now - _window_seconds()
    q = _failures[key]
    while q and q[0] < cutoff:
        q.popleft()
    if not q:
        _failures.pop(key, None)


def is_blocked(key: str) -> bool:
    now = time.monotonic()
    with _lock:
        _prune(key, now)
        return len(_failures.get(key, ())) >= _max_failures()


def record_failure(key: str) -> None:
    now = time.monotonic()
    with _lock:
        _prune(key, now)
        _failures[key].append(now)


def clear(key: str) -> None:
    with _lock:
        _failures.pop(key, None)


def reset_all() -> None:
    """Test helper — wipe all recorded failures."""
    with _lock:
        _failures.clear()
