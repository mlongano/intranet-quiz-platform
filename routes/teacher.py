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
from werkzeug.exceptions import BadRequest, Forbidden, NotFound

import db
from db import queries as Q
from auth.decorators import require_teacher
from services import images as img_service
from services import quiz_session as qs_service
from services import snapshots as snap_service
from services.grading import format_detailed_answers, grade, score_open
from services import score_transforms

teacher_bp = Blueprint('teacher', __name__, url_prefix='/api/teacher')


# ── helpers ───────────────────────────────────────────────────────────────────

def _teacher_id() -> int:
    return int(g.current_user['sub'])


def _assert_session_owner(conn, session_id: int, teacher_id: int):
    row = conn.execute(
        "SELECT teacher_id FROM quiz_sessions WHERE id = %s", (session_id,)
    ).fetchone()
    if not row:
        raise NotFound(description="Session not found.")
    if row[0] != teacher_id:
        raise Forbidden(description="Not your session.")


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
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_CLASSES_FOR_TEACHER, (_teacher_id(),)).fetchall()
    return jsonify([
        {'id': r[0], 'name': r[1], 'academic_year': r[2], 'student_count': r[3]}
        for r in rows
    ]), 200


@teacher_bp.get('/classes/<int:class_id>/students')
@require_teacher
def list_class_students(class_id: int):
    teacher_id = _teacher_id()
    with db.get_conn() as conn:
        # Verify teacher owns this class
        owns = conn.execute(
            "SELECT 1 FROM class_teachers WHERE class_id = %s AND teacher_id = %s",
            (class_id, teacher_id),
        ).fetchone()
        if not owns:
            raise Forbidden(description="Not your class.")
        rows = conn.execute(Q.LIST_STUDENTS_FOR_CLASS, (class_id,)).fetchall()
    return jsonify([
        {'id': r[0], 'email': r[1], 'display_name': r[2], 'status': r[3]}
        for r in rows
    ]), 200


# ── sessions ──────────────────────────────────────────────────────────────────

@teacher_bp.get('/sessions')
@require_teacher
def list_sessions():
    teacher_id = _teacher_id()
    status_filter = request.args.get('status')
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_SESSIONS_FOR_TEACHER, (teacher_id,)).fetchall()
    result = []
    for r in rows:
        sess = {
            'id': r[0], 'title': r[1], 'status': r[2], 'join_code': r[3],
            'opens_at': r[4].isoformat() if r[4] else None,
            'closes_at': r[5].isoformat() if r[5] else None,
            'created_at': r[6].isoformat() if r[6] else None,
            'classes': r[7] if isinstance(r[7], list) else json.loads(r[7] or '[]'),
            'score_count': r[8],
        }
        if not status_filter or sess['status'] == status_filter:
            result.append(sess)
    return jsonify(result), 200


@teacher_bp.post('/sessions')
@require_teacher
def create_session():
    data = request.get_json(silent=True) or {}
    snapshot_id = data.get('snapshot_id')
    class_ids = data.get('class_ids', [])
    title = data.get('title')
    opens_at = data.get('opens_at')
    closes_at = data.get('closes_at')

    if not snapshot_id:
        return jsonify({'error': 'MISSING_SNAPSHOT_ID'}), 400
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

    # Verify teacher owns every class
    with db.get_conn() as conn:
        for cid in class_ids:
            owns = conn.execute(
                "SELECT 1 FROM class_teachers WHERE class_id = %s AND teacher_id = %s",
                (cid, teacher_id),
            ).fetchone()
            if not owns:
                return jsonify({'error': f'Class {cid} not found or not yours.'}), 403

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


@teacher_bp.post('/sessions/<int:session_id>/regen-code')
@require_teacher
def regen_join_code(session_id: int):
    code = qs_service.regenerate_join_code(session_id, _teacher_id())
    return jsonify({'join_code': code}), 200


@teacher_bp.delete('/sessions/<int:session_id>')
@require_teacher
def delete_session(session_id: int):
    teacher_id = _teacher_id()
    with db.get_conn() as conn:
        _assert_session_owner(conn, session_id, teacher_id)
        result = conn.execute(Q.DELETE_SESSION, (session_id, teacher_id))
        if result.rowcount == 0:
            conn.rollback()
            return jsonify({'error': 'SESSION_NOT_DRAFT'}), 409
        conn.commit()
    return jsonify({'ok': True}), 200


# ── scores ────────────────────────────────────────────────────────────────────

