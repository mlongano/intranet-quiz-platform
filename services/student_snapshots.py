"""Teacher-owned Student list Snapshot workflows."""

from __future__ import annotations

import json

from werkzeug.exceptions import NotFound

import db
from db import queries as Q


def _content(value) -> list:
    return value if isinstance(value, list) else json.loads(value or '[]')


def list_student_snapshots(teacher_id: int) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_STUDENT_SNAPSHOTS, (teacher_id,)).fetchall()
    return [
        {'id': r[0], 'title': r[1], 'created_at': r[2].isoformat() if r[2] else None}
        for r in rows
    ]


def create_student_snapshot(teacher_id: int, title: str, content: list) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(Q.INSERT_STUDENT_SNAPSHOT, {
            'teacher_id': teacher_id,
            'title': title,
            'content': json.dumps(content),
        }).fetchone()
        conn.commit()
    return {'id': row[0], 'created_at': row[1].isoformat()}


def get_student_snapshot(teacher_id: int, snapshot_id: int) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_STUDENT_SNAPSHOT, (snapshot_id, teacher_id)).fetchone()
    if not row:
        raise NotFound(description="Student snapshot not found.")
    return {
        'id': row[0], 'title': row[1], 'content': _content(row[2]),
        'created_at': row[3].isoformat() if row[3] else None,
    }


def delete_student_snapshot(teacher_id: int, snapshot_id: int) -> None:
    with db.get_conn() as conn:
        result = conn.execute(Q.DELETE_STUDENT_SNAPSHOT, (snapshot_id, teacher_id))
        if result.rowcount == 0:
            conn.rollback()
            raise NotFound(description="Student snapshot not found.")
        conn.commit()


def rename_student_snapshot(teacher_id: int, snapshot_id: int, title: str) -> None:
    with db.get_conn() as conn:
        result = conn.execute(Q.UPDATE_STUDENT_SNAPSHOT_TITLE, (title, snapshot_id, teacher_id))
        if result.rowcount == 0:
            conn.rollback()
            raise NotFound(description="Student snapshot not found.")
        conn.commit()


def export_student_snapshot(teacher_id: int, snapshot_id: int) -> tuple[str, str]:
    snapshot = get_student_snapshot(teacher_id, snapshot_id)
    filename = f"{snapshot['title']}.json"
    return filename, json.dumps(snapshot['content'], ensure_ascii=False, indent=2)
