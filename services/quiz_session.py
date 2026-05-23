"""
Quiz session lifecycle: plan creation, answer saving, submission, join-code management.
All writes happen inside a single DB transaction per operation.
"""

from __future__ import annotations

import json
import random
import secrets
import string
from datetime import datetime, timezone
from typing import Any

import psycopg
from psycopg import errors as pg_errors
from werkzeug.exceptions import Conflict, Forbidden, NotFound

import db
from db import queries as Q
from services.score_transforms import load_qbank_for_session
from services.grading import format_detailed_answers, grade

# Characters for join codes: unambiguous (no O/0, I/1, etc.)
_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'


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
            raise Conflict(description='ALREADY_SUBMITTED')

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


def save_answer(quiz_id: str, answer: Any, student_id: int) -> dict:
    """
    Save the answer for the current question and advance the index.
    Ownership is verified inside the FOR UPDATE lock — no TOCTOU gap.
    Returns {'next_question': {...}, 'current_index': N, 'total': N} or {'is_complete': True}.
    """
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT quiz_id, session_id, student_id, plan, progression, completed_at "
            "FROM quiz_plans WHERE quiz_id = %s FOR UPDATE",
            (quiz_id,),
        ).fetchone()
        if not row:
            raise NotFound(description="Quiz plan not found.")
        if row[2] != student_id:
            raise Forbidden(description="Not your plan.")

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
            "       qp.completed_at, qs.teacher_id, qs.snapshot_id "
            "FROM quiz_plans qp "
            "JOIN quiz_sessions qs ON qs.id = qp.session_id "
            "WHERE qp.quiz_id = %s FOR UPDATE",
            (quiz_id,),
        ).fetchone()
        if not row:
            raise NotFound(description="Quiz plan not found.")
        if row[2] != student_id:
            raise Forbidden(description="Not your plan.")

        session_id = row[1]
        student_id = row[2]
        teacher_id = row[6]
        snapshot_id = row[7]

        # Idempotency guard — Postgres UNIQUE handles the actual race
        score_exists = conn.execute(
            Q.CHECK_SCORE_EXISTS, (session_id, student_id)
        ).fetchone()
        if score_exists:
            raise Conflict(description='ALREADY_SUBMITTED')

        plan_data = _parse_json_field(row[3])
        progression = _parse_json_field(row[4])
        plan_steps = plan_data.get('plan', []) if isinstance(plan_data, dict) else plan_data
        answers_dict = progression.get('answers', {})
        answers_list = [answers_dict.get(str(i)) for i in range(len(plan_steps))]

        # Load snapshot
        snap_row = conn.execute(Q.GET_SNAPSHOT_CONTENT, (snapshot_id,)).fetchone()
        content = snap_row[0] if snap_row else {}
        questions_list = content.get('questions', []) if isinstance(content, dict) else []
        qbank_map = {str(q['id']): q for q in questions_list}

        grading_plan = {'plan': plan_steps}
        grading_qbank = {'questions': questions_list}
        grade_result = grade(answers_list, grading_plan, grading_qbank)

        detailed = format_detailed_answers(
            grading_plan,
            qbank_map,
            answers_list,
            grade_result['scores_per_question'],
            grade_result['feedbacks_per_question'],
            grade_result['verdicts_per_question'],
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
            raise Conflict(description='ALREADY_SUBMITTED')

        if not score_row:
            conn.rollback()
            raise Conflict(description='ALREADY_SUBMITTED')

        conn.execute(Q.DELETE_PLAN, (quiz_id,))
        conn.commit()

    return {
        'raw_points': grade_result['raw_points'],
        'max_points': grade_result['max_points'],
        'percent': grade_result['percent'],
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
    }


def _parse_json_field(value) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        return json.loads(value)
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
        return {'is_complete': True, 'total': total, 'current_index': current_index}

    step = plan_steps[current_index]
    q_id = str(step.get('id'))

    qbank_map = load_qbank_for_session(conn, session_id)
    q = qbank_map.get(q_id)
    if not q:
        return {'is_complete': False, 'current_index': current_index, 'total': total,
                'question': None}

    option_order = step.get('option_order', list(range(len(q.get('options', [])))))
    options = q.get('options', [])
    shuffled_options = [options[i] for i in option_order if i < len(options)]

    return {
        'is_complete': False,
        'current_index': current_index,
        'total': total,
        'question': {
            'id': q['id'],
            'type': q.get('type'),
            'text': q.get('text'),
            'question_image': q.get('question_image'),
            'options': shuffled_options,
        },
    }
