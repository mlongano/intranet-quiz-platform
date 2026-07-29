"""Grading several answers at once.

Serial grading made a class of 30 with six open questions ~180 sequential
provider calls. These tests check that concurrency actually happens and, more
importantly, that nothing which was safe when one thread did the work becomes
unsafe now that several do.
"""

import json
import threading
import time

import pytest

from services import llm_jobs
from tests.conftest import make_session, make_snapshot, make_student, make_teacher

QUESTION = {
    'id': 'open-1', 'type': 'open', 'text': 'Spiega.',
    'acceptable': ['Risposta completa.'], 'weight': 2,
}


def _pending_answer():
    return {
        'question_id': 'open-1',
        'type': 'open',
        'question_snapshot': QUESTION,
        'question_text': QUESTION['text'],
        'raw_student_answer': 'Risposta.',
        'raw_correct_answer': QUESTION['acceptable'],
        'weight': 2,
        'points_awarded': 0,
        'raw_points': 0,
        'llm_status': 'pending',
        'llm_error': None,
        'option_order': [],
        'answer_revision': 0,
    }


def _session_with_entries(db_conn, count, *, email='conc-t@test.it'):
    teacher_id = make_teacher(db_conn, email=email)
    snapshot_id = make_snapshot(db_conn, teacher_id, jsonc=json.dumps({
        'title': 'Q', 'questions': [QUESTION],
    }))
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='closed')
    for i in range(count):
        student_id = make_student(db_conn, email=f'{email.split("@")[0]}-s{i}@test.it')
        db_conn.execute(
            """INSERT INTO score_entries
               (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
               VALUES (%s, %s, %s, 0, 2, 0, %s::jsonb)""",
            (session_id, student_id, teacher_id, json.dumps([_pending_answer()])),
        )
    db_conn.commit()
    return {'teacher_id': teacher_id, 'session_id': session_id}



def _extra_session(db_conn, teacher_id, tag):
    """Another session for the same teacher.

    uq_llm_active_regrade_per_session allows only one active regrade per
    session, so testing a per-teacher cap needs two different sessions.
    """
    # Distinct title: question_snapshots is unique on (teacher_id, slug).
    snapshot_id = make_snapshot(db_conn, teacher_id, title=f'Test Quiz {tag}', jsonc=json.dumps({
        'title': 'Q', 'questions': [QUESTION],
    }))
    session_id = make_session(db_conn, teacher_id, snapshot_id, status='closed')
    db_conn.commit()
    return session_id


def _grader(*, delay=0.0, observer=None):
    def fake(_user_ans, q, **_kwargs):
        if observer:
            observer()
        if delay:
            time.sleep(delay)
        return {
            'points': 1.0, 'llm_feedback': 'ok', 'llm_verdict': 'partial',
            'llm_provider': 'openai', 'llm_model': 'gpt-4o-mini',
            'prompt_version': 'v1-test',
        }
    return fake


# ── it actually runs in parallel ─────────────────────────────────────────────

def test_entries_are_graded_concurrently(db_conn, monkeypatch):
    """N entries with a grader sleeping t must finish well inside N*t."""
    entries = 8
    delay = 0.25
    ctx = _session_with_entries(db_conn, entries, email='conc-speed@test.it')
    monkeypatch.setenv('LLM_WORKER_CONCURRENCY', '8')
    monkeypatch.setattr(llm_jobs, 'grade_open_answer', _grader(delay=delay))

    job = llm_jobs.enqueue_regrade_session(ctx['session_id'], ctx['teacher_id'], scope='all')

    started = time.monotonic()
    assert llm_jobs.process_next_job() is True
    elapsed = time.monotonic() - started

    # process_next_job() returns True for "a job was claimed", not "it worked",
    # so the timing means nothing until the job is confirmed to have completed.
    status = db_conn.execute(
        "SELECT status FROM llm_grading_jobs WHERE id = %s", (job['id'],)
    ).fetchone()[0]
    assert status == 'completed'

    serial = entries * delay
    assert elapsed < serial / 2, f"took {elapsed:.2f}s, serial would be {serial:.2f}s"


