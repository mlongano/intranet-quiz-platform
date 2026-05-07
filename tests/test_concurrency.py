"""
Concurrency test: 30 students submit simultaneously against one session.
Exactly 30 score_entries rows, no orphaned quiz_plans.
"""
import json
import threading
import pytest
from tests.conftest import (
    make_teacher, make_student, make_class, make_snapshot, make_session,
)

N_STUDENTS = 30


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


@pytest.fixture()
def session_with_students(db_conn, flask_app):
    tid = make_teacher(db_conn, email='concurrent_t@test.it')
    cls = make_class(db_conn, name='CONC')
    student_ids = []
    for i in range(N_STUDENTS):
        sid = make_student(db_conn, email=f'concurrent_s{i:03d}@test.it',
                           display_name=f'Student {i}')
        student_ids.append(sid)
        db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)", (cls, sid))
    snap = make_snapshot(db_conn, tid)
    sess = make_session(db_conn, tid, snap, class_ids=[cls], status='active')
    db_conn.execute("UPDATE quiz_sessions SET join_code='CONC01' WHERE id=%s", (sess,))
    db_conn.commit()
    return {'session_id': sess, 'teacher_id': tid, 'student_emails': [f'concurrent_s{i:03d}@test.it' for i in range(N_STUDENTS)]}


def run_student(flask_app, email, errors):
    """Each student joins, answers all questions, and submits."""
    try:
        with flask_app.test_client() as c:
            # join
            resp = post(c, '/api/auth/student-join', {'email': email, 'join_code': 'CONC01'})
            if resp.status_code != 200:
                errors.append(f'{email}: join failed {resp.status_code}')
                return
            tok = resp.get_json()['token']

            # start
            resp = post(c, '/api/quiz/start', {}, token=tok)
            if resp.status_code != 200:
                errors.append(f'{email}: start failed {resp.status_code}')
                return
            quiz_id = resp.get_json()['quiz_id']

            # get total
            resp = get(c, f'/api/quiz/resume/{quiz_id}', token=tok)
            if resp.status_code != 200:
                errors.append(f'{email}: resume failed {resp.status_code}')
                return
            total = resp.get_json()['total_questions']

            # answer all
            for _ in range(total):
                resp = get(c, f'/api/quiz/resume/{quiz_id}', token=tok)
                if resp.status_code != 200:
                    errors.append(f'{email}: resume mid failed {resp.status_code}')
                    return
                q = resp.get_json()['current_question']
                if q is None:
                    break
                if q['type'] == 'single':
                    answer = 0
                elif q['type'] == 'multiple':
                    answer = [0]
                else:
                    answer = 'gravity pulls masses'
                post(c, '/api/quiz/save-answer', {'quiz_id': quiz_id, 'answer': answer}, token=tok)

            # submit
            resp = post(c, '/api/quiz/submit', {'quiz_id': quiz_id}, token=tok)
            if resp.status_code != 200:
                errors.append(f'{email}: submit failed {resp.status_code}: {resp.get_data(as_text=True)[:200]}')
    except Exception as exc:
        errors.append(f'{email}: exception {exc}')


class TestConcurrency:
    def test_30_concurrent_submissions(self, flask_app, session_with_students, db_conn):
        errors: list[str] = []
        threads = [
            threading.Thread(target=run_student, args=(flask_app, email, errors))
            for email in session_with_students['student_emails']
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)

        assert not errors, f'Errors during concurrent submission:\n' + '\n'.join(errors)

        sess_id = session_with_students['session_id']
        score_count = db_conn.execute(
            "SELECT COUNT(*) FROM score_entries WHERE session_id=%s", (sess_id,)
        ).fetchone()[0]
        assert score_count == N_STUDENTS, f'Expected {N_STUDENTS} scores, got {score_count}'

        plan_count = db_conn.execute(
            "SELECT COUNT(*) FROM quiz_plans WHERE session_id=%s", (sess_id,)
        ).fetchone()[0]
        assert plan_count == 0, f'Expected 0 orphaned plans, got {plan_count}'
