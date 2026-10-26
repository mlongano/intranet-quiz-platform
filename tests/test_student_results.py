"""A student reads their own results, once the teacher publishes them.

Access is the school Google account; the token it gives can read results and
nothing else. Before publication a submission shows no score and no
motivation; after it, every question with points and the motivation (the
teacher's when written, the model's otherwise).
"""
import json

import pytest

from tests.conftest import make_session, make_snapshot, make_student, make_teacher, teacher_token

QUESTIONS = [
    {'id': 'q1', 'type': 'single', 'text': 'Capitale d\'Italia?', 'options': ['Milano', 'Roma', 'Napoli'],
     'correct': 1, 'weight': 1},
    {'id': 'q2', 'type': 'multiple', 'text': 'Numeri primi?', 'options': ['2', '4', '5'],
     'correct': [0, 2], 'weight': 1},
    {'id': 'q3', 'type': 'open', 'text': 'Spiega PATCH.', 'acceptable': 'Aggiorna solo i campi inviati.',
     'weight': 2},
    {'id': 'q4', 'type': 'open', 'text': 'Spiega PUT.', 'acceptable': 'Sostituisce la risorsa.',
     'weight': 1},
]


def _answer(q, **extra):
    base = {'question_id': q['id'], 'type': q['type'], 'question_snapshot': q, 'question_text': q['text'],
            'weight': q['weight'], 'option_order': [], 'llm_status': 'not_applicable'}
    base.update(extra)
    return base


@pytest.fixture()
def world(client, db_conn, monkeypatch):
    teacher_id = make_teacher(db_conn, email='res-teacher@test.it', display_name='Prof Rossi')
    other_teacher = make_teacher(db_conn, email='res-other@test.it')
    anna = make_student(db_conn, email='anna.res@test.it', display_name='Anna')
    bruno = make_student(db_conn, email='bruno.res@test.it', display_name='Bruno')
    snapshot_id = make_snapshot(db_conn, teacher_id, jsonc=json.dumps({'title': 'R', 'questions': QUESTIONS}))
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='closed')
    db_conn.execute("UPDATE quiz_sessions SET title='Verifica HTTP' WHERE id=%s", (session_id,))
    q1, q2, q3, q4 = QUESTIONS
    answers = [
        # shown order [2, 0, 1]: Anna clicked the third option shown, i.e. 'Roma'
        _answer(q1, option_order=[2, 0, 1], raw_student_answer=2, points_awarded=1),
        _answer(q2, option_order=[0, 1, 2], raw_student_answer=[0, 1], points_awarded=0),
        _answer(q3, raw_student_answer='Aggiorna dei campi.', points_awarded=1, llm_status='graded',
                llm_feedback='Manca che aggiorna solo i campi inviati.',
                teacher_feedback='Hai colto l\'idea; manca «solo i campi inviati».'),
        _answer(q4, raw_student_answer='Boh', points_awarded=0, llm_status='pending'),
    ]
    db_conn.execute(
        """INSERT INTO score_entries (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
           VALUES (%s, %s, %s, 2, 5, 40, %s::jsonb)""",
        (session_id, anna, teacher_id, json.dumps(answers)),
    )
    db_conn.commit()

    monkeypatch.setenv('GOOGLE_OAUTH_CLIENT_ID', 'client-id.apps.googleusercontent.com')
    monkeypatch.setenv('GOOGLE_OAUTH_HOSTED_DOMAIN', 'test.it')
    w = {'client': client, 'db': db_conn, 'session_id': session_id, 'monkeypatch': monkeypatch,
         'teacher_auth': {'Authorization': f"Bearer {teacher_token(teacher_id, email='res-teacher@test.it')}"},
         'other_auth': {'Authorization': f"Bearer {teacher_token(other_teacher, email='res-other@test.it')}"}}
    return w


def _google(w, email, hd='test.it'):
    w['monkeypatch'].setattr(
        'routes.auth.google_id_token.verify_oauth2_token',
        lambda credential, req, audience: {'email': email, 'email_verified': True, 'hd': hd},
    )
    return w['client'].post('/api/auth/student-google-login', json={'credential': 'id-token'})


def _student(w, email='anna.res@test.it'):
    r = _google(w, email)
    assert r.status_code == 200, r.get_data(as_text=True)
    return {'Authorization': f"Bearer {r.get_json()['token']}"}


def _publish(w, show_correct=False, auth=None):
    return w['client'].post(f"/api/teacher/sessions/{w['session_id']}/results/publish",
                            json={'show_correct': show_correct}, headers=auth or w['teacher_auth'])


# ── access ────────────────────────────────────────────────────────────────────

def test_google_login_for_a_known_student(world):
    r = _google(world, 'anna.res@test.it')
    assert r.status_code == 200
    assert r.get_json()['display_name'] == 'Anna'


