"""
Teacher-scoped endpoints. Every handler resolves teacher_id = g.current_user['sub'].

Snapshots:
    GET    /api/teacher/snapshots
    POST   /api/teacher/snapshots
    GET    /api/teacher/snapshots/<id>
    PUT    /api/teacher/snapshots/<id>
    DELETE /api/teacher/snapshots/<id>
    GET    /api/teacher/snapshots/<id>/export
    POST   /api/teacher/snapshots/<id>/rename
    POST   /api/teacher/snapshots/<id>/images
    GET    /api/teacher/snapshots/<id>/images
    DELETE /api/teacher/snapshots/<id>/images/<filename>
    POST   /api/teacher/snapshots/<id>/images/clear

Classes:
    GET    /api/teacher/classes
    GET    /api/teacher/classes/<id>/students
    POST   /api/teacher/classes                 (a class of the teacher's own)
    GET    /api/teacher/history[/<id>]          (anonymous history; ?answers=1 to export)
    DELETE /api/teacher/history/<id>
    PATCH  /api/teacher/classes/<id>            (name, archived)
    DELETE /api/teacher/classes/<id>            (only while no session uses it)
    POST   /api/teacher/classes/<id>/students   (manual classes: add by email)
    DELETE /api/teacher/classes/<id>/students/<student_id>
    GET    /api/teacher/classroom/courses
    POST   /api/teacher/classroom/sync

Sessions:
    GET    /api/teacher/live                    (dashboard: progress of active sessions)
    GET    /api/teacher/sessions
    POST   /api/teacher/sessions
    PATCH  /api/teacher/sessions/<id>           (title, quiz, classes, schedule)
    POST   /api/teacher/sessions/<id>/results/publish   (and /unpublish)
    POST   /api/teacher/sessions/<id>/results/email     (the link, from the teacher's Gmail)
    GET    /api/teacher/sessions/<id>/events            (publication, withdrawal, e-mails)
    POST   /api/teacher/sessions/<id>/activate
    POST   /api/teacher/sessions/<id>/close
    POST   /api/teacher/sessions/<id>/regen-code
    DELETE /api/teacher/sessions/<id>

Scores:
    GET    /api/teacher/sessions/<id>/scores
    POST   /api/teacher/sessions/<id>/scores/recalculate
    POST   /api/teacher/sessions/<id>/scores/review
    POST   /api/teacher/sessions/<id>/archive
    POST   /api/teacher/sessions/<id>/scores/regrade-open

Archives:
    GET    /api/teacher/archives
    GET    /api/teacher/archives/<id>
    GET    /api/teacher/archives/<id>/export
    DELETE /api/teacher/archives/<id>
    POST   /api/teacher/archives/<id>/rename

Student list snapshots:
    GET    /api/teacher/student-snapshots
    POST   /api/teacher/student-snapshots
    GET    /api/teacher/student-snapshots/<id>
    DELETE /api/teacher/student-snapshots/<id>

Misc:
    GET    /api/teacher/llm-info
"""

from __future__ import annotations

import json
import os

from flask import Blueprint, Response, g, jsonify, request
from werkzeug.exceptions import BadRequest, Conflict, Forbidden, NotFound

import db
from db import queries as Q
from auth.decorators import require_teacher
from services import archives as archive_service
from services import classes as class_service
from services import images as img_service
from services import quiz_session as qs_service
from services import session_scores as ss_service
from services import snapshots as snap_service
from services import teacher_llm_settings
from services import student_snapshots as sls_service
from services.classroom_sync import list_courses_for_teacher, sync_courses_for_teacher
from services.grading import format_detailed_answers, grade
from services import llm_jobs as llm_jobs_service
from services.llm_jobs import enqueue_regrade_session, get_job_for_teacher, get_latest_job_for_session
from services import score_transforms
from services.session_scores import assert_session_owner as _assert_session_owner

teacher_bp = Blueprint('teacher', __name__, url_prefix='/api/teacher')


# ── helpers ───────────────────────────────────────────────────────────────────

def _teacher_id() -> int:
    return int(g.current_user['sub'])


# Services raise werkzeug exceptions; render them as the JSON error shape the
# frontend expects (apiFetch reads body.error || body.description).

@teacher_bp.errorhandler(NotFound)
def _json_not_found(e):
    return jsonify({'error': 'NOT_FOUND', 'description': e.description}), 404


@teacher_bp.errorhandler(Forbidden)
def _json_forbidden(e):
    return jsonify({'error': 'FORBIDDEN', 'description': e.description}), 403


# These two carry a message for the teacher, so it goes in 'error', the field
# apiFetch shows; the machine-readable reason is in 'code'.
@teacher_bp.errorhandler(BadRequest)
def _json_bad_request(e):
    return jsonify({'error': e.description, 'code': 'BAD_REQUEST'}), 400


