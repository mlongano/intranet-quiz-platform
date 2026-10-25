"""Open-answer drafts.

A long open answer must survive a crash, a closed browser or a lost
connection: the client autosaves it as a draft of the current question, resume
hands it back, and moving on with save-answer replaces it with the answer.
"""
from datetime import datetime, timedelta, timezone

import pytest

from tests.conftest import (
    make_class, make_session, make_snapshot, make_student, make_teacher,
)


def _join(client, email, code):
    token = client.post(
        '/api/auth/student-join', json={'email': email, 'join_code': code},
    ).get_json()['token']
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture()
def at_open(client, db_conn):
    """A student whose current question is the open one (open questions go last)."""
    teacher_id = make_teacher(db_conn, email='draft-teacher@test.it')
    student_id = make_student(db_conn, email='draft-student@test.it')
    other_id = make_student(db_conn, email='draft-other@test.it')
    cls = make_class(db_conn)
    db_conn.execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)",
                    (cls, teacher_id))
    for sid in (student_id, other_id):
        db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)",
                        (cls, sid))
    snapshot_id = make_snapshot(db_conn, teacher_id)
    session_id = make_session(db_conn, teacher_id, snapshot_id, class_ids=[cls], status='active')
    db_conn.execute("UPDATE quiz_sessions SET join_code='DRF001' WHERE id=%s", (session_id,))
    db_conn.commit()

    auth = _join(client, 'draft-student@test.it', 'DRF001')
    quiz_id = client.post('/api/quiz/start', json={}, headers=auth).get_json()['quiz_id']
    while True:
        state = client.get(f'/api/quiz/resume/{quiz_id}', headers=auth).get_json()
        q = state['current_question']
        if q['type'] == 'open':
            break
        answer = 0 if q['type'] == 'single' else [0]
        client.post('/api/quiz/save-answer', json={'quiz_id': quiz_id, 'answer': answer},
                    headers=auth)
    return {'auth': auth, 'quiz_id': quiz_id, 'index': state['current_index'],
            'session_id': session_id, 'db': db_conn, 'client': client}


def _draft(ctx, text, index=None, auth=None):
    return ctx['client'].post('/api/quiz/save-draft', json={
        'quiz_id': ctx['quiz_id'],
        'index': ctx['index'] if index is None else index,
        'text': text,
    }, headers=auth or ctx['auth'])


def _resume(ctx):
    return ctx['client'].get(f"/api/quiz/resume/{ctx['quiz_id']}", headers=ctx['auth']).get_json()


def test_resume_returns_the_saved_draft(at_open):
    text = "La gravità è...\n\n```python\nprint('ciao')\n```"
    saved = _draft(at_open, text)
    assert saved.status_code == 200, saved.get_data(as_text=True)
    assert saved.get_json()['saved_at']

    draft = _resume(at_open)['draft']
    assert draft['text'] == text
    assert draft['saved_at'] == saved.get_json()['saved_at']


def test_a_newer_draft_replaces_the_older(at_open):
    _draft(at_open, 'prima')
    _draft(at_open, 'prima e seconda')
    assert _resume(at_open)['draft']['text'] == 'prima e seconda'


def test_save_answer_turns_the_draft_into_the_answer(at_open):
    _draft(at_open, 'bozza')
    r = at_open['client'].post('/api/quiz/save-answer', json={
        'quiz_id': at_open['quiz_id'], 'answer': 'risposta finale'}, headers=at_open['auth'])
    assert r.status_code == 200
    state = _resume(at_open)
    assert state['is_complete'] is True
    row = at_open['db'].execute("SELECT draft FROM quiz_plans WHERE quiz_id=%s",
                                (at_open['quiz_id'],)).fetchone()
    assert row[0] is None


def test_draft_only_for_the_current_question(at_open):
    r = _draft(at_open, 'vecchia', index=at_open['index'] - 1)
    assert r.status_code == 409
    assert r.get_json()['code'] == 'DRAFT_STALE'


