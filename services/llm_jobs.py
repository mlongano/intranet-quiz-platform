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

from werkzeug.exceptions import Forbidden, NotFound

import db
from db import queries as Q
from services.grading import grade_open_answer
from utils import ensure_list


def create_llm_job(
    conn,
    *,
    teacher_id: int,
    session_id: int,
    score_entry_id: int | None,
    job_type: str,
    total_items: int,
) -> dict:
    row = conn.execute(Q.INSERT_LLM_GRADING_JOB, {
        'teacher_id': teacher_id,
        'session_id': session_id,
        'score_entry_id': score_entry_id,
        'job_type': job_type,
        'total_items': total_items,
    }).fetchone()
    return _job_row_to_dict(row)


def enqueue_regrade_session(session_id: int, teacher_id: int) -> dict:
    """Create a regrade job WITHOUT modifying current evaluations.

    The worker is solely responsible for changing scores, feedback, and
    status.  Enqueuing preserves the current state so a running regrade
    never leaves answers in an inconsistent intermediate condition.
    """
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

        # Count open answers that need regrade WITHOUT modifying them
        rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()
        for row in rows:
            answers = ensure_list(row[4])
            for answer in answers:
                if _answer_type(answer) != 'open':
                    continue
                if answer.get('manual_override'):
                    continue
                total_items += 1

        if total_items > 0:
            # Concurrency: try to insert pending job; unique index rejects duplicate
            try:
                job = create_llm_job(
                    conn,
                    teacher_id=teacher_id,
                    session_id=session_id,
                    score_entry_id=None,
                    job_type='regrade_session',
                    total_items=total_items,
                )
            except Exception:
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
    try:
        score_ids = _score_ids_for_job(job)

        # Open one change set for the entire job
        from services.score_transforms import open_change_set
        with db.get_conn() as conn:
            change_set_id = open_change_set(
                conn,
                session_id=job['session_id'],
                reason='llm_regrade',
                actor_type='system',
                changed_by=job['teacher_id'],
                llm_job_id=job['id'],
            )
            conn.commit()
        job['_change_set_id'] = change_set_id

        for score_id in score_ids:
            changed = _process_next_answer_for_score(job, score_id)
            if changed:
                processed += 1
                _update_job_progress(job['id'], processed)

        with db.get_conn() as conn:
            conn.execute(Q.FINISH_LLM_GRADING_JOB, {
                'id': job['id'],
                'status': 'completed',
                'processed_items': processed,
                'error': None,
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


def worker_loop(*, poll_seconds: float = 2.0) -> None:
    print("[LLM_JOBS] Worker started.", flush=True)
    requeue_running_jobs()
    while True:
        did_work = process_next_job()
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


def _process_next_answer_for_score(job: dict, score_id: int) -> bool:
    from services.score_transforms import record_answer_changes, bump_answer_revision

    with db.get_conn() as conn:
        row = conn.execute(
            Q.GET_SCORE_ENTRY_FOR_LLM_JOB,
            (score_id, job['teacher_id'], job['session_id']),
        ).fetchone()
        if not row:
            conn.commit()
            return False
        answers = ensure_list(row[7])
        old_percent = float(row[6]) if row[6] is not None else None
        old_answers = [dict(a) for a in answers]  # deep copy for history
        changed = _process_one_pending_answer(
            answers,
            is_regrade=(job.get('job_type') == 'regrade_session')
        )
        if not changed:
            conn.commit()
            return False

        # Bump revision on every modified open answer
        for a in answers:
            if _answer_type(a) == 'open' and a.get('llm_status') in ('graded', 'fallback', 'error'):
                bump_answer_revision(a)

        raw_points, max_points, percent = _score_totals(answers)
        conn.execute(Q.UPDATE_SCORE_ANSWERS, {
            'answers': json.dumps(answers),
            'raw_points': raw_points,
            'max_points': max_points,
            'percent': percent,
            'id': score_id,
            'teacher_id': job['teacher_id'],
        })
        record_answer_changes(
            conn,
            change_set_id=job.get('_change_set_id', ''),
            score_entry_id=score_id,
            old_answers=old_answers,
            new_answers=answers,
            old_percent=old_percent,
            new_percent=percent,
        )
        conn.commit()
    return True


def _process_one_pending_answer(answers: list[dict], *, is_regrade: bool = False) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    any_changed = False

    for answer in answers:
        if _answer_type(answer) != 'open':
            continue
        # Submission jobs: only process pending answers.
        if not is_regrade and answer.get('llm_status') != 'pending':
            continue
        if answer.get('manual_override'):
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
            result = grade_open_answer(answer.get('raw_student_answer') or '', q)
            points = round(float(result.get('points', 0)), 2)
            verdict = result.get('llm_verdict')
            answer['points_awarded'] = points
            answer['raw_points'] = points
            answer['llm_feedback'] = result.get('llm_feedback')
            answer['llm_verdict'] = verdict
            answer['llm_status'] = 'fallback' if verdict == 'fallback' else 'graded'
            answer['llm_error'] = None
            answer['llm_updated_at'] = now
            any_changed = True
        except Exception as exc:
            answer['llm_status'] = 'error'
            answer['llm_error'] = str(exc)
            answer['llm_updated_at'] = now
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

    if args.command == 'worker':
        worker_loop(poll_seconds=args.poll_seconds)
    else:
        process_next_job()


if __name__ == '__main__':
    main()