@teacher_bp.errorhandler(qs_service.EditRefused)
def _json_edit_refused(e):
    return jsonify({'error': e.description, 'code': e.reason, 'description': e.description}), 409


@teacher_bp.errorhandler(Conflict)
def _json_conflict(e):
    return jsonify({'error': 'CONFLICT', 'description': e.description}), 409


# ── snapshots ─────────────────────────────────────────────────────────────────

@teacher_bp.get('/snapshots')
@require_teacher
def list_snapshots():
    snaps = snap_service.list_snapshots(_teacher_id())
    return jsonify(snaps), 200


@teacher_bp.post('/snapshots')
@require_teacher
def create_snapshot():
    data = request.get_json(silent=True) or {}
    raw_jsonc = data.get('jsonc') or ''
    title_override = data.get('title')
    if not raw_jsonc:
        # Also accept multipart (file upload)
        f = request.files.get('file')
        if f:
            raw_jsonc = f.read().decode('utf-8', errors='replace')
    if not raw_jsonc:
        return jsonify({'error': 'MISSING_JSONC'}), 400
    snap = snap_service.import_jsonc(_teacher_id(), raw_jsonc, title_override)
    return jsonify(snap), 201


@teacher_bp.post('/snapshots/<int:snapshot_id>/duplicate')
@require_teacher
def duplicate_snapshot(snapshot_id: int):
    return jsonify(snap_service.duplicate_snapshot(snapshot_id, _teacher_id())), 201


@teacher_bp.get('/snapshots/<int:snapshot_id>')
@require_teacher
def get_snapshot(snapshot_id: int):
    snap = snap_service.get_snapshot(snapshot_id, _teacher_id())
    return jsonify(snap), 200


@teacher_bp.put('/snapshots/<int:snapshot_id>')
@require_teacher
def update_snapshot(snapshot_id: int):
    data = request.get_json(silent=True) or {}
    raw_jsonc = data.get('jsonc')
    title = data.get('title')
    result = snap_service.update_snapshot(snapshot_id, _teacher_id(), raw_jsonc, title)
    return jsonify(result), 200


@teacher_bp.delete('/snapshots/<int:snapshot_id>')
@require_teacher
def delete_snapshot(snapshot_id: int):
    snap_service.delete_snapshot(snapshot_id, _teacher_id())
    return jsonify({'ok': True}), 200


@teacher_bp.get('/snapshots/<int:snapshot_id>/export')
@require_teacher
def export_snapshot(snapshot_id: int):
    jsonc_text = snap_service.export_jsonc(snapshot_id, _teacher_id())
    with db.get_conn() as conn:
        row = conn.execute(
            "SELECT slug FROM question_snapshots WHERE id = %s AND teacher_id = %s",
            (snapshot_id, _teacher_id()),
        ).fetchone()
    filename = f"{row[0] if row else snapshot_id}.jsonc"
    return Response(
        jsonc_text,
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@teacher_bp.post('/snapshots/<int:snapshot_id>/rename')
@require_teacher
def rename_snapshot(snapshot_id: int):
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'MISSING_TITLE'}), 400
    result = snap_service.update_snapshot(snapshot_id, _teacher_id(), title=title)
    return jsonify(result), 200


# ── snapshot images ───────────────────────────────────────────────────────────

@teacher_bp.post('/snapshots/<int:snapshot_id>/images')
@require_teacher
def upload_image(snapshot_id: int):
    f = request.files.get('file')
    if not f:
        return jsonify({'error': 'MISSING_FILE'}), 400
    entry = img_service.upload_image(_teacher_id(), snapshot_id, f, f.filename or 'image')
    entry['url'] = img_service.image_url(_teacher_id(), snapshot_id, entry['filename'])
    return jsonify(entry), 201


@teacher_bp.get('/snapshots/<int:snapshot_id>/images')
@require_teacher
def list_images(snapshot_id: int):
    images = img_service.list_images(_teacher_id(), snapshot_id)
    for img in images:
        img['url'] = img_service.image_url(_teacher_id(), snapshot_id, img['filename'])
    return jsonify(images), 200


@teacher_bp.delete('/snapshots/<int:snapshot_id>/images/<path:filename>')
@require_teacher
def delete_image(snapshot_id: int, filename: str):
    img_service.delete_image(_teacher_id(), snapshot_id, filename)
    return jsonify({'ok': True}), 200


@teacher_bp.post('/snapshots/<int:snapshot_id>/images/clear')
@require_teacher
def clear_images(snapshot_id: int):
    deleted = img_service.clear_snapshot_images(_teacher_id(), snapshot_id)
    return jsonify({'deleted': deleted}), 200


# ── classes ───────────────────────────────────────────────────────────────────