def test_draft_only_for_open_questions(client, db_conn):
    teacher_id = make_teacher(db_conn, email='draft-closed-q@test.it')
    student_id = make_student(db_conn, email='draft-closed-s@test.it')
    cls = make_class(db_conn)
    db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)",
                    (cls, student_id))
    snapshot_id = make_snapshot(db_conn, teacher_id)
    session_id = make_session(db_conn, teacher_id, snapshot_id, class_ids=[cls], status='active')
    db_conn.execute("UPDATE quiz_sessions SET join_code='DRF002' WHERE id=%s", (session_id,))
    db_conn.commit()
    auth = _join(client, 'draft-closed-s@test.it', 'DRF002')
    quiz_id = client.post('/api/quiz/start', json={}, headers=auth).get_json()['quiz_id']

    r = client.post('/api/quiz/save-draft', json={'quiz_id': quiz_id, 'index': 0, 'text': 'x'},
                    headers=auth)
    assert r.status_code == 400
    assert r.get_json()['code'] == 'DRAFT_NOT_OPEN'


def test_too_long_is_refused_for_draft_and_answer(at_open, monkeypatch):
    monkeypatch.setenv('OPEN_ANSWER_MAX_CHARS', '10')
    r = _draft(at_open, 'x' * 11)
    assert r.status_code == 413
    assert r.get_json()['code'] == 'ANSWER_TOO_LONG'
    r = at_open['client'].post('/api/quiz/save-answer', json={
        'quiz_id': at_open['quiz_id'], 'answer': 'x' * 11}, headers=at_open['auth'])
    assert r.status_code == 413
    assert _draft(at_open, 'x' * 10).status_code == 200


def test_text_must_be_a_string(at_open):
    r = _draft(at_open, ['non', 'testo'])
    assert r.status_code == 400


def test_another_student_cannot_write_the_draft(at_open):
    other = _join(at_open['client'], 'draft-other@test.it', 'DRF001')
    r = _draft(at_open, 'intrusione', auth=other)
    assert r.status_code == 403
    assert 'draft' not in _resume(at_open) or _resume(at_open)['draft'] is None


def test_after_a_manual_close_the_draft_is_kept_and_handed_in(at_open):
    at_open['db'].execute("UPDATE quiz_sessions SET status='closed' WHERE id=%s",
                          (at_open['session_id'],))
    at_open['db'].commit()

    assert _draft(at_open, 'scritta prima della consegna').status_code == 200
    r = at_open['client'].post('/api/quiz/submit', json={'quiz_id': at_open['quiz_id']},
                               headers=at_open['auth'])
    assert r.status_code == 200, r.get_data(as_text=True)

    answers = at_open['db'].execute(
        "SELECT answers FROM score_entries WHERE session_id=%s", (at_open['session_id'],),
    ).fetchone()[0]
    open_answer = next(a for a in answers if a.get('type') == 'open')
    assert 'scritta prima della consegna' in str(open_answer['student_answer'])
    assert open_answer['llm_status'] == 'pending'


def test_an_empty_draft_is_not_handed_in(at_open):
    at_open['db'].execute("UPDATE quiz_sessions SET status='closed' WHERE id=%s",
                          (at_open['session_id'],))
    at_open['db'].commit()
    _draft(at_open, '   \n ')
    r = at_open['client'].post('/api/quiz/submit', json={'quiz_id': at_open['quiz_id']},
                               headers=at_open['auth'])
    assert r.status_code == 200
    answers = at_open['db'].execute(
        "SELECT answers FROM score_entries WHERE session_id=%s", (at_open['session_id'],),
    ).fetchone()[0]
    open_answer = next(a for a in answers if a.get('type') == 'open')
    assert open_answer['raw_student_answer'] is None


def test_past_grace_refuses_the_draft(at_open, monkeypatch):
    monkeypatch.setenv('QUIZ_GRACE_SECONDS', '60')
    at_open['db'].execute(
        "UPDATE quiz_sessions SET status='closed', closes_at=%s WHERE id=%s",
        (datetime.now(timezone.utc) - timedelta(hours=2), at_open['session_id']),
    )
    at_open['db'].commit()
    r = _draft(at_open, 'troppo tardi')
    assert r.status_code == 409
    assert r.get_json()['code'] == 'SESSION_CLOSED'
