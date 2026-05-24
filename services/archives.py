"""Teacher-owned Score archive workflows."""

from __future__ import annotations

import json

from werkzeug.exceptions import NotFound

import db
from db import queries as Q


def _content(value) -> list:
    return value if isinstance(value, list) else json.loads(value or '[]')


def list_archives(teacher_id: int) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_ARCHIVES, (teacher_id,)).fetchall()
    return [
        {
            'id': r[0], 'title': r[1], 'source_session_id': r[2],
            'notes': r[3], 'archived_at': r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]


def get_archive(teacher_id: int, archive_id: int) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_ARCHIVE, (archive_id, teacher_id)).fetchone()
    if not row:
        raise NotFound(description="Archive not found.")
    return {
        'id': row[0], 'title': row[2], 'source_session_id': row[3],
        'content': _content(row[4]),
        'notes': row[5], 'archived_at': row[6].isoformat() if row[6] else None,
    }


def export_archive(teacher_id: int, archive_id: int) -> tuple[str, str]:
    archive = get_archive(teacher_id, archive_id)
    filename = f"{archive['title']}.json"
    return filename, json.dumps(archive['content'], ensure_ascii=False, indent=2)


def delete_archive(teacher_id: int, archive_id: int) -> None:
    with db.get_conn() as conn:
        result = conn.execute(Q.DELETE_ARCHIVE, (archive_id, teacher_id))
        if result.rowcount == 0:
            conn.rollback()
            raise NotFound(description="Archive not found.")
        conn.commit()


def rename_archive(teacher_id: int, archive_id: int, title: str) -> None:
    with db.get_conn() as conn:
        result = conn.execute(Q.UPDATE_ARCHIVE_TITLE, (title, archive_id, teacher_id))
        if result.rowcount == 0:
            conn.rollback()
            raise NotFound(description="Archive not found.")
        conn.commit()
