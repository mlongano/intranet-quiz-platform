"""The teacher reviews the motivation of a score, not only the points.

The motivation is what the student will read: the teacher can rewrite the
model's, and a rewritten one is never replaced by an automatic regrade.
"""
import json

import pytest

from tests.conftest import make_session, make_snapshot, make_student, make_teacher, teacher_token


@pytest.fixture()
def graded(client, db_conn):
    teacher_id = make_teacher(db_conn, email='fb-teacher@test.it')
    other_id = make_teacher(db_conn, email='fb-other@test.it')
    student_id = make_student(db_conn, email='fb-student@test.it')
    q = {'id': 'open-1', 'type': 'open', 'text': 'Spiega PATCH.', 'acceptable': ['x'], 'weight': 2}
    snapshot_id = make_snapshot(db_conn, teacher_id, jsonc=json.dumps({'title': 'F', 'questions': [q]}))
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='closed')
    answer = {
        'question_id': 'open-1', 'type': 'open', 'question_snapshot': q, 'question_text': q['text'],
        'student_answer': 'Aggiorna dei campi.', 'raw_student_answer': 'Aggiorna dei campi.',
        'correct_answer': 'x', 'raw_correct_answer': ['x'], 'weight': 2,
        'points_awarded': 1.0, 'raw_points': 1.0, 'llm_status': 'graded', 'llm_verdict': 'partial',
        'llm_feedback': 'In generale la risposta è parzialmente corretta.', 'llm_error': None,
        'option_order': [],
    }
    score_id = db_conn.execute(
        """INSERT INTO score_entries (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
           VALUES (%s, %s, %s, 1, 2, 50, %s::jsonb) RETURNING id""",
        (session_id, student_id, teacher_id, json.dumps([answer])),
    ).fetchone()[0]
    db_conn.commit()
    return {
        'client': client, 'db': db_conn, 'session_id': session_id, 'score_id': score_id,
        'auth': {'Authorization': f"Bearer {teacher_token(teacher_id, email='fb-teacher@test.it')}"},
        'other_auth': {'Authorization': f"Bearer {teacher_token(other_id, email='fb-other@test.it')}"},
    }


def _review(w, override, auth=None):
    return w['client'].post(f"/api/teacher/sessions/{w['session_id']}/scores/review",
                            json={'overrides': [{'score_id': w['score_id'], **override}]},
                            headers=auth or w['auth'])


def _answer(w):
    return w['db'].execute("SELECT answers, percent FROM score_entries WHERE id=%s", (w['score_id'],)).fetchone()


TEXT = "Dici che PATCH aggiorna dei campi: giusto. Manca che aggiorna **solo** i campi inviati."


def test_feedback_alone_keeps_points_and_protects_the_answer(graded):
    r = _review(graded, {'feedback': {'open-1': TEXT}})
    assert r.status_code == 200, r.get_data(as_text=True)
    answers, percent = _answer(graded)
    a = answers[0]
    assert a['teacher_feedback'] == TEXT
    assert a['llm_feedback'].startswith('In generale')     # the model's stays, for the record
    assert a['points_awarded'] == 1.0 and float(percent) == 50
    assert a['manual_override'] is True                    # automatic regrades skip it


def test_points_and_feedback_together(graded):
    assert _review(graded, {'per_question': {'open-1': 1.5}, 'feedback': {'open-1': TEXT}}).status_code == 200
    answers, percent = _answer(graded)
    assert answers[0]['points_awarded'] == 1.5 and float(percent) == 75
    assert answers[0]['teacher_feedback'] == TEXT


def test_blank_feedback_goes_back_to_the_models(graded):
    _review(graded, {'feedback': {'open-1': TEXT}})
    _review(graded, {'feedback': {'open-1': '   '}})
    assert _answer(graded)[0][0].get('teacher_feedback') is None


def test_the_change_is_in_the_history(graded):
    _review(graded, {'feedback': {'open-1': TEXT}})
    history = graded['client'].get(f"/api/teacher/sessions/{graded['session_id']}/score-history",
                                   headers=graded['auth']).get_json()
    assert history and history[0]['reason'] == 'manual_review'


def test_too_long_or_not_text_is_refused(graded):
    assert _review(graded, {'feedback': {'open-1': 'x' * 4001}}).status_code == 400
    assert _review(graded, {'feedback': {'open-1': ['non', 'testo']}}).status_code == 400
    assert _answer(graded)[0][0].get('teacher_feedback') is None


def test_another_teacher_cannot_write_it(graded):
    r = _review(graded, {'feedback': {'open-1': 'intrusione'}}, auth=graded['other_auth'])
    assert r.status_code in (403, 404)
    assert _answer(graded)[0][0].get('teacher_feedback') is None


def test_a_regrade_does_not_replace_the_teachers_feedback(graded, monkeypatch):
    import services.llm_jobs as llm_jobs
    _review(graded, {'feedback': {'open-1': TEXT}})
    monkeypatch.setattr(llm_jobs, 'grade_open_answer', lambda *_a, **_k: {
        'points': 0, 'llm_feedback': 'nuovo', 'llm_verdict': 'incorrect',
        'llm_provider': 'openai', 'llm_model': 'm', 'prompt_version': 'v1-test0000'})
    graded['client'].post(f"/api/teacher/sessions/{graded['session_id']}/scores/regrade-open",
                          headers=graded['auth'])
    llm_jobs.process_next_job()
    a = _answer(graded)[0][0]
    assert a['teacher_feedback'] == TEXT and a['points_awarded'] == 1.0


def test_a_motivation_alone_does_not_grade_a_pending_answer(graded):
    graded['db'].execute(
        """UPDATE score_entries SET answers = jsonb_set(answers, '{0,llm_status}', '"pending"')
           WHERE id = %s""", (graded['score_id'],))
    graded['db'].commit()
    _review(graded, {'feedback': {'open-1': TEXT}})
    assert _answer(graded)[0][0]['llm_status'] == 'pending'
