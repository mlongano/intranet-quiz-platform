"""
Score transformation engine.

Single module behind the three score-mutation operations:
  - review (manual point overrides on specific entries)
  - recalculate (full regrade against current snapshot)
  - regrade-open (re-score only open questions)

All three share the same scaffold: load snapshot once, iterate entries once,
apply a caller-supplied transform_fn, update changed rows.  The route
handlers become thin adapters that pass different callbacks.
"""

from __future__ import annotations

import json
from typing import Callable, Iterable

from werkzeug.exceptions import Forbidden, NotFound

import db
from db import queries as Q
from utils import ensure_list

# transform_fn(score_entry_id, answers, qbank_map) -> new_answers | None
#   answers:    list of DetailedAnswer dicts for one score entry
#   qbank_map:  {str(question_id) -> question_dict} from the current snapshot
#   returns:    modified answers list, or None to skip (no changes)
TransformFn = Callable[[int, list[dict], dict[str, dict]], list[dict] | None]


def transform_scores(
    session_id: int,
    teacher_id: int,
    *,
    entry_ids: Iterable[int] | None = None,
    transform_fn: TransformFn,
) -> int:
    """Apply *transform_fn* to score entries in *session_id*.

    Loads the current snapshot once, fetches entries, calls *transform_fn*
    for each (filtered by *entry_ids* when given), and updates rows where
    the transformation produced changes.  Ownership is verified inside the
    transaction.

    Returns the count of updated entries.
    """
    entry_id_set: set[int] | None = set(entry_ids) if entry_ids is not None else None
    updated = 0

    with db.get_conn() as conn:
        # ── verify ownership ──────────────────────────────────────────────
        owner = conn.execute(
            "SELECT teacher_id FROM quiz_sessions WHERE id = %s", (session_id,)
        ).fetchone()
        if not owner:
            raise NotFound(description="Session not found.")
        if owner[0] != teacher_id:
            raise Forbidden(description="Not your session.")

        # ── load current snapshot once ────────────────────────────────────
        qbank_map = load_qbank_for_session(conn, session_id)

        # ── fetch entries ─────────────────────────────────────────────────
        rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()

        for r in rows:
            score_id: int = r[0]
            if entry_id_set is not None and score_id not in entry_id_set:
                continue

            answers = ensure_list(r[4])

            new_answers = transform_fn(score_id, answers, qbank_map)
            if new_answers is None:
                continue

            # Recompute totals from the returned answers
            new_raw = round(sum(a.get("points_awarded", 0) for a in new_answers), 2)
            new_max = round(sum(a.get("weight", 0) for a in new_answers), 2)
            new_pct = round(new_raw / new_max * 100, 2) if new_max else 0

            conn.execute(Q.UPDATE_SCORE_ANSWERS, {
                "answers": json.dumps(new_answers),
                "raw_points": new_raw,
                "max_points": new_max,
                "percent": new_pct,
                "id": score_id,
                "teacher_id": teacher_id,
            })
            updated += 1

        conn.commit()

    return updated


# ── helpers ───────────────────────────────────────────────────────────────────

def load_qbank_for_session(
    conn,              # psycopg.Connection
    session_id: int,
) -> dict[str, dict]:
    """Return {str(question_id) → question_dict} for a session's snapshot."""
    row = conn.execute(
        """SELECT snap.content
           FROM question_snapshots snap
           JOIN quiz_sessions s ON s.snapshot_id = snap.id
           WHERE s.id = %s""",
        (session_id,),
    ).fetchone()

    if not row:
        return {}

    content = row[0]
    questions = content.get("questions", []) if isinstance(content, dict) else []
    return {str(q["id"]): q for q in questions}
