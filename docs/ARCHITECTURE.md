# QuizParty — Architecture

Multi-teacher, multi-class quiz platform for school intranets. One central server,
~150 teachers, ~40 classes, ~800 students, PostgreSQL as single source of truth,
JSONC as import/export authoring format only (never persists on the server).

> Previous version: [`ARCHITECTURE-SINGLE-TENANT-FILE-BASED.md`](./ARCHITECTURE-SINGLE-TENANT-FILE-BASED.md)
> describes the v2.6.0 single-tenant file-based architecture that this replaces.
> Domain vocabulary: [`CONTEXT.md`](./CONTEXT.md)

---

## Table of Contents

1. [System Boundaries](#1-system-boundaries)
2. [Identity and Authentication](#2-identity-and-authentication)
3. [Deployment](#3-deployment)
4. [Data Model (PostgreSQL)](#4-data-model-postgresql)
5. [Directory Layout](#5-directory-layout)
6. [API Surface](#6-api-surface)
7. [Service Layer](#7-service-layer)
8. [Quiz Lifecycle](#8-quiz-lifecycle)
9. [Score Mutation: review, recalculate, regrade](#9-score-mutation-review-recalculate-regrade)
10. [Seams Map](#10-seams-map)

---

## 1. System Boundaries

```
                         ┌─────────────────────────┐
                         │  Browser (Student)       │
                         │  / → /quiz/:id → /finish │
                         │  JWT (student, short TTL) │
                         └───────────┬─────────────┘
                                     │ HTTP (:5001)
                         ┌───────────▼─────────────┐
                         │  Browser (Teacher)       │
                         │  /teacher/*              │
                         │  JWT (teacher, 12h TTL) │
                         ├─────────────────────────┤
                         │  Browser (Super-admin)   │
                         │  /super-admin/*          │
                         │  JWT (teacher role)      │
                         └───────────┬─────────────┘
                                     │
                                     ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │  Flask App (Waitress :5001 / Werkzeug debug :5001)              │
  │  Threads: 8                                                      │
  │                                                                  │
  │  ┌──────────────┐ ┌─────────────┐ ┌────────────┐ ┌───────────┐ │
  │  │  auth_bp     │ │ quiz_bp      │ │ teacher_bp │ │super_admin│ │
  │  │  /api/auth   │ │ /api/quiz    │ │/api/teacher│ │ /api/super│ │
  │  └──────┬───────┘ └──────┬──────┘ └──────┬─────┘ └─────┬─────┘ │
  │         │                │               │              │        │
  │         └────────┬───────┴───────────────┴──────────────┘        │
  │                  ▼                                               │
  │  ┌─────────────────────────────────────────────────────────┐     │
  │  │  Services layer                                        │     │
  │  │  auth/ → jwt_utils, decorators, google_sync             │     │
  │  │  services/ → grading, score_transforms, quiz_session,    │     │
  │  │               snapshots, images                          │     │
  │  │  db/ → ConnectionPool, queries.py, migration            │     │
  │  │  utils.py (pure helpers)                                 │     │
  │  └─────────────────────────────────────────────────────────┘     │
  │                                                                  │
  │  PostgreSQL (local, named volume)                                │
  │  Filesystem: images/{teacher}/{snapshot}/  ·  backups/           │
  └─────────────────────────────────────────────────────────────────┘
```

## 2. Identity and Authentication

### Teacher flow

```
Login (email + bcrypt password)    → POST /api/auth/teacher-login → JWT
Password change (forced or manual) → POST /api/auth/teacher-change-password
Token in every request: Authorization: Bearer <token>
Token expiry: 12 hours (configurable via JWT_TEACHER_TTL_HOURS)
```

The JWT payload carries `{sub, role, email, iat, exp}`. `sub` is a stringified
teacher ID. `role` is `"teacher"` or `"super_admin"`. The `require_teacher`
decorator accepts both roles; `require_super_admin` only the latter.

### Student flow

```
Join by email + 6-char code → POST /api/auth/student-join → JWT
No password — identity derived from Google Workspace sync + class membership
Token expiry: min(closes_at + 1h, 4h)
```

The JWT payload carries `{sub: student_id, sid: session_id, role: "student"}`.

### Super-admin

Uses the exact same teacher flow with `role: "super_admin"`. The super-admin
endpoints (`/api/super-admin/*`) require `require_super_admin`.

### Offline constraint

All authentication is fully offline after initial setup. JWT signing and
verification happen with a local HS256 key (`JWT_SECRET`). The Google
Workspace sync (`google_sync.py`) requires internet only during the sync
window — the results are upserted into the local `teachers`/`students`/`classes`
tables and are then used offline for weeks.

## 3. Deployment

### Production (Waitress)

```
compose.yaml:
  app:   Waitress, 8 threads, port 5001
  db:    PostgreSQL 16 (named volume postgres_data)
  frontend: built via Dockerfile multi-stage, served by Flask as static
```

### Debug / development (HMR)

```
compose.yaml + compose-debug.yaml:
  app:   Werkzeug reloader, bind-mounted Python source
  frontend: Vite dev server, port 5173, proxies /api and /images
  db:    same as production
```

Entrypoint: `docker-entrypoint.sh` waits for the database, applies
migrations (`python -m db.migrate up`), then runs `server.py [--debug]`.

## 4. Data Model (PostgreSQL)

### Core identities

```sql
teachers (id, email, google_id, display_name, role, password_hash,
          password_must_change, status, created_at, last_login_at, last_synced_at)
students (id, email, google_id, display_name, status, created_at, last_synced_at)
classes  (id, name, academic_year, google_group_id, created_at)
class_teachers   (class_id FK, teacher_id FK)  -- M:N
class_students   (class_id FK, student_id FK)  -- M:N  (indexed on student_id)
```

### Question content

```sql
question_snapshots (id, teacher_id FK, title, slug, content JSONB,
                    images_manifest JSONB, created_at, updated_at)
                    UNIQUE (teacher_id, slug)
```

`content` has shape `{questions: [{id, type, text, options, correct, weight, ...}]}`.

### Quiz sessions

```sql
quiz_sessions (id, teacher_id FK, snapshot_id FK [RESTRICT], title, join_code,
               status [draft | active | closed], opens_at, closes_at, created_at)
               UNIQUE join_code WHERE active
session_classes (session_id FK, class_id FK)  -- M:N

quiz_plans (quiz_id TEXT PK, session_id FK, student_id FK,
            plan JSONB, progression JSONB,
            created_at, last_updated, completed_at)
            UNIQUE (session_id, student_id)
```

`plan` stores shuffled question order + option order. `progression` stores
`{current_index, answers: {pos → raw_answer}}`.

### Scores

```sql
score_entries (id, session_id FK [CASCADE], student_id FK [RESTRICT],
               teacher_id FK [RESTRICT],
               raw_points NUMERIC, max_points NUMERIC, percent NUMERIC,
               answers JSONB, submitted_at)
               UNIQUE (session_id, student_id)
```

`answers` is an array of `DetailedAnswer` dicts, each containing the formatted
student answer, correct answer, awarded points, option order, raw values,
LLM feedback, and a `question_snapshot` embedding (deep copy of the question
at submission time — makes each score entry self-contained).

### Archives

```sql
score_archives (id, teacher_id FK, title, source_session_id FK [SET NULL],
                content JSONB, notes, archived_at)
student_list_snapshots (id, teacher_id FK, title, content JSONB, created_at)
```

### Sync audit

```sql
sync_runs (id, started_at, finished_at, triggered_by FK, result JSONB,
           status [running | success | error])
```

## 5. Directory Layout

```
.
├── .env                          # Secrets (DB, JWT_SECRET, Google API creds)
├── compose.yaml                  # Production (Waitress + PostgreSQL)
├── compose-debug.yaml            # Dev override (HMR + auto-reload)
├── server.py                     # Flask entry point + app factory
├── utils.py                      # Pure helpers (string, JSON parsing)
│
├── auth/
│   ├── jwt_utils.py              # Token encode/decode (HS256)
│   ├── decorators.py             # require_teacher, require_student, etc.
│   └── google_sync.py            # Google Workspace Directory API pull
│
├── db/
│   ├── __init__.py               # ConnectionPool init + get_conn()
│   ├── queries.py                # All named SQL constants
│   ├── migrate.py                # Migration runner
│   ├── bootstrap_admin.py        # First-run super-admin setup
│   └── migrations/
│       └── 001_init.sql          # Full schema
│
├── services/
│   ├── grading.py                # Pure grading functions
│   ├── score_transforms.py       # transform_scores() + load_qbank_for_session()
│   ├── quiz_session.py           # Plan lifecycle, session lifecycle
│   ├── snapshots.py              # JSONC import/export ↔ DB
│   └── images.py                 # Per-snapshot image upload/list/delete
│
├── routes/
│   ├── auth.py                   # /api/auth/*
│   ├── quiz.py                   # /api/quiz/*
│   ├── teacher.py                # /api/teacher/*
│   └── super_admin.py            # /api/super-admin/*
│
├── docker-entrypoint.sh          # Wait for DB → migrate → run app
├── Dockerfile                    # Multi-stage (pnpm build + Python app)
│
├── frontend/                     # React + Vite + TanStack Query SPA
│   └── src/
│       ├── api.ts                # All API call functions + TypeScript types
│       ├── lib/                  # theme.ts, utils.ts, session.ts
│       ├── layouts/              # AdminLayout, TeacherLayout
│       ├── components/           # Reusable UI
│       └── pages/                # One per route
│
├── docs/
│   ├── CONTEXT.md                # Domain glossary
│   ├── SCORE-TRANSFORMS.md       # Score mutation module design
│   ├── architecture-review*.html # Deepening opportunities report
│   └── ARCHITECTURE-SINGLE-TENANT-FILE-BASED.md  # v2.6.0 baseline
│
└── images/{teacher_id}/{snapshot_id}/  # Per-snapshot images (Docker volume)
```

## 6. API Surface

### Auth (`/api/auth/`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/teacher-login` | None | Email + bcrypt → JWT |
| POST | `/auth/teacher-change-password` | Change-password token or JWT | Set new password |
| POST | `/auth/student-join` | None | Email + join code → Student JWT |
| GET  | `/auth/me` | Teacher JWT | Current user info |

### Quiz (`/api/quiz/`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET  | `/quiz/session-info` | Student JWT | Title + question count |
| POST | `/quiz/start` | Student JWT | Create or resume plan |
| GET  | `/quiz/resume/<quiz_id>` | Student JWT | Current question + progression |
| POST | `/quiz/save-answer` | Student JWT | Save one answer, advance index |
| POST | `/quiz/submit` | Student JWT | Grade and record submission |

### Teacher (`/api/teacher/`)

**Snapshots:** GET (list), POST (import JSONC), GET/:id, PUT/:id, DELETE/:id,
GET/:id/export, POST/:id/rename, image endpoints (POST/GET/DELETE/clear)

**Classes:** GET (list for teacher), GET/:id/students

**Sessions:** GET (list), POST (create), POST/:id/activate, POST/:id/close,
POST/:id/regen-code, DELETE/:id

**Scores:** GET/:id/scores, POST/:id/scores/review, POST/:id/scores/recalculate,
POST/:id/scores/regrade-open, POST/:id/archive

**Archives:** GET (list), GET/:id, GET/:id/export, DELETE/:id, POST/:id/rename

**Student list snapshots:** GET (list), POST, GET/:id, DELETE/:id

**Misc:** GET /llm-info, POST /email/send-result, POST /sessions/:id/email/send-all

### Super-admin (`/api/super-admin/`)

**Teachers:** GET (list), POST (create with temp password), PUT/:id (role/status),
POST/:id/reset-password

**Students:** GET (list, filterable by class/query)

**Classes:** GET (list with counts), POST/:id/teachers (assign)

**Sync:** POST /sync (trigger Google Workspace sync), GET /sync/:run_id

**Scores:** GET /scores (global view, filterable by teacher/session)

## 7. Service Layer

### Choke points — modules every request passes through

1. **`db/__init__.py::get_conn()`** — Every DB operation. Connection pool (2-8).
   Autocommit off; callers commit explicitly.

2. **`auth/jwt_utils.py::decode_token()`** — Every authenticated request.
   Called by decorators. Signature verified with `JWT_SECRET`.

3. **`auth/decorators.py`** — Every route that requires auth. Guards extract
   JWT, set `g.current_user`, and return 401/403 on failure.

### Pure modules (no Flask, no DB)

4. **`services/grading.py`** — `grade()`, `score_open()`, `format_detailed_answers()`.
   Pure functions. Testable without infrastructure.

5. **`utils.py`** — String helpers + JSON parsing guards. Pure.

### Service modules (Flask-aware, DB-backed)

6. **`services/score_transforms.py`** — `transform_scores(session_id, teacher_id, *, entry_ids, transform_fn)`.
   The deepened module from the architecture review. Handles snapshot loading,
   entry iteration, change detection, and batch UPDATE. Three callers (review,
   recalculate, regrade-open) pass different callbacks. Ownership verified inside
   the transaction. See [`SCORE-TRANSFORMS.md`](./SCORE-TRANSFORMS.md).

7. **`services/quiz_session.py`** — Plan lifecycle (`get_or_create_plan`,
   `save_answer(quiz_id, answer, student_id)`, `submit_plan(quiz_id, student_id)`),
   session lifecycle (`create_session`, `activate_session`, `close_session`,
   `regenerate_join_code`). All writes inside a single DB transaction. Ownership
   is verified inside the FOR UPDATE lock (no TOCTOU gap).

8. **`services/snapshots.py`** — JSONC import/export ↔ `question_snapshots` table.
   `import_jsonc()` parses with `commentjson`, validates, inserts. `export_jsonc()`
   serializes back to JSON text. `_validate_questions()` checks schema.

9. **`services/images.py`** — Image upload to `images/{teacher}/{snapshot}/`.
   Manifest stored in `question_snapshots.images_manifest` JSONB column.

## 8. Quiz Lifecycle

```
                    ┌─────────────────┐
                    │  Session: draft │
                    │  (teacher creates,│
                    │   assigns classes)│
                    └────────┬────────┘
                             │ activate → generates join_code
                             ▼
                    ┌─────────────────┐
                    │  Session: active │
                    │  (students join) │
                    └────────┬────────┘
                             │
       ┌─────────────────────┼─────────────────────┐
       │ POST /auth/         │                     │
       │ student-join        │                     │
       │ (email + code)      │                     │
       │ → student JWT       │                     │
       ▼                     ▼                     ▼
  ┌────────────┐   ┌──────────────┐   ┌──────────────┐
  │ session-   │   │ start        │   │ resume       │
  │ info       │   │ (create      │   │ (return      │
  │ (title,    │   │  plan with   │   │  current     │
  │  count)    │   │  shuffled    │   │  question)   │
  └────────────┘   │  questions)  │   └──────┬───────┘
                   └──────┬───────┘          │
                          │                  │
                          ▼                  ▼
                    ┌──────────────────────────┐
                    │  save-answer (×N)         │
                    │  FOR UPDATE + ownership   │
                    │  verify → advance index   │
                    └──────────┬───────────────┘
                               │ is_complete?
                               ▼
                    ┌──────────────────────────┐
                    │  submit                  │
                    │  FOR UPDATE → grade()    │
                    │  → insert score_entry    │
                    │  → delete plan           │
                    └──────────────────────────┘
                               │
                               ▼
                    ┌─────────────────┐
                    │  Session: close  │
                    │  (teacher ends)  │
                    └─────────────────┘
```

## 9. Score Mutation: review, recalculate, regrade

All three converge on `services/score_transforms.py::transform_scores()`.
See [`SCORE-TRANSFORMS.md`](./SCORE-TRANSFORMS.md) for the full design.

| Operation | What | When | Score entries touched | What happens to each answer |
|-----------|------|------|-----------------------|-----------------------------|
| **review** | Manual override | Teacher says "Q3 should get 4pts" | Only those listed in `overrides` | `points_awarded` = override value |
| **recalculate** | Full regrade | Teacher edited the question bank | All | `grade()` against current snapshot |
| **regrade-open** | Open Q regrade | LLM failed, keywords changed | All with `type == "open"` | `score_open()` against stored snapshot or current bank |

## 10. Seams Map

Using the glossary from [`CONTEXT.md`](./CONTEXT.md):

| Seam | Module | Interface | Adapters (callers) | Depth |
|------|--------|-----------|-------------------|-------|
| JWT auth | `auth/` | `require_*` decorators | teacher token, student token, change-password token | Deep — 3 adapters, simple decorator |
| Score mutation | `services/score_transforms.py` | `transform_scores(..., transform_fn)` | review, recalculate, regrade-open | Deep — 3 callers, ~80 lines each before extraction |
| Quiz taking | `services/quiz_session.py` | `save_answer(quiz_id, answer, student_id)` | `routes/quiz.py` | Deep — FOR UPDATE lock + ownership + progression all in one txn |
| Grading | `services/grading.py` | `grade()`, `score_open()` | quiz_session, score_transforms | Deep — pure functions, callers don't reimplement scoring |
| Snapshot CRUD | `services/snapshots.py` | import/export JSONC ↔ DB | routes/teacher.py | Medium — import does validation + uniqueness |
| Image management | `services/images.py` | upload/list/delete per snapshot | routes/teacher.py | Deep — manifest JSONB in snapshot row, filesystem behind it |
| DB queries | `db/queries.py` | Named SQL constants | All modules | Shallow — just SQL strings, but deliberately so (easy to review) |
| Connection pool | `db/__init__.py` | `get_conn()` context | All modules | Deep — one interface, hides pool management |
