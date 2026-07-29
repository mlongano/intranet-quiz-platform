"""Background jobs for LLM grading.

The request path only creates jobs and marks open answers as pending. This
module is the single place that calls grade_open_answer() for stored answers.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import datetime, timezone
from typing import Any

from psycopg import errors as pg_errors
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

import db
from db import queries as Q
from services.grading import grade_open_answer
from services.llm_errors import LlmConfigurationError, llm_enabled, validate_llm_env
from utils import ensure_list


def create_llm_job(
    conn,
    *,
    teacher_id: int,
    session_id: int,
    score_entry_id: int | None,
    job_type: str,
    total_items: int,
    provenance: dict | None = None,
    scope: str = 'all',
    force_override_manual: bool = False,
) -> dict:
    """Create a grading job, pinning how it must be evaluated.

    Provider, model and prompt are resolved *now* and stored on the row. The
    worker reads them from the job, so editing a prompt file or changing
    LLM_MODEL after enqueueing cannot alter a job already in the queue.
    """
    # Reuse the caller's connection: this runs inside the transaction that
    # records a submission, and taking a second connection from the pool while
    # that one is held deadlocks under concurrent submissions.
    prov = (
        provenance if provenance is not None
        else resolve_job_provenance(teacher_id=teacher_id, conn=conn)
    )
    snapshot = prov.get('prompt_snapshot')
    params = prov.get('params')
    row = conn.execute(Q.INSERT_LLM_GRADING_JOB, {
        'teacher_id': teacher_id,
        'session_id': session_id,
        'score_entry_id': score_entry_id,
        'job_type': job_type,
        'total_items': total_items,
        'provider': prov.get('provider'),
        'model': prov.get('model'),
        'prompt_version': prov.get('prompt_version'),
        'prompt_snapshot': json.dumps(snapshot) if snapshot is not None else None,
        'params': json.dumps(params) if params is not None else None,
        # Submissions only ever grade what was never graded; there is nothing
        # else on a brand-new score entry.
        'scope': 'pending_only' if job_type == 'submission' else scope,
        'force_override_manual': force_override_manual,
    }).fetchone()
    return _job_row_to_dict(row)


def resolve_job_provenance(teacher_id: int | None = None, conn=None) -> dict:
    """Resolve the provider, model and prompt texts to pin onto a new job.

    *teacher_id* selects whose configuration applies, so a job records the
    endpoint and model that teacher actually grades with rather than the
    installation defaults.

    *conn* is the caller's connection when it already holds one, so this never
    acquires a second from the pool.

    Returns empty provenance when LLM grading is disabled or the prompts cannot
    be read: enqueueing must not fail here. The worker will raise the
    configuration error and leave the answers pending, which is the one place
    that failure is handled.
    """
    from services.llm_errors import llm_enabled

    if not llm_enabled():
        return {}
    try:
        from services import prompts
        from services.llm_config import resolve_llm_config

        config = resolve_llm_config(teacher_id=teacher_id, conn=conn)
        prompt_set = prompts.active_prompt_set()
    except Exception as exc:  # noqa: BLE001 - enqueueing must stay non-fatal
        print(f"[LLM_JOBS] Could not resolve grading provenance: {exc}", flush=True)
        return {}

    return {
        'provider': config['provider'],
        'model': config['model'],
        'prompt_version': prompt_set['version'],
        'prompt_snapshot': {
            'system': prompt_set['system'],
            'user': prompt_set['user'],
        },
        'params': config.get('params'),
    }


def enqueue_regrade_session(
    session_id: int,
    teacher_id: int,
    *,
    scope: str = 'all',
    force_override_manual: bool = False,
    model: str | None = None,
) -> dict:
    """Create a regrade job WITHOUT modifying current evaluations.

    The worker is solely responsible for changing scores, feedback, and
    status.  Enqueuing preserves the current state so a running regrade
    never leaves answers in an inconsistent intermediate condition.

    *scope* is 'pending_only' to retry only what was never graded, or 'all' to
    re-grade everything. *force_override_manual* lets a regrade overwrite a
    teacher's manual corrections, and is false unless explicitly requested.
    *model* overrides the model for this job alone, so a teacher can try a
    different one without changing their settings.
    """
    if scope not in ('pending_only', 'all'):
        raise BadRequest(description="Ambito di rivalutazione non valido.")
    import os as _os
    _cooldown = int(_os.getenv('LLM_REGRADE_COOLDOWN_SECONDS', '60'))

    total_items = 0
    with db.get_conn() as conn:
        owner = conn.execute(
            "SELECT teacher_id FROM quiz_sessions WHERE id = %s",
            (session_id,),
        ).fetchone()
        if not owner:
            raise NotFound(description="Session not found.")
        if owner[0] != teacher_id:
            raise Forbidden(description="Not your session.")

        # ── rate limit + concurrency lock ───────────────────────────────
        row = conn.execute(
            """SELECT EXTRACT(EPOCH FROM (now() - last_regrade_at))
               FROM quiz_sessions WHERE id = %s
               FOR UPDATE""",
            (session_id,),
        ).fetchone()
        if row and row[0] is not None and row[0] < _cooldown:
            remaining = int(_cooldown - row[0])
            from werkzeug.exceptions import TooManyRequests
            raise TooManyRequests(
                f"Attendi {remaining} secondi prima di una nuova rivalutazione."
            )

        # Count what this job will actually touch, WITHOUT modifying anything.
        # Same predicate the worker uses, so total_items is not a guess.
        rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()
        for row in rows:
            for answer in ensure_list(row[4]):
                if _should_grade(
                    answer, scope=scope, force_override_manual=force_override_manual
                ):
                    total_items += 1

        # Pin how this job must be evaluated, honouring a one-off model choice.
        provenance = resolve_job_provenance(teacher_id=teacher_id, conn=conn)
        if model and provenance:
            provenance = {**provenance, 'model': model.strip()}

        if total_items > 0:
            # Concurrency: uq_llm_active_regrade_per_session rejects a second
            # pending/running regrade. Only that collision means "already
            # running" — any other failure is a real error and must surface.
            try:
                job = create_llm_job(
                    conn,
                    teacher_id=teacher_id,
                    session_id=session_id,
                    score_entry_id=None,
                    job_type='regrade_session',
                    total_items=total_items,
                    provenance=provenance,
                    scope=scope,
                    force_override_manual=force_override_manual,
                )
            except pg_errors.UniqueViolation:
                conn.rollback()
                from werkzeug.exceptions import Conflict
                raise Conflict(description="Una rivalutazione è già in corso per questa sessione.")
        else:
            job = create_llm_job(
                conn,
                teacher_id=teacher_id,
                session_id=session_id,
                score_entry_id=None,
                job_type='regrade_session',
                total_items=0,
                provenance=provenance,
                scope=scope,
                force_override_manual=force_override_manual,
            )
            conn.execute(Q.FINISH_LLM_GRADING_JOB, {
                'id': job['id'],
                'status': 'completed',
                'processed_items': 0,
                'error': None,
            })
            job['status'] = 'completed'

        conn.execute(
            "UPDATE quiz_sessions SET last_regrade_at = now() WHERE id = %s",
            (session_id,),
        )
        conn.commit()
    return job


def get_job_for_teacher(job_id: int, teacher_id: int) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_LLM_GRADING_JOB_FOR_TEACHER, (job_id, teacher_id)).fetchone()
    return _job_row_to_dict(row) if row else None


def get_latest_job_for_session(session_id: int, teacher_id: int) -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(
            Q.GET_LATEST_LLM_GRADING_JOB_FOR_SESSION,
            (session_id, teacher_id),
        ).fetchone()
    return _job_row_to_dict(row) if row else None


def process_next_job() -> bool:
    job = _claim_next_job()
    if not job:
        return False

    processed = int(job.get('processed_items') or 0)
    failures: list[str] = []
    try:
        score_ids = _score_ids_for_job(job)

        # One change set for the whole job, opened on the first recorded change
        # so a job that grades nothing leaves no empty entry in the history.
        from services.score_transforms import open_change_set
        reason = 'llm_grade' if job['job_type'] == 'submission' else 'llm_regrade'
        change_set_cache: dict[str, str] = {}

        def change_set() -> str:
            if 'id' not in change_set_cache:
                with db.get_conn() as cs_conn:
                    change_set_cache['id'] = open_change_set(
                        cs_conn,
                        session_id=job['session_id'],
                        reason=reason,
                        actor_type='system',
                        changed_by=None,
                        llm_job_id=job['id'],
                    )
                    cs_conn.commit()
            return change_set_cache['id']

        job['_change_set'] = change_set

        # Resolve the evaluation context once per job, not once per answer:
        # every answer in a job must be graded with the same provider, model and
        # prompt, otherwise a single regrade could mix two models silently.
        # A configuration failure here is left to the per-answer handler, which
        # knows to keep answers pending instead of scoring them zero.
        try:
            from services.grading import resolve_evaluation_context
            job['_evaluation'] = resolve_evaluation_context(job)
        except Exception as exc:  # noqa: BLE001 - reported per answer below
            job['_evaluation'] = None
            failures.append(f"configurazione LLM non valida: {exc}")

        for score_id in score_ids:
            changed = _process_next_answer_for_score(job, score_id, failures)
            if changed:
                processed += 1
                _update_job_progress(job['id'], processed)

        # The job still completes when individual answers failed: the answers
        # themselves carry the outcome. The error text is the teacher's summary.
        with db.get_conn() as conn:
            conn.execute(Q.FINISH_LLM_GRADING_JOB, {
                'id': job['id'],
                'status': 'completed',
                'processed_items': processed,
                'error': _format_failures(failures),
            })
            conn.commit()
    except Exception as exc:
        with db.get_conn() as conn:
            conn.execute(Q.FINISH_LLM_GRADING_JOB, {
                'id': job['id'],
                'status': 'failed',
                'processed_items': processed,
                'error': str(exc),
            })
            conn.commit()
        print(f"[LLM_JOBS] Job {job['id']} failed: {exc}")
    return True


def worker_loop(*, poll_seconds: float = 2.0, error_backoff_seconds: float = 5.0) -> None:
    """Poll for grading jobs forever.

    Assumes a single worker replica: requeue_running_jobs() below reclaims
    every running job at startup, which would steal jobs from a live sibling.

    A failure inside one iteration (typically a database blip) must not kill
    the process, or grading silently stops until someone notices.
    """
    print("[LLM_JOBS] Worker started.", flush=True)
    if not llm_enabled():
        print(
            "[LLM_JOBS] WARNING: USE_LLM_EVAL is not 1 — open answers will stay "
            "pending until the LLM is configured and a regrade is requested.",
            flush=True,
        )

    requeue_running_jobs()
    while True:
        try:
            did_work = process_next_job()
        except Exception as exc:
            print(f"[LLM_JOBS] Worker iteration failed: {exc}", flush=True)
            time.sleep(error_backoff_seconds)
            continue
        if not did_work:
            time.sleep(poll_seconds)


def requeue_running_jobs() -> int:
    """Recover jobs left running by a terminated worker process."""
    with db.get_conn() as conn:
        result = conn.execute(Q.REQUEUE_RUNNING_LLM_GRADING_JOBS)
        count = result.rowcount
        conn.commit()
    if count:
        print(f"[LLM_JOBS] Requeued {count} running job(s).", flush=True)
    return count


def _claim_next_job() -> dict | None:
    with db.get_conn() as conn:
        row = conn.execute(Q.CLAIM_LLM_GRADING_JOB).fetchone()
        if not row:
            conn.commit()
            return None
        conn.execute(Q.MARK_LLM_GRADING_JOB_RUNNING, (row[0],))
        conn.commit()
    job = _job_row_to_dict(row)
    job['status'] = 'running'
    return job


def _score_ids_for_job(job: dict) -> list[int]:
    if job['job_type'] in ('submission', 'regrade_score'):
        return [int(job['score_entry_id'])] if job['score_entry_id'] is not None else []
    with db.get_conn() as conn:
        rows = conn.execute(
            Q.LIST_SCORE_ENTRY_IDS_FOR_LLM_SESSION,
            (job['session_id'], job['teacher_id']),
        ).fetchall()
    return [int(row[0]) for row in rows]


def _format_failures(failures: list[str], *, limit: int = 10) -> str | None:
    """Render per-answer failures as the job's error summary."""
    if not failures:
        return None
    head = failures[:limit]
    suffix = f" (+{len(failures) - limit} altre)" if len(failures) > limit else ""
    return f"{len(failures)} risposte non valutate: " + "; ".join(head) + suffix


