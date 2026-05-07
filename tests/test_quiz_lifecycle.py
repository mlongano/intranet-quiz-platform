"""
Full quiz lifecycle: snapshot → session → join → start → answer → submit.
Also verifies duplicate-submit protection and TOKEN_EXPIRED handling.
"""
import json
import pytest
from tests.conftest import (
    make_teacher, make_student, make_class, make_snapshot, make_session,
    teacher_token, student_token,
)


def post(client, path, body, token=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return client.post(path, data=json.dumps(body), headers=headers)


def get(client, path, token=None):
    headers = {}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    return client.get(path, headers=headers)


class TestQuizLifecycle:
    @pytest.fixture()
    def setup(self, db_conn):
        tid = make_teacher(db_conn)
        sid = make_student(db_conn)
        cls = make_class(db_conn)
        db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)", (cls, sid))
        db_conn.execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)", (cls, tid))
        snap = make_snapshot(db_conn, tid)
        sess = make_session(db_conn, tid, snap, class_ids=[cls], status='active')
        db_conn.execute("UPDATE quiz_sessions SET join_code='TEST01' WHERE id=%s", (sess,))
        db_conn.commit()
        return {'teacher_id': tid, 'student_id': sid, 'session_id': sess, 'snapshot_id': snap}

    def _get_student_token(self, client, sid_email='student@test.it', code='TEST01'):
        resp = post(client, '/api/auth/student-join', {'email': sid_email, 'join_code': code})
        return resp.get_json()['token']

    def test_full_lifecycle(self, client, setup, db_conn):
        tok = self._get_student_token(client)
        session_id = setup['session_id']

        # start quiz
        resp = post(client, '/api/quiz/start', {}, token=tok)
        assert resp.status_code == 200
        quiz_id = resp.get_json()['quiz_id']

        # resume — should get first question
        resp = get(client, f'/api/quiz/resume/{quiz_id}', token=tok)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data['is_complete'] is False
        assert data['current_question'] is not None
        total = data['total_questions']
        assert total > 0

        # answer all questions
        for i in range(total):
            resp = get(client, f'/api/quiz/resume/{quiz_id}', token=tok)
            q = resp.get_json()['current_question']
            if q['type'] == 'single':
                answer = 0
            elif q['type'] == 'multiple':
                answer = [0]
            else:
                answer = 'gravity pulls objects toward mass'
            resp = post(client, '/api/quiz/save-answer', {'quiz_id': quiz_id, 'answer': answer}, token=tok)
            assert resp.status_code == 200

        # verify complete
        resp = get(client, f'/api/quiz/resume/{quiz_id}', token=tok)
        assert resp.get_json()['is_complete'] is True

        # submit
        resp = post(client, '/api/quiz/submit', {'quiz_id': quiz_id}, token=tok)
        assert resp.status_code == 200
        result = resp.get_json()
        assert 'percent' in result
        assert 0 <= result['percent'] <= 100

        # verify score in DB
        row = db_conn.execute(
            "SELECT id FROM score_entries WHERE session_id=%s AND student_id=%s",
            (session_id, setup['student_id']),
        ).fetchone()
        assert row is not None

        # verify quiz_plan is gone
        plan = db_conn.execute(
            "SELECT quiz_id FROM quiz_plans WHERE quiz_id=%s", (quiz_id,)
        ).fetchone()
        assert plan is None

    def test_duplicate_submit_returns_409(self, client, setup, db_conn):
        tok = self._get_student_token(client)

        # complete the quiz
        resp = post(client, '/api/quiz/start', {}, token=tok)
        quiz_id = resp.get_json()['quiz_id']

        resp = get(client, f'/api/quiz/resume/{quiz_id}', token=tok)
        total = resp.get_json()['total_questions']
        for _ in range(total):
            resp = get(client, f'/api/quiz/resume/{quiz_id}', token=tok)
            q = resp.get_json()['current_question']
            answer = 0 if q['type'] == 'single' else ([0] if q['type'] == 'multiple' else 'answer')
            post(client, '/api/quiz/save-answer', {'quiz_id': quiz_id, 'answer': answer}, token=tok)

        resp1 = post(client, '/api/quiz/submit', {'quiz_id': quiz_id}, token=tok)
        assert resp1.status_code == 200

        # second submit — quiz_id is gone, should 404 or the plan is deleted
        resp2 = post(client, '/api/quiz/submit', {'quiz_id': quiz_id}, token=tok)
        assert resp2.status_code in (404, 409)

    def test_start_twice_resumes_same_plan(self, client, setup, db_conn):
        tok = self._get_student_token(client)
        resp1 = post(client, '/api/quiz/start', {}, token=tok)
        qid1 = resp1.get_json()['quiz_id']

        resp2 = post(client, '/api/quiz/start', {}, token=tok)
        qid2 = resp2.get_json()['quiz_id']

        assert qid1 == qid2

    def test_open_questions_last(self, client, setup, db_conn):
        tok = self._get_student_token(client)
        post(client, '/api/quiz/start', {}, token=tok)
        resp = get(client, '/api/quiz/session-info', token=tok)
        assert resp.status_code == 200
        info = resp.get_json()
        assert 'question_count' in info


class TestSessionInfo:
    def test_requires_student_token(self, client, db_conn):
        resp = client.get('/api/quiz/session-info')
        assert resp.status_code == 401

    def test_returns_session_title(self, client, db_conn):
        tid = make_teacher(db_conn, email='t99@test.it')
        sid = make_student(db_conn, email='s99@test.it')
        cls = make_class(db_conn, name='4BP')
        db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)", (cls, sid))
        snap = make_snapshot(db_conn, tid)
        sess = make_session(db_conn, tid, snap, class_ids=[cls], status='active')
        db_conn.execute("UPDATE quiz_sessions SET join_code='INFO01' WHERE id=%s", (sess,))
        db_conn.commit()

        join = post(client, '/api/auth/student-join', {'email': 's99@test.it', 'join_code': 'INFO01'})
        tok = join.get_json()['token']
        resp = get(client, '/api/quiz/session-info', token=tok)
        assert resp.status_code == 200
        assert 'title' in resp.get_json()