def test_peak_concurrency_respects_the_bound(db_conn, monkeypatch):
    """The point of a bounded pool: never more provider calls than configured."""
    ctx = _session_with_entries(db_conn, 10, email='conc-bound@test.it')
    monkeypatch.setenv('LLM_WORKER_CONCURRENCY', '3')

    lock = threading.Lock()
    state = {'now': 0, 'peak': 0}

    def enter():
        with lock:
            state['now'] += 1
            state['peak'] = max(state['peak'], state['now'])

    def fake(_user_ans, q, **_kwargs):
        enter()
        try:
            time.sleep(0.1)
            return {
                'points': 1.0, 'llm_feedback': 'ok', 'llm_verdict': 'partial',
                'llm_provider': 'openai', 'llm_model': 'm', 'prompt_version': 'v1',
            }
        finally:
            with lock:
                state['now'] -= 1

    monkeypatch.setattr(llm_jobs, 'grade_open_answer', fake)
    llm_jobs.enqueue_regrade_session(ctx['session_id'], ctx['teacher_id'], scope='all')
    assert llm_jobs.process_next_job() is True

    assert state['peak'] > 1, "no concurrency at all"
    assert state['peak'] <= 3, f"exceeded the bound: {state['peak']}"


# ── what concurrency could have broken ───────────────────────────────────────

def test_one_change_set_for_the_whole_job(db_conn, monkeypatch):
    """The lazy change set is created under a lock.

    Without it each thread opens its own, splitting the job's history across
    several change sets and leaving revert able to undo only part of it.
    """
    ctx = _session_with_entries(db_conn, 8, email='conc-cs@test.it')
    monkeypatch.setenv('LLM_WORKER_CONCURRENCY', '8')
    # A delay widens the window in which two threads race to create it.
    monkeypatch.setattr(llm_jobs, 'grade_open_answer', _grader(delay=0.05))

    llm_jobs.enqueue_regrade_session(ctx['session_id'], ctx['teacher_id'], scope='all')
    assert llm_jobs.process_next_job() is True

    change_sets = db_conn.execute(
        "SELECT count(*) FROM score_change_sets WHERE session_id = %s AND reason = 'llm_regrade'",
        (ctx['session_id'],),
    ).fetchone()[0]
    assert change_sets == 1


def test_progress_and_totals_are_not_lost_under_concurrency(db_conn, monkeypatch):
    ctx = _session_with_entries(db_conn, 8, email='conc-count@test.it')
    monkeypatch.setenv('LLM_WORKER_CONCURRENCY', '8')
    monkeypatch.setattr(llm_jobs, 'grade_open_answer', _grader())

    job = llm_jobs.enqueue_regrade_session(ctx['session_id'], ctx['teacher_id'], scope='all')
    assert llm_jobs.process_next_job() is True

    status, processed = db_conn.execute(
        "SELECT status, processed_items FROM llm_grading_jobs WHERE id = %s", (job['id'],)
    ).fetchone()
    assert status == 'completed'
    assert processed == 8

    graded = db_conn.execute(
        """SELECT count(*) FROM score_entries
           WHERE session_id = %s AND answers::text LIKE '%%"llm_status": "graded"%%'""",
        (ctx['session_id'],),
    ).fetchone()[0]
    assert graded == 8


def test_a_failing_entry_does_not_lose_the_others(db_conn, monkeypatch):
    """One provider failure must not take the whole concurrent batch down."""
    ctx = _session_with_entries(db_conn, 6, email='conc-fail@test.it')
    monkeypatch.setenv('LLM_WORKER_CONCURRENCY', '6')

    calls = {'n': 0}
    lock = threading.Lock()

    def flaky(_user_ans, q, **_kwargs):
        with lock:
            calls['n'] += 1
            mine = calls['n']
        if mine == 1:
            raise RuntimeError('provider blew up')
        return {
            'points': 1.0, 'llm_feedback': 'ok', 'llm_verdict': 'partial',
            'llm_provider': 'openai', 'llm_model': 'm', 'prompt_version': 'v1',
        }

    monkeypatch.setattr(llm_jobs, 'grade_open_answer', flaky)
    llm_jobs.enqueue_regrade_session(ctx['session_id'], ctx['teacher_id'], scope='all')
    assert llm_jobs.process_next_job() is True

    rows = db_conn.execute(
        "SELECT answers FROM score_entries WHERE session_id = %s", (ctx['session_id'],)
    ).fetchall()
    statuses = [r[0][0]['llm_status'] for r in rows]
    assert statuses.count('graded') == 5
    assert statuses.count('pending') == 1     # the failure stayed pending, not a zero


# ── claim ordering and fairness ──────────────────────────────────────────────

