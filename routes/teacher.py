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
    GET    /api/teacher/classroom/courses
    POST   /api/teacher/classroom/sync

Sessions:
    GET    /api/teacher/sessions
    POST   /api/teacher/sessions
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
    POST   /api/teacher/email/send-result
    POST   /api/teacher/sessions/<id>/email/send-all
"""

from __future__ import annotations

import json
import os

from flask import Blueprint, Response, g, jsonify, request
from werkzeug.exceptions import Conflict, Forbidden, NotFound

import db
from db import queries as Q
from auth.decorators import require_teacher
from services import archives as archive_service
from services import classes as class_service
from services import images as img_service
from services import quiz_session as qs_service
from services import session_scores as ss_service
from services import snapshots as snap_service
from services import student_snapshots as sls_service
from services.classroom_sync import list_courses_for_teacher, sync_courses_for_teacher
from services.grading import format_detailed_answers, grade
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
    return jsonify(class_service.list_classes_for_teacher(_teacher_id())), 200


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


# ── sessions ──────────────────────────────────────────────────────────────────

@teacher_bp.get('/sessions')
@require_teacher
def list_sessions():
    sessions = ss_service.list_sessions_for_teacher(_teacher_id(), request.args.get('status'))
    return jsonify(sessions), 200


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


@teacher_bp.post('/sessions/<int:session_id>/scores/review')
@require_teacher
def review_scores(session_id: int):
    """Apply per-question point overrides to score entries."""
    data = request.get_json(silent=True) or {}
    overrides = data.get('overrides', [])
    teacher_id = _teacher_id()

    # Build lookup: {score_entry_id -> {question_id -> new_points}}
    overrides_by_id: dict[int, dict[str, float]] = {}
    for o in overrides:
        sid = o.get('score_id')
        if sid is not None:
            overrides_by_id[int(sid)] = {str(k): float(v) for k, v in o.get('per_question', {}).items()}

    def _review_fn(score_id: int, answers: list[dict], _qbank_map: dict) -> list[dict] | None:
        per_q = overrides_by_id.get(score_id)
        if not per_q:
            return None
        for ans in answers:
            q_id = str(ans.get('question_id'))
            if q_id in per_q:
                if not ans.get('manual_override') and ans.get('original_points_awarded') is None:
                    ans['original_points_awarded'] = ans.get('points_awarded')
                ans['points_awarded'] = ans['raw_points'] = per_q[q_id]
                ans['manual_override'] = True
                if ans.get('type') == 'open':
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
        plan_steps = [
            {'id': str(a['question_id']), 'option_order': a.get('option_order', [])}
            for a in answers
        ]
        raw_answers = [a.get('raw_student_answer') for a in answers]
        questions_list = list(qbank_map.values())
        result = grade(raw_answers, {'plan': plan_steps}, {'questions': questions_list})
        return format_detailed_answers(
            {'plan': plan_steps}, qbank_map, raw_answers,
            result['scores_per_question'],
            result['feedbacks_per_question'],
            result['verdicts_per_question'],
            result['statuses_per_question'],
            result['errors_per_question'],
        )

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


@teacher_bp.post('/sessions/<int:session_id>/scores/regrade-open')
@require_teacher
def regrade_open_questions(session_id: int):
    """Queue open-question regrading without blocking on the LLM provider."""
    job = enqueue_regrade_session(session_id, _teacher_id())
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
            hist_new_rev = e[4]  # new_revision from history
            old_answer = e[6] if isinstance(e[6], dict) else _json.loads(e[6])
            new_answer_snap = e[7] if isinstance(e[7], dict) else _json.loads(e[7])

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

            # Replace the answer in the array
            replaced = False
            for idx, cur_a in enumerate(revert_map[sid]):
                if str(cur_a.get('question_id')) == q_id:
                    restored = dict(old_answer)
                    from services.score_transforms import bump_answer_revision
                    bump_answer_revision(restored)
                    revert_map[sid][idx] = restored
                    replaced = True
                    break
            if not replaced:
                # Question not in current array — append it
                restored = dict(old_answer)
                from services.score_transforms import bump_answer_revision
                bump_answer_revision(restored)
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

            conn.execute(Q.UPDATE_SCORE_ANSWERS, {
                'answers': _json.dumps(new_answers),
                'raw_points': new_raw,
                'max_points': new_max,
                'percent': new_pct,
                'id': sid,
                'teacher_id': teacher_id,
            })
            record_answer_changes(
                conn,
                change_set_id=revert_cs_id,
                score_entry_id=sid,
                old_answers=old_answers,
                new_answers=new_answers,
                old_percent=old_data['percent'],
                new_percent=new_pct,
            )

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


# ── misc ──────────────────────────────────────────────────────────────────────

@teacher_bp.get('/llm-info')
@require_teacher
def llm_info():
    use_llm = os.getenv('USE_LLM_EVAL', '0') == '1'
    model = os.getenv('LLM_MODEL', '')
    return jsonify({
        'use_llm': use_llm,
        'enabled': use_llm,
        'model': model if use_llm else None,
    }), 200


@teacher_bp.post('/email/send-result')
@require_teacher
def send_result_email():
    data = request.get_json(silent=True) or {}
    score_id = data.get('score_id')
    if not score_id:
        return jsonify({'error': 'MISSING_SCORE_ID'}), 400
    custom_subject = (data.get('subject') or '').strip() or None
    include_details = bool(data.get('include_details', True))
    include_feedback = bool(data.get('include_feedback', False))
    teacher_id = _teacher_id()

    with db.get_conn() as conn:
        row = conn.execute(
            """SELECT se.raw_points, se.max_points, se.percent, se.answers,
                      se.submitted_at, s.email, s.display_name, qs.title
               FROM score_entries se
               JOIN students s ON s.id = se.student_id
               JOIN quiz_sessions qs ON qs.id = se.session_id
               WHERE se.id = %s AND se.teacher_id = %s""",
            (score_id, teacher_id),
        ).fetchone()
    if not row:
        return jsonify({'error': 'NOT_FOUND'}), 404

    try:
        from email_service import send_result_to_student  # type: ignore[import]
        teacher_email = g.current_user.get('email', '')
        answers = row[3] if isinstance(row[3], list) else json.loads(row[3] or '[]')
        ok, msg = send_result_to_student(
            student_email=row[5],
            student_name=row[6],
            quiz_title=row[7],
            score=float(row[0]),
            max_score=float(row[1]),
            percent=float(row[2]),
            answers=answers,
            teacher_email=teacher_email,
            custom_subject=custom_subject,
            include_details=include_details,
            show_admin_feedback=include_feedback,
        )
        if not ok:
            return jsonify({'error': msg}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    return jsonify({'ok': True, 'sent_to': row[5]}), 200


@teacher_bp.post('/sessions/<int:session_id>/email/send-all')
@require_teacher
def send_all_emails(session_id: int):
    data = request.get_json(silent=True) or {}
    custom_subject = (data.get('subject') or '').strip() or None
    include_details = bool(data.get('include_details', True))
    include_feedback = bool(data.get('include_feedback', False))
    teacher_id = _teacher_id()
    teacher_email = g.current_user.get('email', '')
    sent = 0
    errors = []

    with db.get_conn() as conn:
        _assert_session_owner(conn, session_id, teacher_id)
        sess_row = conn.execute(
            "SELECT title FROM quiz_sessions WHERE id = %s", (session_id,)
        ).fetchone()
        quiz_title = sess_row[0] if sess_row else ''
        score_rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()

    for r in score_rows:
        try:
            from email_service import send_result_to_student  # type: ignore[import]
            answers = r[4] if isinstance(r[4], list) else json.loads(r[4] or '[]')
            ok, msg = send_result_to_student(
                student_email=r[6],
                student_name=r[7],
                quiz_title=quiz_title,
                score=float(r[1]),
                max_score=float(r[2]),
                percent=float(r[3]),
                answers=answers,
                teacher_email=teacher_email,
                custom_subject=custom_subject,
                include_details=include_details,
                show_admin_feedback=include_feedback,
            )
            if ok:
                sent += 1
            else:
                errors.append({'email': r[6], 'error': msg})
        except Exception as e:
            errors.append({'email': r[6], 'error': str(e)})

    return jsonify({'sent': sent, 'errors': errors}), 200