@teacher_bp.get('/classes')
@require_teacher
def list_classes():
    """The teacher's classes; archived ones only with ?archived=1."""
    include = request.args.get('archived') in ('1', 'true')
    return jsonify(class_service.list_classes_for_teacher(_teacher_id(), include_archived=include)), 200


@teacher_bp.post('/classes')
@require_teacher
def create_class():
    data = request.get_json(silent=True) or {}
    result = class_service.create_class(_teacher_id(), data.get('name'), data.get('academic_year'),
                                        data.get('emails'))
    return jsonify(result), 201


@teacher_bp.patch('/classes/<int:class_id>')
@require_teacher
def update_class(class_id: int):
    data = request.get_json(silent=True) or {}
    changes = {k: data[k] for k in ('name', 'archived') if k in data}
    return jsonify(class_service.update_class(_teacher_id(), class_id, changes)), 200


@teacher_bp.delete('/classes/<int:class_id>')
@require_teacher
def delete_class(class_id: int):
    return jsonify(class_service.delete_class(_teacher_id(), class_id)), 200


@teacher_bp.post('/classes/<int:class_id>/students')
@require_teacher
def add_class_students(class_id: int):
    data = request.get_json(silent=True) or {}
    return jsonify(class_service.add_students(_teacher_id(), class_id, data.get('emails'))), 200


@teacher_bp.delete('/classes/<int:class_id>/students/<int:student_id>')
@require_teacher
def remove_class_student(class_id: int, student_id: int):
    return jsonify(class_service.remove_student(_teacher_id(), class_id, student_id)), 200


@teacher_bp.get('/classes/<int:class_id>/students')
@require_teacher
def list_class_students(class_id: int):
    return jsonify(class_service.list_students_for_class(_teacher_id(), class_id)), 200


@teacher_bp.get('/classroom/courses')
@require_teacher
def list_classroom_courses():
    courses = list_courses_for_teacher(g.current_user.get('email') or '')
    return jsonify(courses), 200


@teacher_bp.post('/classroom/sync')
@require_teacher
def sync_classroom_courses():
    data = request.get_json(silent=True) or {}
    course_ids = data.get('course_ids')
    if course_ids is not None and not isinstance(course_ids, list):
        return jsonify({'error': 'INVALID_COURSE_IDS'}), 400
    result = sync_courses_for_teacher(
        _teacher_id(),
        g.current_user.get('email') or '',
        course_ids=[str(course_id) for course_id in course_ids] if course_ids else None,
    )
    return jsonify(result), 200


# ── anonymous history ─────────────────────────────────────────────────────────

@teacher_bp.get('/history')
@require_teacher
def list_history():
    """The anonymous history of the teacher's quizzes (services/history.py)."""
    from services import history
    with db.get_conn() as conn:
        return jsonify(history.list_for_teacher(conn, _teacher_id())), 200


@teacher_bp.get('/history/<int:quiz_id>')
@require_teacher
def get_history(quiz_id: int):
    """Per-question statistics; ?answers=1 adds every anonymous answer (export)."""
    from services import history
    with db.get_conn() as conn:
        detail = history.detail_for_teacher(conn, _teacher_id(), quiz_id,
                                            with_answers=request.args.get('answers') in ('1', 'true'))
    if detail is None:
        raise NotFound(description="Storico non trovato.")
    return jsonify(detail), 200


@teacher_bp.delete('/history/<int:quiz_id>')
@require_teacher
def delete_history(quiz_id: int):
    with db.get_conn() as conn:
        deleted = conn.execute(Q.DELETE_HISTORY_QUIZ, (quiz_id, _teacher_id())).rowcount
        conn.commit()
    if not deleted:
        raise NotFound(description="Storico non trovato.")
    return jsonify({'ok': True}), 200


# ── sessions ──────────────────────────────────────────────────────────────────

@teacher_bp.get('/sessions')
@require_teacher
def list_sessions():
    sessions = ss_service.list_sessions_for_teacher(_teacher_id(), request.args.get('status'))
    return jsonify(sessions), 200


@teacher_bp.get('/live')
@require_teacher
def live():
    """Dashboard: who handed in, is working or has not started, per active session."""
    return jsonify(ss_service.live_progress(_teacher_id())), 200


@teacher_bp.get('/sessions/<int:session_id>')
@require_teacher
def get_session(session_id: int):
    return jsonify(ss_service.get_session_for_teacher(_teacher_id(), session_id)), 200


