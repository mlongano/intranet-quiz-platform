"""
JSONC import/export and snapshot CRUD.
JSONC files are transient — they appear only during import/export requests.
"""

from __future__ import annotations

import json
from typing import Any

import commentjson
from werkzeug.exceptions import BadRequest, NotFound

import db
from db import queries as Q
from utils import slugify


def import_jsonc(teacher_id: int, raw_text: str, title_override: str | None = None) -> dict:
    """
    Parse raw JSONC text (may contain // comments), validate, and insert a snapshot.
    Returns the new snapshot dict.
    Raises BadRequest on parse or schema errors.
    """
    try:
        parsed = commentjson.loads(raw_text)
    except Exception as e:
        raise BadRequest(description=f"Invalid JSONC: {e}")

    questions = parsed.get('questions')
    if not isinstance(questions, list) or len(questions) == 0:
        raise BadRequest(description='JSONC must have a non-empty "questions" array.')

    title = title_override or parsed.get('title') or 'Untitled Quiz'
    _validate_questions(questions)

    # Store without the title at root (title is a DB column; content = {questions:[...]})
    content = {'questions': questions}
    slug = _unique_slug(teacher_id, slugify(title))

    with db.get_conn() as conn:
        try:
            row = conn.execute(Q.INSERT_SNAPSHOT, {
                'teacher_id': teacher_id,
                'title': title,
                'slug': slug,
                'content': json.dumps(content),
            }).fetchone()
        except Exception as e:
            # UniqueViolation on slug — another request raced with the same title.
            # Retry once with the next available slug.
            slug = _unique_slug(teacher_id, slugify(title), start_from=slug)
            row = conn.execute(Q.INSERT_SNAPSHOT, {
                'teacher_id': teacher_id,
                'title': title,
                'slug': slug,
                'content': json.dumps(content),
            }).fetchone()
        conn.commit()

    return {'id': row[0], 'title': title, 'slug': slug,
            'question_count': len(questions),
            'created_at': row[1], 'updated_at': row[2]}


def export_jsonc(snapshot_id: int, teacher_id: int) -> str:
    """
    Serialize a snapshot back to JSONC text for download.
    Raises NotFound if the snapshot doesn't belong to this teacher.
    """
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_SNAPSHOT, (snapshot_id, teacher_id)).fetchone()
    if not row:
        raise NotFound(description="Snapshot not found.")
    title = row[2]
    content = row[4]
    questions = content.get('questions', []) if isinstance(content, dict) else []
    doc = {'title': title, 'questions': questions}
    return json.dumps(doc, ensure_ascii=False, indent=2)


def update_snapshot(
    snapshot_id: int,
    teacher_id: int,
    raw_text: str | None = None,
    title: str | None = None,
) -> dict:
    """
    Update an existing snapshot. Pass raw_text to replace questions; title to rename.
    Returns updated snapshot metadata.
    """
    with db.get_conn() as conn:
        existing = conn.execute(Q.GET_SNAPSHOT, (snapshot_id, teacher_id)).fetchone()
        if not existing:
            raise NotFound(description="Snapshot not found.")

        current_title = existing[2]
        new_title = title or current_title
        new_slug = slugify(new_title)

        if raw_text is not None:
            try:
                parsed = commentjson.loads(raw_text)
            except Exception as e:
                raise BadRequest(description=f"Invalid JSONC: {e}")
            questions = parsed.get('questions')
            if not isinstance(questions, list) or len(questions) == 0:
                raise BadRequest(description='JSONC must have a non-empty "questions" array.')
            _validate_questions(questions)
            content = json.dumps({'questions': questions})
            conn.execute(Q.UPDATE_SNAPSHOT, {
                'id': snapshot_id,
                'teacher_id': teacher_id,
                'title': new_title,
                'slug': new_slug,
                'content': content,
            })
        else:
            conn.execute(Q.UPDATE_SNAPSHOT_TITLE_ONLY, {
                'id': snapshot_id,
                'teacher_id': teacher_id,
                'title': new_title,
                'slug': new_slug,
            })
        conn.commit()

    return {'id': snapshot_id, 'title': new_title, 'slug': new_slug}


def list_snapshots(teacher_id: int) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(Q.LIST_SNAPSHOTS, (teacher_id,)).fetchall()
    return [
        {
            'id': r[0],
            'title': r[1],
            'slug': r[2],
            'question_count': r[3],
            'single_count': r[4],
            'multiple_count': r[5],
            'open_count': r[6],
            'updated_at': r[7].isoformat() if r[7] else None,
            'created_at': r[8].isoformat() if r[8] else None,
        }
        for r in rows
    ]


def get_snapshot(snapshot_id: int, teacher_id: int) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_SNAPSHOT, (snapshot_id, teacher_id)).fetchone()
    if not row:
        raise NotFound(description="Snapshot not found.")
    content = row[4] if isinstance(row[4], dict) else json.loads(row[4])
    return {
        'id': row[0],
        'teacher_id': row[1],
        'title': row[2],
        'slug': row[3],
        'content': content,
        'images_manifest': row[5] if isinstance(row[5], list) else [],
        'created_at': row[6].isoformat() if row[6] else None,
        'updated_at': row[7].isoformat() if row[7] else None,
    }


def delete_snapshot(snapshot_id: int, teacher_id: int) -> None:
    """
    Raises NotFound if not owned by teacher, raises Conflict if a session references it
    (FK RESTRICT will surface as IntegrityError).
    """
    import psycopg
    with db.get_conn() as conn:
        row = conn.execute(Q.GET_SNAPSHOT, (snapshot_id, teacher_id)).fetchone()
        if not row:
            raise NotFound(description="Snapshot not found.")
        try:
            conn.execute(Q.DELETE_SNAPSHOT, (snapshot_id, teacher_id))
            conn.commit()
        except psycopg.errors.ForeignKeyViolation:
            conn.rollback()
            from werkzeug.exceptions import Conflict
            raise Conflict(description="Cannot delete a snapshot that has sessions referencing it.")


# ── helpers ───────────────────────────────────────────────────────────────────

def _validate_questions(questions: list[Any]) -> None:
    for i, q in enumerate(questions):
        if not isinstance(q, dict):
            raise BadRequest(description=f"Question at index {i} is not an object.")
        if 'id' not in q:
            raise BadRequest(description=f"Question at index {i} is missing 'id'.")
        if q.get('type') not in ('single', 'multiple', 'open'):
            raise BadRequest(description=f"Question {q.get('id')} has invalid type '{q.get('type')}'.")
        if q.get('type') != 'open' and not isinstance(q.get('options'), list):
            raise BadRequest(description=f"Question {q.get('id')} is missing 'options' array.")


def _unique_slug(teacher_id: int, base_slug: str, start_from: str | None = None) -> str:
    """Ensure the slug is unique for this teacher by appending a counter if needed."""
    candidate = start_from or base_slug
    counter = 1
    with db.get_conn() as conn:
        while True:
            row = conn.execute(
                "SELECT 1 FROM question_snapshots WHERE teacher_id = %s AND slug = %s",
                (teacher_id, candidate),
            ).fetchone()
            if not row:
                return candidate
            candidate = f"{base_slug}-{counter}"
            counter += 1
