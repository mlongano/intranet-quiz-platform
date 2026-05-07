"""
Migration script: v2.6.0 single-tenant → intranet-quiz-platform multi-tenant.

Usage:
    python scripts/migrate_v260_to_platform.py \\
        --source /path/to/intranet-quiz-manager \\
        --owner-email mauro@school.it \\
        --owner-name "Mauro Longano"

The target DB must already have the schema applied (python -m db.migrate up).
The script aborts if the target DB already has score_entries or quiz_plans rows.
Pass --discard-in-flight to proceed even if source/quizzes/ is non-empty (plans are not migrated).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

import bcrypt
import commentjson
import psycopg
from dotenv import load_dotenv

# ── argument parsing ──────────────────────────────────────────────────────────

parser = argparse.ArgumentParser(description="Migrate v2.6.0 single-tenant data to platform DB")
parser.add_argument('--source', required=True, help="Path to the v2.6.0 project root")
parser.add_argument('--owner-email', required=True, help="Email for the existing teacher account")
parser.add_argument('--owner-name', default='', help="Display name (default: owner-email)")
parser.add_argument('--discard-in-flight', action='store_true',
                    help="Skip in-flight quiz plans instead of aborting")
args = parser.parse_args()

SOURCE = Path(args.source).resolve()
OWNER_EMAIL = args.owner_email.strip().lower()
OWNER_NAME = args.owner_name.strip() or OWNER_EMAIL

load_dotenv(Path(__file__).parent.parent / '.env')
DSN = os.environ.get('DATABASE_URL', 'postgresql:///quizparty')

IMAGES_BASE = Path(__file__).parent.parent / 'images'


# ── helpers ───────────────────────────────────────────────────────────────────

def _slugify(text: str) -> str:
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    return text.strip('-') or 'quiz'


def _load_jsonc(path: Path) -> object:
    return commentjson.loads(path.read_text('utf-8'))


def _current_academic_year() -> str:
    now = datetime.now(timezone.utc)
    y = now.year
    return f"{y}-{y + 1}" if now.month >= 9 else f"{y - 1}-{y}"


def _copy_images(src_dir: Path, teacher_id: int, snapshot_id: int) -> list[dict]:
    manifest = []
    if not src_dir.is_dir():
        return manifest
    dest = IMAGES_BASE / str(teacher_id) / str(snapshot_id)
    dest.mkdir(parents=True, exist_ok=True)
    for f in src_dir.iterdir():
        if f.is_file():
            shutil.copy2(f, dest / f.name)
            manifest.append({
                'filename': f.name,
                'size': f.stat().st_size,
                'mime': 'image/unknown',
                'uploaded_at': datetime.now(timezone.utc).isoformat(),
            })
    return manifest


# ── main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print(f"Source: {SOURCE}")
    print(f"Owner: {OWNER_EMAIL}")
    print(f"Target DB: {DSN}")
    print()

    # Check for in-flight plans
    quizzes_dir = SOURCE / 'quizzes'
    in_flight = list(quizzes_dir.glob('*.json')) if quizzes_dir.is_dir() else []
    if in_flight and not args.discard_in_flight:
        print(f"ERROR: {len(in_flight)} in-flight quiz plan(s) found in {quizzes_dir}.")
        print("Stop the source server before migrating, then re-run.")
        print("Or pass --discard-in-flight to skip them.")
        sys.exit(1)

    with psycopg.connect(DSN) as conn:
        # Pre-flight checks
        score_count = conn.execute("SELECT COUNT(*) FROM score_entries").fetchone()[0]
        plan_count = conn.execute("SELECT COUNT(*) FROM quiz_plans").fetchone()[0]
        if score_count or plan_count:
            print("ERROR: Target DB already has data. Aborting to protect existing records.")
            sys.exit(1)

        counters = {
            'teachers': 0, 'students': 0, 'classes': 0, 'snapshots': 0,
            'sessions': 0, 'score_entries': 0, 'score_archives': 0,
            'student_snapshots': 0, 'images': 0,
        }

        # ── 1. Create owner teacher ───────────────────────────────────────────
        print("1. Creating owner teacher account...")
        temp_pw = _generate_temp_password()
        pw_hash = bcrypt.hashpw(temp_pw.encode(), bcrypt.gensalt(rounds=12)).decode()
        owner_row = conn.execute(
            """INSERT INTO teachers
                   (email, display_name, role, password_hash, password_must_change, status)
               VALUES (%s, %s, 'super_admin', %s, TRUE, 'active')
               RETURNING id""",
            (OWNER_EMAIL, OWNER_NAME, pw_hash),
        ).fetchone()
        owner_teacher_id = owner_row[0]
        counters['teachers'] += 1
        print(f"   Created teacher id={owner_teacher_id}, temp password: {temp_pw}")
        print("   ⚠  Record this password — change it at first login.")

        # ── 2. Students and classes ────────────────────────────────────────────
        print("2. Migrating students and classes...")
        academic_year = _current_academic_year()
        students_file = SOURCE / 'students.jsonc'
        class_map: dict[str, int] = {}   # group name → class_id
        student_email_to_id: dict[str, int] = {}

        if students_file.exists():
            raw = _load_jsonc(students_file)
            entries = raw if isinstance(raw, list) else []
            # Normalise to [{email, group}]
            normalised: list[dict] = []
            for entry in entries:
                if isinstance(entry, str):
                    normalised.append({'email': entry.lower(), 'group': None})
                elif isinstance(entry, dict):
                    if 'emails' in entry:
                        for e in entry['emails']:
                            normalised.append({'email': e.lower(), 'group': entry.get('group')})
                    elif 'email' in entry:
                        normalised.append({'email': entry['email'].lower(), 'group': entry.get('group')})

            for item in normalised:
                email = item['email']
                group = item.get('group')

                # Upsert student
                existing = conn.execute("SELECT id FROM students WHERE email = %s", (email,)).fetchone()
                if existing:
                    student_id = existing[0]
                else:
                    row = conn.execute(
                        """INSERT INTO students (email, display_name, status)
                           VALUES (%s, %s, 'active') RETURNING id""",
                        (email, email.split('@')[0]),
                    ).fetchone()
                    student_id = row[0]
                    counters['students'] += 1
                student_email_to_id[email] = student_id

                # Class
                if group:
                    if group not in class_map:
                        row = conn.execute(
                            """INSERT INTO classes (name, academic_year)
                               VALUES (%s, %s)
                               ON CONFLICT (name, academic_year) DO UPDATE SET name = EXCLUDED.name
                               RETURNING id""",
                            (group, academic_year),
                        ).fetchone()
                        class_map[group] = row[0]
                        conn.execute(
                            "INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                            (class_map[group], owner_teacher_id),
                        )
                        counters['classes'] += 1
                    conn.execute(
                        "INSERT INTO class_students (class_id, student_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (class_map[group], student_id),
                    )

        print(f"   {counters['students']} students, {counters['classes']} classes")

        # ── 3. Active question bank (questions.jsonc) ─────────────────────────
        print("3. Migrating active question bank...")
        active_snapshot_id: int | None = None
        questions_file = SOURCE / 'questions.jsonc'
        if questions_file.exists():
            parsed = _load_jsonc(questions_file)
            title = parsed.get('title', 'Imported Quiz')
            slug = _slugify(title)
            content = json.dumps({'questions': parsed.get('questions', [])})
            row = conn.execute(
                """INSERT INTO question_snapshots (teacher_id, title, slug, content)
                   VALUES (%s, %s, %s, %s) RETURNING id""",
                (owner_teacher_id, title, slug, content),
            ).fetchone()
            active_snapshot_id = row[0]
            counters['snapshots'] += 1

            # Copy active images
            active_images_dir = SOURCE / 'images'
            manifest = _copy_images(active_images_dir, owner_teacher_id, active_snapshot_id)
            if manifest:
                conn.execute(
                    "UPDATE question_snapshots SET images_manifest = %s WHERE id = %s",
                    (json.dumps(manifest), active_snapshot_id),
                )
                counters['images'] += len(manifest)
            print(f"   Snapshot id={active_snapshot_id}: '{title}' ({len(parsed.get('questions',[]))} questions)")

        # ── 4. Question bank files ────────────────────────────────────────────
        print("4. Migrating question bank files...")
        qbank_dir = SOURCE / 'banks' / 'question_bank'
        if qbank_dir.is_dir():
            for f in sorted(qbank_dir.glob('*.jsonc')):
                try:
                    parsed = _load_jsonc(f)
                except Exception as e:
                    print(f"   WARN: Could not parse {f.name}: {e}")
                    continue
                title = parsed.get('title', f.stem)
                slug_base = _slugify(title)
                # Ensure slug uniqueness
                slug = slug_base
                counter = 1
                while conn.execute(
                    "SELECT 1 FROM question_snapshots WHERE teacher_id = %s AND slug = %s",
                    (owner_teacher_id, slug),
                ).fetchone():
                    slug = f"{slug_base}-{counter}"
                    counter += 1

                content = json.dumps({'questions': parsed.get('questions', [])})
                mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
                row = conn.execute(
                    """INSERT INTO question_snapshots (teacher_id, title, slug, content, created_at, updated_at)
                       VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
                    (owner_teacher_id, title, slug, content, mtime, mtime),
                ).fetchone()
                snap_id = row[0]
                counters['snapshots'] += 1

                # Copy images (folder convention: {stem}_images/)
                images_dir = qbank_dir / f"{f.stem}_images"
                manifest = _copy_images(images_dir, owner_teacher_id, snap_id)
                if manifest:
                    conn.execute(
                        "UPDATE question_snapshots SET images_manifest = %s WHERE id = %s",
                        (json.dumps(manifest), snap_id),
                    )
                    counters['images'] += len(manifest)

        print(f"   {counters['snapshots']} total snapshots, {counters['images']} images copied")

        # ── 5. Synthesise a closed session for scores.jsonc ───────────────────
        print("5. Migrating scores...")
        migrated_session_id: int | None = None
        scores_file = SOURCE / 'scores.jsonc'
        if scores_file.exists() and active_snapshot_id is not None:
            try:
                scores_data = _load_jsonc(scores_file)
            except Exception as e:
                print(f"   WARN: Could not parse scores.jsonc: {e}")
                scores_data = []
            if isinstance(scores_data, list) and scores_data:
                earliest_ts = None
                for entry in scores_data:
                    ts_str = entry.get('timestamp')
                    if ts_str:
                        try:
                            ts = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                            if earliest_ts is None or ts < earliest_ts:
                                earliest_ts = ts
                        except Exception:
                            pass
                earliest_ts = earliest_ts or datetime.now(timezone.utc)

                # Create synthetic closed session
                row = conn.execute(
                    """INSERT INTO quiz_sessions
                           (teacher_id, snapshot_id, title, status, created_at)
                       VALUES (%s, %s, %s, 'closed', %s)
                       RETURNING id""",
                    (owner_teacher_id, active_snapshot_id,
                     f"Migrated — {SOURCE.name}", earliest_ts),
                ).fetchone()
                migrated_session_id = row[0]
                counters['sessions'] += 1

                # Attach all classes to this session
                for class_id in class_map.values():
                    conn.execute(
                        "INSERT INTO session_classes (session_id, class_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (migrated_session_id, class_id),
                    )

                for entry in scores_data:
                    email = (entry.get('student') or '').lower()
                    # Ensure student exists
                    s_id = student_email_to_id.get(email)
                    if not s_id:
                        existing_s = conn.execute("SELECT id FROM students WHERE email = %s", (email,)).fetchone()
                        if existing_s:
                            s_id = existing_s[0]
                        else:
                            row2 = conn.execute(
                                "INSERT INTO students (email, display_name) VALUES (%s, %s) RETURNING id",
                                (email, email.split('@')[0]),
                            ).fetchone()
                            s_id = row2[0]
                            student_email_to_id[email] = s_id
                            print(f"   WARN: Student '{email}' not in students.jsonc — created anyway")

                    ts_str = entry.get('timestamp')
                    submitted_at = datetime.now(timezone.utc)
                    if ts_str:
                        try:
                            submitted_at = datetime.fromisoformat(ts_str.replace('Z', '+00:00'))
                        except Exception:
                            pass

                    conn.execute(
                        """INSERT INTO score_entries
                               (session_id, student_id, teacher_id,
                                raw_points, max_points, percent, answers, submitted_at)
                           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                           ON CONFLICT (session_id, student_id) DO NOTHING""",
                        (
                            migrated_session_id, s_id, owner_teacher_id,
                            entry.get('raw_points', 0),
                            entry.get('max_points', 100),
                            entry.get('percent', 0),
                            json.dumps(entry.get('answers', [])),
                            submitted_at,
                        ),
                    )
                    counters['score_entries'] += 1

        print(f"   {counters['score_entries']} score entries in session id={migrated_session_id}")

        # ── 6. Score archives ─────────────────────────────────────────────────
        print("6. Migrating score archives...")
        sbank = SOURCE / 'banks' / 'scores_bank'
        if sbank.is_dir():
            for f in sorted(sbank.glob('*.jsonc')):
                try:
                    data = _load_jsonc(f)
                except Exception as e:
                    print(f"   WARN: {f.name}: {e}")
                    continue
                mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
                conn.execute(
                    """INSERT INTO score_archives (teacher_id, title, content, archived_at)
                       VALUES (%s, %s, %s, %s)""",
                    (owner_teacher_id, f.stem, json.dumps(data), mtime),
                )
                counters['score_archives'] += 1
        print(f"   {counters['score_archives']} score archives")

        # ── 7. Student list snapshots ─────────────────────────────────────────
        print("7. Migrating student list snapshots...")
        stbank = SOURCE / 'banks' / 'students_bank'
        if stbank.is_dir():
            for f in sorted(stbank.glob('*.jsonc')):
                try:
                    data = _load_jsonc(f)
                except Exception as e:
                    print(f"   WARN: {f.name}: {e}")
                    continue
                mtime = datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc)
                conn.execute(
                    """INSERT INTO student_list_snapshots (teacher_id, title, content, created_at)
                       VALUES (%s, %s, %s, %s)""",
                    (owner_teacher_id, f.stem, json.dumps(data), mtime),
                )
                counters['student_snapshots'] += 1
        print(f"   {counters['student_snapshots']} student list snapshots")

        conn.commit()

    # ── summary ───────────────────────────────────────────────────────────────
    print()
    print("=" * 60)
    print("Migration complete.")
    print(f"  teachers:          {counters['teachers']}")
    print(f"  students:          {counters['students']}")
    print(f"  classes:           {counters['classes']}")
    print(f"  snapshots:         {counters['snapshots']}")
    print(f"  sessions:          {counters['sessions']}")
    print(f"  score entries:     {counters['score_entries']}")
    print(f"  score archives:    {counters['score_archives']}")
    print(f"  student snapshots: {counters['student_snapshots']}")
    print(f"  images copied:     {counters['images']}")
    print()
    print(f"Super-admin login:  {OWNER_EMAIL}")
    print("Change the password at first login (forced).")
    print("=" * 60)


def _generate_temp_password(length: int = 12) -> str:
    import secrets
    import string
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


if __name__ == '__main__':
    main()
