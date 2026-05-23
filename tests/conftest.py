"""
Shared pytest fixtures for the multi-tenant platform.

Requires a live PostgreSQL instance. Set TEST_DATABASE_URL in the environment,
or it falls back to 'postgresql:///quizparty_test'.

Each test session gets a fresh schema applied via db/migrate.py logic; each
test function gets its own transaction that is rolled back on teardown so tests
are isolated without needing to truncate tables.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
import pytest

# ── make the repo root importable ────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

# ── env setup ─────────────────────────────────────────────────────────────────

os.environ.setdefault('DATABASE_URL', 'postgresql:///quizparty_test')
os.environ.setdefault('JWT_SECRET', 'test-secret-not-for-production')
os.environ.setdefault('JWT_TEACHER_TTL_HOURS', '12')
os.environ.setdefault('IMAGES_BASE', '/tmp/quizparty_test_images')

# ── schema bootstrap (session-scoped) ────────────────────────────────────────

@pytest.fixture(scope='session', autouse=True)
def apply_schema():
    """Apply migrations to the test DB once per test session."""
    import db
    db.init_pool(dsn=os.environ['DATABASE_URL'], min_size=1, max_size=4)

    migrations_dir = REPO_ROOT / 'db' / 'migrations'
    with db.get_conn() as conn:
        # Tracking table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
        """)
        applied = {r[0] for r in conn.execute("SELECT version FROM schema_migrations").fetchall()}

        for sql_file in sorted(migrations_dir.glob('*.sql')):
            version = sql_file.stem
            if version in applied:
                continue
            conn.execute(sql_file.read_text())
            conn.execute("INSERT INTO schema_migrations (version) VALUES (%s)", (version,))

        conn.commit()

    yield

    # Teardown: drop all data tables so subsequent sessions start clean.
    with db.get_conn() as conn:
        conn.execute("""
            DO $$ DECLARE r RECORD;
            BEGIN
              FOR r IN (
                SELECT tablename FROM pg_tables
                WHERE schemaname = 'public' AND tablename != 'schema_migrations'
              ) LOOP
                EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
              END LOOP;
            END $$;
        """)
        conn.commit()
    # Close and reopen pool so next session gets fresh connections
    db.get_pool().close()
    db.init_pool(dsn=os.environ['DATABASE_URL'], min_size=1, max_size=4)


@pytest.fixture()
def db_conn(apply_schema):
    """Per-test DB connection. Data helpers commit, so isolation relies on
    TRUNCATE in the session teardown + fresh pool after apply_schema."""
    import db as _db
    with _db.get_conn() as conn:
        yield conn


# ── Flask test client ─────────────────────────────────────────────────────────

@pytest.fixture(scope='session')
def flask_app(apply_schema):
    import db
    from server import APP
    APP.config['TESTING'] = True
    yield APP


@pytest.fixture()
def client(flask_app):
    with flask_app.test_client() as c:
        yield c


# ── data helpers ──────────────────────────────────────────────────────────────

SAMPLE_JSONC = """{
  "title": "Test Quiz",
  "questions": [
    {"id": "q1", "type": "single", "text": "What is 2+2?",
     "options": ["3", "4", "5"], "correct": 1, "weight": 1},
    {"id": "q2", "type": "multiple", "text": "Which are prime?",
     "options": ["2", "3", "4", "5"], "correct": [0, 1, 3], "weight": 2},
    {"id": "q3", "type": "open", "text": "Explain gravity.",
     "correct": ["gravity", "mass"], "weight": 1}
  ]
}"""


def make_teacher(conn, email='teacher@test.it', role='teacher', display_name='Test Teacher'):
    import bcrypt
    from db import queries as Q
    pw_hash = bcrypt.hashpw(b'Password123!', bcrypt.gensalt()).decode()
    row = conn.execute(
        """INSERT INTO teachers (email, display_name, role, password_hash, password_must_change, status)
           VALUES (%s, %s, %s, %s, false, 'active') RETURNING id""",
        (email, display_name, role, pw_hash),
    ).fetchone()
    conn.commit()
    return row[0]


def make_student(conn, email='student@test.it', display_name='Test Student'):
    row = conn.execute(
        """INSERT INTO students (email, display_name, status)
           VALUES (%s, %s, 'active') RETURNING id""",
        (email, display_name),
    ).fetchone()
    conn.commit()
    return row[0]


def make_class(conn, name='5CI', year='2026-2027'):
    row = conn.execute(
        "INSERT INTO classes (name, academic_year) VALUES (%s, %s) RETURNING id",
        (name, year),
    ).fetchone()
    conn.commit()
    return row[0]


def make_snapshot(conn, teacher_id, title='Test Quiz', jsonc=SAMPLE_JSONC):
    import commentjson
    from utils import slugify
    content = commentjson.loads(jsonc)
    slug = slugify(title)
    row = conn.execute(
        """INSERT INTO question_snapshots (teacher_id, title, slug, content, images_manifest)
           VALUES (%s, %s, %s, %s::jsonb, '[]'::jsonb) RETURNING id""",
        (teacher_id, title, slug, commentjson.dumps(content)),
    ).fetchone()
    conn.commit()
    return row[0]


def make_session(conn, teacher_id, snapshot_id, class_ids=None, status='draft'):
    row = conn.execute(
        """INSERT INTO quiz_sessions (teacher_id, snapshot_id, title, status)
           VALUES (%s, %s, 'Test Session', %s) RETURNING id""",
        (teacher_id, snapshot_id, status),
    ).fetchone()
    session_id = row[0]
    if class_ids:
        for cid in class_ids:
            conn.execute(
                "INSERT INTO session_classes (session_id, class_id) VALUES (%s, %s)",
                (session_id, cid),
            )
    conn.commit()
    return session_id


def teacher_token(teacher_id, role='teacher', email='teacher@test.it'):
    from auth.jwt_utils import encode_teacher_token
    return encode_teacher_token(teacher_id, role, email)


def student_token(student_id, session_id):
    from auth.jwt_utils import encode_student_token
    return encode_student_token(student_id, session_id)
