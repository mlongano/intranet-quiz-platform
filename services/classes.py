"""Teacher-owned Classes: reading, and the editing their origin allows.

A class comes from a Classroom course, from a Workspace group, or from a
teacher (created here, or migrated from v2.6.0): its ``kind``. The members of
a synced class are Google's — an edit here would be overwritten by the next
sync — so only a ``manual`` class has its students edited by hand. Any class
can be renamed (a synced one keeps the new name across syncs) and archived.

Archiving is per teacher and hides the class from that teacher's lists and
from the class choice for a new session; sessions, scores and published
results are untouched. A class is deleted only while no session uses it.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from werkzeug.exceptions import BadRequest, Forbidden, NotFound

import db
from db import queries as Q
from services.quiz_session import EditRefused

MAX_NAME = 120
MAX_EMAILS = 300
_YEAR = re.compile(r'^(\d{4})-(\d{4})$')


def list_classes_for_teacher(teacher_id: int, include_archived: bool = False) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_CLASSES_FOR_TEACHER, {
            'teacher_id': teacher_id, 'include_archived': include_archived,
        }).fetchall()
    return [
        {'id': r[0], 'name': r[1], 'academic_year': r[2], 'student_count': r[3], 'kind': r[4],
         'archived': r[5] is not None, 'used_in_sessions': r[6]}
        for r in rows
    ]


def list_students_for_class(teacher_id: int, class_id: int) -> list[dict]:
    with db.get_conn() as conn:
        owns = conn.execute(
            "SELECT 1 FROM class_teachers WHERE class_id = %s AND teacher_id = %s",
            (class_id, teacher_id),
        ).fetchone()
        if not owns:
            raise Forbidden(description="Not your class.")
        rows = conn.execute(Q.LIST_STUDENTS_FOR_CLASS, (class_id,)).fetchall()
    return [
        {'id': r[0], 'email': r[1], 'display_name': r[2], 'status': r[3]}
        for r in rows
    ]


# ── editing ──────────────────────────────────────────────────────────────────

def _clean_name(value) -> str:
    name = ' '.join(str(value or '').split())
    if not name:
        raise BadRequest(description="Il nome della classe è obbligatorio.")
    if len(name) > MAX_NAME:
        raise BadRequest(description=f"Il nome della classe supera {MAX_NAME} caratteri.")
    return name


def _clean_year(value) -> str:
    m = _YEAR.match(str(value or '').strip())
    if not m or int(m.group(2)) != int(m.group(1)) + 1:
        raise BadRequest(description="Anno scolastico non valido: usa la forma 2026-2027.")
    return m.group(0)


def _clean_emails(value) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or not all(isinstance(e, str) for e in value):
        raise BadRequest(description="emails deve essere un elenco di indirizzi.")
    emails = list(dict.fromkeys(e.strip().lower() for e in value if e.strip()))
    if len(emails) > MAX_EMAILS:
        raise BadRequest(description=f"Al massimo {MAX_EMAILS} indirizzi alla volta.")
    return emails


def _lock_class(conn, teacher_id: int, class_id: int) -> dict:
    row = conn.execute(Q.LOCK_TEACHER_CLASS, (class_id, teacher_id)).fetchone()
    if not row:
        raise NotFound(description="Classe non trovata.")
    return {'id': row[0], 'name': row[1], 'academic_year': row[2], 'kind': row[3]}


def _assert_name_free(conn, teacher_id: int, name: str, year: str, exclude_id: int | None = None) -> None:
    taken = conn.execute(Q.TEACHER_CLASS_NAME_TAKEN, {
        'teacher_id': teacher_id, 'name': name, 'academic_year': year, 'exclude_id': exclude_id,
    }).fetchone()
    if taken:
        raise EditRefused('CLASS_NAME_TAKEN', f"Hai già una classe «{name}» nel {year}.")


def _add_students(conn, class_id: int, emails: list[str]) -> dict:
    """Adds the provisioned, active students among *emails*; reports the rest.

    Students come only from the Workspace sync — an unknown address is never
    created here, so a typo cannot invent a student.
    """
    found = {email: (sid, status) for sid, email, status in
             conn.execute(Q.STUDENTS_BY_EMAIL, (emails,)).fetchall()}
    added, unknown, disabled = 0, [], []
    for email in emails:
        if email not in found:
            unknown.append(email)
        elif found[email][1] != 'active':
            disabled.append(email)
        else:
            added += conn.execute(Q.INSERT_CLASS_STUDENT, (class_id, found[email][0])).rowcount
    return {'added': added, 'unknown': unknown, 'disabled': disabled}


def create_class(teacher_id: int, name, academic_year, emails=None) -> dict:
    name, year, emails = _clean_name(name), _clean_year(academic_year), _clean_emails(emails)
    with db.get_conn() as conn:
        _assert_name_free(conn, teacher_id, name, year)
        class_id = conn.execute(Q.INSERT_MANUAL_CLASS, (name, year)).fetchone()[0]
        conn.execute(Q.INSERT_CLASS_TEACHER, (class_id, teacher_id))
        report = _add_students(conn, class_id, emails)
        conn.commit()
    return {'id': class_id, **report}


def update_class(teacher_id: int, class_id: int, changes: dict) -> dict:
    """Rename and/or archive (``archived``: true/false) one of the teacher's classes."""
    with db.get_conn() as conn:
        cls = _lock_class(conn, teacher_id, class_id)
        if 'name' in changes:
            name = _clean_name(changes['name'])
            if name != cls['name']:
                _assert_name_free(conn, teacher_id, name, cls['academic_year'], exclude_id=class_id)
                # A synced class keeps the teacher's name across later syncs.
                conn.execute(Q.RENAME_CLASS, {'id': class_id, 'name': name,
                                              'locked': cls['kind'] != 'manual'})
        if 'archived' in changes:
            if not isinstance(changes['archived'], bool):
                raise BadRequest(description="archived deve essere true o false.")
            conn.execute(Q.SET_CLASS_ARCHIVED, {
                'class_id': class_id, 'teacher_id': teacher_id,
                'archived_at': datetime.now(timezone.utc) if changes['archived'] else None,
            })
        conn.commit()
    return {'ok': True}


