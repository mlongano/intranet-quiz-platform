from functools import wraps

import jwt
from flask import g, jsonify, request

from auth.jwt_utils import decode_token


def _extract_token() -> str | None:
    header = request.headers.get('Authorization', '')
    if header.startswith('Bearer '):
        return header[7:]
    return None


def _auth_guard(required_roles: set[str]):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            token = _extract_token()
            if not token:
                return jsonify({'error': 'MISSING_TOKEN'}), 401
            try:
                payload = decode_token(token)
            except jwt.ExpiredSignatureError:
                return jsonify({'error': 'TOKEN_EXPIRED'}), 401
            except jwt.InvalidTokenError:
                return jsonify({'error': 'INVALID_TOKEN'}), 401
            if payload.get('role') not in required_roles:
                return jsonify({'error': 'FORBIDDEN'}), 403
            g.current_user = payload
            return f(*args, **kwargs)
        return decorated
    return decorator


# A teacher OR super_admin may access teacher-scoped endpoints:
def require_teacher(f):
    return _auth_guard({'teacher', 'super_admin'})(f)


def require_super_admin(f):
    return _auth_guard({'super_admin'})(f)


def require_student(f):
    return _auth_guard({'student'})(f)


def require_change_password_token(f):
    """Accepts only the short-lived change-password token."""
    @wraps(f)
    def decorated(*args, **kwargs):
        token = _extract_token()
        if not token:
            return jsonify({'error': 'MISSING_TOKEN'}), 401
        try:
            payload = decode_token(token)
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'TOKEN_EXPIRED'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'INVALID_TOKEN'}), 401
        if payload.get('scope') != 'password_change' and payload.get('role') not in ('teacher', 'super_admin'):
            return jsonify({'error': 'FORBIDDEN'}), 403
        g.current_user = payload
        return f(*args, **kwargs)
    return decorated
