"""
Quiz session lifecycle: plan creation, answer saving, submission, join-code management.
All writes happen inside a single DB transaction per operation.
"""

from __future__ import annotations

import json
import os
import random
import secrets
import string
from datetime import datetime, timedelta, timezone
from typing import Any

import psycopg
from psycopg import errors as pg_errors
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound, RequestEntityTooLarge

import db
from db import queries as Q
from services.score_transforms import load_qbank_for_session
from services.grading import format_detailed_answers, grade

# Characters for join codes: unambiguous (no O/0, I/1, etc.)
_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


class SessionClosed(Conflict):
    """The session no longer accepts this operation."""


class AnswerTooLong(RequestEntityTooLarge):
    """An open answer over OPEN_ANSWER_MAX_CHARS."""


class DraftStale(Conflict):
    """A draft for a question the student has already moved past."""


class DraftNotOpen(BadRequest):
    """Drafts exist only for open questions."""


def _max_answer_chars() -> int:
    """Generous for an essay, a bound for the database and the grading model."""
    return int(os.getenv('OPEN_ANSWER_MAX_CHARS', '20000'))


def _check_answer_length(answer: Any) -> None:
    if isinstance(answer, str) and len(answer) > _max_answer_chars():
        raise AnswerTooLong(
            description=f"La risposta supera i {_max_answer_chars()} caratteri ammessi."
        )


def _grace_seconds() -> int:
    """Slack after closes_at, matching the student token's closes_at + 1h."""
    return int(os.getenv('QUIZ_GRACE_SECONDS', '3600'))


def _past_grace(closes_at: datetime | None) -> bool:
    if closes_at is None:
        return False
    if closes_at.tzinfo is None:
        closes_at = closes_at.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) > closes_at + timedelta(seconds=_grace_seconds())


def generate_join_code() -> str:
    return ''.join(secrets.choice(_CODE_CHARS) for _ in range(6))


# ── session lifecycle ─────────────────────────────────────────────────────────

def create_session(
    teacher_id: int,
    snapshot_id: int,
    title: str,
    class_ids: list[int],
    opens_at: datetime | None = None,
    closes_at: datetime | None = None,
) -> dict:
    with db.get_conn() as conn:
        # Verify teacher owns every class (inside the same transaction as the INSERT)
        for cid in class_ids:
            owns = conn.execute(
                "SELECT 1 FROM class_teachers WHERE class_id = %s AND teacher_id = %s",
                (cid, teacher_id),
            ).fetchone()
            if not owns:
                raise Forbidden(description=f"Class {cid} not found or not yours.")

        row = conn.execute(Q.INSERT_SESSION, {
            'teacher_id': teacher_id,
            'snapshot_id': snapshot_id,
            'title': title,
            'opens_at': opens_at,
            'closes_at': closes_at,
        }).fetchone()
        session_id = row[0]
        for cid in class_ids:
            conn.execute(Q.INSERT_SESSION_CLASS, (session_id, cid))
        conn.commit()
    return {'id': session_id, 'join_code': None}


def activate_session(session_id: int, teacher_id: int) -> str:
    code = generate_join_code()
    with db.get_conn() as conn:
        row = conn.execute(Q.ACTIVATE_SESSION, (code, session_id, teacher_id)).fetchone()
        if not row:
            raise NotFound(description="Session not found or already active/closed.")
        conn.commit()
    return code


def close_session(session_id: int, teacher_id: int) -> None:
    with db.get_conn() as conn:
        row = conn.execute(Q.CLOSE_SESSION, (session_id, teacher_id)).fetchone()
        if not row:
            raise NotFound(description="Session not found or not in active state.")
        conn.commit()


def reopen_session(session_id: int, teacher_id: int) -> str:
    code = generate_join_code()
    with db.get_conn() as conn:
        row = conn.execute(Q.REOPEN_SESSION, (code, session_id, teacher_id)).fetchone()
        if not row:
            raise NotFound(description="Session not found or not in closed state.")
        conn.commit()
    return code


