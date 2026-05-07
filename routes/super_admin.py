"""
Super-admin endpoints — IT staff only.

GET  /api/super-admin/teachers
POST /api/super-admin/teachers
PUT  /api/super-admin/teachers/<id>
POST /api/super-admin/teachers/<id>/reset-password
GET  /api/super-admin/students
GET  /api/super-admin/classes
POST /api/super-admin/classes/<id>/teachers
POST /api/super-admin/sync
GET  /api/super-admin/sync/<run_id>
GET  /api/super-admin/scores
"""

from __future__ import annotations

import json
import secrets
import string

import bcrypt
from flask import Blueprint, g, jsonify, request
from werkzeug.exceptions import NotFound

import db
from db import queries as Q
from auth.decorators import require_super_admin
from auth.jwt_utils import encode_teacher_token

super_admin_bp = Blueprint('super_admin', __name__, url_prefix='/api/super-admin')


def _random_temp_password(length: int = 12) -> str:
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


# ── teachers ──────────────────────────────────────────────────────────────────

@super_admin_bp.get('/teachers')
@require_super_admin
def list_teachers():
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_TEACHERS).fetchall()
    return jsonify([
        {
            'id': r[0], 'email': r[1], 'display_name': r[2], 'role': r[3],
            'status': r[4],
            'created_at': r[5].isoformat() if r[5] else None,
            'last_login_at': r[6].isoformat() if r[6] else None,
            'last_synced_at': r[7].isoformat() if r[7] else None,
        }
        for r in rows
    ]), 200


@super_admin_bp.post('/teachers')
@require_super_admin
def create_teacher():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    display_name = (data.get('display_name') or email).strip()
    role = data.get('role', 'teacher')

    if not email:
        return jsonify({'error': 'MISSING_EMAIL'}), 400
    if role not in ('teacher', 'super_admin'):
        return jsonify({'error': 'INVALID_ROLE'}), 400

    temp_pw = _random_temp_password()
    pw_hash = bcrypt.hashpw(temp_pw.encode(), bcrypt.gensalt(rounds=12)).decode()

    with db.get_conn() as conn:
        row = conn.execute(Q.INSERT_TEACHER, {
            'email': email,
            'google_id': None,
            'display_name': display_name,
            'role': role,
            'password_hash': pw_hash,
            'password_must_change': True,
            'status': 'active',
        }).fetchone()
        conn.commit()

    return jsonify({'id': row[0], 'email': email, 'temp_password': temp_pw}), 201


@super_admin_bp.put('/teachers/<int:teacher_id>')
@require_super_admin
def update_teacher(teacher_id: int):
    data = request.get_json(silent=True) or {}
    caller_id = g.current_user['sub']

    updates = {}
    if 'role' in data:
        if data['role'] not in ('teacher', 'super_admin'):
            return jsonify({'error': 'INVALID_ROLE'}), 400
        # Prevent demoting yourself
        if teacher_id == caller_id and data['role'] != 'super_admin':
            return jsonify({'error': 'CANNOT_DEMOTE_SELF'}), 400
        updates['role'] = data['role']
    if 'status' in data:
        if data['status'] not in ('active', 'disabled'):
            return jsonify({'error': 'INVALID_STATUS'}), 400
        if teacher_id == caller_id and data['status'] == 'disabled':
            return jsonify({'error': 'CANNOT_DISABLE_SELF'}), 400
        updates['status'] = data['status']

    if not updates:
        return jsonify({'ok': True}), 200

    set_clause = ', '.join(f"{k} = %({k})s" for k in updates)
    updates['id'] = teacher_id
    with db.get_conn() as conn:
        result = conn.execute(
            f"UPDATE teachers SET {set_clause} WHERE id = %(id)s",
            updates,
        )
        if result.rowcount == 0:
            conn.rollback()
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.commit()
    return jsonify({'ok': True}), 200


@super_admin_bp.post('/teachers/<int:teacher_id>/reset-password')
@require_super_admin
def reset_teacher_password(teacher_id: int):
    temp_pw = _random_temp_password()
    pw_hash = bcrypt.hashpw(temp_pw.encode(), bcrypt.gensalt(rounds=12)).decode()
    with db.get_conn() as conn:
        result = conn.execute(
            "UPDATE teachers SET password_hash = %s, password_must_change = TRUE WHERE id = %s",
            (pw_hash, teacher_id),
        )
        if result.rowcount == 0:
            conn.rollback()
            return jsonify({'error': 'NOT_FOUND'}), 404
        conn.commit()
    return jsonify({'temp_password': temp_pw}), 200


# ── students ──────────────────────────────────────────────────────────────────

