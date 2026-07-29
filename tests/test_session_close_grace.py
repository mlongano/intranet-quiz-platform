"""Session-close policy.

Closing a session stops new answers but must never strand a student who has
already answered: submitting stays possible until closes_at + grace.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import (
    make_class, make_session, make_snapshot, make_student, make_teacher,
)


@pytest.fixture()
def midquiz(client, db_conn):
    """A student partway through an active session."""
    teacher_id = make_teacher(db_conn, email='grace-teacher@test.it')
    student_id = make_student(db_conn, email='grace-student@test.it')
    cls = make_class(db_conn)
    db_conn.execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)",
                    (cls, teacher_id))
    db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)",
                    (cls, student_id))
    snapshot_id = make_snapshot(db_conn, teacher_id)
    session_id = make_session(db_conn, teacher_id, snapshot_id, class_ids=[cls], status='active')
    db_conn.execute("UPDATE quiz_sessions SET join_code='GRC001' WHERE id=%s", (session_id,))
    db_conn.commit()

    token = client.post(
        '/api/auth/student-join',
        json={'email': 'grace-student@test.it', 'join_code': 'GRC001'},
    ).get_json()['token']
    auth = {'Authorization': f'Bearer {token}'}
    quiz_id = client.post('/api/quiz/start', json={}, headers=auth).get_json()['quiz_id']

    # Answer the first question so there is something to hand in.
    state = client.get(f'/api/quiz/resume/{quiz_id}', headers=auth).get_json()
    q = state['current_question']
    answer = 0 if q['type'] == 'single' else ([0] if q['type'] == 'multiple' else 'testo')
    client.post('/api/quiz/save-answer', json={'quiz_id': quiz_id, 'answer': answer},
                headers=auth)

    return {'auth': auth, 'quiz_id': quiz_id, 'session_id': session_id, 'db': db_conn}


def _save(client, ctx, answer=0):
    return client.post(
        '/api/quiz/save-answer',
        json={'quiz_id': ctx['quiz_id'], 'answer': answer},
        headers=ctx['auth'],
    )


def _submit(client, ctx):
    return client.post(
        '/api/quiz/submit', json={'quiz_id': ctx['quiz_id']}, headers=ctx['auth'],
    )


def test_manual_close_blocks_saving_but_allows_submitting(client, midquiz):
    ctx = midquiz
    ctx['db'].execute("UPDATE quiz_sessions SET status='closed' WHERE id=%s",
                      (ctx['session_id'],))
    ctx['db'].commit()

    saved = _save(client, ctx)
    assert saved.status_code == 409
    assert saved.get_json()['code'] == 'SESSION_CLOSED'

    submitted = _submit(client, ctx)
    assert submitted.status_code == 200, submitted.get_data(as_text=True)


def test_past_grace_blocks_both(client, midquiz, monkeypatch):
    ctx = midquiz
    monkeypatch.setenv('QUIZ_GRACE_SECONDS', '60')
    long_past = datetime.now(timezone.utc) - timedelta(hours=2)
    ctx['db'].execute("UPDATE quiz_sessions SET closes_at=%s WHERE id=%s",
                      (long_past, ctx['session_id']))
    ctx['db'].commit()

    assert _save(client, ctx).status_code == 409
    submitted = _submit(client, ctx)
    assert submitted.status_code == 409
    assert submitted.get_json()['code'] == 'SESSION_CLOSED'


def test_within_grace_still_works(client, midquiz, monkeypatch):
    ctx = midquiz
    monkeypatch.setenv('QUIZ_GRACE_SECONDS', '3600')
    just_closed = datetime.now(timezone.utc) - timedelta(minutes=5)
    ctx['db'].execute("UPDATE quiz_sessions SET closes_at=%s WHERE id=%s",
                      (just_closed, ctx['session_id']))
    ctx['db'].commit()

    # Still inside the grace window, and the session is still 'active'.
    assert _save(client, ctx).status_code == 200
    assert _submit(client, ctx).status_code == 200
