"""
Score transformation engine.

Single module behind the three score-mutation operations:
  - review (manual point overrides on specific entries)
  - recalculate (full regrade against current snapshot)
  - regrade-open (re-score only open questions)

All three share the same scaffold: load snapshot once, iterate entries once,
apply a caller-supplied transform_fn, update changed rows.  The route
handlers become thin adapters that pass different callbacks.

Phase 2: every mutation opens a score_change_set, bumps answer_revision
on each modified answer, and records old→new answer snapshots in
score_history for audit and atomic revert.
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


# ── public API ────────────────────────────────────────────────────────────────

def transform_scores(
    session_id: int,
    teacher_id: int,
    *,
    entry_ids: Iterable[int] | None = None,
    transform_fn: TransformFn,
    reason: str = 'recalculate',
) -> int:
    """Apply *transform_fn* to score entries in *session_id*.

    Opens a score_change_set, fetches entries, calls *transform_fn*
    for each (filtered by *entry_ids* when given), and updates rows where
    the transformation produced changes.  Ownership is verified inside the
    transaction.

    Returns the count of updated entries.
    """
    entry_id_set: set[int] | None = set(entry_ids) if entry_ids is not None else None
    updated = 0

    with db.get_conn() as conn:
        owner = conn.execute(
            "SELECT teacher_id FROM quiz_sessions WHERE id = %s", (session_id,)
        ).fetchone()
        if not owner:
            raise NotFound(description="Session not found.")
        if owner[0] != teacher_id:
            raise Forbidden(description="Not your session.")

        change_set_id = open_change_set(
            conn,
            session_id=session_id,
            reason=reason,
            actor_type='teacher',
            changed_by=teacher_id,
        )

        qbank_map = load_qbank_for_session(conn, session_id)
        rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()

        for r in rows:
            score_id: int = r[0]
            if entry_id_set is not None and score_id not in entry_id_set:
                continue

            answers = ensure_list(r[4])
            new_answers = transform_fn(score_id, answers, qbank_map)
            if new_answers is None:
                continue

            new_raw = round(sum(a.get("points_awarded", 0) for a in new_answers), 2)
            new_max = round(sum(a.get("weight", 0) for a in new_answers), 2)
            new_pct = round(new_raw / new_max * 100, 2) if new_max else 0

            old_raw = round(sum(a.get("points_awarded", 0) for a in answers), 2)
            old_max = round(sum(a.get("weight", 0) for a in answers), 2)
            old_pct = round(old_raw / old_max * 100, 2) if old_max else 0

            # Bump revision on every modified answer
            for new_a in new_answers:
                bump_answer_revision(new_a)

            conn.execute(Q.UPDATE_SCORE_ANSWERS, {
                "answers": json.dumps(new_answers),
                "raw_points": new_raw,
                "max_points": new_max,
                "percent": new_pct,
                "id": score_id,
                "teacher_id": teacher_id,
            })

            record_answer_changes(
                conn,
                change_set_id=change_set_id,
                score_entry_id=score_id,
                old_answers=answers,
                new_answers=new_answers,
                old_percent=old_pct,
                new_percent=new_pct,
            )
            updated += 1

        conn.commit()

    return updated


# ── change set helpers ────────────────────────────────────────────────────────

def open_change_set(
    conn,
    *,
    session_id: int,
    reason: str,
    actor_type: str,
    changed_by: int,
    llm_job_id: int | None = None,
    reverted_change_id: str | None = None,
) -> str:
    """Insert a score_change_sets row; return the UUID as a string."""
    row = conn.execute(Q.CREATE_CHANGE_SET, {
        'session_id': session_id,
        'reason': reason,
        'actor_type': actor_type,
        'changed_by': changed_by,
        'llm_job_id': llm_job_id,
        'reverted_change_id': reverted_change_id,
    }).fetchone()
    return str(row[0])


def record_answer_changes(
    conn,
    *,
    change_set_id: str,
    score_entry_id: int,
    old_answers: list[dict] | None,
    new_answers: list[dict],
    old_percent: float | None,
    new_percent: float,
) -> None:
    """Insert score_history rows for every answer whose points changed.

    old_answers may be None (first submission — every answer is new).
    Saves complete old/new answer snapshots for audit and revert.
    """
    for idx, new_a in enumerate(new_answers):
        new_pts = new_a.get('points_awarded', 0)
        old_a = None
        old_pts = 0.0
        if old_answers is not None and idx < len(old_answers):
            old_a = old_answers[idx]
            old_pts = old_a.get('points_awarded', 0)

        if old_answers is not None and old_pts == new_pts:
            continue

        old_rev = old_a.get('answer_revision', 0) if old_a else 0
        new_rev = new_a.get('answer_revision', 0)
        q_id = str(new_a.get('question_id', ''))

        conn.execute(Q.INSERT_SCORE_HISTORY, {
            'change_set_id': change_set_id,
            'score_entry_id': score_entry_id,
            'question_id': q_id,
            'answer_index': idx,
            'old_revision': old_rev,
            'new_revision': new_rev,
            'old_answer': json.dumps(old_a or {}),
            'new_answer': json.dumps(new_a),
            'old_raw_points': round(float(old_pts or 0), 2),
            'new_raw_points': round(float(new_pts), 2),
            'old_percent': round(float(old_percent or 0), 2),
            'new_percent': round(float(new_percent), 2),
        })


def bump_answer_revision(answer: dict) -> dict:
    """Increment answer_revision on the dict in-place; returns it."""
    rev = (answer.get('answer_revision') or 0) + 1
    answer['answer_revision'] = rev
    return answer


def load_qbank_for_session(
    conn,
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
