"""Teacher-owned Quiz session Score entry workflows."""

from __future__ import annotations

import json

from werkzeug.exceptions import Conflict, Forbidden, NotFound

import db
from db import queries as Q
from services import retention


def assert_session_owner(conn, session_id: int, teacher_id: int) -> None:
    row = conn.execute(
        "SELECT teacher_id FROM quiz_sessions WHERE id = %s", (session_id,)
    ).fetchone()
    if not row:
        raise NotFound(description="Session not found.")
    if row[0] != teacher_id:
        raise Forbidden(description="Not your session.")


def _answers(value) -> list:
    return value if isinstance(value, list) else json.loads(value or '[]')


def list_sessions_for_teacher(teacher_id: int, status_filter: str | None = None) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_SESSIONS_FOR_TEACHER, (teacher_id,)).fetchall()

    result = []
    for r in rows:
        session = {
            'id': r[0], 'title': r[1], 'status': r[2], 'join_code': r[3],
            'opens_at': r[4].isoformat() if r[4] else None,
            'closes_at': r[5].isoformat() if r[5] else None,
            'created_at': r[6].isoformat() if r[6] else None,
            'classes': r[7] if isinstance(r[7], list) else json.loads(r[7] or '[]'),
            'score_count': r[8],
        }
        if not status_filter or session['status'] == status_filter:
            result.append(session)
    return result


def get_session_for_teacher(teacher_id: int, session_id: int) -> dict:
    from services.quiz_session import edit_constraints
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_SESSION, (session_id, teacher_id)).fetchone()
        if not row:
            raise NotFound(description="Session not found.")
        edit = edit_constraints(conn, session_id, row[5])
        kept_until = retention.session_kept_until(conn, session_id)
    return {
        'id': row[0], 'snapshot_id': row[2], 'title': row[3],
        'join_code': row[4], 'status': row[5],
        'opens_at': row[6].isoformat() if row[6] else None,
        'closes_at': row[7].isoformat() if row[7] else None,
        'created_at': row[8].isoformat() if row[8] else None,
        'classes': row[9] if isinstance(row[9], list) else json.loads(row[9] or '[]'),
        'edit': edit,
        'results_published_at': row[10].isoformat() if row[10] else None,
        'results_show_correct': bool(row[11]),
        'results_show_acceptable': bool(row[12]),
        'results_emailed_at': row[13].isoformat() if row[13] else None,
        'results_emailed_count': row[14],
        # Data retention: the students' data of this session is deleted after this day.
        'data_kept_until': kept_until,
    }


def list_session_scores(teacher_id: int, session_id: int) -> list[dict]:
    with db.get_conn() as conn:
        assert_session_owner(conn, session_id, teacher_id)
        rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()

    entries = []
    for r in rows:
        answers = _answers(r[4])
        pending = [
            a for a in answers
            if a.get('type') == 'open' and a.get('llm_status') == 'pending'
        ]
        entries.append({
            'id': r[0], 'raw_points': float(r[1]), 'max_points': float(r[2]),
            'percent': float(r[3]), 'answers': answers,
            'submitted_at': r[5].isoformat() if r[5] else None,
            'student_email': r[6], 'student_name': r[7],
            'grading_complete': not pending,
            'pending_open_count': len(pending),
            'pending_open_weight': sum(a.get('weight', 0) for a in pending),
        })
    return entries


def delete_draft_session(teacher_id: int, session_id: int) -> None:
    with db.get_conn() as conn:
        assert_session_owner(conn, session_id, teacher_id)
        result = conn.execute(Q.DELETE_SESSION, (session_id, teacher_id))
        if result.rowcount == 0:
            conn.rollback()
            raise Conflict(description="Session is not a draft.")
        conn.commit()


def archive_session_scores(
    teacher_id: int,
    session_id: int,
    *,
    title: str | None = None,
    notes: str | None = None,
) -> dict:
    with db.get_conn() as conn:
        assert_session_owner(conn, session_id, teacher_id)
        sess_row = conn.execute(
            "SELECT title FROM quiz_sessions WHERE id = %s", (session_id,)
        ).fetchone()
        archive_title = title or (sess_row[0] if sess_row else f"session-{session_id}")

        score_rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()
        content = [
            {
                'student_email': r[6], 'student_name': r[7],
                'raw_points': float(r[1]), 'max_points': float(r[2]),
                'percent': float(r[3]), 'answers': _answers(r[4]),
                'submitted_at': r[5].isoformat() if r[5] else None,
            }
            for r in score_rows
        ]
        row = conn.execute(Q.INSERT_ARCHIVE, {
            'teacher_id': teacher_id,
            'title': archive_title,
            'source_session_id': session_id,
            'content': json.dumps(content),
            'notes': notes,
        }).fetchone()
        conn.commit()
    return {'archive_id': row[0], 'archived_at': row[1].isoformat()}


def live_progress(teacher_id: int) -> dict:
    """Who handed in, who is working and who has not started, per active session.

    For the dashboard, polled every few seconds: two queries whatever the
    number of sessions and students. Only the teacher's own sessions.
    """
    with db.get_conn() as conn:
        sessions = conn.execute(Q.LIVE_ACTIVE_SESSIONS, (teacher_id,)).fetchall()
        ids = [r[0] for r in sessions]
        rows = conn.execute(Q.LIVE_ROSTER, {'ids': ids}).fetchall() if ids else []

    by_session: dict[int, list[dict]] = {sid: [] for sid in ids}
    for (session_id, student_id, name, email, classes, progression, last_updated,
         writing, submitted_at, percent, grading_pending) in rows:
        if submitted_at is not None:
            state = 'submitted'
        elif progression is not None:
            state = 'in_progress'
        else:
            state = 'not_started'
        progression = progression if isinstance(progression, dict) else (
            json.loads(progression) if progression else {})
        by_session[session_id].append({
            'id': student_id,
            'name': name,
            'email': email,
            'classes': list(classes or []),
            'state': state,
            'answered': int(progression.get('current_index', 0)) if state == 'in_progress' else None,
            'last_activity': last_updated.isoformat() if state == 'in_progress' and last_updated else None,
            'writing': bool(writing) if state == 'in_progress' else False,
            'submitted_at': submitted_at.isoformat() if submitted_at else None,
            'percent': float(percent) if percent is not None else None,
            'grading_pending': bool(grading_pending) if state == 'submitted' else False,
        })

    result = []
    for sid, title, join_code, opens_at, closes_at, question_count in sessions:
        students = by_session[sid]
        counts = {'expected': len(students), 'submitted': 0, 'in_progress': 0, 'not_started': 0}
        for st in students:
            counts[st['state']] += 1
        result.append({
            'id': sid, 'title': title, 'join_code': join_code,
            'opens_at': opens_at.isoformat() if opens_at else None,
            'closes_at': closes_at.isoformat() if closes_at else None,
            'question_count': question_count,
            'counts': counts,
            'students': students,
        })
    return {'sessions': result}