def _process_next_answer_for_score(
    job: dict,
    score_id: int,
    failures: list[str] | None = None,
) -> bool:
    """Grade one score entry, optimistically.

    An LLM call can take minutes, so it must not run inside a transaction
    holding row locks. The entry is read unlocked, graded in memory, and only
    then written under FOR UPDATE — re-checking that each answer still carries
    the revision it was graded against and has not since been manually
    overridden. Answers that moved on are skipped rather than overwritten,
    which is what actually protects a teacher's manual review from a regrade
    that was already in flight.
    """
    from services.score_transforms import record_answer_changes

    # ── 1. read without locking ─────────────────────────────────────────────
    with db.get_conn() as conn:
        row = conn.execute(
            Q.GET_SCORE_ENTRY_FOR_LLM_JOB,
            (score_id, job['teacher_id'], job['session_id']),
        ).fetchone()
        conn.commit()
    if not row:
        return False

    read_answers = ensure_list(row[7])

    # ── 2. grade in memory, holding no connection ───────────────────────────
    graded = [dict(a) for a in read_answers]
    changed = _process_one_pending_answer(
        graded,
        is_regrade=(job.get('job_type') == 'regrade_session'),
        failures=failures,
        evaluation=job.get('_evaluation'),
        scope=job.get('scope') or 'all',
        force_override_manual=bool(job.get('force_override_manual')),
    )
    if not changed:
        return False

    # What we intend to write, and the revision each was graded against.
    proposals: dict[str, dict] = {}
    for before, after in zip(read_answers, graded):
        if before != after:
            proposals[str(after.get('question_id'))] = {
                'answer': after,
                'revision': before.get('answer_revision') or 0,
            }
    if not proposals:
        return False

    # ── 3. write under lock, re-verifying every target answer ───────────────
    with db.get_conn() as conn:
        locked = conn.execute(
            Q.LOCK_SCORE_ENTRY_FOR_LLM_JOB,
            (score_id, job['teacher_id'], job['session_id']),
        ).fetchone()
        if not locked:
            conn.commit()
            return False

        current = ensure_list(locked[2])
        old_percent = float(locked[1]) if locked[1] is not None else None
        old_answers = [dict(a) for a in current]
        new_answers = [dict(a) for a in current]

        applied = 0
        for idx, cur in enumerate(new_answers):
            proposal = proposals.get(str(cur.get('question_id')))
            if proposal is None:
                continue
            stale = (cur.get('answer_revision') or 0) != proposal['revision']
            # Re-check the override here too: it may have been set by a teacher
            # between the read and this write, which is precisely the race the
            # optimistic pattern exists to catch.
            overridden = (
                cur.get('manual_override') and not job.get('force_override_manual')
            )
            if stale or overridden:
                if failures is not None:
                    failures.append(
                        f"q={cur.get('question_id')}: modificata durante la valutazione, "
                        f"risultato LLM ignorato"
                    )
                continue
            new_answers[idx] = proposal['answer']
            applied += 1

        if not applied:
            conn.commit()
            return False

        raw_points, max_points, percent = _score_totals(new_answers)

        # Assigns the new revisions — must run before the answers are stored.
        recorded = record_answer_changes(
            conn,
            change_set_id=job['_change_set'],
            score_entry_id=score_id,
            old_answers=old_answers,
            new_answers=new_answers,
            old_percent=old_percent,
            new_percent=percent,
        )
        if not recorded:
            conn.commit()
            return False

        conn.execute(Q.UPDATE_SCORE_ANSWERS, {
            'answers': json.dumps(new_answers),
            'raw_points': raw_points,
            'max_points': max_points,
            'percent': percent,
            'id': score_id,
            'teacher_id': job['teacher_id'],
        })
        conn.commit()
    return True