@teacher_bp.post('/sessions')
@require_teacher
def create_session():
    data = request.get_json(silent=True) or {}
    try:
        snapshot_id = int(data.get('snapshot_id') or '')
    except (TypeError, ValueError):
        return jsonify({'error': 'INVALID_SNAPSHOT_ID'}), 400
    class_ids = data.get('class_ids', [])
    title = data.get('title')
    opens_at = data.get('opens_at')
    closes_at = data.get('closes_at')

    if not snapshot_id:
        return jsonify({'error': 'MISSING_SNAPSHOT_ID'}), 400
    if not isinstance(class_ids, list):
        return jsonify({'error': 'INVALID_CLASS_IDS'}), 400
    if not class_ids:
        return jsonify({'error': 'MISSING_CLASS_IDS'}), 400

    teacher_id = _teacher_id()

    # Verify snapshot ownership
    with db.get_conn() as conn:
        snap_row = conn.execute(
            "SELECT title FROM question_snapshots WHERE id = %s AND teacher_id = %s",
            (snapshot_id, teacher_id),
        ).fetchone()
    if not snap_row:
        return jsonify({'error': 'SNAPSHOT_NOT_FOUND'}), 404

    opens_at = qs_service.parse_schedule(opens_at, 'Apertura')
    closes_at = qs_service.parse_schedule(closes_at, 'Chiusura')
    qs_service.check_schedule(opens_at, closes_at)

    session_title = title or snap_row[0]
    result = qs_service.create_session(
        teacher_id=teacher_id,
        snapshot_id=snapshot_id,
        title=session_title,
        class_ids=class_ids,
        opens_at=opens_at,
        closes_at=closes_at,
    )
    return jsonify(result), 201


@teacher_bp.patch('/sessions/<int:session_id>')
@require_teacher
def edit_session(session_id: int):
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({'error': 'INVALID_BODY'}), 400
    allowed = {'title', 'snapshot_id', 'class_ids', 'opens_at', 'closes_at'}
    qs_service.edit_session(session_id, _teacher_id(), {k: v for k, v in data.items() if k in allowed})
    return jsonify(ss_service.get_session_for_teacher(_teacher_id(), session_id)), 200


@teacher_bp.post('/sessions/<int:session_id>/results/publish')
@require_teacher
def publish_results(session_id: int):
    """Make a closed session's results visible to its students."""
    from services import student_results
    data = request.get_json(silent=True) or {}
    return jsonify(student_results.set_publication(
        session_id, _teacher_id(), published=True, show_correct=bool(data.get('show_correct')),
        show_acceptable=bool(data.get('show_acceptable')))), 200


def _public_base_url() -> str:
    """The address students open: PUBLIC_BASE_URL, else what the proxy says."""
    configured = os.environ.get('PUBLIC_BASE_URL', '').strip().rstrip('/')
    if configured:
        return configured
    scheme = request.headers.get('X-Forwarded-Proto') or request.scheme
    return f"{scheme}://{request.host}"


@teacher_bp.post('/sessions/<int:session_id>/results/email')
@require_teacher
def email_results_link(session_id: int):
    """Send each student who handed in the link to their results, from the teacher's Gmail.

    Only once published: the link would otherwise open onto nothing. The
    message holds no score or answer (email_service.results_message).
    """
    import email_service
    with db.get_conn() as conn:
        ctx = conn.execute(Q.RESULTS_EMAIL_CONTEXT, (session_id, _teacher_id())).fetchone()
        if not ctx:
            raise NotFound(description="Session not found.")
        title, published_at, teacher_email, teacher_name = ctx
        if not published_at:
            raise qs_service.EditRefused('RESULTS_NOT_PUBLISHED',
                                         "Pubblica i risultati prima di mandare il link.")
        recipients = [r[0] for r in conn.execute(Q.RESULTS_EMAIL_RECIPIENTS, (session_id,)).fetchall()]

    try:
        service = email_service.gmail_service(teacher_email)
    except email_service.EmailNotAvailable as exc:
        return jsonify({'error': str(exc), 'code': exc.code}), 503

    link = f"{_public_base_url()}/risultati/{session_id}"
    sent, errors = 0, []
    for student_email in recipients:
        try:
            email_service.send(service, email_service.results_message(
                teacher_name=teacher_name, teacher_email=teacher_email,
                student_email=student_email, title=title, link=link))
            sent += 1
        except Exception as exc:   # one bad address must not stop the class
            errors.append({'email': student_email, 'error': str(exc)[:300]})

    from services.student_results import record_event
    with db.get_conn() as conn:
        if sent:
            conn.execute(Q.MARK_RESULTS_EMAILED, (sent, session_id))
        # Who did not get it is worth keeping; who did is the class list.
        record_event(conn, session_id, _teacher_id(), 'results_emailed',
                     {'sent': sent, 'failed': [e['email'] for e in errors]})
        conn.commit()
    return jsonify({'sent': sent, 'errors': errors, 'link': link}), 200


@teacher_bp.post('/sessions/<int:session_id>/results/unpublish')
@require_teacher
def unpublish_results(session_id: int):
    from services import student_results
    return jsonify(student_results.set_publication(session_id, _teacher_id(), published=False)), 200


@teacher_bp.post('/sessions/<int:session_id>/activate')
@require_teacher
def activate_session(session_id: int):
    join_code = qs_service.activate_session(session_id, _teacher_id())
    return jsonify({'join_code': join_code}), 200


