"""
Image management per snapshot. Images live under images/{teacher_id}/{snapshot_id}/.
Metadata (filename, size, mime, uploaded_at) is stored in question_snapshots.images_manifest JSONB.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from werkzeug.datastructures import FileStorage
from werkzeug.exceptions import BadRequest, NotFound

import db
from db import queries as Q
from utils import sanitize_filename

IMAGES_BASE = Path(os.environ.get('IMAGES_BASE', 'images'))
ALLOWED_MIMES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'}
MAX_SIZE_BYTES = 25 * 1024 * 1024  # 25 MB


def _snapshot_dir(teacher_id: int, snapshot_id: int) -> Path:
    return IMAGES_BASE / str(teacher_id) / str(snapshot_id)


def _get_manifest(conn, teacher_id: int, snapshot_id: int) -> list[dict]:
    row = conn.execute(Q.GET_SNAPSHOT, (snapshot_id, teacher_id)).fetchone()
    if not row:
        raise NotFound(description="Snapshot not found.")
    manifest = row[5]
    if isinstance(manifest, list):
        return manifest
    if isinstance(manifest, str):
        return json.loads(manifest)
    return []


def _save_manifest(conn, teacher_id: int, snapshot_id: int, manifest: list[dict]) -> None:
    conn.execute(
        Q.UPDATE_SNAPSHOT_IMAGES_MANIFEST,
        (json.dumps(manifest), snapshot_id, teacher_id),
    )


def upload_image(
    teacher_id: int,
    snapshot_id: int,
    file_storage: FileStorage,
    original_filename: str,
) -> dict:
    data = file_storage.read()
    if len(data) > MAX_SIZE_BYTES:
        raise BadRequest(description=f"File exceeds {MAX_SIZE_BYTES // (1024 * 1024)} MB limit.")

    try:
        import magic as _magic
        mime = _magic.from_buffer(data[:2048], mime=True)
    except ImportError:
        # libmagic not installed — fall back to extension-based detection
        ext = os.path.splitext(original_filename.lower())[1]
        ext_mime = {'.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml'}
        mime = ext_mime.get(ext, 'application/octet-stream')
    if mime not in ALLOWED_MIMES:
        raise BadRequest(description=f"File type '{mime}' is not allowed.")

    safe_name = sanitize_filename(original_filename)
    dest_dir = _snapshot_dir(teacher_id, snapshot_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe_name

    # Avoid overwriting — append counter
    counter = 1
    stem = dest_path.stem
    suffix = dest_path.suffix
    while dest_path.exists():
        dest_path = dest_dir / f"{stem}_{counter}{suffix}"
        counter += 1

    dest_path.write_bytes(data)

    entry = {
        'filename': dest_path.name,
        'size': len(data),
        'mime': mime,
        'uploaded_at': datetime.now(timezone.utc).isoformat(),
    }

    with db.get_conn() as conn:
        manifest = _get_manifest(conn, teacher_id, snapshot_id)
        manifest.append(entry)
        _save_manifest(conn, teacher_id, snapshot_id, manifest)
        conn.commit()

    return entry


def list_images(teacher_id: int, snapshot_id: int) -> list[dict]:
    with db.get_conn() as conn:
        return _get_manifest(conn, teacher_id, snapshot_id)


def delete_image(teacher_id: int, snapshot_id: int, filename: str) -> None:
    safe_name = sanitize_filename(filename)
    dest_path = _snapshot_dir(teacher_id, snapshot_id) / safe_name

    with db.get_conn() as conn:
        manifest = _get_manifest(conn, teacher_id, snapshot_id)
        new_manifest = [e for e in manifest if e.get('filename') != safe_name]
        if len(new_manifest) == len(manifest):
            raise NotFound(description=f"Image '{safe_name}' not found in manifest.")
        _save_manifest(conn, teacher_id, snapshot_id, new_manifest)
        conn.commit()

    if dest_path.exists():
        dest_path.unlink(missing_ok=True)


def clear_snapshot_images(teacher_id: int, snapshot_id: int) -> int:
    snapshot_dir = _snapshot_dir(teacher_id, snapshot_id)
    deleted = 0
    with db.get_conn() as conn:
        manifest = _get_manifest(conn, teacher_id, snapshot_id)
        for entry in manifest:
            path = snapshot_dir / entry.get('filename', '')
            if path.exists():
                path.unlink(missing_ok=True)
                deleted += 1
        _save_manifest(conn, teacher_id, snapshot_id, [])
        conn.commit()
    return deleted


def image_url(teacher_id: int, snapshot_id: int, filename: str) -> str:
    """URL path served by Nginx (or Flask in dev)."""
    return f"/images/{teacher_id}/{snapshot_id}/{filename}"