def _should_grade(answer: dict, *, scope: str, force_override_manual: bool) -> bool:
    """Whether this job is allowed to touch this answer.

    Both inputs come from the job row, so a job keeps the behaviour it was
    enqueued with even if the teacher changes their mind while it runs. This
    check is also the primary protection for a manual evaluation: it holds even
    if a job was queued with the wrong parameters or the UI skipped its own
    confirmation.
    """
    if _answer_type(answer) != 'open':
        return False
    if scope == 'pending_only' and answer.get('llm_status') != 'pending':
        return False
    if answer.get('manual_override') and not force_override_manual:
        return False
    return True


def _process_one_pending_answer(
    answers: list[dict],
    *,
    is_regrade: bool = False,
    failures: list[str] | None = None,
    evaluation: dict | None = None,
    scope: str = 'all',
    force_override_manual: bool = False,
) -> bool:
    """Grade the open answers in *answers* in place.

    A failed evaluation is never recorded as a grade:
      - an answer that was never graded stays 'pending' with llm_error set and
        0 points, so the teacher can retry;
      - an answer that already carries a grade is left completely untouched,
        so a failing regrade cannot destroy a good evaluation.
    Failures are appended to *failures* for the job-level error report.
    """
    now = datetime.now(timezone.utc).isoformat()
    any_changed = False

    effective_scope = scope if is_regrade else 'pending_only'

    for answer in answers:
        if not _should_grade(
            answer, scope=effective_scope, force_override_manual=force_override_manual
        ):
            continue
        answer.setdefault('type', 'open')

        q = answer.get('question_snapshot')
        if not isinstance(q, dict):
            q = {
                'id': answer.get('question_id'),
                'type': 'open',
                'text': answer.get('question_text') or '',
                'acceptable': answer.get('raw_correct_answer') or answer.get('correct_answer') or [],
                'weight': answer.get('weight', 1),
            }

        try:
            result = grade_open_answer(
                answer.get('raw_student_answer') or '', q, evaluation=evaluation
            )
        except Exception as exc:
            # Typed LlmError subclasses are the expected cases; anything else is
            # caught too because a single bad answer must not kill the worker.
            if failures is not None:
                failures.append(f"q={answer.get('question_id')}: {exc}")
            if answer.get('llm_status') == 'graded':
                # Preserve the previous evaluation verbatim.
                continue
            answer['llm_status'] = 'pending'
            answer['llm_error'] = str(exc)
            answer['llm_updated_at'] = now
            any_changed = True
            continue

        points = round(float(result.get('points', 0)), 2)
        answer['points_awarded'] = points
        answer['raw_points'] = points
        answer['llm_feedback'] = result.get('llm_feedback')
        answer['llm_verdict'] = result.get('llm_verdict')
        answer['llm_status'] = 'graded'
        answer['llm_error'] = None
        answer['llm_updated_at'] = now
        # Provenance: which provider, model and prompt produced this grade.
        # Without it a teacher cannot be told why a regrade moved a score.
        answer['llm_provider'] = result.get('llm_provider')
        answer['llm_model'] = result.get('llm_model')
        answer['prompt_version'] = result.get('prompt_version')
        # Reaching here for an overridden answer means the teacher forced it.
        # The value is now the model's, not theirs, so the flag has to go:
        # leaving it would make the next ordinary regrade skip an answer that
        # is no longer a manual correction, and misreport it in the preview.
        if answer.pop('manual_override', None):
            answer.pop('original_points_awarded', None)
        any_changed = True

    return any_changed


