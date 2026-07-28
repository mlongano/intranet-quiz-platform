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

        # Opened lazily: an operation that changes nothing must not leave an
        # empty change set in the teacher's history.
        change_set_cache: dict[str, str] = {}

        def change_set() -> str:
            if 'id' not in change_set_cache:
                change_set_cache['id'] = open_change_set(
                    conn,
                    session_id=session_id,
                    reason=reason,
                    actor_type='teacher',
                    changed_by=teacher_id,
                )
            return change_set_cache['id']

        # Lock the session's score rows for the duration of this transaction:
        # review, recalculate and revert must not interleave with each other or
        # with the grading worker. These are short transactions with no LLM call.
        conn.execute(Q.LOCK_SCORES_FOR_SESSION, (session_id,))

        qbank_map = load_qbank_for_session(conn, session_id)
        rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()

        for r in rows:
            score_id: int = r[0]
            if entry_id_set is not None and score_id not in entry_id_set:
                continue

            answers = ensure_list(r[4])
            old_answers = [dict(a) for a in answers]
            new_answers = transform_fn(score_id, answers, qbank_map)
            if new_answers is None:
                continue

            new_raw = round(sum(a.get("points_awarded", 0) for a in new_answers), 2)
            new_max = round(sum(a.get("weight", 0) for a in new_answers), 2)
            new_pct = round(new_raw / new_max * 100, 2) if new_max else 0

            old_raw = round(sum(a.get("points_awarded", 0) for a in old_answers), 2)
            old_max = round(sum(a.get("weight", 0) for a in old_answers), 2)
            old_pct = round(old_raw / old_max * 100, 2) if old_max else 0

            # Must run before serialising: it assigns the new revisions.
            changed = record_answer_changes(
                conn,
                change_set_id=change_set,
                score_entry_id=score_id,
                old_answers=old_answers,
                new_answers=new_answers,
                old_percent=old_pct,
                new_percent=new_pct,
            )
            if not changed:
                continue

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


# ── change set helpers ────────────────────────────────────────────────────────

def open_change_set(
    conn,
    *,
    session_id: int,
    reason: str,
    actor_type: str,
    changed_by: int | None,
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


# Fields that must not, on their own, count as a change to an answer.
#   answer_revision — the bookkeeping we are about to compute
#   llm_updated_at  — a re-evaluation that reproduces the same result would
#                     otherwise bump every revision and make every earlier
#                     change set permanently un-revertable
_NON_SUBSTANTIVE_FIELDS = ('answer_revision', 'llm_updated_at')


def answers_differ(old_answer: dict | None, new_answer: dict) -> bool:
    """True when the two answers differ in any substantive field.

    Compares full content — points, feedback, verdict, status, override flags —
    not just points: a re-evaluation that keeps the score but rewrites the
    feedback is still a change the teacher must be able to see and revert.
    """
    if old_answer is None:
        return True

    def strip(a: dict) -> dict:
        return {k: v for k, v in a.items() if k not in _NON_SUBSTANTIVE_FIELDS}

    return strip(old_answer) != strip(new_answer)


def record_answer_changes(
    conn,
    *,
    change_set_id: str | Callable[[], str],
    score_entry_id: int,
    old_answers: list[dict] | None,
    new_answers: list[dict],
    old_percent: float | None,
    new_percent: float,
) -> int:
    """Bump revisions and insert score_history rows for changed answers only.

    This is the single seam that decides what "changed" means. For each answer
    that actually changed it sets answer_revision = old + 1 *on the new answer
    dict* and writes the history row, so the stored answers and the history
    always agree — migration 006 enforces new_revision = old_revision + 1.
    Answers that did not change keep their revision and get no row.

    Mutates new_answers, so callers must serialise them *after* calling this.

    old_answers may be None (first submission — every answer is recorded at
    revision 0). change_set_id may be a callable, which is invoked only when
    the first change is recorded, so a no-op operation leaves no empty change
    set behind.

    Returns the number of changed answers.
    """
    resolved_id: str | None = None
    changed = 0

    for idx, new_a in enumerate(new_answers):
        old_a = None
        if old_answers is not None and idx < len(old_answers):
            old_a = old_answers[idx]

        is_first_submission = old_answers is None
        if not is_first_submission and not answers_differ(old_a, new_a):
            continue

        old_rev = (old_a.get('answer_revision') or 0) if old_a else 0
        if is_first_submission:
            # Nothing preceded these answers: they are revision 0, not 0 -> 1.
            new_rev = new_a.get('answer_revision') or 0
            old_rev = new_rev
        else:
            new_rev = old_rev + 1
            new_a['answer_revision'] = new_rev

        if resolved_id is None:
            resolved_id = change_set_id() if callable(change_set_id) else change_set_id

        old_pts = old_a.get('points_awarded', 0) if old_a else 0.0
        new_pts = new_a.get('points_awarded', 0)

        conn.execute(Q.INSERT_SCORE_HISTORY, {
            'change_set_id': resolved_id,
            'score_entry_id': score_entry_id,
            'question_id': str(new_a.get('question_id', '')),
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
        changed += 1

    return changed


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
