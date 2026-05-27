"""
Teacher session reopening: a closed session can be made active again.
"""
import json

from tests.conftest import make_teacher, make_snapshot, make_session, teacher_token


def auth_post(client, path, body, teacher_id, email='teacher@test.it'):
    tok = teacher_token(teacher_id, email=email)
    return client.post(
        path,
        data=json.dumps(body),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {tok}',
        },
    )


def test_teacher_can_reopen_closed_session(client, db_conn):
    teacher_id = make_teacher(db_conn)
    snapshot_id = make_snapshot(db_conn, teacher_id)
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='closed')

    resp = auth_post(client, f'/api/teacher/sessions/{session_id}/reopen', {}, teacher_id)

    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data['join_code'], str)
    assert len(data['join_code']) == 6

    row = db_conn.execute(
        "SELECT status, join_code FROM quiz_sessions WHERE id = %s",
        (session_id,),
    ).fetchone()
    assert row[0] == 'active'
    assert row[1] == data['join_code']
