"""What is happening right now: who handed in, who is working, who has not
started, in each of the teacher's active sessions."""
import pytest

from tests.conftest import (
    make_class, make_session, make_snapshot, make_student, make_teacher, teacher_token,
)


def _join_and_start(client, email, code):
    token = client.post('/api/auth/student-join',
                        json={'email': email, 'join_code': code}).get_json()['token']
    auth = {'Authorization': f'Bearer {token}'}
    quiz_id = client.post('/api/quiz/start', json={}, headers=auth).get_json()['quiz_id']
    return auth, quiz_id


def _answer_current(client, auth, quiz_id):
    q = client.get(f'/api/quiz/resume/{quiz_id}', headers=auth).get_json()['current_question']
    answer = 0 if q['type'] == 'single' else ([0] if q['type'] == 'multiple' else 'testo')
    client.post('/api/quiz/save-answer', json={'quiz_id': quiz_id, 'answer': answer}, headers=auth)


@pytest.fixture()
def classroom(client, db_conn):
    teacher = make_teacher(db_conn, email='live-teacher@test.it')
    other = make_teacher(db_conn, email='live-other@test.it')
    c1 = make_class(db_conn, name='LIVE-1')
    c2 = make_class(db_conn, name='LIVE-2')
    for c in (c1, c2):
        db_conn.execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)", (c, teacher))
    students = {}
    for name, classes in (('anna', [c1]), ('bruno', [c1]), ('carla', [c2]), ('dario', [c1, c2])):
        sid = make_student(db_conn, email=f'live-{name}@test.it', display_name=name.title())
        students[name] = sid
        for c in classes:
            db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)", (c, sid))
    gone = make_student(db_conn, email='live-ex@test.it', display_name='Ex')
    db_conn.execute("UPDATE students SET status='disabled' WHERE id=%s", (gone,))
    db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)", (c2, gone))
    snap = make_snapshot(db_conn, teacher)
    session_id = make_session(db_conn, teacher, snap, class_ids=[c1, c2], status='active')
    db_conn.execute("UPDATE quiz_sessions SET join_code='LIVE01' WHERE id=%s", (session_id,))
    draft_session = make_session(db_conn, teacher, snap, class_ids=[c1], status='draft')
    db_conn.commit()

    # anna hands in, bruno answers one question and is writing, carla and dario wait.
    auth, quiz_id = _join_and_start(client, 'live-anna@test.it', 'LIVE01')
    for _ in range(3):
        _answer_current(client, auth, quiz_id)
    client.post('/api/quiz/submit', json={'quiz_id': quiz_id}, headers=auth)
    auth_b, quiz_b = _join_and_start(client, 'live-bruno@test.it', 'LIVE01')
    _answer_current(client, auth_b, quiz_b)

    return {
        'client': client, 'db': db_conn, 'session_id': session_id, 'draft_session': draft_session,
        'students': students, 'c1': c1,
        'auth': {'Authorization': f'Bearer {teacher_token(teacher, email="live-teacher@test.it")}'},
        'other_auth': {'Authorization': f'Bearer {teacher_token(other, email="live-other@test.it")}'},
    }


def _live(w, auth=None):
    r = w['client'].get('/api/teacher/live', headers=auth or w['auth'])
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.json


def _by_name(session):
    return {s['name']: s for s in session['students']}


def test_only_active_sessions_with_counts(classroom):
    live = _live(classroom)
    assert [s['id'] for s in live['sessions']] == [classroom['session_id']]
    s = live['sessions'][0]
    assert s['counts'] == {'expected': 4, 'submitted': 1, 'in_progress': 1, 'not_started': 2}
    assert s['join_code'] == 'LIVE01'
    assert s['question_count'] == 3


def test_each_student_once_with_state_and_classes(classroom):
    students = _by_name(_live(classroom)['sessions'][0])
    assert set(students) == {'Anna', 'Bruno', 'Carla', 'Dario'}     # disabled one left out
    assert students['Anna']['state'] == 'submitted'
    assert students['Bruno']['state'] == 'in_progress'
    assert students['Carla']['state'] == 'not_started'
    assert students['Dario']['classes'] == ['LIVE-1', 'LIVE-2']
    assert students['Anna']['email'] == 'live-anna@test.it'


def test_in_progress_shows_where_and_when(classroom):
    bruno = _by_name(_live(classroom)['sessions'][0])['Bruno']
    assert bruno['answered'] == 1
    assert bruno['last_activity']
    assert bruno['writing'] is False


def test_submitted_shows_result_and_pending_grading(classroom):
    anna = _by_name(_live(classroom)['sessions'][0])['Anna']
    assert anna['submitted_at']
    assert anna['percent'] is not None
    assert anna['grading_pending'] is True          # the sample quiz has an open question


def test_a_participant_outside_the_classes_is_still_shown(classroom):
    w = classroom
    w['db'].execute("DELETE FROM class_students WHERE student_id=%s AND class_id=%s",
                    (w['students']['bruno'], w['c1']))
    w['db'].commit()
    students = _by_name(_live(w)['sessions'][0])
    assert students['Bruno']['state'] == 'in_progress'
    assert students['Bruno']['classes'] == []


def test_other_teachers_see_nothing(classroom):
    assert _live(classroom, auth=classroom['other_auth'])['sessions'] == []
