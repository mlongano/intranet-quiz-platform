# Code Context

## Files Retrieved

1. `scripts/recover_legacy_quizparty.py` (lines 1-630) — Read-only dry-run recovery planner for legacy QuizParty data. Two-phase: `--dry-run` produces human-reviewable reports, `--apply` writes importable rows to PostgreSQL. Uses question-text fuzzy-matching (SequenceMatcher ≥94%) to pair score files with question banks when embedded `question_snapshot` fields are missing.

2. `scripts/migrate_v260_to_platform.py` (lines 1-280) — Single-pass migration from v2.6.0 single-tenant file-based QuizParty to multi-tenant PostgreSQL. Creates owner teacher, imports students.jsonc, active questions.jsonc, bank files, scores, and archives. Pre-flight guards: aborts if `score_entries` or `quiz_plans` rows exist; aborts if in-flight quiz plans exist in `quizzes/` directory.

3. `scripts/import_new_scores.py` (lines 1-160) — Targeted import for three specific new-format score files from local-quizzies. Hardcoded snapshot-id-to-filename mapping. Used for one-off imports of scores that already contain `question_snapshot` embeddings.

4. `tests/conftest.py` (lines 1-210) — Pytest infrastructure using psycopg pool. Three-layer safety: (a) name-check on DATABASE_URL (must contain "test"), (b) session-scoped `apply_schema` fixture that runs migrations and truncates on teardown, (c) function-scoped `db_conn` that truncates again before each test. Data helpers (`make_teacher`, `make_student`, `make_snapshot`, `make_session`) commit directly so Flask routes see the rows through the pool.

5. `scripts/run_tests_safe.sh` (lines 1-40) — Docker entry point for tests. Creates `quizparty_test` DB if missing. Passes `TEST_DATABASE_URL` so `conftest.py` redirects all DB access to the isolated test database. Disallows running pytest directly inside the app container.

6. `docs/OPERATIONS.md` — Deployment, backup, restore, test, and LLM prompt documentation.

7. `db/__init__.py` (lines 1-40) — Connection pool module (`psycopg_pool.ConnectionPool`). Singleton pool managed by `init_pool()`/`get_pool()`/`get_conn()`.

8. `db/migrate.py` (lines 1-70) — Migration runner: scans `db/migrations/*.sql`, tracks applied versions in `schema_migrations` table.

9. `auth/jwt_utils.py` (lines 1-80) — JWT encode/decode for teacher, student, and password-change tokens. Uses HS256. Enforces ≥32-character secret.