def _update_job_progress(job_id: int, processed: int) -> None:
    with db.get_conn() as conn:
        conn.execute(Q.UPDATE_LLM_GRADING_JOB_PROGRESS, (processed, job_id))
        conn.commit()


def _answer_type(answer: dict) -> str | None:
    direct_type = answer.get('type')
    if direct_type:
        return str(direct_type)
    snapshot = answer.get('question_snapshot')
    if isinstance(snapshot, dict) and snapshot.get('type'):
        return str(snapshot.get('type'))
    return None


def _score_totals(answers: list[dict]) -> tuple[float, float, float]:
    raw_points = round(sum(float(a.get('points_awarded') or 0) for a in answers), 2)
    max_points = round(sum(float(a.get('weight') or 0) for a in answers), 2)
    percent = round(raw_points / max_points * 100, 2) if max_points else 0.0
    return raw_points, max_points, percent


def _job_row_to_dict(row: Any) -> dict:
    """Map a job row by position — the order is Q.LLM_GRADING_JOB_COLUMNS.

    Every job query selects that shared column list, so adding a column there
    and here is a single coordinated change. prompt_snapshot is intentionally
    not returned: it is large, it is only for the worker, and job dicts are
    serialised straight to the teacher API.
    """
    return {
        'id': row[0],
        'teacher_id': row[1],
        'session_id': row[2],
        'score_entry_id': row[3],
        'status': row[4],
        'job_type': row[5],
        'total_items': row[6],
        'processed_items': row[7],
        'error': row[8],
        'created_at': row[9].isoformat() if row[9] else None,
        'started_at': row[10].isoformat() if row[10] else None,
        'finished_at': row[11].isoformat() if row[11] else None,
        'provider': row[12],
        'model': row[13],
        'prompt_version': row[14],
        '_prompt_snapshot': row[15],
        'params': row[16],
        'scope': row[17],
        'force_override_manual': row[18],
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['worker', 'once'])
    parser.add_argument('--poll-seconds', type=float, default=2.0)
    args = parser.parse_args()

    db.init_pool(
        dsn=os.environ.get('DATABASE_URL', 'postgresql:///quizparty'),
        min_size=1,
        max_size=4,
    )

    # After the pool: the grading endpoint may come from the llm_endpoints
    # table rather than from the environment.
    try:
        validate_llm_env()
    except LlmConfigurationError as exc:
        print(f"[LLM_JOBS] ERROR: {exc}", flush=True)
        raise SystemExit(1)

    if args.command == 'worker':
        worker_loop(poll_seconds=args.poll_seconds)
    else:
        process_next_job()


