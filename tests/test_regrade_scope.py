"""What a regrade is allowed to touch.

The invariant under test is the one the design calls "Protezione valutazioni
manuali": a teacher's manual correction survives any automatic regrade unless
it is overwritten deliberately. Scope and the override flag live on the job, so
a queued job keeps the behaviour it was enqueued with.
"""

import json

import pytest

from services import llm_jobs
from tests.conftest import make_session, make_snapshot, make_student, make_teacher, teacher_token

QUESTION = {
    'id': 'open-1', 'type': 'open', 'text': 'Spiega.',
    'acceptable': ['Risposta completa.'], 'weight': 2,
}


def _answer(question_id, *, status, points=0.0, manual=False, model=None):
    return {
        'question_id': question_id,
        'type': 'open',
        'question_snapshot': {**QUESTION, 'id': question_id},
        'question_text': QUESTION['text'],
        'raw_student_answer': 'Risposta dello studente.',
        'raw_correct_answer': QUESTION['acceptable'],
        'weight': 2,
        'points_awarded': points,
        'raw_points': points,
        'llm_status': status,
        'llm_error': None,
        'llm_model': model,
        'manual_override': manual,
        'option_order': [],
        'answer_revision': 0,
    }


@pytest.fixture
def session_with_answers(db_conn):
    teacher_id = make_teacher(db_conn, email='scope-t@test.it')
    student_id = make_student(db_conn, email='scope-s@test.it')
    snapshot_id = make_snapshot(db_conn, teacher_id, jsonc=json.dumps({
        'title': 'Q', 'questions': [QUESTION],
    }))
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='closed')
    answers = [
        _answer('pending-q', status='pending'),
        _answer('graded-q', status='graded', points=1.0, model='gpt-4o-mini'),
        _answer('manual-q', status='graded', points=2.0, manual=True),
    ]
    row = db_conn.execute(
        """INSERT INTO score_entries
           (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
           VALUES (%s, %s, %s, 3, 6, 50, %s::jsonb) RETURNING id""",
        (session_id, student_id, teacher_id, json.dumps(answers)),
    ).fetchone()
    db_conn.commit()
    return {
        'teacher_id': teacher_id, 'session_id': session_id, 'score_id': row[0],
        'email': 'scope-t@test.it',
    }


def _answers(db_conn, score_id):
    return {
        a['question_id']: a
        for a in db_conn.execute(
            "SELECT answers FROM score_entries WHERE id = %s", (score_id,)
        ).fetchone()[0]
    }


def _run_worker(monkeypatch, points=1.5):
    graded = []

    def fake(user_ans, q, **_kwargs):
        graded.append(q['id'])
        return {
            'points': points, 'llm_feedback': 'nuovo', 'llm_verdict': 'partial',
            'llm_provider': 'openai', 'llm_model': 'gpt-4o-mini',
            'prompt_version': 'v1-test',
        }

    monkeypatch.setattr(llm_jobs, 'grade_open_answer', fake)
    assert llm_jobs.process_next_job() is True
    return graded


# ── the predicate itself ─────────────────────────────────────────────────────

@pytest.mark.parametrize(
    ('status', 'manual', 'scope', 'force', 'expected'),
    [
        ('pending', False, 'pending_only', False, True),
        ('graded', False, 'pending_only', False, False),   # already graded
        ('pending', False, 'all', False, True),
        ('graded', False, 'all', False, True),
        ('graded', True, 'all', False, False),             # manual protected
        ('graded', True, 'all', True, True),               # explicitly forced
        ('pending', True, 'pending_only', False, False),   # manual wins over scope
    ],
)
def test_should_grade(status, manual, scope, force, expected):
    answer = _answer('q', status=status, manual=manual)
    assert llm_jobs._should_grade(
        answer, scope=scope, force_override_manual=force
    ) is expected


# ── end to end through the worker ────────────────────────────────────────────

def test_pending_only_leaves_graded_answers_alone(session_with_answers, db_conn, monkeypatch):
    ctx = session_with_answers
    job = llm_jobs.enqueue_regrade_session(
        ctx['session_id'], ctx['teacher_id'], scope='pending_only'
    )
    assert job['total_items'] == 1

    graded = _run_worker(monkeypatch)
    assert graded == ['pending-q']

    after = _answers(db_conn, ctx['score_id'])
    assert after['pending-q']['llm_status'] == 'graded'
    assert after['graded-q']['points_awarded'] == 1.0      # untouched
    assert after['manual-q']['points_awarded'] == 2.0      # untouched


def test_scope_all_regrades_graded_but_not_manual(session_with_answers, db_conn, monkeypatch):
    ctx = session_with_answers
    job = llm_jobs.enqueue_regrade_session(ctx['session_id'], ctx['teacher_id'], scope='all')
    assert job['total_items'] == 2   # pending + graded, never the manual one

    graded = _run_worker(monkeypatch)
    assert sorted(graded) == ['graded-q', 'pending-q']

    after = _answers(db_conn, ctx['score_id'])
    assert after['graded-q']['points_awarded'] == 1.5      # re-graded
    assert after['manual-q']['points_awarded'] == 2.0      # still protected
    assert after['manual-q']['manual_override'] is True