def regenerate_join_code(session_id: int, teacher_id: int) -> str:
    code = generate_join_code()
    with db.get_conn() as conn:
        row = conn.execute(Q.UPDATE_JOIN_CODE, (code, session_id, teacher_id)).fetchone()
        if not row:
            raise NotFound(description="Active session not found.")
        conn.commit()
    return code


# ── plan management ───────────────────────────────────────────────────────────

def _build_plan(questions_list: list[dict]) -> list[dict]:
    """
    Shuffle questions (open questions go last), shuffle options within each.
    Returns [{id, option_order: [original_indices...]}, ...].
    """
    non_open = [q for q in questions_list if q.get('type') != 'open']
    open_q = [q for q in questions_list if q.get('type') == 'open']
    random.shuffle(non_open)
    random.shuffle(open_q)
    ordered = non_open + open_q

    plan_steps = []
    for q in ordered:
        options = q.get('options', [])
        option_order = list(range(len(options)))
        if q.get('type') != 'open':
            random.shuffle(option_order)
        plan_steps.append({'id': str(q['id']), 'option_order': option_order})
    return plan_steps


def get_or_create_plan(session_id: int, student_id: int) -> dict:
    """
    Returns existing plan or creates one. Returns the quiz_plans row as a dict.
    Raises Conflict if student already submitted.
    """
    with db.get_conn() as conn:
        # Check for already-submitted score
        score_exists = conn.execute(
            Q.CHECK_SCORE_EXISTS, (session_id, student_id)
        ).fetchone()
        if score_exists:
            raise Conflict(description='Hai già consegnato questo quiz.')

        # Try existing plan
        existing = conn.execute(
            Q.GET_PLAN_BY_STUDENT_SESSION, (session_id, student_id)
        ).fetchone()
        if existing:
            return _plan_row_to_dict(existing)

        # Load the snapshot content for this session
        session_row = conn.execute(
            "SELECT snapshot_id FROM quiz_sessions WHERE id = %s", (session_id,)
        ).fetchone()
        if not session_row:
            raise NotFound(description="Quiz session not found.")

        snap_row = conn.execute(
            Q.GET_SNAPSHOT_CONTENT, (session_row[0],)
        ).fetchone()
        if not snap_row:
            raise NotFound(description="Question snapshot not found.")

        content = snap_row[0]  # already a dict from psycopg3 JSONB
        questions_list = content.get('questions', []) if isinstance(content, dict) else content

        plan_steps = _build_plan(questions_list)
        quiz_id = secrets.token_hex(6)  # 12-char hex, matches legacy format
        progression = {'current_index': 0, 'answers': {}}

        inserted = conn.execute(Q.INSERT_PLAN, {
            'quiz_id': quiz_id,
            'session_id': session_id,
            'student_id': student_id,
            'plan': json.dumps(plan_steps),
            'progression': json.dumps(progression),
        }).fetchone()

        if not inserted:
            # Race: another request inserted first — fetch it
            existing = conn.execute(
                Q.GET_PLAN_BY_STUDENT_SESSION, (session_id, student_id)
            ).fetchone()
            conn.commit()
            return _plan_row_to_dict(existing)

        conn.commit()
        return {
            'quiz_id': quiz_id,
            'session_id': session_id,
            'student_id': student_id,
            'plan': plan_steps,
            'progression': progression,
            'created_at': datetime.now(timezone.utc),
            'last_updated': datetime.now(timezone.utc),
            'completed_at': None,
        }


def find_plan_by_quiz_id(quiz_id: str) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_PLAN_BY_QUIZ_ID, (quiz_id,)).fetchone()
    if not row:
        return None
    return _plan_row_to_dict(row)


