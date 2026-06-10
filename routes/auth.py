"""
Authentication endpoints — no ADMIN_PW; everything uses bcrypt + JWT.

POST /api/auth/teacher-login
POST /api/auth/teacher-google-login
POST /api/auth/teacher-change-password
POST /api/auth/student-join
GET  /api/auth/me
"""

import os

import bcrypt
from flask import Blueprint, g, jsonify, request
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from werkzeug.exceptions import BadRequest

import db
from db import queries as Q
from auth import rate_limit
from auth.decorators import require_change_password_token, require_teacher
from auth.jwt_utils import (
    encode_change_password_token,
    encode_student_token,
    encode_teacher_token,
)

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')


def _teacher_login_response(
    teacher_id: int,
    email: str,
    role: str,
    display_name: str,
) -> dict:
    token = encode_teacher_token(teacher_id, role, email)
    return {
        'token': token,
        'teacher_id': teacher_id,
        'role': role,
        'email': email,
        'display_name': display_name,
    }


@auth_bp.post('/teacher-login')
def teacher_login():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    password = (data.get('password') or '')

    if not email or not password:
        return jsonify({'error': 'MISSING_CREDENTIALS'}), 400

    rate_key = f'teacher-login:{email}'
    if rate_limit.is_blocked(rate_key):
        return jsonify({'error': 'TOO_MANY_ATTEMPTS'}), 429

    with db.get_conn() as conn:
        row = conn.execute(Q.GET_TEACHER_BY_EMAIL, (email,)).fetchone()

    if not row:
        rate_limit.record_failure(rate_key)
        return jsonify({'error': 'INVALID_CREDENTIALS'}), 401

    teacher_id, _, pw_hash, role, status, must_change, display_name, _ = row

    if status != 'active':
        return jsonify({'error': 'ACCOUNT_DISABLED'}), 401

    if not bcrypt.checkpw(password.encode(), pw_hash.encode()):
        rate_limit.record_failure(rate_key)
        return jsonify({'error': 'INVALID_CREDENTIALS'}), 401

    rate_limit.clear(rate_key)

    with db.get_conn() as conn:
        conn.execute(Q.UPDATE_TEACHER_LAST_LOGIN, (teacher_id,))
        conn.commit()

    if must_change:
        change_token = encode_change_password_token(teacher_id)
        return jsonify({
            'must_change_password': True,
            'change_token': change_token,
            'teacher_id': teacher_id,
            'display_name': display_name,
        }), 200

    return jsonify(_teacher_login_response(teacher_id, email, role, display_name)), 200


@auth_bp.post('/teacher-google-login')
def teacher_google_login():
    data = request.get_json(silent=True) or {}
    credential = data.get('credential') or ''
    client_id = os.environ.get('GOOGLE_OAUTH_CLIENT_ID', '')
    hosted_domain = os.environ.get('GOOGLE_OAUTH_HOSTED_DOMAIN', '')

    if not client_id:
        return jsonify({'error': 'GOOGLE_LOGIN_NOT_CONFIGURED'}), 503
    if not credential:
        return jsonify({'error': 'MISSING_CREDENTIAL'}), 400

    try:
        idinfo = google_id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            client_id,
        )
    except ValueError:
        return jsonify({'error': 'INVALID_GOOGLE_TOKEN'}), 401

    email = (idinfo.get('email') or '').strip().lower()
    email_verified = bool(idinfo.get('email_verified'))
    if not email or not email_verified:
        return jsonify({'error': 'GOOGLE_EMAIL_NOT_VERIFIED'}), 401
    if hosted_domain and idinfo.get('hd') != hosted_domain:
        return jsonify({'error': 'INVALID_GOOGLE_DOMAIN'}), 401

    with db.get_conn() as conn:
        row = conn.execute(Q.GET_TEACHER_BY_EMAIL, (email,)).fetchone()

    if not row:
        return jsonify({'error': 'TEACHER_NOT_PROVISIONED'}), 401

    teacher_id, _, _pw_hash, role, status, _must_change, display_name, _ = row
    if status != 'active':
        return jsonify({'error': 'ACCOUNT_DISABLED'}), 401

    with db.get_conn() as conn:
        conn.execute(Q.UPDATE_TEACHER_LAST_LOGIN, (teacher_id,))
        conn.commit()

    return jsonify(_teacher_login_response(teacher_id, email, role, display_name)), 200


