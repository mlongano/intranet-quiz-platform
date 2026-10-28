"""Teachers manage their classes as far as each class's origin allows.

A class created by a teacher (or migrated) has its students edited by hand; a
synced one takes them from Google. Any class can be renamed and archived;
archiving hides it from the teacher, never from history. Deleting is only for
a class no session ever used.
"""
import pytest

from tests.conftest import make_class, make_session, make_snapshot, make_student, make_teacher, teacher_token


@pytest.fixture()
def w(client, db_conn):
    teacher = make_teacher(db_conn, email='cm-teacher@test.it')
    other = make_teacher(db_conn, email='cm-other@test.it')
    anna = make_student(db_conn, email='anna.cm@test.it', display_name='Anna')
    bruno = make_student(db_conn, email='bruno.cm@test.it', display_name='Bruno')
    gone = make_student(db_conn, email='ex.cm@test.it', display_name='Ex')
    db_conn.execute("UPDATE students SET status='disabled' WHERE id=%s", (gone,))
    db_conn.commit()
    return {
        'client': client, 'db': db_conn, 'teacher': teacher, 'anna': anna, 'bruno': bruno,
        'auth': {'Authorization': f"Bearer {teacher_token(teacher, email='cm-teacher@test.it')}"},
        'other_auth': {'Authorization': f"Bearer {teacher_token(other, email='cm-other@test.it')}"},
    }


def _create(w, name='Gruppo recupero', year='2026-2027', emails=None, auth=None):
    return w['client'].post('/api/teacher/classes', json={'name': name, 'academic_year': year,
                                                          'emails': emails or []},
                            headers=auth or w['auth'])


def _classes(w, archived=False, auth=None):
    url = '/api/teacher/classes' + ('?archived=1' if archived else '')
    return {c['name']: c for c in w['client'].get(url, headers=auth or w['auth']).get_json()}


def _members(w, class_id):
    r = w['client'].get(f'/api/teacher/classes/{class_id}/students', headers=w['auth'])
    return sorted(s['email'] for s in r.get_json())


def _link(w, class_id):
    w['db'].execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)", (class_id, w['teacher']))
    w['db'].commit()


# ── creating ─────────────────────────────────────────────────────────────────

def test_create_with_students_and_a_report_of_the_rest(w):
    r = _create(w, emails=['Anna.CM@test.it', 'bruno.cm@test.it', 'nessuno@test.it', 'ex.cm@test.it'])
    assert r.status_code == 201
    body = r.get_json()
    assert body['added'] == 2
    assert body['unknown'] == ['nessuno@test.it']          # never created from a typo
    assert body['disabled'] == ['ex.cm@test.it']
    assert _members(w, body['id']) == ['anna.cm@test.it', 'bruno.cm@test.it']
    c = _classes(w)['Gruppo recupero']
    assert c['kind'] == 'manual' and c['student_count'] == 2 and c['archived'] is False


def test_unknown_addresses_create_no_student(w):
    _create(w, emails=['nessuno@test.it'])
    assert w['db'].execute("SELECT 1 FROM students WHERE email='nessuno@test.it'").fetchone() is None


def test_same_name_twice_for_one_teacher_is_refused_but_not_across_teachers(w):
    assert _create(w, name='3AI').status_code == 201
    r = _create(w, name='3ai')
    assert r.status_code == 409 and r.get_json()['code'] == 'CLASS_NAME_TAKEN'
    assert _create(w, name='3AI', auth=w['other_auth']).status_code == 201
    assert _create(w, name='3AI', year='2027-2028').status_code == 201


def test_invalid_name_or_year(w):
    assert _create(w, name='  ').status_code == 400
    assert _create(w, year='2026-2028').status_code == 400


# ── editing members ──────────────────────────────────────────────────────────

def test_add_and_remove_students_of_a_manual_class(w):
    cid = _create(w, emails=['anna.cm@test.it']).get_json()['id']
    r = w['client'].post(f'/api/teacher/classes/{cid}/students', json={'emails': ['bruno.cm@test.it']},
                         headers=w['auth'])
    assert r.get_json()['added'] == 1
    r = w['client'].delete(f"/api/teacher/classes/{cid}/students/{w['anna']}", headers=w['auth'])
    assert r.status_code == 200
    assert _members(w, cid) == ['bruno.cm@test.it']


def test_a_migrated_class_is_editable(w):
    cid = make_class(w['db'], name='Test Users', year='2025-2026')
    _link(w, cid)
    assert _classes(w)['Test Users']['kind'] == 'manual'
    r = w['client'].post(f'/api/teacher/classes/{cid}/students', json={'emails': ['anna.cm@test.it']},
                         headers=w['auth'])
    assert r.status_code == 200 and r.get_json()['added'] == 1


