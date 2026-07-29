import json

import pytest

from tests.conftest import make_session, make_snapshot, make_student, make_teacher, teacher_token


def test_grade_never_calls_the_open_grader(monkeypatch):
    """grade() always defers open questions — no request path may call the LLM."""
    import services.grading as grading

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError('open grader must not run inside grade()')

    monkeypatch.setattr(grading, 'grade_open_answer', fail_if_called)
    monkeypatch.setenv('USE_LLM_EVAL', '1')

    result = grading.grade(
        ['risposta studente'],
        {'plan': [{'id': 'q1', 'option_order': []}]},
        {'questions': [{'id': 'q1', 'type': 'open', 'text': 'Spiega.', 'weight': 1}]},
    )

    assert result['scores_per_question'] == [0.0]
    assert result['statuses_per_question'] == ['pending']
    assert result['raw_points'] == 0
    assert result['max_points'] == 1


def test_grade_open_answer_propagates_llm_failure(monkeypatch):
    import services.grading as grading
    from services.llm_errors import LlmTemporaryError

    def failing_evaluator(*_args, **_kwargs):
        raise LlmTemporaryError('model unavailable')

    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setitem(__import__('sys').modules, 'llm_evaluator', type(
        'FakeLlmEvaluator',
        (),
        {'evaluate_open_question': staticmethod(failing_evaluator)},
    ))

    # A failure must surface as an exception, never as a zero-point result that
    # could be mistaken for a real grade.
    with pytest.raises(LlmTemporaryError):
        grading.grade_open_answer(
            'contiene parola',
            {'id': 'q1', 'type': 'open', 'text': 'Spiega.', 'keywords': ['parola'], 'weight': 2},
        )


def test_grade_open_answer_requires_llm_to_be_configured(monkeypatch):
    import services.grading as grading
    from services.llm_errors import LlmConfigurationError

    monkeypatch.setenv('USE_LLM_EVAL', '0')

    with pytest.raises(LlmConfigurationError):
        grading.grade_open_answer(
            'qualcosa',
            {'id': 'q1', 'type': 'open', 'text': 'Spiega.', 'weight': 1},
        )


def test_regrade_open_enqueues_job_and_worker_uses_shared_grader(
    client,
    db_conn,
    monkeypatch,
):
    import services.llm_jobs as llm_jobs

    teacher_id = make_teacher(db_conn, email='teacher-regrade@test.it')
    student_id = make_student(db_conn, email='student-regrade@test.it')
    snapshot_id = make_snapshot(db_conn, teacher_id, jsonc=json.dumps({
        'title': 'Open Quiz',
        'questions': [
            {
                'id': 'open-1',
                'type': 'open',
                'text': 'Spiega PATCH.',
                'acceptable': ['Aggiorna solo i campi inviati.'],
                'weight': 1,
            },
        ],
    }))
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='active')
    answer = {
        'question_id': 'open-1',
        'type': 'open',
        'question_snapshot': {
            'id': 'open-1',
            'type': 'open',
            'text': 'Spiega PATCH.',
            'acceptable': ['Aggiorna solo i campi inviati.'],
            'weight': 1,
        },
        'question_text': 'Spiega PATCH.',
        'student_answer': 'Aggiorna alcuni campi.',
        'correct_answer': 'Aggiorna solo i campi inviati.',
        'raw_student_answer': 'Aggiorna alcuni campi.',
        'raw_correct_answer': ['Aggiorna solo i campi inviati.'],
        'weight': 1,
        'points_awarded': 0.5,
        'raw_points': 0.5,
        'llm_feedback': 'Feedback vecchio',
        'llm_verdict': 'partial',
        'llm_status': 'graded',
        'llm_error': None,
        'option_order': [],
    }
    db_conn.execute(
        """INSERT INTO score_entries
           (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
           VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)""",
        (session_id, student_id, teacher_id, 0.5, 1, 50, json.dumps([answer])),
    )
    db_conn.commit()

    calls = []

    def fake_grade_open_answer(user_ans, q):
        calls.append((user_ans, q['id']))
        return {
            'points': 0.5,
            'llm_feedback': 'Feedback nuovo',
            'llm_verdict': 'partial',
        }

    monkeypatch.setattr(llm_jobs, 'grade_open_answer', fake_grade_open_answer)

    response = client.post(
        f'/api/teacher/sessions/{session_id}/scores/regrade-open',
        headers={'Authorization': f"Bearer {teacher_token(teacher_id, email='teacher-regrade@test.it')}"},
    )

    assert response.status_code == 202
    body = response.get_json()
    assert body['status'] == 'pending'
    assert body['total_items'] == 1
    assert calls == []

    pending_row = db_conn.execute(
        "SELECT answers FROM score_entries WHERE session_id = %s",
        (session_id,),
    ).fetchone()
    # Non-destructive: enqueue does NOT change llm_status
    assert pending_row[0][0]['llm_status'] == 'graded'
    assert pending_row[0][0]['llm_feedback'] == 'Feedback vecchio'

    assert llm_jobs.process_next_job() is True
    assert calls == [('Aggiorna alcuni campi.', 'open-1')]

    row = db_conn.execute(
        "SELECT raw_points, percent, answers FROM score_entries WHERE session_id = %s",
        (session_id,),
    ).fetchone()
    updated_answer = row[2][0]
    assert float(row[0]) == 0.5
    assert float(row[1]) == 50
    assert updated_answer['raw_points'] == 0.5
    assert updated_answer['llm_feedback'] == 'Feedback nuovo'
    assert updated_answer['llm_status'] == 'graded'

    job_row = db_conn.execute(
        "SELECT status, processed_items FROM llm_grading_jobs WHERE id = %s",
        (body['id'],),
    ).fetchone()
    assert job_row == ('completed', 1)


