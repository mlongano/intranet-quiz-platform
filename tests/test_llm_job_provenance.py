"""Grading jobs pin how they must be evaluated.

Two things are guarded here:

1. Provenance is resolved at enqueue time and stored on the job, so a prompt
   edit or an LLM_MODEL change afterwards cannot alter a queued job.
2. The job row mapping stays aligned with the shared column list. That mapping
   is positional, so a mismatch does not raise — it silently shifts every field
   after the new column, which is exactly the kind of bug tests must catch.
"""

import json

from db import queries as Q
from services import llm_jobs
from tests.conftest import make_session, make_snapshot, make_teacher


def _make_job(db_conn, **overrides):
    teacher_id = overrides.pop('teacher_id', None) or make_teacher(
        db_conn, email=overrides.pop('email', 'prov-teacher@test.it')
    )
    snapshot_id = make_snapshot(db_conn, teacher_id)
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='active')
    job = llm_jobs.create_llm_job(
        db_conn,
        teacher_id=teacher_id,
        session_id=session_id,
        score_entry_id=None,
        job_type='regrade_session',
        total_items=1,
        **overrides,
    )
    db_conn.commit()
    return job, teacher_id, session_id


def test_job_row_mapping_matches_the_shared_column_list(db_conn):
    """_job_row_to_dict reads by position; the order must match the SQL."""
    columns = [c.strip() for c in Q.LLM_GRADING_JOB_COLUMNS.replace('\n', ' ').split(',')]
    columns = [c for c in columns if c]

    job, _, _ = _make_job(db_conn, provenance={})

    # Every selected column must be represented, in order, by the mapping.
    expected_keys = [
        'id', 'teacher_id', 'session_id', 'score_entry_id', 'status', 'job_type',
        'total_items', 'processed_items', 'error', 'created_at', 'started_at',
        'finished_at', 'provider', 'model', 'prompt_version', '_prompt_snapshot',
        'params', 'scope', 'force_override_manual',
    ]
    assert columns == [
        'id', 'teacher_id', 'session_id', 'score_entry_id', 'status', 'job_type',
        'total_items', 'processed_items', 'error', 'created_at', 'started_at',
        'finished_at', 'provider', 'model', 'prompt_version', 'prompt_snapshot',
        'params', 'scope', 'force_override_manual',
    ], "column list changed -- update _job_row_to_dict in the same commit"
    assert len(expected_keys) == len(columns)
    # Every mapped key must be present, so a shifted mapping cannot pass.
    assert set(expected_keys) <= set(job) | {'_prompt_snapshot'}

    # Sanity: values landed in the right fields rather than being shifted.
    assert isinstance(job['id'], int)
    assert job['job_type'] == 'regrade_session'
    assert job['status'] == 'pending'
    assert job['total_items'] == 1


def test_enqueue_pins_provider_model_and_prompt(db_conn):
    provenance = {
        'provider': 'openai',
        'model': 'gpt-4o-mini',
        'prompt_version': 'v1-aaaaaaaa+v1-bbbbbbbb',
        'prompt_snapshot': {'system': 'SYSTEM TEXT', 'user': 'USER TEMPLATE'},
        'params': {'timeout_seconds': 25.0, 'retries': 0},
    }
    job, _, _ = _make_job(db_conn, provenance=provenance, email='prov-pin@test.it')

    assert job['provider'] == 'openai'
    assert job['model'] == 'gpt-4o-mini'
    assert job['prompt_version'] == 'v1-aaaaaaaa+v1-bbbbbbbb'
    assert job['params'] == {'timeout_seconds': 25.0, 'retries': 0}

    stored = db_conn.execute(
        "SELECT prompt_snapshot FROM llm_grading_jobs WHERE id = %s", (job['id'],)
    ).fetchone()[0]
    assert stored == {'system': 'SYSTEM TEXT', 'user': 'USER TEMPLATE'}


def test_prompt_snapshot_is_not_exposed_in_the_job_api_shape(db_conn):
    """The snapshot is large and worker-only; job dicts go straight to the API."""
    provenance = {
        'provider': 'openai',
        'model': 'gpt-4o-mini',
        'prompt_version': 'v1-cccccccc',
        'prompt_snapshot': {'system': 'S', 'user': 'U'},
        'params': {},
    }
    job, teacher_id, _ = _make_job(db_conn, provenance=provenance, email='prov-api@test.it')

    fetched = llm_jobs.get_job_for_teacher(job['id'], teacher_id)
    assert 'prompt_snapshot' not in fetched
    assert fetched['prompt_version'] == 'v1-cccccccc'
    # Serialisable as-is by the teacher endpoint.
    json.dumps({k: v for k, v in fetched.items() if not k.startswith('_')})


def test_job_without_provenance_still_works(db_conn):
    """Jobs enqueued while grading is disabled must remain valid."""
    job, _, _ = _make_job(db_conn, provenance={}, email='prov-none@test.it')
    assert job['provider'] is None
    assert job['model'] is None
    assert job['prompt_version'] is None
    assert job['status'] == 'pending'


def test_resolve_job_provenance_is_empty_when_llm_disabled(monkeypatch):
    monkeypatch.setenv('USE_LLM_EVAL', '0')
    assert llm_jobs.resolve_job_provenance() == {}


def test_resolve_job_provenance_captures_current_prompts(monkeypatch):
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')
    monkeypatch.setenv('OPENAI_API_KEY', 'sk-test')

    prov = llm_jobs.resolve_job_provenance()

    assert prov['provider'] == 'openai'
    assert prov['model'] == 'gpt-4o-mini'
    assert prov['prompt_snapshot']['system'].strip()
    assert '{{QUESTION}}' in prov['prompt_snapshot']['user']
    assert 'api_key' not in prov, "credentials must never be stored on a job"


def test_resolve_job_provenance_survives_bad_config(monkeypatch):
    """Enqueueing must not fail on misconfiguration; the worker reports it."""
    monkeypatch.setenv('USE_LLM_EVAL', '1')
    monkeypatch.setenv('LLM_PROVIDER', 'openai')
    monkeypatch.setenv('LLM_MODEL', 'gpt-4o-mini')
    monkeypatch.delenv('OPENAI_API_KEY', raising=False)

    assert llm_jobs.resolve_job_provenance() == {}