@super_admin_bp.get('/students')
@require_super_admin
def list_students():
    class_id = request.args.get('class_id', type=int)
    query = (request.args.get('query') or '').strip()

    with db.get_conn() as conn:
        if class_id:
            rows = conn.execute(Q.LIST_STUDENTS_FOR_CLASS, (class_id,)).fetchall()
        elif query:
            rows = conn.execute(
                """SELECT id, email, display_name, status FROM students
                   WHERE email ILIKE %s OR display_name ILIKE %s
                   ORDER BY display_name LIMIT 100""",
                (f'%{query}%', f'%{query}%'),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, email, display_name, status FROM students ORDER BY display_name LIMIT 500"
            ).fetchall()

    return jsonify([
        {'id': r[0], 'email': r[1], 'display_name': r[2], 'status': r[3]}
        for r in rows
    ]), 200


# ── classes ───────────────────────────────────────────────────────────────────

@super_admin_bp.get('/classes')
@require_super_admin
def list_classes():
    with db.get_conn() as conn:
        rows = conn.execute(
            """SELECT c.id, c.name, c.academic_year,
                      COUNT(DISTINCT cs.student_id) AS student_count,
                      COUNT(DISTINCT ct.teacher_id) AS teacher_count
               FROM classes c
               LEFT JOIN class_students cs ON cs.class_id = c.id
               LEFT JOIN class_teachers ct ON ct.class_id = c.id
               GROUP BY c.id
               ORDER BY c.name"""
        ).fetchall()
    return jsonify([
        {
            'id': r[0], 'name': r[1], 'academic_year': r[2],
            'student_count': r[3], 'teacher_count': r[4],
        }
        for r in rows
    ]), 200


@super_admin_bp.post('/classes/<int:class_id>/teachers')
@require_super_admin
def assign_teacher_to_class(class_id: int):
    data = request.get_json(silent=True) or {}
    teacher_id = data.get('teacher_id')
    if not teacher_id:
        return jsonify({'error': 'MISSING_TEACHER_ID'}), 400
    with db.get_conn() as conn:
        conn.execute(Q.INSERT_CLASS_TEACHER, (class_id, teacher_id))
        conn.commit()
    return jsonify({'ok': True}), 200


# ── google workspace sync ─────────────────────────────────────────────────────

@super_admin_bp.post('/sync')
@require_super_admin
def trigger_sync():
    """Start a sync run. Returns {run_id} immediately; sync runs synchronously for simplicity."""
    triggered_by = g.current_user['sub']
    with db.get_conn() as conn:
        row = conn.execute(Q.INSERT_SYNC_RUN, (triggered_by,)).fetchone()
        conn.commit()
        run_id = row[0]

    try:
        from auth.google_sync import run_sync
        result = run_sync(triggered_by=triggered_by)
        status = 'error' if result.get('errors') else 'success'
        with db.get_conn() as conn:
            conn.execute(Q.FINISH_SYNC_RUN, {
                'id': run_id, 'status': status, 'result': json.dumps(result)
            })
            conn.commit()
        return jsonify({'run_id': run_id, 'status': status, 'result': result}), 200
    except Exception as e:
        with db.get_conn() as conn:
            conn.execute(Q.FINISH_SYNC_RUN, {
                'id': run_id, 'status': 'error',
                'result': json.dumps({'errors': [str(e)]})
            })
            conn.commit()
        return jsonify({'run_id': run_id, 'status': 'error', 'error': str(e)}), 500


@super_admin_bp.get('/sync/<int:run_id>')
@require_super_admin
def get_sync_status(run_id: int):
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_SYNC_RUN, (run_id,)).fetchone()
    if not row:
        return jsonify({'error': 'NOT_FOUND'}), 404
    return jsonify({
        'id': row[0],
        'started_at': row[1].isoformat() if row[1] else None,
        'finished_at': row[2].isoformat() if row[2] else None,
        'triggered_by': row[3],
        'result': row[4],
        'status': row[5],
    }), 200


# ── global scores view ────────────────────────────────────────────────────────

@super_admin_bp.get('/scores')
@require_super_admin
def global_scores():
    teacher_id = request.args.get('teacher_id', type=int)
    session_id = request.args.get('session_id', type=int)

    with db.get_conn() as conn:
        if session_id:
            rows = conn.execute(Q.LIST_SCORES_FOR_SESSION, (session_id,)).fetchall()
        elif teacher_id:
            rows = conn.execute(Q.LIST_SCORES_FOR_TEACHER, (teacher_id,)).fetchall()
        else:
            rows = conn.execute(
                """SELECT se.id, se.raw_points, se.max_points, se.percent,
                          se.answers, se.submitted_at,
                          s.email, s.display_name, qs.title
                   FROM score_entries se
                   JOIN students s ON s.id = se.student_id
                   JOIN quiz_sessions qs ON qs.id = se.session_id
                   ORDER BY se.submitted_at DESC LIMIT 200"""
            ).fetchall()

    return jsonify([
        {
            'id': r[0], 'raw_points': float(r[1]), 'max_points': float(r[2]),
            'percent': float(r[3]),
            'submitted_at': r[5].isoformat() if r[5] else None,
            'student_email': r[6], 'student_name': r[7],
        }
        for r in rows
    ]), 200
