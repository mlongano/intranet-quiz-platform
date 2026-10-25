"""Editing a quiz session.

What may change depends on the status: everything in draft; in an active
session only what cannot pull the ground from under a student already in it;
in a closed one only the title, since its results are what they are.
"""
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import (
    make_class, make_session, make_snapshot, make_student, make_teacher, teacher_token,
)


def _iso(dt):
    return dt.isoformat()


@pytest.fixture()
def world(client, db_conn):
    teacher_id = make_teacher(db_conn, email='edit-teacher@test.it')
    other_teacher = make_teacher(db_conn, email='edit-other@test.it')
    c1 = make_class(db_conn, name='EDIT-1A')
    c2 = make_class(db_conn, name='EDIT-2A')
    c3 = make_class(db_conn, name='EDIT-3A')
    foreign_class = make_class(db_conn, name='EDIT-ALTRUI')
    for c in (c1, c2, c3):
        db_conn.execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)", (c, teacher_id))
    db_conn.execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)",
                    (foreign_class, other_teacher))
    s1 = make_student(db_conn, email='edit-s1@test.it')
    s2 = make_student(db_conn, email='edit-s2@test.it')
    db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)", (c1, s1))
    db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)", (c2, s2))
    snap_a = make_snapshot(db_conn, teacher_id, title='Quiz A')
    snap_b = make_snapshot(db_conn, teacher_id, title='Quiz B')
    foreign_snap = make_snapshot(db_conn, other_teacher, title='Quiz altrui')
    db_conn.commit()
    return {
        'db': db_conn, 'client': client, 'teacher': teacher_id,
        'auth': {'Authorization': f'Bearer {teacher_token(teacher_id, email="edit-teacher@test.it")}'},
        'other_auth': {'Authorization': f'Bearer {teacher_token(other_teacher, email="edit-other@test.it")}'},
        'c1': c1, 'c2': c2, 'c3': c3, 'foreign_class': foreign_class,
        'snap_a': snap_a, 'snap_b': snap_b, 'foreign_snap': foreign_snap,
    }


def _session(w, status='draft', classes=None, code=None):
    sid = make_session(w['db'], w['teacher'], w['snap_a'], class_ids=classes or [w['c1'], w['c2']],
                       status=status)
    if code:
        w['db'].execute("UPDATE quiz_sessions SET join_code=%s WHERE id=%s", (code, sid))
        w['db'].commit()
    return sid


def _patch(w, sid, body, auth=None):
    return w['client'].patch(f'/api/teacher/sessions/{sid}', json=body, headers=auth or w['auth'])


def _get(w, sid):
    return w['client'].get(f'/api/teacher/sessions/{sid}', headers=w['auth']).get_json()


def _student_starts(w, email, code):
    token = w['client'].post('/api/auth/student-join',
                             json={'email': email, 'join_code': code}).get_json()['token']
    auth = {'Authorization': f'Bearer {token}'}
    assert w['client'].post('/api/quiz/start', json={}, headers=auth).status_code in (200, 201)
    return auth


def test_draft_everything_can_change(world):
    w = world
    sid = _session(w)
    opens = datetime.now(timezone.utc) + timedelta(days=1)
    closes = opens + timedelta(hours=2)
    r = _patch(w, sid, {'title': 'Verifica 2', 'snapshot_id': w['snap_b'],
                        'class_ids': [w['c3']], 'opens_at': _iso(opens), 'closes_at': _iso(closes)})
    assert r.status_code == 200, r.get_data(as_text=True)
    s = _get(w, sid)
    assert s['title'] == 'Verifica 2'
    assert s['snapshot_id'] == w['snap_b']
    assert [c['id'] for c in s['classes']] == [w['c3']]
    assert datetime.fromisoformat(s['opens_at']) == opens
    assert datetime.fromisoformat(s['closes_at']) == closes


def test_schedule_can_be_cleared(world):
    w = world
    sid = _session(w)
    _patch(w, sid, {'closes_at': _iso(datetime.now(timezone.utc) + timedelta(hours=1))})
    assert _patch(w, sid, {'closes_at': None}).status_code == 200
    assert _get(w, sid)['closes_at'] is None


def test_get_reports_what_can_be_edited(world):
    w = world
    sid = _session(w, status='active', code='EDT001')
    assert _get(w, sid)['edit'] == {'quiz': True, 'locked_class_ids': []}
    _student_starts(w, 'edit-s1@test.it', 'EDT001')
    assert _get(w, sid)['edit'] == {'quiz': False, 'locked_class_ids': [w['c1']]}


def test_active_quiz_changes_only_before_anyone_starts(world):
    w = world
    sid = _session(w, status='active', code='EDT002')
    assert _patch(w, sid, {'snapshot_id': w['snap_b']}).status_code == 200
    _student_starts(w, 'edit-s1@test.it', 'EDT002')
    r = _patch(w, sid, {'snapshot_id': w['snap_a']})
    assert r.status_code == 409
    assert r.get_json()['code'] == 'QUIZ_IN_USE'
    assert _get(w, sid)['snapshot_id'] == w['snap_b']