def save_draft(quiz_id: str, index: int, text: Any, student_id: str) -> dict:
    """Store the draft of the open answer the student is writing.

    Only for the current question, and only while the student could still hand
    it in: an active session, or a closed one within the grace window, since
    submit_plan hands in the draft after a manual close. Ownership is checked
    under the same FOR UPDATE lock as the write. Returns {'saved_at': iso}.
    """
    if not isinstance(text, str):
        raise BadRequest(description="Il testo della bozza non è valido.")
    _check_answer_length(text)
    with db.get_conn() as conn:
        row = conn.execute(Q.LOCK_PLAN_WITH_SESSION, (quiz_id,)).fetchone()
        if not row:
            raise NotFound(description="Quiz plan not found.")
        owner, session_id, plan_raw, progression_raw, completed_at, status, closes_at = row
        if str(owner) != student_id:
            raise Forbidden(description="Not your plan.")
        if status not in ('active', 'closed') or _past_grace(closes_at):
            raise SessionClosed(description="La sessione è chiusa: la bozza non è stata salvata.")

        plan_data = _parse_json_field(plan_raw)
        plan_steps = plan_data.get('plan', []) if isinstance(plan_data, dict) else plan_data
        current_index = int(_parse_json_field(progression_raw).get('current_index', 0))
        if completed_at is not None or index != current_index or current_index >= len(plan_steps):
            raise DraftStale(description="La domanda della bozza non è più quella corrente.")

        q = load_qbank_for_session(conn, session_id).get(str(plan_steps[current_index].get('id')))
        if not q or q.get('type') != 'open':
            raise DraftNotOpen(description="Solo le domande aperte hanno una bozza.")

        saved_at = datetime.now(timezone.utc).isoformat()
        conn.execute(Q.UPDATE_PLAN_DRAFT, {
            'draft': json.dumps({'index': index, 'text': text, 'saved_at': saved_at}),
            'quiz_id': quiz_id,
        })
        conn.commit()
    return {'saved_at': saved_at}


def current_draft(plan: dict) -> dict | None:
    """The plan's draft if it belongs to the current question, for resume."""
    draft = plan.get('draft')
    progression = plan.get('progression') or {}
    if not isinstance(draft, dict) or draft.get('index') != int(progression.get('current_index', 0)):
        return None
    return {'text': draft.get('text', ''), 'saved_at': draft.get('saved_at')}


def save_answer(quiz_id: str, answer: Any, student_id: int) -> dict:
    """
    Save the answer for the current question and advance the index.
    Ownership is verified inside the FOR UPDATE lock — no TOCTOU gap.
    Returns {'next_question': {...}, 'current_index': N, 'total': N} or {'is_complete': True}.
    """
    _check_answer_length(answer)
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT qp.quiz_id, qp.session_id, qp.student_id, qp.plan, qp.progression, "
            "       qp.completed_at, qs.status, qs.closes_at "
            "FROM quiz_plans qp "
            "JOIN quiz_sessions qs ON qs.id = qp.session_id "
            "WHERE qp.quiz_id = %s FOR UPDATE OF qp",
            (quiz_id,),
        ).fetchone()
        if not row:
            raise NotFound(description="Quiz plan not found.")
        if str(row[2]) != student_id:
            raise Forbidden(description="Not your plan.")

        # A closed session accepts no new answers, but the student may still
        # submit what they have already answered (see submit_plan).
        if row[6] != 'active' or _past_grace(row[7]):
            raise SessionClosed(
                description="La sessione è stata chiusa dall'insegnante."
            )

        plan_data = _parse_json_field(row[3])
        progression = _parse_json_field(row[4])
        completed_at = row[5]

        if completed_at is not None:
            return {'is_complete': True}

        plan_steps = plan_data.get('plan', []) if isinstance(plan_data, dict) else plan_data
        current_index = int(progression.get('current_index', 0))

        if current_index >= len(plan_steps):
            return {'is_complete': True}

        answers = progression.get('answers', {})
        answers[str(current_index)] = answer
        next_index = current_index + 1
        progression['current_index'] = next_index
        progression['answers'] = answers

        conn.execute(Q.UPDATE_PLAN_PROGRESSION, {
            'progression': json.dumps(progression),
            'quiz_id': quiz_id,
        })

        session_id = row[1]
        result = _build_question_response(conn, session_id, plan_steps, next_index)

        if result.get('is_complete'):
            conn.execute(Q.MARK_PLAN_COMPLETE, (quiz_id,))

        conn.commit()
    return result


