"""Application-layer encryption for teachers' API keys.

Keys are encrypted before they reach the database, with a master key that lives
outside it (``CREDENTIAL_ENCRYPTION_KEY``, an environment variable or Docker
secret). A database dump therefore does not leak anyone's provider credentials.

Fernet is used rather than raw AES-GCM: it is authenticated (so a tampered
ciphertext fails to decrypt instead of yielding garbage), and it manages the
nonce itself, which removes the single easiest way to get AEAD catastrophically
wrong — reusing one.

Two rules hold everywhere in this module:

- a decrypted key is returned to the caller and never logged, never put in an
  exception message, and never stored anywhere but memory;
- what the API may show is the *fingerprint*, a hash prefix that identifies
  which key is configured without being able to reveal it.
"""

from __future__ import annotations

import hashlib
import os

from cryptography.fernet import Fernet, InvalidToken
from werkzeug.exceptions import BadRequest

import db
from db import queries as Q

MASTER_KEY_ENV = 'CREDENTIAL_ENCRYPTION_KEY'


class CredentialEncryptionError(RuntimeError):
    """The master key is missing or unusable, or a stored key cannot be read."""


def fingerprint(secret: str) -> str:
    """Stable, non-reversible identifier for a key, safe to display."""
    return hashlib.sha256(secret.encode('utf-8')).hexdigest()[:8]


def generate_master_key() -> str:
    """A fresh master key, for first setup and for rotation."""
    return Fernet.generate_key().decode('ascii')


def _cipher(master_key: str | None = None) -> Fernet:
    raw = master_key if master_key is not None else os.getenv(MASTER_KEY_ENV, '')
    if not raw:
        raise CredentialEncryptionError(
            f"{MASTER_KEY_ENV} is not set. Teacher API keys cannot be stored or read "
            f"without it; generate one with services.credentials.generate_master_key()."
        )
    try:
        return Fernet(raw.encode('ascii') if isinstance(raw, str) else raw)
    except Exception:
        # Deliberately does not echo the value.
        raise CredentialEncryptionError(
            f"{MASTER_KEY_ENV} is not a valid Fernet key (32 url-safe base64 bytes)."
        )


def encryption_available() -> bool:
    """Whether credentials can be stored at all, for feature gating in the UI."""
    try:
        _cipher()
        return True
    except CredentialEncryptionError:
        return False


def encrypt(secret: str, master_key: str | None = None) -> str:
    return _cipher(master_key).encrypt(secret.encode('utf-8')).decode('ascii')


def decrypt(ciphertext: str, master_key: str | None = None) -> str:
    try:
        return _cipher(master_key).decrypt(ciphertext.encode('ascii')).decode('utf-8')
    except InvalidToken:
        raise CredentialEncryptionError(
            "A stored API key could not be decrypted with the current "
            f"{MASTER_KEY_ENV}. It was probably encrypted with a different master "
            f"key — re-encrypt before rotating, or ask the teacher to re-enter it."
        )


# ── stored credentials ───────────────────────────────────────────────────────
#
# A teacher's key is stored per endpoint and only ever read back for that
# endpoint: it authenticates the teacher to one whitelisted service and is never
# a fallback for any other.

def set_teacher_key(teacher_id: int, endpoint_id: int, secret: str) -> dict:
    """Store (or replace) a teacher's key for one endpoint. Returns its status."""
    secret = (secret or '').strip()
    if not secret:
        raise BadRequest(description="La chiave API non può essere vuota.")

    ciphertext = encrypt(secret)
    digest = fingerprint(secret)
    with db.get_conn() as conn:
        conn.execute(Q.UPSERT_TEACHER_LLM_CREDENTIAL, {
            'teacher_id': teacher_id,
            'endpoint_id': endpoint_id,
            'ciphertext': ciphertext,
            'fingerprint': digest,
            'key_version': _master_key_fingerprint(),
        })
        conn.commit()
    return {'configured': True, 'fingerprint': digest}


def clear_teacher_key(teacher_id: int, endpoint_id: int) -> None:
    with db.get_conn() as conn:
        conn.execute(Q.DELETE_TEACHER_LLM_CREDENTIAL, (teacher_id, endpoint_id))
        conn.commit()


def get_teacher_key(teacher_id: int, endpoint_id: int, conn=None) -> str | None:
    """The decrypted key for this endpoint, for making a call. Never expose it.

    Pass *conn* when one is already held: this runs on the grading path.
    """
    row = _fetch(Q.GET_TEACHER_LLM_CREDENTIAL, (teacher_id, endpoint_id), conn)
    if not row:
        return None
    return decrypt(row[0])


def describe_teacher_keys(teacher_id: int) -> dict[int, dict]:
    """What the API may say about a teacher's keys, per endpoint id."""
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_TEACHER_LLM_KEY_STATUS, (teacher_id,)).fetchall()
    return {endpoint_id: key_status(digest, updated_at) for endpoint_id, digest, updated_at in rows}


def key_status(digest: str | None = None, updated_at=None) -> dict:
    if digest is None:
        return {'configured': False, 'fingerprint': None, 'updated_at': None}
    return {
        'configured': True,
        'fingerprint': digest,
        'updated_at': updated_at.isoformat() if updated_at else None,
    }


def _fetch(query: str, params: tuple, conn):
    if conn is not None:
        return conn.execute(query, params).fetchone()
    with db.get_conn() as owned:
        return owned.execute(query, params).fetchone()


def _master_key_fingerprint() -> str | None:
    raw = os.getenv(MASTER_KEY_ENV, '')
    return fingerprint(raw) if raw else None


# ── rotation ─────────────────────────────────────────────────────────────────

def re_encrypt_all(old_key: str, new_key: str, conn) -> int:
    """Re-encrypt every stored credential from *old_key* to *new_key*.

    Must run before ``CREDENTIAL_ENCRYPTION_KEY`` is replaced: once the old key
    is gone the ciphertexts are unreadable and every teacher has to enter their
    API key again.

    Takes a connection and does not commit, so the caller controls the
    transaction — either every credential moves to the new key or none does. A
    partial rotation would leave rows nobody can decrypt.

    Returns the number of credentials re-encrypted.
    """
    new_fingerprint = fingerprint(new_key)
    count = 0
    for teacher_id, endpoint_id, ciphertext in conn.execute(Q.LIST_TEACHER_LLM_CREDENTIALS).fetchall():
        secret = decrypt(ciphertext, old_key)
        conn.execute(Q.UPDATE_TEACHER_LLM_CREDENTIAL_CIPHERTEXT, {
            'teacher_id': teacher_id,
            'endpoint_id': endpoint_id,
            'ciphertext': encrypt(secret, new_key),
            'key_version': new_fingerprint,
        })
        count += 1
    return count