def test_worker_failure_leaves_never_graded_answer_pending():
    """A failed evaluation must never become a definitive 0-point grade."""
    from services.llm_errors import LlmTemporaryError
    import services.llm_jobs as llm_jobs

    answers = [{
        'question_id': 'open-1',
        'type': 'open',
        'weight': 2,
        'points_awarded': 0,
        'raw_points': 0,
        'llm_status': 'pending',
        'llm_feedback': None,
        'raw_student_answer': 'Una risposta.',
    }]
    failures: list[str] = []

    def boom(*_args, **_kwargs):
        raise LlmTemporaryError('provider down')

    original = llm_jobs.grade_open_answer
    llm_jobs.grade_open_answer = boom
    try:
        changed = llm_jobs._process_one_pending_answer(answers, failures=failures)
    finally:
        llm_jobs.grade_open_answer = original

    assert changed is True
    assert answers[0]['llm_status'] == 'pending'      # never 'graded' / 'error'
    assert answers[0]['points_awarded'] == 0
    assert 'provider down' in answers[0]['llm_error']
    assert failures and 'open-1' in failures[0]


def test_worker_failure_preserves_an_existing_grade():
    """A failing regrade must leave the previous evaluation untouched."""
    from services.llm_errors import LlmTemporaryError
    import services.llm_jobs as llm_jobs

    answers = [{
        'question_id': 'open-1',
        'type': 'open',
        'weight': 2,
        'points_awarded': 1.5,
        'raw_points': 1.5,
        'llm_status': 'graded',
        'llm_feedback': 'Buona risposta',
        'llm_verdict': 'partial',
        'raw_student_answer': 'Una risposta.',
    }]
    before = dict(answers[0])
    failures: list[str] = []

    def boom(*_args, **_kwargs):
        raise LlmTemporaryError('provider down')

    original = llm_jobs.grade_open_answer
    llm_jobs.grade_open_answer = boom
    try:
        changed = llm_jobs._process_one_pending_answer(
            answers, is_regrade=True, failures=failures,
        )
    finally:
        llm_jobs.grade_open_answer = original

    assert changed is False
    assert answers[0] == before          # byte-for-byte untouched
    assert failures                       # but the failure is still reported


def test_worker_without_llm_configured_leaves_answers_pending(monkeypatch):
    """The misconfigured-container scenario: nothing is graded, nothing is lost."""
    import services.llm_jobs as llm_jobs

    monkeypatch.setenv('USE_LLM_EVAL', '0')
    answers = [{
        'question_id': 'open-1',
        'type': 'open',
        'weight': 1,
        'points_awarded': 0,
        'raw_points': 0,
        'llm_status': 'pending',
        'raw_student_answer': 'Risposta.',
    }]
    failures: list[str] = []

    llm_jobs._process_one_pending_answer(answers, failures=failures)

    assert answers[0]['llm_status'] == 'pending'
    assert answers[0]['points_awarded'] == 0
    assert failures


def test_regrade_open_recognizes_legacy_answers_without_top_level_type(
    client,
    db_conn,
    monkeypatch,
):
    import services.llm_jobs as llm_jobs

    teacher_id = make_teacher(db_conn, email='teacher-legacy-regrade@test.it')
    student_id = make_student(db_conn, email='student-legacy-regrade@test.it')
    snapshot_id = make_snapshot(db_conn, teacher_id, jsonc=json.dumps({
        'title': 'Legacy Open Quiz',
        'questions': [
            {
                'id': 'open-legacy',
                'type': 'open',
                'text': 'Spiega.',
                'acceptable': ['Risposta completa.'],
                'weight': 2,
            },
        ],
    }))
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='active')
    answer = {
        'question_id': 'open-legacy',
        'question_snapshot': {
            'id': 'open-legacy',
            'type': 'open',
            'text': 'Spiega.',
            'acceptable': ['Risposta completa.'],
            'weight': 2,
        },
        'question_text': 'Spiega.',
        'student_answer': 'Risposta parziale.',
        'correct_answer': ['Risposta completa.'],
        'raw_student_answer': 'Risposta parziale.',
        'raw_correct_answer': ['Risposta completa.'],
        'weight': 2,
        'points_awarded': 0,
        'raw_points': 0,
        'option_order': [],
    }
    db_conn.execute(
        """INSERT INTO score_entries
           (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
           VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)""",
        (session_id, student_id, teacher_id, 0, 2, 0, json.dumps([answer])),
    )
    db_conn.commit()

    monkeypatch.setattr(llm_jobs, 'grade_open_answer', lambda *_args: {
        'points': 1.5,
        'llm_feedback': 'Feedback legacy',
        'llm_verdict': 'partial',
    })

    response = client.post(
        f'/api/teacher/sessions/{session_id}/scores/regrade-open',
        headers={'Authorization': f"Bearer {teacher_token(teacher_id, email='teacher-legacy-regrade@test.it')}"},
    )

    assert response.status_code == 202
    assert response.get_json()['total_items'] == 1
    assert llm_jobs.process_next_job() is True

    row = db_conn.execute(
        "SELECT raw_points, answers FROM score_entries WHERE session_id = %s",
        (session_id,),
    ).fetchone()
    assert float(row[0]) == 1.5
    updated_answer = row[1][0]
    assert updated_answer['type'] == 'open'
    assert updated_answer['llm_status'] == 'graded'