def submit_plan(quiz_id: str, student_id: int) -> dict:
    """
    Grade the completed plan, insert a score_entries row, and delete the plan.
    Ownership is verified inside the FOR UPDATE lock — no TOCTOU gap.
    Returns {raw_points, max_points, percent}.
    Raises Conflict if already submitted.
    """
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT qp.quiz_id, qp.session_id, qp.student_id, qp.plan, qp.progression, "
            "       qp.completed_at, qs.teacher_id, qs.snapshot_id, qs.status, qs.closes_at, "
            "       qp.draft "
            "FROM quiz_plans qp "
            "JOIN quiz_sessions qs ON qs.id = qp.session_id "
            "WHERE qp.quiz_id = %s FOR UPDATE OF qp",
            (quiz_id,),
        ).fetchone()
        if not row:
            raise NotFound(description="Quiz plan not found.")
        if str(row[2]) != student_id:
            raise Forbidden(description="Not your plan.")

        # Handing in still works after a manual close — a student who answered
        # must not lose their work because the teacher closed the session.
        if row[8] not in ('active', 'closed') or _past_grace(row[9]):
            raise SessionClosed(
                description="La sessione è chiusa: non è più possibile consegnare."
            )

        session_id = row[1]
        student_id = row[2]
        teacher_id = row[6]
        snapshot_id = row[7]

        # Idempotency guard — Postgres UNIQUE handles the actual race
        score_exists = conn.execute(
            Q.CHECK_SCORE_EXISTS, (session_id, student_id)
        ).fetchone()
        if score_exists:
            raise Conflict(description='Hai già consegnato questo quiz.')

        plan_data = _parse_json_field(row[3])
        progression = _parse_json_field(row[4])
        plan_steps = plan_data.get('plan', []) if isinstance(plan_data, dict) else plan_data
        answers_dict = progression.get('answers', {})
        answers_list = [answers_dict.get(str(i)) for i in range(len(plan_steps))]

        # Handing in before the last question happens only after a close. The
        # open answer being written then counts: losing it would punish the
        # student for the teacher closing mid-sentence. The question's type is
        # checked below, once the snapshot is loaded.
        draft = _parse_json_field(row[10])
        current_index = int(progression.get('current_index', 0))
        draft_text = None
        if (isinstance(draft, dict) and draft.get('index') == current_index
                and current_index < len(plan_steps)
                and answers_list[current_index] is None
                and isinstance(draft.get('text'), str) and draft['text'].strip()):
            draft_text = draft['text']

        # Load snapshot
        snap_row = conn.execute(Q.GET_SNAPSHOT_CONTENT, (snapshot_id,)).fetchone()
        content = snap_row[0] if snap_row else {}
        questions_list = content.get('questions', []) if isinstance(content, dict) else []
        qbank_map = {str(q['id']): q for q in questions_list}
        if draft_text is not None:
            q = qbank_map.get(str(plan_steps[current_index].get('id')))
            if q and q.get('type') == 'open':
                answers_list[current_index] = draft_text

        grading_plan = {'plan': plan_steps}
        grading_qbank = {'questions': questions_list}
        # Open questions are always deferred to the worker — see grade().
        grade_result = grade(answers_list, grading_plan, grading_qbank)

        detailed = format_detailed_answers(
            grading_plan,
            qbank_map,
            answers_list,
            grade_result['scores_per_question'],
            grade_result['feedbacks_per_question'],
            grade_result['verdicts_per_question'],
            grade_result['statuses_per_question'],
            grade_result['errors_per_question'],
        )

        try:
            score_row = conn.execute(Q.INSERT_SCORE_ENTRY, {
                'session_id': session_id,
                'student_id': student_id,
                'teacher_id': teacher_id,
                'raw_points': grade_result['raw_points'],
                'max_points': grade_result['max_points'],
                'percent': grade_result['percent'],
                'answers': json.dumps(detailed),
            }).fetchone()
        except pg_errors.UniqueViolation:
            conn.rollback()
            raise Conflict(description='Hai già consegnato questo quiz.')

        if not score_row:
            conn.rollback()
            raise Conflict(description='Hai già consegnato questo quiz.')

        pending_open_count = sum(
            1
            for answer in detailed
            if answer.get('type') == 'open' and answer.get('llm_status') == 'pending'
        )
        pending_open_weight = sum(
            answer.get('weight', 0)
            for answer in detailed
            if answer.get('type') == 'open' and answer.get('llm_status') == 'pending'
        )
        if pending_open_count:
            from services.llm_jobs import create_llm_job
            create_llm_job(
                conn,
                teacher_id=teacher_id,
                session_id=session_id,
                score_entry_id=score_row[0],
                job_type='submission',
                total_items=pending_open_count,
            )

        # Set answer_revision=0 and record score history for initial submission
        for answer in detailed:
            answer['answer_revision'] = 0

        from services.score_transforms import open_change_set, record_answer_changes
        change_set_id = open_change_set(
            conn,
            session_id=session_id,
            reason='submission',
            actor_type='system',
            changed_by=None,   # the student's submission, not a teacher action
        )
        record_answer_changes(
            conn,
            change_set_id=change_set_id,
            score_entry_id=score_row[0],
            old_answers=None,
            new_answers=detailed,
            old_percent=None,
            new_percent=grade_result['percent'],
        )

        conn.execute(Q.DELETE_PLAN, (quiz_id,))
        conn.commit()

    return {
        'raw_points': grade_result['raw_points'],
        'max_points': grade_result['max_points'],
        'percent': grade_result['percent'],
        'status': 'provisional' if pending_open_count else 'final',
        'grading_complete': pending_open_count == 0,
        'pending_open_count': pending_open_count,
        'pending_open_weight': pending_open_weight,
    }