def _assert_manual(cls: dict) -> None:
    if cls['kind'] != 'manual':
        source = 'Google Classroom' if cls['kind'] == 'classroom' else 'Google Workspace'
        raise EditRefused('CLASS_SYNCED',
                          f"Gli studenti di questa classe vengono da {source}: "
                          "modificali lì e sincronizza.")


def add_students(teacher_id: int, class_id: int, emails) -> dict:
    emails = _clean_emails(emails)
    with db.get_conn() as conn:
        _assert_manual(_lock_class(conn, teacher_id, class_id))
        report = _add_students(conn, class_id, emails)
        conn.commit()
    return report


def remove_student(teacher_id: int, class_id: int, student_id: int) -> dict:
    with db.get_conn() as conn:
        _assert_manual(_lock_class(conn, teacher_id, class_id))
        removed = conn.execute(Q.DELETE_CLASS_STUDENT, (class_id, student_id)).rowcount
        conn.commit()
    if not removed:
        raise NotFound(description="Lo studente non è in questa classe.")
    return {'ok': True}


def delete_class(teacher_id: int, class_id: int) -> dict:
    """Removes the class from the teacher; deletes it once no one has it.

    A class some session used is part of that session's history: archive it
    instead. Another teacher who shares the class keeps it.
    """
    with db.get_conn() as conn:
        _lock_class(conn, teacher_id, class_id)
        if conn.execute(Q.CLASS_USED_IN_SESSIONS, (class_id,)).fetchone():
            raise EditRefused('CLASS_IN_USE',
                              "La classe è usata in almeno una sessione: archiviala invece di eliminarla.")
        conn.execute(Q.DELETE_CLASS_TEACHER, (class_id, teacher_id))
        deleted = conn.execute(Q.DELETE_CLASS_IF_ORPHAN, (class_id,)).rowcount
        conn.commit()
    return {'deleted': bool(deleted)}
