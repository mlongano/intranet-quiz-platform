"""
Multi-tenancy isolation: Teacher A cannot access Teacher B's resources.
These tests form the core tenancy contract — any regression here is critical.
"""
import json
import pytest
from tests.conftest import (
    make_teacher, make_student, make_class, make_snapshot, make_session,
    teacher_token,
)


def auth_get(client, path, teacher_id, email='t@test.it'):
    tok = teacher_token(teacher_id, email=email)
    return client.get(path, headers={'Authorization': f'Bearer {tok}'})


def auth_post(client, path, body, teacher_id, email='t@test.it'):
    tok = teacher_token(teacher_id, email=email)
    return client.post(path,
                       data=json.dumps(body),
                       headers={'Content-Type': 'application/json',
                                'Authorization': f'Bearer {tok}'})


def auth_put(client, path, body, teacher_id, email='t@test.it'):
    tok = teacher_token(teacher_id, email=email)
    return client.put(path,
                      data=json.dumps(body),
                      headers={'Content-Type': 'application/json',
                               'Authorization': f'Bearer {tok}'})


def auth_delete(client, path, teacher_id, email='t@test.it'):
    tok = teacher_token(teacher_id, email=email)
    return client.delete(path, headers={'Authorization': f'Bearer {tok}'})


@pytest.fixture()
def two_teachers(db_conn):
    tid_a = make_teacher(db_conn, email='teacher_a@test.it', display_name='Teacher A')
    tid_b = make_teacher(db_conn, email='teacher_b@test.it', display_name='Teacher B')
    snap_a = make_snapshot(db_conn, tid_a, title='Quiz A')
    snap_b = make_snapshot(db_conn, tid_b, title='Quiz B')
    cls_a = make_class(db_conn, name='3CA')
    cls_b = make_class(db_conn, name='3CB')
    sess_a = make_session(db_conn, tid_a, snap_a, class_ids=[cls_a])
    sess_b = make_session(db_conn, tid_b, snap_b, class_ids=[cls_b])
    db_conn.commit()
    return {
        'a': {'id': tid_a, 'email': 'teacher_a@test.it', 'snap': snap_a, 'sess': sess_a},
        'b': {'id': tid_b, 'email': 'teacher_b@test.it', 'snap': snap_b, 'sess': sess_b},
    }


class TestSnapshotIsolation:
    def test_cannot_read_other_snapshot(self, client, two_teachers):
        snap_b = two_teachers['b']['snap']
        tid_a = two_teachers['a']['id']
        resp = auth_get(client, f'/api/teacher/snapshots/{snap_b}', tid_a, 'teacher_a@test.it')
        assert resp.status_code in (403, 404)

    def test_cannot_update_other_snapshot(self, client, two_teachers):
        snap_b = two_teachers['b']['snap']
        tid_a = two_teachers['a']['id']
        resp = auth_put(client, f'/api/teacher/snapshots/{snap_b}', {'title': 'Hacked'},
                        tid_a, 'teacher_a@test.it')
        assert resp.status_code in (403, 404)

    def test_cannot_delete_other_snapshot(self, client, two_teachers):
        snap_b = two_teachers['b']['snap']
        tid_a = two_teachers['a']['id']
        resp = auth_delete(client, f'/api/teacher/snapshots/{snap_b}', tid_a, 'teacher_a@test.it')
        assert resp.status_code in (403, 404)

    def test_list_shows_only_own_snapshots(self, client, two_teachers):
        tid_a = two_teachers['a']['id']
        resp = auth_get(client, '/api/teacher/snapshots', tid_a, 'teacher_a@test.it')
        assert resp.status_code == 200
        ids = [s['id'] for s in resp.get_json()]
        assert two_teachers['a']['snap'] in ids
        assert two_teachers['b']['snap'] not in ids


class TestSessionIsolation:
    def test_cannot_read_other_session_scores(self, client, two_teachers):
        sess_b = two_teachers['b']['sess']
        tid_a = two_teachers['a']['id']
        resp = auth_get(client, f'/api/teacher/sessions/{sess_b}/scores', tid_a, 'teacher_a@test.it')
        assert resp.status_code in (403, 404)

    def test_cannot_activate_other_session(self, client, two_teachers):
        sess_b = two_teachers['b']['sess']
        tid_a = two_teachers['a']['id']
        resp = auth_post(client, f'/api/teacher/sessions/{sess_b}/activate', {}, tid_a, 'teacher_a@test.it')
        assert resp.status_code in (403, 404)

    def test_cannot_close_other_session(self, client, two_teachers):
        sess_b = two_teachers['b']['sess']
        tid_a = two_teachers['a']['id']
        resp = auth_post(client, f'/api/teacher/sessions/{sess_b}/close', {}, tid_a, 'teacher_a@test.it')
        assert resp.status_code in (403, 404)

    def test_cannot_reopen_other_session(self, client, two_teachers, db_conn):
        sess_b = two_teachers['b']['sess']
        tid_a = two_teachers['a']['id']
        db_conn.execute("UPDATE quiz_sessions SET status = 'closed' WHERE id = %s", (sess_b,))
        db_conn.commit()

        resp = auth_post(client, f'/api/teacher/sessions/{sess_b}/reopen', {}, tid_a, 'teacher_a@test.it')

        assert resp.status_code in (403, 404)

    def test_list_shows_only_own_sessions(self, client, two_teachers):
        tid_a = two_teachers['a']['id']
        resp = auth_get(client, '/api/teacher/sessions', tid_a, 'teacher_a@test.it')
        assert resp.status_code == 200
        ids = [s['id'] for s in resp.get_json()]
        assert two_teachers['a']['sess'] in ids
        assert two_teachers['b']['sess'] not in ids


class TestNoAuthAccess:
    def test_snapshots_require_auth(self, client):
        assert client.get('/api/teacher/snapshots').status_code == 401

    def test_sessions_require_auth(self, client):
        assert client.get('/api/teacher/sessions').status_code == 401

    def test_super_admin_requires_super_admin_role(self, client, db_conn):
        tid = make_teacher(db_conn, email='plain@test.it', role='teacher')
        db_conn.commit()
        tok = teacher_token(tid, role='teacher', email='plain@test.it')
        resp = client.get('/api/super-admin/teachers',
                          headers={'Authorization': f'Bearer {tok}'})
        assert resp.status_code == 403
