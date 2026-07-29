"""A queued job grades with what it was enqueued with.

This is the guarantee that makes a historical score explainable: the provider,
model and prompt are pinned when the job is created, so editing a prompt file
or changing LLM_MODEL afterwards cannot silently change how a job already in
the queue is graded.
"""

import json

from services import grading, llm_jobs
from tests.conftest import make_session, make_snapshot, make_student, make_teacher

OPEN_QUESTION = {
    'id': 'open-1',
    'type': 'open',
    'text': 'Spiega PATCH.',
    'acceptable': ['Aggiorna solo i campi inviati.'],
    'weight': 2,
}


def _seed_pending_answer(db_conn, email_suffix):
    teacher_id = make_teacher(db_conn, email=f'repro-{email_suffix}-t@test.it')
    student_id = make_student(db_conn, email=f'repro-{email_suffix}-s@test.it')
    snapshot_id = make_snapshot(db_conn, teacher_id, jsonc=json.dumps({
        'title': 'Open Quiz', 'questions': [OPEN_QUESTION],
    }))
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='active')
    answer = {
        'question_id': 'open-1',
        'type': 'open',
        'question_snapshot': OPEN_QUESTION,
        'question_text': OPEN_QUESTION['text'],
        'raw_student_answer': 'Aggiorna alcuni campi.',
        'raw_correct_answer': OPEN_QUESTION['acceptable'],
        'weight': 2,
        'points_awarded': 0,
        'raw_points': 0,
        'llm_status': 'pending',
        'llm_error': None,
        'option_order': [],
        'answer_revision': 0,
    }
    row = db_conn.execute(
        """INSERT INTO score_entries
           (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
           VALUES (%s, %s, %s, 0, 2, 0, %s::jsonb) RETURNING id""",
        (session_id, student_id, teacher_id, json.dumps([answer])),
    ).fetchone()
    db_conn.commit()
    return {'teacher_id': teacher_id, 'session_id': session_id, 'score_id': row[0]}


def _answers(db_conn, score_id):
    return db_conn.execute(
        "SELECT answers FROM score_entries WHERE id = %s", (score_id,)
    ).fetchone()[0]


def test_worker_grades_with_the_prompt_pinned_on_the_job(db_conn, monkeypatch):
    """Editing the prompt after enqueueing must not change a queued job."""
    ctx = _seed_pending_answer(db_conn, 'snapshot')

    pinned = {
        'provider': 'openai',
        'model': 'gpt-4o-mini',
        'prompt_version': 'v1-pinned00+v1-pinned01',
        'prompt_snapshot': {
            'system': 'PINNED SYSTEM PROMPT',
            'user': 'PINNED {{QUESTION}} {{ACCEPTABLE_ANSWER}} {{STUDENT_ANSWER}}',
        },
        'params': {'timeout_seconds': 5, 'retries': 0},
    }
    llm_jobs.create_llm_job(
        db_conn, teacher_id=ctx['teacher_id'], session_id=ctx['session_id'],
        score_entry_id=ctx['score_id'], job_type='submission', total_items=1,
        provenance=pinned,
    )
    db_conn.commit()

    # The live configuration says something else entirely.
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'anthropic')
    monkeypatch.setenv('LLM_MODEL', 'claude-sonnet-4')
    monkeypatch.setenv('ANTHROPIC_API_KEY', 'sk-live')

    seen = {}

    def capture(**kwargs):
        seen.update(kwargs)
        return {
            'score': 0.5, 'verdict': 'partial', 'llm_feedback': 'ok',
            'provider': kwargs['provider'], 'model': kwargs['model'], 'params': {},
        }

    import services.llm_provider as llm_provider
    monkeypatch.setattr(llm_provider, 'evaluate_open_question', capture)

    assert llm_jobs.process_next_job() is True

    # Graded with the job's pinned prompt and model, not the live environment's.
    assert seen['system_prompt'] == 'PINNED SYSTEM PROMPT'
    assert seen['user_prompt_template'].startswith('PINNED ')
    assert seen['model'] == 'gpt-4o-mini'
    assert seen['provider'] == 'openai'
    # The live config (anthropic/claude) must not have leaked in anywhere.
    assert seen['provider'] != 'anthropic'
    # ...but the key is read live, since credentials are never stored on a job.
    assert seen['api_key'] == 'sk-live'

    stored = _answers(db_conn, ctx['score_id'])[0]
    assert stored['llm_status'] == 'graded'
    assert stored['llm_provider'] == 'openai'
    assert stored['llm_model'] == 'gpt-4o-mini'
    assert stored['prompt_version'] == 'v1-pinned00+v1-pinned01'
    assert stored['points_awarded'] == 1.0  # weight 2 x score 0.5


def test_credentials_come_from_live_config_not_the_job(db_conn, monkeypatch):
    """Keys are secrets: pinned on nothing, read fresh, never stored on a job."""
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-rotated-key')

    job = {
        'provider': 'openai',
        'model': 'gpt-4o-mini',
        'prompt_version': 'v1-x',
        '_prompt_snapshot': {'system': 'S', 'user': 'U'},
        'params': {'timeout_seconds': 5, 'retries': 0},
    }
    context = grading.resolve_evaluation_context(job)

    assert context['api_key'] == 'sk-rotated-key'
    assert context['system_prompt'] == 'S'
    assert context['prompt_version'] == 'v1-x'


def test_job_without_snapshot_falls_back_to_current_prompts(monkeypatch):
    """Jobs enqueued before migration 007 still grade, using today's prompts."""
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-test')

    context = grading.resolve_evaluation_context({'provider': None, 'model': None})

    assert '{{QUESTION}}' in context['user_prompt_template']
    assert context['prompt_version'].startswith('v')
    assert context['model'] == 'gpt-4o-mini'


def test_failed_configuration_leaves_answer_pending_not_zero(db_conn, monkeypatch):
    """The whole point of the taxonomy: a misconfiguration is not a grade of 0."""
    ctx = _seed_pending_answer(db_conn, 'badconfig')
    llm_jobs.create_llm_job(
        db_conn, teacher_id=ctx['teacher_id'], session_id=ctx['session_id'],
        score_entry_id=ctx['score_id'], job_type='submission', total_items=1,
        provenance={},
    )
    db_conn.commit()

    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)

    assert llm_jobs.process_next_job() is True

    stored = _answers(db_conn, ctx['score_id'])[0]
    assert stored['llm_status'] == 'pending'
    assert stored['points_awarded'] == 0
    assert 'OPENAI_API_KEY' in (stored['llm_error'] or '')
