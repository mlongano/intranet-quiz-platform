"""Teacher-owned Quiz session Score entry workflows."""

from __future__ import annotations

import json

from werkzeug.exceptions import Conflict, Forbidden, NotFound

import db
from db import queries as Q


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


def list_session_scores(teacher_id: int, session_id: int) -> list[dict]:
    with db.get_conn() as conn:
        assert_session_owner(conn, session_id, teacher_id)
        rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()
    return [
        {
            'id': r[0], 'raw_points': float(r[1]), 'max_points': float(r[2]),
            'percent': float(r[3]), 'answers': _answers(r[4]),
            'submitted_at': r[5].isoformat() if r[5] else None,
            'student_email': r[6], 'student_name': r[7],
        }
        for r in rows
    ]


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