# ── helpers ───────────────────────────────────────────────────────────────────

def _plan_row_to_dict(row) -> dict:
    return {
        'quiz_id': row[0],
        'session_id': row[1],
        'student_id': row[2],
        'plan': _parse_json_field(row[3]),
        'progression': _parse_json_field(row[4]),
        'created_at': row[5],
        'last_updated': row[6],
        'completed_at': row[7] if len(row) > 7 else None,
        'draft': _parse_json_field(row[8]) if len(row) > 8 else None,
    }


def _parse_json_field(value) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def _build_question_response(
    conn: psycopg.Connection,
    session_id: int,
    plan_steps: list[dict],
    current_index: int,
) -> dict:
    """Build the next-question response or is_complete flag."""
    total = len(plan_steps)
    if current_index >= total:
        return {'is_complete': True, 'total_questions': total, 'current_index': current_index}

    step = plan_steps[current_index]
    q_id = str(step.get('id'))

    qbank_map = load_qbank_for_session(conn, session_id)
    q = qbank_map.get(q_id)
    if not q:
        return {'is_complete': False, 'current_index': current_index, 'total_questions': total,
                'current_question': None}

    option_order = step.get('option_order', list(range(len(q.get('options', [])))))
    options = q.get('options', [])
    shuffled_options = [options[i] for i in option_order if i < len(options)]

    return {
        'is_complete': False,
        'current_index': current_index,
        'total_questions': total,
        'current_question': {
            'id': q['id'],
            'type': q.get('type'),
            'text': q.get('text'),
            'question_image': q.get('question_image'),
            'options': shuffled_options,
        },
    }
