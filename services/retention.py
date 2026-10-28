"""Data retention: students' data is deleted when it no longer serves its purpose.

The purpose is the assessment of one school year (the official grade lives in
the school register), so a session's data is kept through 31 December after
its school year ends and deleted on 1 January (``quizparty_purge_after`` in
migration 016). With the session go everything that hangs off it — answers,
scores, motivations, score history, grading jobs, published results — and so
do the score archives copied from it and the teachers' saved student lists of
that year. Quiz content (questions) is the teacher's, not student data: it
stays, and so does an anonymous copy of what serves the long run
(``services/history.py``). A class of an expired year that no session uses goes too, and so does
a student no longer at the school once nothing refers to them.

``DATA_RETENTION`` decides what happens: ``report`` (the default) only
computes what is due, ``apply`` deletes it, ``off`` does neither. The worker
checks at most every ``DATA_RETENTION_CHECK_SECONDS`` (6 hours). Each applied
run records counts — never whose data — in ``retention_runs``.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import db
from db import queries as Q
from services import history

SCHOOL_TZ = ZoneInfo('Europe/Rome')  # the time zone migration 016 counts school years in

# Order matters: sessions first, so the classes and students they held free up
# in the same run.
_KINDS = (
    ('sessions', Q.RETENTION_SESSIONS),
    ('archives', Q.RETENTION_ARCHIVES),
    ('student_lists', Q.RETENTION_STUDENT_LISTS),
    ('classes', Q.RETENTION_CLASSES),
    ('students', Q.RETENTION_STUDENTS),
)


def mode() -> str:
    value = (os.environ.get('DATA_RETENTION') or 'report').strip().lower()
    return value if value in ('off', 'report', 'apply') else 'report'


def _due(conn, now: datetime) -> dict[str, list[int]]:
    return {kind: [r[0] for r in conn.execute(sql, {'now': now}).fetchall()] for kind, sql in _KINDS}


def report(now: datetime | None = None) -> dict:
    """What is due now (counts) and the next deletion dates."""
    now = now or datetime.now(timezone.utc)
    with db.get_conn() as conn:
        due = _due(conn, now)
        upcoming = conn.execute(Q.RETENTION_UPCOMING, {'now': now}).fetchall()
        last = conn.execute(Q.LAST_RETENTION_RUN).fetchone()
    return {
        'mode': mode(),
        'due': {kind: len(ids) for kind, ids in due.items()},
        'upcoming': [{'date': last_day(d), 'sessions': s, 'archives': a} for d, s, a in upcoming],
        'last_run': {'ran_at': last[0].isoformat(), 'deleted': last[1]} if last else None,
    }


def apply(now: datetime | None = None) -> dict:
    """Delete what is due, in one transaction; returns the counts."""
    now = now or datetime.now(timezone.utc)
    deleted = {}
    with db.get_conn() as conn:
        # Recomputed kind by kind: deleting sessions frees classes and students.
        for kind, sql in _KINDS:
            ids = [r[0] for r in conn.execute(sql, {'now': now}).fetchall()]
            if kind == 'sessions':
                # What outlives them goes to the anonymous history first.
                deleted['history'] = sum(history.archive_session(conn, sid) for sid in ids)
            if ids:
                conn.execute(Q.RETENTION_DELETE[kind], (ids,))
            deleted[kind] = len(ids)
        if any(deleted.values()):
            conn.execute(Q.INSERT_RETENTION_RUN, (json.dumps(deleted),))
        conn.commit()
    return deleted


def last_day(purge_after: datetime) -> str:
    """The last day data is kept, as an ISO date: 31 December before *purge_after*."""
    return (purge_after.astimezone(SCHOOL_TZ) - timedelta(days=1)).date().isoformat()


def session_kept_until(conn, session_id: int) -> str | None:
    row = conn.execute(Q.SESSION_PURGE_AFTER, (session_id,)).fetchone()
    return last_day(row[0]) if row and row[0] else None


_last_check = 0.0


def tick() -> None:
    """Called by the worker when idle: apply retention at most every few hours.

    Never raises: a retention failure must not stop grading.
    """
    global _last_check
    interval = float(os.environ.get('DATA_RETENTION_CHECK_SECONDS', 6 * 3600))
    if mode() != 'apply' or time.monotonic() - _last_check < interval:
        return
    _last_check = time.monotonic()
    try:
        deleted = apply()
        if any(deleted.values()):
            print(f"[RETENTION] deleted {deleted}", flush=True)
    except Exception as exc:
        print(f"[RETENTION] failed: {exc}", flush=True)


if __name__ == '__main__':
    # python -m services.retention [report|apply]
    db.init_pool(os.environ['DATABASE_URL'], min_size=1, max_size=2)
    if sys.argv[1:] == ['apply']:
        print(json.dumps(apply()))
    else:
        print(json.dumps(report(), indent=2))
