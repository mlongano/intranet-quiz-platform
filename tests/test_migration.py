"""
test_migration.py — verify scripts/migrate_v260_to_platform.py.

Creates a minimal v2.6.0 fixture directory, runs the migration as a
subprocess against the test DB, then asserts that every table has the
expected row count.

Requires: TEST_DATABASE_URL or DATABASE_URL pointing to quizparty_test.
The schema must already be applied (apply_schema fixture from conftest.py).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import psycopg
import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
TEST_DSN = os.environ.get('DATABASE_URL', 'postgresql:///quizparty_test')

# ── ordered so TRUNCATE CASCADE works without FK violations ───────────────────
_ALL_TABLES = [
    'sync_runs', 'student_list_snapshots', 'score_archives',
    'score_entries', 'quiz_plans', 'session_classes', 'quiz_sessions',
    'question_snapshots', 'class_students', 'class_teachers',
    'classes', 'students', 'teachers',
]


# ── fixture data ──────────────────────────────────────────────────────────────

_STUDENTS = json.dumps([
    {"emails": ["alice@school.it", "bob@school.it"], "group": "5CI"},
    {"emails": ["carol@school.it"], "group": "5BI"},
])

_QUESTIONS = json.dumps({
    "title": "Java Basics",
    "questions": [
        {"id": "q1", "type": "single", "text": "What is JVM?",
         "options": ["Acronym", "Tool"], "correct": 0, "weight": 1},
        {"id": "q2", "type": "open", "text": "Explain OOP.",
         "correct": ["object", "class"], "weight": 2},
        {"id": "q3", "type": "single", "text": "Byte size?",
         "options": ["8", "16"], "correct": 0, "weight": 1},
    ],
})

_SCORES = json.dumps([
    {
        "student": "alice@school.it",
        "timestamp": "2026-04-10T09:00:00+00:00",
        "raw_points": 3.0, "max_points": 4.0, "percent": 75.0,
        "answers": [],
    },
    {
        "student": "bob@school.it",
        "timestamp": "2026-04-10T09:05:00+00:00",
        "raw_points": 2.0, "max_points": 4.0, "percent": 50.0,
        "answers": [],
    },
])

_BANK_QUIZ = json.dumps({
    "title": "Python Quiz",
    "questions": [
        {"id": "q1", "type": "single", "text": "GIL?",
         "options": ["Yes", "No"], "correct": 0, "weight": 1},
    ],
})

_SCORES_BANK = json.dumps([
    {"student": "carol@school.it",
     "raw_points": 1.0, "max_points": 2.0, "percent": 50.0, "answers": []},
])

_STUDENTS_BANK = json.dumps([
    {"email": "alice@school.it", "display_name": "Alice"},
])


# ── helpers ───────────────────────────────────────────────────────────────────

def _build_fixture(tmp_path: Path) -> Path:
    """Build a minimal v2.6.0 project directory tree."""
    src = tmp_path / "quiz-manager-v260"
    src.mkdir()

    (src / "students.jsonc").write_text(_STUDENTS)
    (src / "questions.jsonc").write_text(_QUESTIONS)
    (src / "scores.jsonc").write_text(_SCORES)
    (src / "quizzes").mkdir()   # empty — no in-flight plans
    (src / "images").mkdir()    # no images to copy

    qbank = src / "banks" / "question_bank"
    qbank.mkdir(parents=True)
    (qbank / "python-quiz.jsonc").write_text(_BANK_QUIZ)

    sbank = src / "banks" / "scores_bank"
    sbank.mkdir(parents=True)
    (sbank / "archive-2025.jsonc").write_text(_SCORES_BANK)

    stbank = src / "banks" / "students_bank"
    stbank.mkdir(parents=True)
    (stbank / "students-2025.jsonc").write_text(_STUDENTS_BANK)

    return src


def _truncate_all() -> None:
    with psycopg.connect(TEST_DSN) as conn:
        conn.execute("TRUNCATE TABLE " + ", ".join(_ALL_TABLES) + " CASCADE")
        conn.commit()


def _run_migration(source: Path, extra_args: list[str] | None = None) -> subprocess.CompletedProcess:
    env = {**os.environ, 'DATABASE_URL': TEST_DSN}
    cmd = [
        sys.executable,
        str(REPO_ROOT / 'scripts' / 'migrate_v260_to_platform.py'),
        '--source', str(source),
        '--owner-email', 'owner@school.it',
        '--owner-name', 'Test Owner',
        *(extra_args or []),
    ]
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        env=env,
        cwd=str(REPO_ROOT),
    )


def _count(conn: psycopg.Connection, table: str, where: str = '', params: tuple = ()) -> int:
    sql = f"SELECT COUNT(*) FROM {table}"
    if where:
        sql += f" WHERE {where}"
    return conn.execute(sql, params).fetchone()[0]


# ── shared fixture: runs migration once for the entire class ──────────────────

@pytest.fixture(scope='class')
def migrated(tmp_path_factory, apply_schema):
    """Truncate DB → run migration once → yield connection → truncate DB."""
    tmp = tmp_path_factory.mktemp('migration')
    source = _build_fixture(tmp)

    _truncate_all()

    result = _run_migration(source)
    assert result.returncode == 0, (
        f"Migration failed:\n--- stdout ---\n{result.stdout}\n"
        f"--- stderr ---\n{result.stderr}"
    )

    with psycopg.connect(TEST_DSN) as conn:
        yield conn

    _truncate_all()


# ── happy-path assertions (all share one migration run) ───────────────────────

class TestHappyPath:
    def test_teacher_created(self, migrated):
        assert _count(migrated, 'teachers', "email = 'owner@school.it'") == 1

    def test_teacher_is_super_admin(self, migrated):
        row = migrated.execute(
            "SELECT role FROM teachers WHERE email = 'owner@school.it'"
        ).fetchone()
        assert row[0] == 'super_admin'

    def test_teacher_must_change_password(self, migrated):
        row = migrated.execute(
            "SELECT password_must_change FROM teachers WHERE email = 'owner@school.it'"
        ).fetchone()
        assert row[0] is True

    def test_students_migrated(self, migrated):
        # alice, bob, carol
        assert _count(migrated, 'students') == 3

    def test_classes_created(self, migrated):
        # 5CI and 5BI
        assert _count(migrated, 'classes') == 2

    def test_class_student_memberships(self, migrated):
        # alice+bob in 5CI (2), carol in 5BI (1)
        assert _count(migrated, 'class_students') == 3

    def test_teacher_assigned_to_classes(self, migrated):
        teacher_id = migrated.execute(
            "SELECT id FROM teachers WHERE email = 'owner@school.it'"
        ).fetchone()[0]
        assert _count(migrated, 'class_teachers', 'teacher_id = %s', (teacher_id,)) == 2

    def test_snapshots_migrated(self, migrated):
        # questions.jsonc (active) + python-quiz.jsonc (bank)
        assert _count(migrated, 'question_snapshots') == 2

    def test_active_snapshot_question_count(self, migrated):
        row = migrated.execute(
            "SELECT jsonb_array_length(content->'questions') "
            "FROM question_snapshots WHERE title = 'Java Basics'"
        ).fetchone()
        assert row is not None
        assert row[0] == 3

    def test_synthetic_session_created(self, migrated):
        assert _count(migrated, 'quiz_sessions', "status = 'closed'") == 1

    def test_score_entries_migrated(self, migrated):
        # alice and bob from scores.jsonc
        assert _count(migrated, 'score_entries') == 2

    def test_score_entries_teacher_id_consistent(self, migrated):
        teacher_id = migrated.execute(
            "SELECT id FROM teachers WHERE email = 'owner@school.it'"
        ).fetchone()[0]
        mismatch = _count(migrated, 'score_entries', 'teacher_id != %s', (teacher_id,))
        assert mismatch == 0

    def test_score_archives_migrated(self, migrated):
        assert _count(migrated, 'score_archives') == 1

    def test_student_list_snapshots_migrated(self, migrated):
        assert _count(migrated, 'student_list_snapshots') == 1

    def test_no_orphaned_plans(self, migrated):
        assert _count(migrated, 'quiz_plans') == 0


# ── error-case tests (each uses its own clean DB state) ───────────────────────

class TestErrorCases:
    @pytest.fixture(autouse=True)
    def clean(self, apply_schema):
        """Truncate before and after each error-case test."""
        _truncate_all()
        yield
        _truncate_all()

    def test_aborts_if_db_already_has_data(self, tmp_path):
        source = _build_fixture(tmp_path / 'src1')
        _run_migration(source)  # first run: succeeds, populates DB
        result = _run_migration(tmp_path / 'src1')  # second run: DB is not empty
        assert result.returncode != 0
        assert 'already has data' in result.stdout

    def test_aborts_if_in_flight_plans_exist(self, tmp_path):
        source = _build_fixture(tmp_path / 'src2')
        (source / 'quizzes' / 'abc123.json').write_text('{}')
        result = _run_migration(source)
        assert result.returncode != 0
        assert 'in-flight' in result.stdout

    def test_discard_in_flight_flag_bypasses_abort(self, tmp_path):
        source = _build_fixture(tmp_path / 'src3')
        (source / 'quizzes' / 'abc123.json').write_text('{}')
        result = _run_migration(source, extra_args=['--discard-in-flight'])
        assert result.returncode == 0