@teacher_bp.get('/sessions/<int:session_id>/scores')
@require_teacher
def session_scores(session_id: int):
    teacher_id = _teacher_id()
    with db.get_conn() as conn:
        _assert_session_owner(conn, session_id, teacher_id)
        rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()
    return jsonify([
        {
            'id': r[0], 'raw_points': float(r[1]), 'max_points': float(r[2]),
            'percent': float(r[3]),
            'answers': r[4] if isinstance(r[4], list) else json.loads(r[4] or '[]'),
            'submitted_at': r[5].isoformat() if r[5] else None,
            'student_email': r[6], 'student_name': r[7],
        }
        for r in rows
    ]), 200


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
        if sid:
            overrides_by_id[sid] = {str(k): float(v) for k, v in o.get('per_question', {}).items()}

    def _review_fn(score_id: int, answers: list[dict], _qbank_map: dict) -> list[dict] | None:
        per_q = overrides_by_id.get(score_id)
        if not per_q:
            return None
        for ans in answers:
            q_id = str(ans.get('question_id'))
            if q_id in per_q:
                ans['points_awarded'] = ans['raw_points'] = per_q[q_id]
        return answers

    updated = score_transforms.transform_scores(
        session_id, teacher_id,
        entry_ids=list(overrides_by_id.keys()),
        transform_fn=_review_fn,
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
    title = data.get('title')
    notes = data.get('notes')
    teacher_id = _teacher_id()

    with db.get_conn() as conn:
        _assert_session_owner(conn, session_id, teacher_id)
        sess_row = conn.execute(
            "SELECT title FROM quiz_sessions WHERE id = %s", (session_id,)
        ).fetchone()
        archive_title = title or (sess_row[0] if sess_row else f"session-{session_id}")

        score_rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()
        content = [
            {
                'student_email': r[6], 'student_name': r[7],
                'raw_points': float(r[1]), 'max_points': float(r[2]), 'percent': float(r[3]),
                'answers': r[4] if isinstance(r[4], list) else json.loads(r[4] or '[]'),
                'submitted_at': r[5].isoformat() if r[5] else None,
            }
            for r in score_rows
        ]
        row = conn.execute(Q.INSERT_ARCHIVE, {
            'teacher_id': teacher_id,
            'title': archive_title,
            'source_session_id': session_id,
            'content': json.dumps(content),
            'notes': notes,
        }).fetchone()
        conn.commit()

    return jsonify({'archive_id': row[0], 'archived_at': row[1].isoformat()}), 201


@teacher_bp.post('/sessions/<int:session_id>/scores/regrade-open')
@require_teacher
def regrade_open_questions(session_id: int):
    """Re-grade open questions using the current LLM/keyword settings."""
    teacher_id = _teacher_id()

    def _regrade_open_fn(_score_id: int, answers: list[dict], qbank_map: dict) -> list[dict] | None:
        changed = False
        for ans in answers:
            q = ans.get('question_snapshot')
            if not isinstance(q, dict):
                q = qbank_map.get(str(ans.get('question_id')))
            if not isinstance(q, dict) or q.get('type') != 'open':
                continue
            raw_student = ans.get('raw_student_answer') or ''
            new_fraction = score_open(raw_student, q)
            new_pts = round(new_fraction * q.get('weight', 1), 2)
            old_pts = ans.get('raw_points', 0)
            if abs(new_pts - old_pts) > 0.001:
                ans['points_awarded'] = ans['raw_points'] = new_pts
                changed = True
        return answers if changed else None

    updated = score_transforms.transform_scores(
        session_id, teacher_id, transform_fn=_regrade_open_fn,
    )
    return jsonify({'updated': updated}), 200


# ── archives ──────────────────────────────────────────────────────────────────

@teacher_bp.get('/archives')
@require_teacher
def list_archives():
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_ARCHIVES, (_teacher_id(),)).fetchall()
    return jsonify([
        {
            'id': r[0], 'title': r[1], 'source_session_id': r[2],
            'notes': r[3], 'archived_at': r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]), 200


@teacher_bp.get('/archives/<int:archive_id>')
@require_teacher
def get_archive(archive_id: int):
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_ARCHIVE, (archive_id, _teacher_id())).fetchone()
    if not row:
        return jsonify({'error': 'NOT_FOUND'}), 404
    return jsonify({
        'id': row[0], 'title': row[2], 'source_session_id': row[3],
        'content': row[4] if isinstance(row[4], list) else json.loads(row[4] or '[]'),
        'notes': row[5], 'archived_at': row[6].isoformat() if row[6] else None,
    }), 200


@teacher_bp.get('/archives/<int:archive_id>/export')
@require_teacher
def export_archive(archive_id: int):
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_ARCHIVE, (archive_id, _teacher_id())).fetchone()
    if not row:
        return jsonify({'error': 'NOT_FOUND'}), 404
    content = row[4] if isinstance(row[4], list) else json.loads(row[4] or '[]')
    filename = f"{row[2]}.json"
    return Response(
        json.dumps(content, ensure_ascii=False, indent=2),
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


@teacher_bp.delete('/archives/<int:archive_id>')
@require_teacher
def delete_archive(archive_id: int):
    with db.get_conn() as conn:
        result = conn.execute(Q.DELETE_ARCHIVE, (archive_id, _teacher_id()))
        if result.rowcount == 0:
            conn.rollback()
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.commit()
    return jsonify({'ok': True}), 200


@teacher_bp.post('/archives/<int:archive_id>/rename')
@require_teacher
def rename_archive(archive_id: int):
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'MISSING_TITLE'}), 400
    with db.get_conn() as conn:
        result = conn.execute(Q.UPDATE_ARCHIVE_TITLE, (title, archive_id, _teacher_id()))
        if result.rowcount == 0:
            conn.rollback()
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.commit()
    return jsonify({'ok': True}), 200


