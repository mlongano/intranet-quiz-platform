#!/usr/bin/env python3
"""Report image paths still stored in the legacy single-segment form.

Images live at images/{teacher_id}/{snapshot_id}/{file}. Rows written before
the multi-tenant migration may still reference images/{snapshot_id}/{file},
which only resolves through a cross-tenant directory scan in the image route.

Read-only. Run before removing that fallback:

    DATABASE_URL=... uv run scripts/check_legacy_image_paths.py

Exit code 0 means no legacy path is referenced and the fallback can go.
"""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import db  # noqa: E402

# Matches an /images/... reference and captures the part after the prefix.
IMAGE_REF = re.compile(r'/images/([^"\'\s\\]+)')


def _legacy_refs(blob: str) -> set[str]:
    """A reference is legacy when it has a single path segment before the file."""
    found = set()
    for ref in IMAGE_REF.findall(blob or ''):
        if ref.count('/') < 2:
            found.add(ref)
    return found


def main() -> int:
    db.init_pool(
        dsn=os.environ.get('DATABASE_URL', 'postgresql:///quizparty'),
        min_size=1,
        max_size=2,
    )

    findings: dict[str, set[str]] = {}
    with db.get_conn() as conn:
        for label, query in (
            ('question_snapshots.content',
             "SELECT id, content::text FROM question_snapshots"),
            ('question_snapshots.images_manifest',
             "SELECT id, images_manifest::text FROM question_snapshots"),
            ('score_entries.answers',
             "SELECT id, answers::text FROM score_entries"),
        ):
            for row_id, blob in conn.execute(query).fetchall():
                refs = _legacy_refs(blob)
                if refs:
                    findings.setdefault(f"{label}#{row_id}", set()).update(refs)
        conn.commit()

    if not findings:
        print("No legacy single-segment image paths found.")
        return 0

    total = sum(len(v) for v in findings.values())
    print(f"Found {total} legacy image reference(s) in {len(findings)} row(s):")
    for location, refs in sorted(findings.items()):
        for ref in sorted(refs):
            print(f"  {location}: /images/{ref}")
    print("\nRewrite these to /images/{teacher_id}/{snapshot_id}/{file} "
          "before removing the fallback in server.py.")
    return 1


if __name__ == '__main__':
    raise SystemExit(main())