def test_unknown_or_foreign_accounts_are_refused(world):
    assert _google(world, 'nessuno@test.it').get_json()['error'] == 'STUDENT_NOT_PROVISIONED'
    assert _google(world, 'anna.res@test.it', hd='altro.it').status_code == 401


def test_a_disabled_student_is_refused(world):
    world['db'].execute("UPDATE students SET status='disabled' WHERE email='anna.res@test.it'")
    world['db'].commit()
    assert _google(world, 'anna.res@test.it').status_code == 401


def test_the_results_token_opens_results_only(world):
    auth = _student(world)
    assert world['client'].get('/api/quiz/session-info', headers=auth).status_code == 403
    assert world['client'].get('/api/teacher/sessions', headers=auth).status_code == 403


def test_a_quiz_token_does_not_open_results(world):
    from tests.conftest import student_token
    row = world['db'].execute("SELECT id FROM students WHERE email='anna.res@test.it'").fetchone()
    auth = {'Authorization': f"Bearer {student_token(row[0], world['session_id'])}"}
    assert world['client'].get('/api/student/results', headers=auth).status_code == 403


# ── before and after publication ─────────────────────────────────────────────

def test_before_publication_only_that_it_was_handed_in(world):
    auth = _student(world)
    items = world['client'].get('/api/student/results', headers=auth).get_json()
    assert len(items) == 1
    item = items[0]
    assert item['title'] == 'Verifica HTTP' and item['teacher'] == 'Prof Rossi'
    assert item['published'] is False
    assert 'percent' not in item
    r = world['client'].get(f"/api/student/results/{world['session_id']}", headers=auth)
    assert r.status_code == 404


def test_after_publication_points_and_motivation(world):
    assert _publish(world).status_code == 200
    auth = _student(world)
    item = world['client'].get('/api/student/results', headers=auth).get_json()[0]
    assert item['published'] is True and item['percent'] == 40.0

    detail = world['client'].get(f"/api/student/results/{world['session_id']}", headers=auth).get_json()
    q = {x['question_id']: x for x in detail['questions']}
    assert q['q1']['your_answer'] == 'Roma' and q['q1']['points'] == 1 and q['q1']['max_points'] == 1
    assert q['q2']['your_answer'] == ['2', '4']
    assert q['q3']['motivation'] == 'Hai colto l\'idea; manca «solo i campi inviati».'   # the teacher's wins
    assert q['q4']['pending'] is True and q['q4']['motivation'] is None
    assert 'correct_answer' not in q['q1']                       # not chosen at publication
    assert detail['raw_points'] == 2 and detail['max_points'] == 5


def test_correct_answers_only_when_the_teacher_chooses(world):
    _publish(world, show_correct=True)
    auth = _student(world)
    q = {x['question_id']: x for x in world['client'].get(
        f"/api/student/results/{world['session_id']}", headers=auth).get_json()['questions']}
    assert q['q1']['correct_answer'] == 'Roma'
    assert q['q2']['correct_answer'] == ['2', '5']
    assert q['q3']['correct_answer'] == 'Aggiorna solo i campi inviati.'


def test_the_models_motivation_when_the_teacher_wrote_none(world):
    world['db'].execute(
        """UPDATE score_entries SET answers = jsonb_set(answers, '{2,teacher_feedback}', 'null')
           WHERE session_id = %s""", (world['session_id'],))
    world['db'].commit()
    _publish(world)
    q = {x['question_id']: x for x in world['client'].get(
        f"/api/student/results/{world['session_id']}", headers=_student(world)).get_json()['questions']}
    assert q['q3']['motivation'] == 'Manca che aggiorna solo i campi inviati.'


def test_withdrawing_hides_them_again(world):
    _publish(world)
    r = world['client'].post(f"/api/teacher/sessions/{world['session_id']}/results/unpublish",
                             headers=world['teacher_auth'])
    assert r.status_code == 200
    auth = _student(world)
    assert world['client'].get(f"/api/student/results/{world['session_id']}", headers=auth).status_code == 404


def test_each_student_sees_only_their_own(world):
    _publish(world)
    auth = _student(world, 'bruno.res@test.it')
    assert world['client'].get('/api/student/results', headers=auth).get_json() == []
    assert world['client'].get(f"/api/student/results/{world['session_id']}", headers=auth).status_code == 404


# ── publishing ───────────────────────────────────────────────────────────────

def test_only_the_owner_publishes_and_only_a_closed_session(world):
    assert _publish(world, auth=world['other_auth']).status_code == 404
    world['db'].execute("UPDATE quiz_sessions SET status='active' WHERE id=%s", (world['session_id'],))
    world['db'].commit()
    r = _publish(world)
    assert r.status_code == 409 and r.get_json()['code'] == 'SESSION_NOT_CLOSED'


def test_the_session_reports_its_publication(world):
    _publish(world, show_correct=True)
    s = world['client'].get(f"/api/teacher/sessions/{world['session_id']}", headers=world['teacher_auth']).get_json()
    assert s['results_published_at'] and s['results_show_correct'] is True