10. `tests/test_isolation.py`, `tests/test_concurrency.py`, `tests/test_quiz_lifecycle.py` — Existing test suites exercising tenancy isolation (teacher A cannot access teacher B's resources), 30-student concurrent submission, and full quiz lifecycle.

## Key Code

### Pre-flight guard pattern (present in all three import scripts)

```python
# migrate_v260_to_platform.py (lines ~70-74)
score_count = conn.execute("SELECT COUNT(*) FROM score_entries").fetchone()[0]
plan_count = conn.execute("SELECT COUNT(*) FROM quiz_plans").fetchone()[0]
if score_count or plan_count:
    print("ERROR: Target DB already has data. Aborting to protect existing records.")
    sys.exit(1)
```

```python
# recover_legacy_quizparty.py (lines ~508-510, apply_recovery function)
existing_scores = conn.execute('SELECT COUNT(*) FROM score_entries').fetchone()[0]
existing_plans = conn.execute('SELECT COUNT(*) FROM quiz_plans').fetchone()[0]
if existing_scores or existing_plans:
    raise RuntimeError('Target DB already has score_entries or quiz_plans; refusing to apply recovery.')
```

### Test DB name guard (conftest.py lines 34-39)

```python
_database_url = os.environ['DATABASE_URL']
if 'test' not in _database_url.rsplit('/', 1)[-1].lower():
    raise RuntimeError(
        "Refusing to run tests against a non-test database. "
        "Set TEST_DATABASE_URL or DATABASE_URL to a database whose name contains 'test'."
    )
```

### Duplicated utility functions across scripts

| Function | `recover_legacy_quizparty.py` | `migrate_v260_to_platform.py` | `import_new_scores.py` | `utils.py` (shared) |
|---|---|---|---|---|
| `slugify` / `_slugify` | ✅ (line 97, `slugify`) | ✅ (line 53, `_slugify`) | — | ✅ (line 34) |
| `generate_temp_password` | ✅ (line 104) | ✅ (line 270, `_generate_temp_password`) | — | — |
| `current_academic_year` | ✅ (line 109) | ✅ (line 64, `_current_academic_year`) | — | — |
| `educate_teacher` | ✅ (line 467) | Inline (lines ~115-125) | Inline | — |
| `educate_student` | ✅ (line 482) | Inline (lines ~135-145) | Inline (lines ~85-100) | — |
| `educate_class` | ✅ (line 499) | Inline (lines ~148-160) | — | — |
| `insert_snapshot` | ✅ (line 515) | Inline (lines ~185-206) | — | — |
| `copy_images` / `_copy_images` | ✅ (line 545, `copy_bank_images`) | ✅ (line 70, `_copy_images`) | — | — |

### Dry-run / apply split pattern (recover_legacy_quizparty.py)

```python
# Analyse (dry-run, read-only): no DB connection at all
def analyse_score_file(path, banks) -> ScoreFileReport: ...

# Apply: reads the dry-run report, writes to DB
def apply_recovery(source, report_path, teacher_email, ...) -> dict: ...
```

### Embedded snapshot reconstruction (recover_legacy_quizparty.py lines 429-465)

```python
def embedded_questions_from_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Build the exact session snapshot from embedded answer snapshots.

    Quiz questions are randomized per student, so rows may have different order.
    Use the first complete row as canonical order, but validate other rows by
    question identity (id/text), not by position.
    """
```

## Architecture

### Module structure

```
scripts/
├── recover_legacy_quizparty.py   # Dry-run report + apply (630 lines)
├── migrate_v260_to_platform.py    # Single-pass migration (280 lines)
└── import_new_scores.py           # Targeted one-off import (160 lines)

tests/
├── conftest.py                    # DB safety, schema bootstrap, data helpers (210 lines)
├── test_quiz_lifecycle.py         # Session → submit lifecycle
├── test_concurrency.py            # 30-student simultaneous submit
├── test_isolation.py              # Teacher-A cannot access Teacher-B
├── test_regrade_open.py           # Regrade-open LLM path
└── ...

scripts/run_tests_safe.sh          # Docker test entry point

db/
├── __init__.py                    # Connection pool (40 lines)
├── migrate.py                     # Migration runner (70 lines)
├── queries.py                     # Named SQL constants
└── migrations/*.sql               # Schema files
```

### How the pieces connect

1. **Import path (scripts → DB)**: All three import scripts establish their own `psycopg` connections directly (bypass the `db` module's pool), load `.env` for DATABASE_URL, and write to PostgreSQL. They share ~60% of logic (ensure_teacher/student/class, temp password generation, image copying, slug creation) but each reimplements it inline.

2. **Test safety path (scripts/run_tests_safe.sh → tests/conftest.py → db module)**: The shell script creates the test DB and sets `TEST_DATABASE_URL`. conftest.py checks the DB name for "test", applies migrations via the `db` pool, and truncates all tables both at session teardown and before each test function. Data helpers commit through the pool's connections so Flask routes see the data.

3. **Script safety path (scripts → pre-flight guards)**: Each import script checks that `score_entries` and `quiz_plans` are empty before proceeding. This prevents double-import. There's no analogous safety for `run_tests_safe.sh` — it relies on conftest.py's name-guard.

### Safety architecture visualized

```
                        ┌──────────────────────────┐
                        │   scripts/run_tests_safe  │
                        │   Creates quizparty_test  │
                        │   Sets TEST_DATABASE_URL  │
                        └─────────┬────────────────┘
                                  │ env var
                        ┌─────────▼────────────────┐
                        │   tests/conftest.py       │
                        │   Name guard: "test" in   │
                        │   DB name → RuntimeError  │
                        │   if missing              │
                        │                           │
                        │   apply_schema (session)  │
                        │     → runs migrations     │
                        │     → teardown: TRUNCATE  │
                        │       ALL TABLES CASCADE  │
                        │                           │
                        │   db_conn (per-test)      │
                        │     → TRUNCATE ALL TABLES │
                        │       CASCADE again       │
                        └──────────────────────────┘

                        ┌──────────────────────────┐
                        │   Scripts (import/recover) │
                        │   Pre-flight guard:       │
                        │   COUNT(*) score_entries  │
                        │   + quiz_plans == 0       │
                        │   → abort if non-zero     │
                        │                           │
                        │   Direct psycopg.connect() │
                        │   (bypasses db pool)       │
                        └──────────────────────────┘
```

### Test data helper commital pattern

The `make_*` helpers in conftest.py use `conn.commit()` after each insert. This is necessary because Flask routes use the `db` pool (different connections), so uncommitted test data is invisible. The `db_conn` fixture's pre-test truncation ensures isolation despite committed data. This is a deliberate **seam**: the helpers commit so routes see the data, and the truncation is the compensating action.

## Deepening Opportunities

### Candidate 1: Extract shared import infrastructure into `scripts/import_lib.py`

**Files affected**: `recover_legacy_quizparty.py`, `migrate_v260_to_platform.py`, `import_new_scores.py` → new `scripts/import_lib.py`

**Problem**: Three import scripts duplicate ~60% of their logic: slug generation, temporary password creation, academic year calculation, `ensure_teacher`/`ensure_student`/`ensure_class` upsert patterns, image copying, snapshot insertion with slug uniqueness, and pre-flight guards. This is a **locality** failure — related functions are copy-pasted across module boundaries. When a bug is discovered in one (e.g., slug collision handling), it must be fixed in three places. The duplication also makes it harder to migrate from direct `psycopg.connect()` to the shared `db` pool if that ever becomes desirable.

**Solution**: Extract a `scripts/import_lib.py` module that provides:
- `generate_temp_password(length=14) -> str`
- `slugify_unique(conn, teacher_id, title) -> str` (handles collision loop)
- `current_academic_year() -> str`
- `ensure_teacher(conn, email, display_name, role) -> int` (returns id, tracks temp passwords)
- `ensure_student(conn, email, student_cache) -> int`
- `ensure_class(conn, name, year, teacher_id, class_cache) -> int`
- `insert_snapshot(conn, teacher_id, title, questions, created_at) -> int`
- `copy_snapshot_images(src_dir, teacher_id, snapshot_id, images_base) -> int`
- `check_target_is_empty(conn) -> None` (the pre-flight guard)

**Benefits**:
- Single point of correctness for all import operations
- Reduces total code by approximately 200 lines (deduplication)
- Makes `import_new_scores.py` ~50 lines (currently 160, mostly boilerplate)
- Enables future refactor: swap `psycopg.connect()` → `db.get_conn()` in one place
- The `generate_temp_password` and `slugify_unique` functions already exist in `utils.py` — they should be used, not reimplemented

### Candidate 2: Add integration-test scaffold for import/recovery scripts

**Files affected**: New `tests/test_import_recovery.py`, `tests/conftest.py`

**Problem**: The three import scripts have zero automated tests. They run against live production databases and mutable legacy source directories. A regression in question-matching logic (`build_question_match_map` in recovery), timestamp parsing (`parse_timestamp`), or the embedded snapshot reconstruction (`embedded_questions_from_rows`) could silently corrupt score data. The **depth** of the current test safety net is shallow — it covers quiz lifecycle, concurrency, and isolation, but not the data import/recovery path. This is a **seam** gap: the test infrastructure and the operational scripts don't connect.

**Solution**: Add a test fixture that:
1. Creates a temporary directory with a synthetic legacy QuizParty structure (students.jsonc, questions.jsonc, banks/, scores.jsonc)
2. Runs `recover_legacy_quizparty.py --source <tmpdir> --out-dir <tmpdir> --apply` against the test DB
3. Asserts the expected DB state (correct student count, snapshot count, session count, score entry count, answer content)

Use the existing `db_conn` fixture and the test DB safety infrastructure. The synthetic source directory can be driven from the `SAMPLE_JSONC` constant already in conftest.py.

**Benefits**:
- Catches regressions in question-matching, answer enrichment, and snapshot reconstruction
- Gives confidence when refactoring shared import infrastructure (Candidate 1)
- The synthetic source directory doubles as documentation of the expected legacy format
- Test runs in the same Docker test stack via `scripts/run_tests_safe.sh`

### Candidate 3: Replace dynamic table discovery in conftest.py with explicit table registry

**Files affected**: `tests/conftest.py`, `db/migrate.py` (optional)

**Problem**: Both `apply_schema` teardown (line ~50) and `db_conn` pre-test cleanup (line ~64) discover tables dynamically via `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`. This is an **interface** fragility: if a migration adds a table with circular foreign keys or a table owned by an extension, the `TRUNCATE ... CASCADE` loop can fail. Additionally, the double-truncation (session teardown + per-test) is redundant — only one is needed if the per-test truncation is reliable. The current approach has weak **leverage**: it works for the current schema but provides no guarantee for future migrations.

**Solution**: Introduce a known table list in `db/migrate.py` or a new `db/tables.py`:
```python
APP_TABLES = [
    'score_entries', 'quiz_plans', 'session_classes', 'class_students',
    'class_teachers', 'quiz_sessions', 'question_snapshots',
    'student_list_snapshots', 'score_archives', 'classes', 'students', 'teachers'
]
```

In conftest.py, replace the dynamic loop with:
```python
conn.execute("TRUNCATE TABLE {} CASCADE".format(', '.join(APP_TABLES)))
```

This eliminates the dynamic query and runs a single TRUNCATE statement (faster, atomic). Add a test that asserts every migration-created table is in the list (compare `pg_tables` against `APP_TABLES` after migrations apply).

**Benefits**:
- Single, atomic TRUNCATE instead of N separate statements in a loop
- Fails fast if a migration adds a table not yet registered (catch via the registry test)
- Removes redundant double-truncation (session teardown can be simplified to just `pool.close()`)
- The table registry also serves as documentation of the data model

## Start Here

Begin with `scripts/recover_legacy_quizparty.py` — it's the most complex script (~630 lines), introduces the dry-run/apply pattern, and contains the question-matching logic and embedded-snapshot reconstruction that the other import scripts lack. Understanding it will clarify the full import architecture.
