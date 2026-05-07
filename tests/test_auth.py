"""
Tests for auth flows: teacher login, password change, student join, JWT expiry.
"""
import json
import pytest
from tests.conftest import make_teacher, make_student, make_class, make_snapshot, make_session


def post_json(client, path, body, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return client.post(path, data=json.dumps(body), headers=headers)


# ── teacher login ─────────────────────────────────────────────────────────────

class TestTeacherLogin:
    def test_happy_path(self, client, db_conn):
        tid = make_teacher(db_conn, email='t@test.it')
        resp = post_json(client, '/api/auth/teacher-login', {'email': 't@test.it', 'password': 'Password123!'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'token' in data
        assert data['role'] in ('teacher', 'super_admin')
        assert data['teacher_id'] == tid

    def test_wrong_password(self, client, db_conn):
        make_teacher(db_conn, email='t2@test.it')
        resp = post_json(client, '/api/auth/teacher-login', {'email': 't2@test.it', 'password': 'wrong'})
        assert resp.status_code == 401

    def test_unknown_email(self, client, db_conn):
        resp = post_json(client, '/api/auth/teacher-login', {'email': 'nobody@test.it', 'password': 'any'})
        assert resp.status_code == 401

    def test_disabled_account(self, client, db_conn):
        make_teacher(db_conn, email='dis@test.it')
        db_conn.execute("UPDATE teachers SET status='disabled' WHERE email='dis@test.it'")
        db_conn.commit()
        resp = post_json(client, '/api/auth/teacher-login', {'email': 'dis@test.it', 'password': 'Password123!'})
        assert resp.status_code == 401

    def test_must_change_password_flow(self, client, db_conn):
        import bcrypt
        pw_hash = bcrypt.hashpw(b'TempPass1!', bcrypt.gensalt()).decode()
        db_conn.execute(
            "INSERT INTO teachers (email, display_name, role, password_hash, password_must_change, status) "
            "VALUES ('mustchange@test.it', 'MC', 'teacher', %s, true, 'active')",
            (pw_hash,)
        )
        db_conn.commit()
        resp = post_json(client, '/api/auth/teacher-login', {'email': 'mustchange@test.it', 'password': 'TempPass1!'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get('must_change_password') is True
        assert 'change_token' in data
        assert 'token' not in data

    def test_missing_fields(self, client, db_conn):
        resp = post_json(client, '/api/auth/teacher-login', {'email': 'x@test.it'})
        assert resp.status_code in (400, 422)


# ── /api/auth/me ─────────────────────────────────────────────────────────────

class TestGetMe:
    def test_valid_token(self, client, db_conn):
        tid = make_teacher(db_conn, email='me@test.it')
        from tests.conftest import teacher_token
        tok = teacher_token(tid, email='me@test.it')
        resp = client.get('/api/auth/me', headers={'Authorization': f'Bearer {tok}'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['teacher_id'] == tid

    def test_no_token(self, client):
        resp = client.get('/api/auth/me')
        assert resp.status_code == 401

    def test_malformed_token(self, client):
        resp = client.get('/api/auth/me', headers={'Authorization': 'Bearer not.a.jwt'})
        assert resp.status_code == 401


# ── student join ──────────────────────────────────────────────────────────────

class TestStudentJoin:
    def _setup(self, db_conn):
        tid = make_teacher(db_conn, email='teach@test.it')
        sid = make_student(db_conn, email='stud@test.it')
        cls = make_class(db_conn)
        db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)", (cls, sid))
        snap = make_snapshot(db_conn, tid)
        sess = make_session(db_conn, tid, snap, class_ids=[cls], status='active')
        db_conn.execute("UPDATE quiz_sessions SET join_code='ABCD12' WHERE id=%s", (sess,))
        db_conn.commit()
        return sid, sess

    def test_valid_join(self, client, db_conn):
        sid, sess = self._setup(db_conn)
        resp = post_json(client, '/api/auth/student-join', {'email': 'stud@test.it', 'join_code': 'ABCD12'})
        assert resp.status_code == 200
        data = resp.get_json()
        assert 'token' in data
        assert data['session_id'] == sess

    def test_wrong_join_code(self, client, db_conn):
        self._setup(db_conn)
        resp = post_json(client, '/api/auth/student-join', {'email': 'stud@test.it', 'join_code': 'ZZZZZZ'})
        assert resp.status_code in (401, 404)

    def test_student_not_in_class(self, client, db_conn):
        tid = make_teacher(db_conn, email='t3@test.it')
        make_student(db_conn, email='other@test.it')
        snap = make_snapshot(db_conn, tid)
        sess = make_session(db_conn, tid, snap, status='active')
        db_conn.execute("UPDATE quiz_sessions SET join_code='XXYYZZ' WHERE id=%s", (sess,))
        db_conn.commit()
        resp = post_json(client, '/api/auth/student-join', {'email': 'other@test.it', 'join_code': 'XXYYZZ'})
        assert resp.status_code == 403

    def test_already_submitted(self, client, db_conn):
        sid, sess = self._setup(db_conn)
        db_conn.execute(
            "INSERT INTO score_entries (session_id, student_id, teacher_id, raw_points, max_points, percent, answers) "
            "SELECT %s, %s, teacher_id, 1, 1, 100, '[]'::jsonb FROM quiz_sessions WHERE id=%s",
            (sess, sid, sess),
        )
        db_conn.commit()
        resp = post_json(client, '/api/auth/student-join', {'email': 'stud@test.it', 'join_code': 'ABCD12'})
        assert resp.status_code == 409