@teacher_bp.post('/sessions/<int:session_id>/close')
@require_teacher
def close_session(session_id: int):
    qs_service.close_session(session_id, _teacher_id())
    return jsonify({'ok': True}), 200


@teacher_bp.post('/sessions/<int:session_id>/reopen')
@require_teacher
def reopen_session(session_id: int):
    join_code = qs_service.reopen_session(session_id, _teacher_id())
    return jsonify({'join_code': join_code}), 200


@teacher_bp.post('/sessions/<int:session_id>/regen-code')
@require_teacher
def regen_join_code(session_id: int):
    code = qs_service.regenerate_join_code(session_id, _teacher_id())
    return jsonify({'join_code': code}), 200


@teacher_bp.delete('/sessions/<int:session_id>')
@require_teacher
def delete_session(session_id: int):
    try:
        ss_service.delete_draft_session(_teacher_id(), session_id)
    except Conflict:
        return jsonify({'error': 'SESSION_NOT_DRAFT'}), 409
    return jsonify({'ok': True}), 200


# ── scores ────────────────────────────────────────────────────────────────────

@teacher_bp.get('/sessions/<int:session_id>/scores')
@require_teacher
def session_scores(session_id: int):
    return jsonify(ss_service.list_session_scores(_teacher_id(), session_id)), 200


MAX_FEEDBACK_CHARS = 4000


@teacher_bp.post('/sessions/<int:session_id>/scores/review')
@require_teacher
def review_scores(session_id: int):
    """Apply per-question point overrides to score entries."""
    data = request.get_json(silent=True) or {}
    overrides = data.get('overrides', [])
    teacher_id = _teacher_id()

    # Build lookups: {score_entry_id -> {question_id -> new_points}} and
    # {score_entry_id -> {question_id -> motivation or None}}.
    overrides_by_id: dict[int, dict[str, float]] = {}
    feedback_by_id: dict[int, dict[str, str | None]] = {}
    for o in overrides:
        sid = o.get('score_id')
        if sid is None:
            continue
        overrides_by_id[int(sid)] = {str(k): float(v) for k, v in o.get('per_question', {}).items()}
        feedback = {}
        for k, v in (o.get('feedback') or {}).items():
            if not isinstance(v, str):
                return jsonify({'error': 'La motivazione deve essere un testo.', 'code': 'BAD_REQUEST'}), 400
            if len(v) > MAX_FEEDBACK_CHARS:
                return jsonify({'error': f'La motivazione supera i {MAX_FEEDBACK_CHARS} caratteri.',
                                'code': 'BAD_REQUEST'}), 400
            feedback[str(k)] = v.strip() or None
        if feedback:
            feedback_by_id[int(sid)] = feedback

    def _review_fn(score_id: int, answers: list[dict], _qbank_map: dict) -> list[dict] | None:
        per_q = overrides_by_id.get(score_id) or {}
        per_fb = feedback_by_id.get(score_id) or {}
        if not per_q and not per_fb:
            return None
        for ans in answers:
            q_id = str(ans.get('question_id'))
            if q_id not in per_q and q_id not in per_fb:
                continue
            # A reviewed answer is the teacher's: points and motivation alike
            # are then left alone by automatic regrades.
            if not ans.get('manual_override') and ans.get('original_points_awarded') is None:
                ans['original_points_awarded'] = ans.get('points_awarded')
            if q_id in per_q:
                ans['points_awarded'] = ans['raw_points'] = per_q[q_id]
            if q_id in per_fb:
                # What the student reads; the model's llm_feedback is kept.
                ans['teacher_feedback'] = per_fb[q_id]
            ans['manual_override'] = True
            # Only points make a pending answer graded: a motivation alone
            # must not turn it into a graded zero.
            if q_id in per_q and ans.get('type') == 'open':
                ans['llm_status'] = 'graded'
        return answers

    updated = score_transforms.transform_scores(
        session_id, teacher_id,
        entry_ids=list(overrides_by_id.keys()),
        transform_fn=_review_fn,
        reason='manual_review',
    )
    return jsonify({'ok': True, 'updated': updated}), 200