def test_synced_class_members_are_not_edited_by_hand(w):
    cid = make_class(w['db'], name='Sistemi - 5CI')
    w['db'].execute("UPDATE classes SET google_classroom_course_id='c-1' WHERE id=%s", (cid,))
    _link(w, cid)
    r = w['client'].post(f'/api/teacher/classes/{cid}/students', json={'emails': ['anna.cm@test.it']},
                         headers=w['auth'])
    assert r.status_code == 409 and r.get_json()['code'] == 'CLASS_SYNCED'
    assert _classes(w)['Sistemi - 5CI']['kind'] == 'classroom'


def test_another_teachers_class_is_out_of_reach(w):
    cid = _create(w).get_json()['id']
    for call in (
        lambda: w['client'].patch(f'/api/teacher/classes/{cid}', json={'name': 'X'}, headers=w['other_auth']),
        lambda: w['client'].post(f'/api/teacher/classes/{cid}/students', json={'emails': []}, headers=w['other_auth']),
        lambda: w['client'].delete(f'/api/teacher/classes/{cid}', headers=w['other_auth']),
    ):
        assert call().status_code == 404


# ── renaming ─────────────────────────────────────────────────────────────────

def test_a_renamed_classroom_class_keeps_its_name_across_syncs(w, monkeypatch, tmp_path):
    from services import classroom_sync
    from tests.test_classroom_sync import _ClassroomService, _enable_google_config
    _enable_google_config(monkeypatch, tmp_path)
    service = _ClassroomService([{'id': 'course-9', 'name': 'Sistemi', 'section': '5CI', 'courseState': 'ACTIVE'}],
                                {'course-9': []})
    classroom_sync.sync_courses_for_teacher(w['teacher'], 'cm-teacher@test.it', classroom_service=service)
    cid = _classes(w)['Sistemi - 5CI']['id']
    assert w['client'].patch(f'/api/teacher/classes/{cid}', json={'name': '5CI Sistemi'},
                             headers=w['auth']).status_code == 200
    classroom_sync.sync_courses_for_teacher(w['teacher'], 'cm-teacher@test.it', classroom_service=service)
    assert '5CI Sistemi' in _classes(w)


# ── archiving and deleting ───────────────────────────────────────────────────

def test_archive_hides_the_class_and_keeps_its_history(w):
    snap = make_snapshot(w['db'], w['teacher'])
    cid = _create(w, emails=['anna.cm@test.it']).get_json()['id']
    session = make_session(w['db'], w['teacher'], snap, class_ids=[cid], status='closed')
    r = w['client'].patch(f'/api/teacher/classes/{cid}', json={'archived': True}, headers=w['auth'])
    assert r.status_code == 200
    assert 'Gruppo recupero' not in _classes(w)
    assert _classes(w, archived=True)['Gruppo recupero']['archived'] is True
    s = w['client'].get(f'/api/teacher/sessions/{session}', headers=w['auth']).get_json()
    assert [c['name'] for c in s['classes']] == ['Gruppo recupero']
    assert _members(w, cid) == ['anna.cm@test.it']
    w['client'].patch(f'/api/teacher/classes/{cid}', json={'archived': False}, headers=w['auth'])
    assert 'Gruppo recupero' in _classes(w)


def test_archiving_is_per_teacher(w):
    cid = _create(w).get_json()['id']
    other = w['db'].execute("SELECT id FROM teachers WHERE email='cm-other@test.it'").fetchone()[0]
    w['db'].execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)", (cid, other))
    w['db'].commit()
    w['client'].patch(f'/api/teacher/classes/{cid}', json={'archived': True}, headers=w['auth'])
    assert 'Gruppo recupero' in _classes(w, auth=w['other_auth'])


def test_delete_only_a_class_no_session_used(w):
    snap = make_snapshot(w['db'], w['teacher'])
    used = _create(w, name='Usata').get_json()['id']
    make_session(w['db'], w['teacher'], snap, class_ids=[used], status='closed')
    r = w['client'].delete(f'/api/teacher/classes/{used}', headers=w['auth'])
    assert r.status_code == 409 and r.get_json()['code'] == 'CLASS_IN_USE'
    assert _classes(w)['Usata']['used_in_sessions'] is True

    unused = _create(w, name='Mai usata', emails=['anna.cm@test.it']).get_json()['id']
    r = w['client'].delete(f'/api/teacher/classes/{unused}', headers=w['auth'])
    assert r.status_code == 200 and r.get_json()['deleted'] is True
    assert w['db'].execute("SELECT 1 FROM classes WHERE id=%s", (unused,)).fetchone() is None
    assert w['db'].execute("SELECT 1 FROM students WHERE id=%s", (w['anna'],)).fetchone()   # students stay


def test_deleting_a_shared_class_only_removes_it_for_me(w):
    cid = _create(w).get_json()['id']
    other = w['db'].execute("SELECT id FROM teachers WHERE email='cm-other@test.it'").fetchone()[0]
    w['db'].execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)", (cid, other))
    w['db'].commit()
    r = w['client'].delete(f'/api/teacher/classes/{cid}', headers=w['auth'])
    assert r.get_json()['deleted'] is False
    assert 'Gruppo recupero' not in _classes(w)
    assert 'Gruppo recupero' in _classes(w, auth=w['other_auth'])
