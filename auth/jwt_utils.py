import os
from datetime import datetime, timezone, timedelta

import jwt

_SECRET: str | None = None


def _secret() -> str:
    global _SECRET
    if _SECRET is None:
        s = os.environ.get('JWT_SECRET', '')
        if not s:
            raise EnvironmentError("JWT_SECRET environment variable is not set.")
        _SECRET = s
    return _SECRET


def _teacher_ttl() -> int:
    return int(os.environ.get('JWT_TEACHER_TTL_HOURS', '12'))


def encode_teacher_token(teacher_id: int, role: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        'sub': teacher_id,
        'role': role,
        'email': email,
        'iat': now,
        'exp': now + timedelta(hours=_teacher_ttl()),
    }
    return jwt.encode(payload, _secret(), algorithm='HS256')


def encode_student_token(student_id: int, session_id: int, closes_at: datetime | None = None) -> str:
    now = datetime.now(timezone.utc)
    max_exp = now + timedelta(hours=4)
    if closes_at is not None:
        if closes_at.tzinfo is None:
            closes_at = closes_at.replace(tzinfo=timezone.utc)
        exp = min(closes_at + timedelta(hours=1), max_exp)
    else:
        exp = max_exp
    payload = {
        'sub': student_id,
        'sid': session_id,
        'role': 'student',
        'iat': now,
        'exp': exp,
    }
    return jwt.encode(payload, _secret(), algorithm='HS256')


def encode_change_password_token(teacher_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        'sub': teacher_id,
        'scope': 'password_change',
        'iat': now,
        'exp': now + timedelta(minutes=15),
    }
    return jwt.encode(payload, _secret(), algorithm='HS256')


def decode_token(token: str) -> dict:
    return jwt.decode(token, _secret(), algorithms=['HS256'])