@teacher_bp.post('/sessions/<int:session_id>/scores/recalculate')
@require_teacher
def recalculate_scores(session_id: int):
    """Re-grade all score entries for a session against the current snapshot."""
    teacher_id = _teacher_id()

    def _recalc_fn(_score_id: int, answers: list[dict], qbank_map: dict) -> list[dict] | None:
        """Rescore closed questions against the current snapshot.

        Open answers and manually overridden answers are carried over
        untouched: recalculate refreshes what can be derived from the snapshot,
        it never discards an LLM evaluation or a teacher's correction. Since
        grade() always defers open questions, this makes no LLM calls.
        """
        plan_steps = [
            {'id': str(a['question_id']), 'option_order': a.get('option_order', [])}
            for a in answers
        ]
        raw_answers = [a.get('raw_student_answer') for a in answers]
        questions_list = list(qbank_map.values())
        result = grade(raw_answers, {'plan': plan_steps}, {'questions': questions_list})
        rebuilt = format_detailed_answers(
            {'plan': plan_steps}, qbank_map, raw_answers,
            result['scores_per_question'],
            result['feedbacks_per_question'],
            result['verdicts_per_question'],
            result['statuses_per_question'],
            result['errors_per_question'],
        )

        merged: list[dict] = []
        for idx, new_a in enumerate(rebuilt):
            old_a = answers[idx] if idx < len(answers) else None
            if old_a is None:
                merged.append(new_a)
                continue
            if old_a.get('type') == 'open' or old_a.get('manual_override'):
                merged.append(dict(old_a))
                continue
            # Freshly formatted answers carry no revision; keep the stored one
            # so the diff-and-bump seam sees the real before/after.
            new_a['answer_revision'] = old_a.get('answer_revision', 0)
            merged.append(new_a)
        return merged

    updated = score_transforms.transform_scores(
        session_id, teacher_id, transform_fn=_recalc_fn,
    )
    return jsonify({'updated': updated}), 200


@teacher_bp.post('/sessions/<int:session_id>/archive')
@require_teacher
def archive_session_scores(session_id: int):
    """Snapshot current score entries into score_archives."""
    data = request.get_json(silent=True) or {}
    result = ss_service.archive_session_scores(
        _teacher_id(), session_id,
        title=data.get('title'),
        notes=data.get('notes'),
    )
    return jsonify(result), 201


@teacher_bp.get('/sessions/<int:session_id>/regrade-preview')
@require_teacher
def regrade_preview(session_id: int):
    """Counts the regrade panel warns with, before anything is queued."""
    return jsonify(llm_jobs_service.regrade_preview(session_id, _teacher_id())), 200


@teacher_bp.post('/sessions/<int:session_id>/scores/regrade-open')
@require_teacher
def regrade_open_questions(session_id: int):
    """Queue open-question regrading without blocking on the LLM provider.

    `scope` and `force_override_manual` are stored on the job, so the worker
    applies what was requested at enqueue time rather than whatever the
    configuration says when it eventually runs.
    """
    data = request.get_json(silent=True) or {}
    job = enqueue_regrade_session(
        session_id,
        _teacher_id(),
        scope=data.get('scope', 'all'),
        force_override_manual=bool(data.get('force_override_manual', False)),
        model=data.get('model') or None,
    )
    return jsonify(job), 202


# ── score history & revert ───────────────────────────────────────────────────

@teacher_bp.get('/sessions/<int:session_id>/score-history')
@require_teacher
def get_score_history(session_id: int):
    teacher_id = _teacher_id()
    with db.get_conn() as conn:
        _assert_session_owner(conn, session_id, teacher_id)
        rows = conn.execute(Q.LIST_SCORE_HISTORY, (session_id,)).fetchall()
    return jsonify([{
        'id': str(r[0]),
        'reason': r[1],
        'actor_type': r[2],
        'changed_by': r[3],
        'llm_job_id': r[4],
        'reverted_change_id': str(r[5]) if r[5] else None,
        'created_at': r[6].isoformat() if r[6] else None,
        'changed_answers': r[7],
        'actor_name': r[8],
    } for r in rows]), 200


@teacher_bp.get('/sessions/<int:session_id>/events')
@require_teacher
def get_session_events(session_id: int):
    """Publication, withdrawal and link e-mails: the history beyond scores."""
    teacher_id = _teacher_id()
    with db.get_conn() as conn:
        _assert_session_owner(conn, session_id, teacher_id)
        rows = conn.execute(Q.LIST_SESSION_EVENTS, (session_id,)).fetchall()
    return jsonify([{'id': r[0], 'kind': r[1], 'details': r[2], 'created_at': r[3].isoformat(),
                     'actor_name': r[4]} for r in rows]), 200