# ── student list snapshots ─────────────────────────────────────────────────────

@teacher_bp.get('/student-snapshots')
@require_teacher
def list_student_snapshots():
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_STUDENT_SNAPSHOTS, (_teacher_id(),)).fetchall()
    return jsonify([
        {'id': r[0], 'title': r[1], 'created_at': r[2].isoformat() if r[2] else None}
        for r in rows
    ]), 200


@teacher_bp.post('/student-snapshots')
@require_teacher
def create_student_snapshot():
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    content = data.get('content', [])
    if not title:
        return jsonify({'error': 'MISSING_TITLE'}), 400
    teacher_id = _teacher_id()
    with db.get_conn() as conn:
        row = conn.execute(Q.INSERT_STUDENT_SNAPSHOT, {
            'teacher_id': teacher_id,
            'title': title,
            'content': json.dumps(content),
        }).fetchone()
        conn.commit()
    return jsonify({'id': row[0], 'created_at': row[1].isoformat()}), 201


@teacher_bp.get('/student-snapshots/<int:snapshot_id>')
@require_teacher
def get_student_snapshot(snapshot_id: int):
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_STUDENT_SNAPSHOT, (snapshot_id, _teacher_id())).fetchone()
    if not row:
        return jsonify({'error': 'NOT_FOUND'}), 404
    return jsonify({
        'id': row[0], 'title': row[1],
        'content': row[2] if isinstance(row[2], list) else json.loads(row[2] or '[]'),
        'created_at': row[3].isoformat() if row[3] else None,
    }), 200


@teacher_bp.delete('/student-snapshots/<int:snapshot_id>')
@require_teacher
def delete_student_snapshot(snapshot_id: int):
    with db.get_conn() as conn:
        result = conn.execute(Q.DELETE_STUDENT_SNAPSHOT, (snapshot_id, _teacher_id()))
        if result.rowcount == 0:
            conn.rollback()
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.commit()
    return jsonify({'ok': True}), 200


@teacher_bp.post('/student-snapshots/<int:snapshot_id>/rename')
@require_teacher
def rename_student_snapshot(snapshot_id: int):
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return jsonify({'error': 'MISSING_TITLE'}), 400
    with db.get_conn() as conn:
        result = conn.execute(
            "UPDATE student_list_snapshots SET title = %s WHERE id = %s AND teacher_id = %s",
            (title, snapshot_id, _teacher_id()),
        )
        if result.rowcount == 0:
            conn.rollback()
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.commit()
    return jsonify({'ok': True}), 200


@teacher_bp.get('/student-snapshots/<int:snapshot_id>/export')
@require_teacher
def export_student_snapshot(snapshot_id: int):
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_STUDENT_SNAPSHOT, (snapshot_id, _teacher_id())).fetchone()
    if not row:
        return jsonify({'error': 'NOT_FOUND'}), 404
    title = row[1]
    content = row[2] if isinstance(row[2], list) else json.loads(row[2] or '[]')
    filename = f"{title}.json"
    return Response(
        json.dumps(content, ensure_ascii=False, indent=2),
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment; filename="{filename}"'},
    )


# ── misc ──────────────────────────────────────────────────────────────────────

@teacher_bp.get('/llm-info')
@require_teacher
def llm_info():
    use_llm = os.getenv('USE_LLM_EVAL', '0') == '1'
    model = os.getenv('LLM_MODEL', '')
    return jsonify({'use_llm': use_llm, 'model': model if use_llm else None}), 200


@teacher_bp.post('/email/send-result')
@require_teacher
def send_result_email():
    data = request.get_json(silent=True) or {}
    score_id = data.get('score_id')
    if not score_id:
        return jsonify({'error': 'MISSING_SCORE_ID'}), 400
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
        )
        if not ok:
            return jsonify({'error': msg}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

    return jsonify({'ok': True, 'sent_to': row[5]}), 200


@teacher_bp.post('/sessions/<int:session_id>/email/send-all')
@require_teacher
def send_all_emails(session_id: int):
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
            )
            if ok:
                sent += 1
            else:
                errors.append({'email': r[6], 'error': msg})
        except Exception as e:
            errors.append({'email': r[6], 'error': str(e)})

    return jsonify({'sent': sent, 'errors': errors}), 200