if __name__ == '__main__':
    main()


def regrade_preview(session_id: int, teacher_id: int) -> dict:
    """What a regrade would touch, before the teacher commits to it.

    The panel needs real numbers to warn with: how many evaluations would be
    replaced, and how many manual corrections would be overwritten if the
    teacher forces it. Counted with the same predicate the worker applies, so
    the warning cannot disagree with what actually happens.
    """
    with db.get_conn() as conn:
        owner = conn.execute(
            "SELECT teacher_id FROM quiz_sessions WHERE id = %s", (session_id,)
        ).fetchone()
        if not owner:
            raise NotFound(description="Session not found.")
        if owner[0] != teacher_id:
            raise Forbidden(description="Not your session.")

        rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()

    pending = graded = manual = 0
    models: dict[str, int] = {}
    for row in rows:
        for answer in ensure_list(row[4]):
            if _answer_type(answer) != 'open':
                continue
            if answer.get('manual_override'):
                manual += 1
                continue
            if answer.get('llm_status') == 'pending':
                pending += 1
            else:
                graded += 1
                used = answer.get('llm_model')
                if used:
                    models[used] = models.get(used, 0) + 1

    return {
        'pending': pending,
        'graded': graded,
        'manual_override': manual,
        # Most-used first: the panel preselects it, so a regrade defaults to
        # the model the existing evaluations were produced with.
        'models_in_use': [m for m, _ in sorted(models.items(), key=lambda kv: -kv[1])],
    }