def test_forcing_the_override_is_the_only_way_to_touch_a_manual_answer(
    session_with_answers, db_conn, monkeypatch
):
    ctx = session_with_answers
    job = llm_jobs.enqueue_regrade_session(
        ctx['session_id'], ctx['teacher_id'], scope='all', force_override_manual=True
    )
    assert job['total_items'] == 3

    _run_worker(monkeypatch)

    after = _answers(db_conn, ctx['score_id'])
    assert after['manual-q']['points_awarded'] == 1.5


def test_job_keeps_its_scope_even_if_asked_again_later(session_with_answers, db_conn):
    """The worker reads scope from the row, not from whatever is current."""
    ctx = session_with_answers
    job = llm_jobs.enqueue_regrade_session(
        ctx['session_id'], ctx['teacher_id'], scope='pending_only'
    )

    stored = db_conn.execute(
        "SELECT scope, force_override_manual FROM llm_grading_jobs WHERE id = %s",
        (job['id'],),
    ).fetchone()
    assert stored == ('pending_only', False)


def test_invalid_scope_is_rejected(session_with_answers):
    from werkzeug.exceptions import BadRequest
    ctx = session_with_answers
    with pytest.raises(BadRequest):
        llm_jobs.enqueue_regrade_session(ctx['session_id'], ctx['teacher_id'], scope='everything')


def test_model_override_is_pinned_on_the_job(session_with_answers, db_conn, monkeypatch):
    ctx = session_with_answers
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-test')

    job = llm_jobs.enqueue_regrade_session(
        ctx['session_id'], ctx['teacher_id'], scope='all', model='gpt-4o'
    )

    assert job['model'] == 'gpt-4o'


# ── preview ──────────────────────────────────────────────────────────────────

def test_preview_counts_match_what_a_regrade_would_do(session_with_answers):
    ctx = session_with_answers
    preview = llm_jobs.regrade_preview(ctx['session_id'], ctx['teacher_id'])

    assert preview['pending'] == 1
    assert preview['graded'] == 1
    assert preview['manual_override'] == 1
    assert preview['models_in_use'] == ['gpt-4o-mini']

    pending_only = llm_jobs.enqueue_regrade_session(
        ctx['session_id'], ctx['teacher_id'], scope='pending_only'
    )
    assert pending_only['total_items'] == preview['pending']


def test_preview_requires_ownership(session_with_answers, db_conn):
    from werkzeug.exceptions import Forbidden
    ctx = session_with_answers
    other = make_teacher(db_conn, email='scope-other@test.it')
    with pytest.raises(Forbidden):
        llm_jobs.regrade_preview(ctx['session_id'], other)


# ── API surface ──────────────────────────────────────────────────────────────

def test_regrade_route_passes_the_options_through(session_with_answers, client, db_conn):
    ctx = session_with_answers
    headers = {'Authorization': f"Bearer {teacher_token(ctx['teacher_id'], email=ctx['email'])}"}

    preview = client.get(
        f"/api/teacher/sessions/{ctx['session_id']}/regrade-preview", headers=headers
    )
    assert preview.status_code == 200
    assert preview.get_json()['manual_override'] == 1

    response = client.post(
        f"/api/teacher/sessions/{ctx['session_id']}/scores/regrade-open",
        json={'scope': 'pending_only', 'force_override_manual': False},
        headers=headers,
    )
    assert response.status_code == 202
    assert response.get_json()['total_items'] == 1

    stored = db_conn.execute(
        "SELECT scope, force_override_manual FROM llm_grading_jobs WHERE id = %s",
        (response.get_json()['id'],),
    ).fetchone()
    assert stored == ('pending_only', False)


def test_revert_restores_the_manual_override_flag(session_with_answers, db_conn, client):
    """Third layer of the invariant: a revert must bring the flag back too.

    Restoring only the points would leave the answer looking automatic, and the
    next regrade would happily overwrite a correction the teacher had made.
    """
    ctx = session_with_answers
    headers = {'Authorization': f"Bearer {teacher_token(ctx['teacher_id'], email=ctx['email'])}"}

    # Overwrite the manual answer with a forced regrade.
    llm_jobs.enqueue_regrade_session(
        ctx['session_id'], ctx['teacher_id'], scope='all', force_override_manual=True
    )
    monkey_graded = []

    def fake(user_ans, q, **_kwargs):
        monkey_graded.append(q['id'])
        return {
            'points': 0.5, 'llm_feedback': 'auto', 'llm_verdict': 'partial',
            'llm_provider': 'openai', 'llm_model': 'gpt-4o-mini',
            'prompt_version': 'v1-test',
        }

    original = llm_jobs.grade_open_answer
    llm_jobs.grade_open_answer = fake
    try:
        assert llm_jobs.process_next_job() is True
    finally:
        llm_jobs.grade_open_answer = original

    after = _answers(db_conn, ctx['score_id'])
    assert after['manual-q']['points_awarded'] == 0.5
    assert not after['manual-q'].get('manual_override')

    # Now revert that change set.
    history = client.get(
        f"/api/teacher/sessions/{ctx['session_id']}/score-history", headers=headers
    ).get_json()
    regrade_set = next(h for h in history if h['reason'] == 'llm_regrade')

    reverted = client.post(
        f"/api/teacher/sessions/{ctx['session_id']}/score-history/{regrade_set['id']}/revert",
        headers=headers,
    )
    assert reverted.status_code == 200

    restored = _answers(db_conn, ctx['score_id'])
    assert restored['manual-q']['points_awarded'] == 2.0
    assert restored['manual-q']['manual_override'] is True