def test_active_classes_can_be_added_but_not_removed_from_under_a_student(world):
    w = world
    sid = _session(w, status='active', code='EDT003')
    _student_starts(w, 'edit-s1@test.it', 'EDT003')       # s1 is in c1

    assert _patch(w, sid, {'class_ids': [w['c1'], w['c2'], w['c3']]}).status_code == 200
    assert _patch(w, sid, {'class_ids': [w['c1'], w['c3']]}).status_code == 200   # c2: nobody started

    r = _patch(w, sid, {'class_ids': [w['c3']]})
    assert r.status_code == 409
    assert r.get_json()['code'] == 'CLASS_IN_USE'
    assert 'EDIT-1A' in r.get_json()['description']
    assert sorted(c['id'] for c in _get(w, sid)['classes']) == sorted([w['c1'], w['c3']])


def test_a_student_still_reachable_through_another_class_does_not_block(world):
    w = world
    w['db'].execute("INSERT INTO class_students (class_id, student_id) "
                    "SELECT %s, id FROM students WHERE email='edit-s1@test.it'", (w['c3'],))
    w['db'].commit()
    sid = _session(w, status='active', classes=[w['c1'], w['c3']], code='EDT004')
    _student_starts(w, 'edit-s1@test.it', 'EDT004')
    assert _patch(w, sid, {'class_ids': [w['c3']]}).status_code == 200


def test_extending_the_closing_time_reopens_joining(world):
    w = world
    sid = _session(w, status='active', code='EDT005')
    past = datetime.now(timezone.utc) - timedelta(minutes=5)
    assert _patch(w, sid, {'closes_at': _iso(past)}).status_code == 200
    join = w['client'].post('/api/auth/student-join',
                            json={'email': 'edit-s2@test.it', 'join_code': 'EDT005'})
    assert join.status_code == 401

    assert _patch(w, sid, {'closes_at': _iso(datetime.now(timezone.utc) + timedelta(hours=1))}).status_code == 200
    join = w['client'].post('/api/auth/student-join',
                            json={'email': 'edit-s2@test.it', 'join_code': 'EDT005'})
    assert join.status_code == 200


def test_closed_only_the_title(world):
    w = world
    sid = _session(w, status='closed')
    assert _patch(w, sid, {'title': 'Archivio verifica'}).status_code == 200
    for body in ({'snapshot_id': w['snap_b']}, {'class_ids': [w['c1']]},
                 {'closes_at': _iso(datetime.now(timezone.utc) + timedelta(days=1))}):
        r = _patch(w, sid, body)
        assert r.status_code == 409, body
        assert r.get_json()['code'] == 'SESSION_CLOSED'


def test_unchanged_values_are_not_refused(world):
    """The edit form sends every field back: unchanged ones must pass."""
    w = world
    sid = _session(w, status='closed')
    s = _get(w, sid)
    r = _patch(w, sid, {'title': 'Nuovo titolo', 'snapshot_id': s['snapshot_id'],
                        'class_ids': [c['id'] for c in s['classes']],
                        'opens_at': s['opens_at'], 'closes_at': s['closes_at']})
    assert r.status_code == 200, r.get_data(as_text=True)


def test_ownership(world):
    w = world
    sid = _session(w)
    assert _patch(w, sid, {'title': 'x'}, auth=w['other_auth']).status_code == 404
    assert _patch(w, sid, {'snapshot_id': w['foreign_snap']}).status_code == 404
    assert _patch(w, sid, {'class_ids': [w['foreign_class']]}).status_code == 403
    assert _get(w, sid)['title'] == 'Test Session'


@pytest.mark.parametrize('body', [
    {'title': '   '},
    {'class_ids': []},
    {'class_ids': 'tutte'},
    {'closes_at': 'domani'},
    {'opens_at': '2026-11-01T10:00:00'},                       # no time zone
    {'opens_at': '2026-11-01T10:00:00+00:00', 'closes_at': '2026-11-01T09:00:00+00:00'},
])
def test_invalid_values(world, body):
    w = world
    sid = _session(w)
    assert _patch(w, sid, body).status_code == 400


def test_create_validates_the_schedule(world):
    w = world
    r = w['client'].post('/api/teacher/sessions', headers=w['auth'], json={
        'snapshot_id': w['snap_a'], 'class_ids': [w['c1']],
        'opens_at': '2026-11-01T10:00:00+00:00', 'closes_at': '2026-11-01T09:00:00+00:00'})
    assert r.status_code == 400
    r = w['client'].post('/api/teacher/sessions', headers=w['auth'], json={
        'snapshot_id': w['snap_a'], 'class_ids': [w['c1']],
        'opens_at': '2026-11-01T10:00:00+01:00', 'closes_at': '2026-11-01T12:00:00+01:00'})
    assert r.status_code == 201
    s = _get(w, r.get_json()['id'])
    assert datetime.fromisoformat(s['closes_at']) == datetime(2026, 11, 1, 11, 0, tzinfo=timezone.utc)


def test_an_expired_student_token_says_so_in_code(client, db_conn):
    """The quiz page offers re-entering the join code only on code TOKEN_EXPIRED."""
    import jwt
    from datetime import datetime, timedelta, timezone
    payload = {'sub': '1', 'sid': 1, 'role': 'student',
               'iat': datetime.now(timezone.utc) - timedelta(hours=5),
               'exp': datetime.now(timezone.utc) - timedelta(hours=1)}
    import os
    token = jwt.encode(payload, os.environ['JWT_SECRET'], algorithm='HS256')
    r = client.get('/api/quiz/resume/abc', headers={'Authorization': f'Bearer {token}'})
    assert r.status_code == 401
    assert r.get_json()['code'] == 'TOKEN_EXPIRED'
