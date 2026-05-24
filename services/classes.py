"""Teacher-owned Class read workflows."""

from __future__ import annotations

from werkzeug.exceptions import Forbidden

import db
from db import queries as Q


def list_classes_for_teacher(teacher_id: int) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_CLASSES_FOR_TEACHER, (teacher_id,)).fetchall()
    return [
        {'id': r[0], 'name': r[1], 'academic_year': r[2], 'student_count': r[3]}
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