@teacher_bp.post('/sessions/<int:session_id>/score-history/<change_set_id>/revert')
@require_teacher
def revert_change_set(session_id: int, change_set_id: str):
    """Atomically revert a change set.

    Uses FOR UPDATE + answer_revision for conflict detection.
    If any answer was modified since the change set, returns 409.
    """
    import json as _json
    teacher_id = _teacher_id()

    with db.get_conn() as conn:
        _assert_session_owner(conn, session_id, teacher_id)

        # 1. Verify change set exists and belongs to this session
        cs = conn.execute(Q.GET_CHANGE_SET, (change_set_id, session_id)).fetchone()
        if not cs:
            raise NotFound(description="Change set non trovato.")

        if cs[2] == 'submission':
            return jsonify({
                'error': 'BAD_REQUEST',
                'description': "Il change set di consegna non è annullabile.",
            }), 400

        already = conn.execute(Q.FIND_REVERT_OF_CHANGE_SET, (change_set_id,)).fetchone()
        if already:
            raise Conflict(
                description=(
                    "Questo change set è già stato annullato. "
                    "Per ripristinarlo annulla il change set di annullamento."
                )
            )

        # 2. Load all entries from the change set
        entries = conn.execute(Q.GET_CHANGE_SET_ENTRIES, (change_set_id,)).fetchall()
        if not entries:
            raise NotFound(description="Nessuna risposta da ripristinare in questo change set.")

        # 3. Lock and verify: collect score_entry_ids, lock them, check revisions
        score_ids = list({e[0] for e in entries})
        locked_rows = {}
        for sid in score_ids:
            row = conn.execute(
                "SELECT id, answers, raw_points, max_points, percent FROM score_entries WHERE id = %s FOR UPDATE",
                (sid,),
            ).fetchone()
            if not row:
                raise NotFound(description=f"Score entry {sid} non trovato.")
            answers = _json.loads(row[1]) if isinstance(row[1], str) else row[1]
            locked_rows[sid] = {
                'answers': answers,
                'raw_points': float(row[2]),
                'max_points': float(row[3]),
                'percent': float(row[4]),
            }

        # 4. Check revision match for every entry; build reverted answers
        revert_map: dict[int, list[dict]] = {}
        for e in entries:
            sid = e[0]
            q_id = e[1]
            # Column order: 0 score_entry_id, 1 question_id, 2 answer_index,
            # 3 old_revision, 4 new_revision, 5 old_answer, 6 new_answer.
            hist_new_rev = e[4]
            old_answer = e[5] if isinstance(e[5], dict) else _json.loads(e[5])

            current_answers = locked_rows[sid]['answers']
            # Find the matching answer by question_id
            found = False
            for cur_a in current_answers:
                if str(cur_a.get('question_id')) == q_id:
                    cur_rev = cur_a.get('answer_revision', 0)
                    if cur_rev != hist_new_rev:
                        raise Conflict(
                            description=f"Conflitto: la risposta {q_id} è stata modificata dopo il change set."
                        )
                    found = True
                    break
            if not found:
                # Answer may have been removed — allow revert to restore it
                pass

            if sid not in revert_map:
                revert_map[sid] = [dict(a) for a in current_answers]

            # Restore the old content but keep the revision counter where it is:
            # record_answer_changes() advances it to current + 1, so a revert
            # moves the audit chain forward and never rewinds a revision.
            restored = dict(old_answer)
            restored['answer_revision'] = hist_new_rev

            replaced = False
            for idx, cur_a in enumerate(revert_map[sid]):
                if str(cur_a.get('question_id')) == q_id:
                    revert_map[sid][idx] = restored
                    replaced = True
                    break
            if not replaced:
                # Question not in current array — append it
                revert_map[sid].append(restored)

        # 5. Update all modified score entries and record new change set
        from services.score_transforms import open_change_set, record_answer_changes
        revert_cs_id = open_change_set(
            conn,
            session_id=session_id,
            reason='revert',
            actor_type='teacher',
            changed_by=teacher_id,
            reverted_change_id=change_set_id,
        )

        for sid, new_answers in revert_map.items():
            old_data = locked_rows[sid]
            old_answers = old_data['answers']
            new_raw = round(sum(a.get('points_awarded', 0) for a in new_answers), 2)
            new_max = round(sum(a.get('weight', 0) for a in new_answers), 2)
            new_pct = round(new_raw / new_max * 100, 2) if new_max else 0

            # Assigns the restored answers' new revisions — before serialising.
            record_answer_changes(
                conn,
                change_set_id=revert_cs_id,
                score_entry_id=sid,
                old_answers=old_answers,
                new_answers=new_answers,
                old_percent=old_data['percent'],
                new_percent=new_pct,
            )
            conn.execute(Q.UPDATE_SCORE_ANSWERS, {
                'answers': _json.dumps(new_answers),
                'raw_points': new_raw,
                'max_points': new_max,
                'percent': new_pct,
                'id': sid,
                'teacher_id': teacher_id,
            })

        conn.commit()

    return jsonify({'ok': True, 'revert_change_set_id': revert_cs_id}), 200


@teacher_bp.get('/llm-jobs/<int:job_id>')
@require_teacher
def get_llm_job(job_id: int):
    job = get_job_for_teacher(job_id, _teacher_id())
    if not job:
        return jsonify({'error': 'NOT_FOUND'}), 404
    return jsonify(job), 200


