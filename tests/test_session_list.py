"""The teacher's session list: each class once, scores counted once.

Joining a session's classes and its score entries in one query multiplies the
rows: one class and fourteen scores made fourteen rows, so the class appeared
fourteen times in the list ("5CI, 5CI, 5CI, ..."). The score count was right
only because it used COUNT(DISTINCT).
"""

import json

from services import session_scores
from tests.conftest import (
    make_class, make_session, make_snapshot, make_student, make_teacher, teacher_token,
)


def _scores(db_conn, session_id, teacher_id, n):
    for i in range(n):
        student_id = make_student(db_conn, email=f'list-s{session_id}-{i}@test.it')
        db_conn.execute(
            """INSERT INTO score_entries
               (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
               VALUES (%s, %s, %s, 1, 1, 100, '[]'::jsonb)""",
            (session_id, student_id, teacher_id),
        )
    db_conn.commit()


def test_each_class_listed_once_whatever_the_number_of_scores(db_conn):
    teacher_id = make_teacher(db_conn, email='list-t@test.it')
    snapshot_id = make_snapshot(db_conn, teacher_id)
    a, b = make_class(db_conn, name='5CI'), make_class(db_conn, name='4CI')
    session_id = make_session(db_conn, teacher_id, snapshot_id, class_ids=[a, b], status='closed')
    _scores(db_conn, session_id, teacher_id, 3)

    [session] = session_scores.list_sessions_for_teacher(teacher_id)

    assert sorted(c['name'] for c in session['classes']) == ['4CI', '5CI']
    assert session['score_count'] == 3


def test_session_without_classes_or_scores(db_conn):
    teacher_id = make_teacher(db_conn, email='list-empty@test.it')
    session_id = make_session(db_conn, teacher_id, make_snapshot(db_conn, teacher_id))

    [session] = session_scores.list_sessions_for_teacher(teacher_id)

    assert session['id'] == session_id
    assert session['classes'] == []
    assert session['score_count'] == 0


def test_api_returns_each_class_once(client, db_conn):
    teacher_id = make_teacher(db_conn, email='list-api@test.it')
    snapshot_id = make_snapshot(db_conn, teacher_id)
    class_id = make_class(db_conn, name='3AI')
    session_id = make_session(db_conn, teacher_id, snapshot_id, class_ids=[class_id], status='closed')
    _scores(db_conn, session_id, teacher_id, 4)

    response = client.get('/api/teacher/sessions',
                          headers={'Authorization': f"Bearer {teacher_token(teacher_id, email='list-api@test.it')}"})

    assert response.status_code == 200
    body = response.get_json()
    sessions = body if isinstance(body, list) else body.get('sessions', body)
    [session] = [s for s in sessions if s['id'] == session_id]
    assert [c['name'] for c in session['classes']] == ['3AI']
    assert session['score_count'] == 4