def test_submissions_are_claimed_before_older_regrades(db_conn, monkeypatch):
    """A student waiting on a score should not queue behind a bulk regrade."""
    ctx = _session_with_entries(db_conn, 1, email='conc-order@test.it')
    monkeypatch.setattr(llm_jobs, 'grade_open_answer', _grader())

    with db_conn.transaction():
        regrade = llm_jobs.create_llm_job(
            db_conn, teacher_id=ctx['teacher_id'], session_id=ctx['session_id'],
            score_entry_id=None, job_type='regrade_session', total_items=1,
            provenance={},
        )
    score_id = db_conn.execute(
        "SELECT id FROM score_entries WHERE session_id = %s", (ctx['session_id'],)
    ).fetchone()[0]
    with db_conn.transaction():
        submission = llm_jobs.create_llm_job(
            db_conn, teacher_id=ctx['teacher_id'], session_id=ctx['session_id'],
            score_entry_id=score_id, job_type='submission', total_items=1,
            provenance={},
        )
    db_conn.commit()

    claimed = llm_jobs._claim_next_job()
    assert claimed['id'] == submission['id'], "the newer submission must win over the older regrade"
    assert claimed['id'] != regrade['id']


def test_per_teacher_cap_holds_back_a_second_job(db_conn, monkeypatch):
    ctx = _session_with_entries(db_conn, 1, email='conc-cap@test.it')
    monkeypatch.setenv('LLM_WORKER_MAX_JOBS_PER_TEACHER', '1')

    second_session = _extra_session(db_conn, ctx['teacher_id'], 'b')
    for session_id in (ctx['session_id'], second_session):
        with db_conn.transaction():
            llm_jobs.create_llm_job(
                db_conn, teacher_id=ctx['teacher_id'], session_id=session_id,
                score_entry_id=None, job_type='regrade_session', total_items=1,
                provenance={},
            )
    db_conn.commit()

    first = llm_jobs._claim_next_job()
    assert first is not None
    # The first is now 'running', so the cap of 1 blocks the second.
    assert llm_jobs._claim_next_job() is None


def test_cap_does_not_block_a_different_teacher(db_conn, monkeypatch):
    mine = _session_with_entries(db_conn, 1, email='conc-cap-a@test.it')
    theirs = _session_with_entries(db_conn, 1, email='conc-cap-b@test.it')
    monkeypatch.setenv('LLM_WORKER_MAX_JOBS_PER_TEACHER', '1')

    for ctx in (mine, theirs):
        with db_conn.transaction():
            llm_jobs.create_llm_job(
                db_conn, teacher_id=ctx['teacher_id'], session_id=ctx['session_id'],
                score_entry_id=None, job_type='regrade_session', total_items=1,
                provenance={},
            )
    db_conn.commit()

    first = llm_jobs._claim_next_job()
    second = llm_jobs._claim_next_job()
    assert first is not None and second is not None
    assert first['teacher_id'] != second['teacher_id']


def test_cap_can_be_disabled(db_conn, monkeypatch):
    ctx = _session_with_entries(db_conn, 1, email='conc-nocap@test.it')
    monkeypatch.setenv('LLM_WORKER_MAX_JOBS_PER_TEACHER', '0')

    second_session = _extra_session(db_conn, ctx['teacher_id'], 'b')
    for session_id in (ctx['session_id'], second_session):
        with db_conn.transaction():
            llm_jobs.create_llm_job(
                db_conn, teacher_id=ctx['teacher_id'], session_id=session_id,
                score_entry_id=None, job_type='regrade_session', total_items=1,
                provenance={},
            )
    db_conn.commit()

    assert llm_jobs._claim_next_job() is not None
    assert llm_jobs._claim_next_job() is not None


# ── configuration ────────────────────────────────────────────────────────────

def test_pool_is_sized_above_the_concurrency(monkeypatch):
    """A pool smaller than the concurrency deadlocks instead of queueing."""
    monkeypatch.setenv('LLM_WORKER_CONCURRENCY', '10')
    monkeypatch.setenv('LLM_WORKER_MAX_JOBS', '4')

    assert llm_jobs.required_pool_size() > llm_jobs.worker_concurrency()
    assert llm_jobs.required_pool_size() >= 10 + 4


@pytest.mark.parametrize('value', ['0', '-3'])
def test_concurrency_never_drops_below_one(monkeypatch, value):
    monkeypatch.setenv('LLM_WORKER_CONCURRENCY', value)
    assert llm_jobs.worker_concurrency() == 1