@teacher_bp.get('/sessions/<int:session_id>/llm-jobs/latest')
@require_teacher
def latest_llm_job(session_id: int):
    with db.get_conn() as conn:
        _assert_session_owner(conn, session_id, _teacher_id())
    job = get_latest_job_for_session(session_id, _teacher_id())
    if not job:
        return jsonify({'job': None}), 200
    return jsonify(job), 200


# ── archives ──────────────────────────────────────────────────────────────────

@teacher_bp.get('/archives')
@require_teacher
def list_archives():
    return jsonify(archive_service.list_archives(_teacher_id())), 200


@teacher_bp.get('/archives/<int:archive_id>')
@require_teacher
def get_archive(archive_id: int):
    return jsonify(archive_service.get_archive(_teacher_id(), archive_id)), 200


@teacher_bp.get('/archives/<int:archive_id>/export')
@require_teacher
def export_archive(archive_id: int):
    filename, payload = archive_service.export_archive(_teacher_id(), archive_id)
    return Response(
        payload,
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@teacher_bp.delete('/archives/<int:archive_id>')
@require_teacher
def delete_archive(archive_id: int):
    archive_service.delete_archive(_teacher_id(), archive_id)
    return jsonify({'ok': True}), 200


@teacher_bp.post('/archives/<int:archive_id>/rename')
@require_teacher
def rename_archive(archive_id: int):
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'MISSING_TITLE'}), 400
    archive_service.rename_archive(_teacher_id(), archive_id, title)
    return jsonify({'ok': True}), 200


# ── student list snapshots ─────────────────────────────────────────────────────

@teacher_bp.get('/student-snapshots')
@require_teacher
def list_student_snapshots():
    return jsonify(sls_service.list_student_snapshots(_teacher_id())), 200


@teacher_bp.post('/student-snapshots')
@require_teacher
def create_student_snapshot():
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    content = data.get('content', [])
    if not title:
        return jsonify({'error': 'MISSING_TITLE'}), 400
    result = sls_service.create_student_snapshot(_teacher_id(), title, content)
    return jsonify(result), 201


@teacher_bp.get('/student-snapshots/<int:snapshot_id>')
@require_teacher
def get_student_snapshot(snapshot_id: int):
    return jsonify(sls_service.get_student_snapshot(_teacher_id(), snapshot_id)), 200


@teacher_bp.delete('/student-snapshots/<int:snapshot_id>')
@require_teacher
def delete_student_snapshot(snapshot_id: int):
    sls_service.delete_student_snapshot(_teacher_id(), snapshot_id)
    return jsonify({'ok': True}), 200


@teacher_bp.post('/student-snapshots/<int:snapshot_id>/rename')
@require_teacher
def rename_student_snapshot(snapshot_id: int):
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'MISSING_TITLE'}), 400
    sls_service.rename_student_snapshot(_teacher_id(), snapshot_id, title)
    return jsonify({'ok': True}), 200


@teacher_bp.get('/student-snapshots/<int:snapshot_id>/export')
@require_teacher
def export_student_snapshot(snapshot_id: int):
    filename, payload = sls_service.export_student_snapshot(_teacher_id(), snapshot_id)
    return Response(
        payload,
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


# ── teacher LLM settings ──────────────────────────────────────────────────────
#
# A teacher configures their own endpoint, model and API key. Reads never
# return the key: only whether one is set, and a fingerprint identifying which.

@teacher_bp.get('/llm-settings')
@require_teacher
def get_llm_settings():
    return jsonify(teacher_llm_settings.get_settings(_teacher_id())), 200


@teacher_bp.put('/llm-settings')
@require_teacher
def update_llm_settings():
    data = request.get_json(silent=True) or {}
    return jsonify(teacher_llm_settings.update_settings(_teacher_id(), data)), 200


# A teacher's key is stored per whitelisted endpoint and is the only key ever
# sent there on their behalf. Write-only: responses report status, never keys.
@teacher_bp.put('/llm-settings/endpoints/<int:endpoint_id>/key')
@require_teacher
def set_llm_key(endpoint_id: int):
    data = request.get_json(silent=True) or {}
    return jsonify(teacher_llm_settings.set_key(
        _teacher_id(), endpoint_id, data.get('api_key', ''))), 200


@teacher_bp.delete('/llm-settings/endpoints/<int:endpoint_id>/key')
@require_teacher
def clear_llm_key(endpoint_id: int):
    return jsonify(teacher_llm_settings.clear_key(_teacher_id(), endpoint_id)), 200


# ── misc ──────────────────────────────────────────────────────────────────────

@teacher_bp.get('/llm-info')
@require_teacher
def llm_info():
    """Where and with which model *this teacher's* open answers are graded.

    Reports disabled unless grading would actually run for them — an endpoint
    resolves and they hold a key for it — and says whether the key is what is
    missing. Never returns a key or an endpoint address.
    """
    from services.llm_config import public_llm_info

    return jsonify(public_llm_info(_teacher_id())), 200