@auth_bp.post('/teacher-change-password')
@require_change_password_token
def teacher_change_password():
    data = request.get_json(silent=True) or {}
    new_password = (data.get('new_password') or '')

    if len(new_password) < 8:
        return jsonify({'error': 'PASSWORD_TOO_SHORT'}), 400

    teacher_id = g.current_user['sub']

    # Verify current password if this is a non-forced change (full teacher token)
    if g.current_user.get('role') in ('teacher', 'super_admin'):
        old_password = data.get('old_password') or ''
        if not old_password:
            return jsonify({'error': 'MISSING_OLD_PASSWORD'}), 400
        with db.get_conn() as conn:
            row = conn.execute(
                "SELECT id, email, role, status, display_name, "
                "password_must_change, password_hash "
                "FROM teachers WHERE id = %s", (teacher_id,)
            ).fetchone()
        if not row:
            return jsonify({'error': 'INVALID_CREDENTIALS'}), 401
        if not bcrypt.checkpw(old_password.encode(), row[6].encode()):
            return jsonify({'error': 'INVALID_CREDENTIALS'}), 401

    new_hash = bcrypt.hashpw(new_password.encode(), bcrypt.gensalt(rounds=12)).decode()

    with db.get_conn() as conn:
        conn.execute(Q.UPDATE_TEACHER_PASSWORD, (new_hash, teacher_id))
        row = conn.execute(Q.GET_TEACHER_BY_ID, (teacher_id,)).fetchone()
        conn.commit()

    if not row:
        return jsonify({'error': 'NOT_FOUND'}), 404

    teacher_id, email, role, status, display_name, _ = row
    return jsonify(_teacher_login_response(teacher_id, email, role, display_name)), 200


@auth_bp.post('/student-join')
def student_join():
    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip().lower()
    join_code = (data.get('join_code') or '').strip().upper()

    if not email or not join_code:
        return jsonify({'error': 'MISSING_CREDENTIALS'}), 400

    with db.get_conn() as conn:
        student_row = conn.execute(Q.GET_STUDENT_BY_EMAIL, (email,)).fetchone()
        if not student_row or student_row[3] != 'active':
            return jsonify({'error': 'INVALID_CREDENTIALS'}), 401

        session_row = conn.execute(Q.GET_ACTIVE_SESSION_BY_CODE, (join_code,)).fetchone()
        if not session_row:
            return jsonify({'error': 'INVALID_CODE'}), 401

        session_id = session_row[0]
        student_id = student_row[0]
        closes_at = session_row[7]  # closes_at

        in_class = conn.execute(Q.CHECK_STUDENT_IN_SESSION, (session_id, student_id)).fetchone()
        if not in_class:
            return jsonify({'error': 'NOT_IN_CLASS'}), 403

        score_exists = conn.execute(Q.CHECK_SCORE_EXISTS, (session_id, student_id)).fetchone()
        if score_exists:
            return jsonify({'error': 'Hai già consegnato questo quiz.', 'code': 'ALREADY_SUBMITTED'}), 409

    token = encode_student_token(student_id, session_id, closes_at)

    return jsonify({
        'token': token,
        'session_id': session_id,
        'student_id': student_id,
        'session_title': session_row[3],
    }), 200


@auth_bp.get('/me')
@require_teacher
def me():
    user = g.current_user
    return jsonify({
        'teacher_id': int(user['sub']),
        'role': user['role'],
        'email': user.get('email'),
    }), 200
