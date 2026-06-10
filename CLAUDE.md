# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**intranet-quiz-platform** (QuizParty) is a multi-teacher, multi-class quiz platform for school intranets: one central server, ~150 teachers, ~40 classes, ~800 students. PostgreSQL is the single source of truth; JSONC is only an import/export authoring format (it never persists on the server). Authentication is fully offline (bcrypt + local HS256 JWT); Google Workspace is contacted only during on-demand account sync.

It was forked from the single-teacher `intranet-quiz-manager` at v2.6.0. **The multi-tenant refactor is complete** — the single-tenant architecture (one admin password, flat JSONC files, file locking) no longer exists in this codebase. The legacy version is maintained separately at `mlongano/intranet-quiz-manager`.

**Canonical references — read these instead of re-deriving:**
- `docs/ARCHITECTURE.md` — full architecture: data model, API surface, service layer, quiz lifecycle, seams map
- `docs/CONTEXT.md` — domain glossary (Saved quiz vs Quiz version, Recalculate vs Regrade vs Review…). Use this vocabulary in code and discussion.
- `AGENTS.md` — coding conventions, commit rules, TDD workflow, Docker/LXC notes
- `docs/OPERATIONS.md` — deployment, backups, runbooks
- `docs/ARCHITECTURE-SINGLE-TENANT-FILE-BASED.md` — historical v2.6.0 baseline only

## Development Commands

### Full stack (Docker — canonical)

```bash
# Debug stack: Flask auto-reload + Vite HMR (frontend on :5173)
docker compose -f compose.yaml -f compose-debug.yaml up --build

# Production stack: db + app (Waitress) + worker (LLM grading) + backup
docker compose up --build
```

`.env` sets `APP_PORT` (host port, default 5002); Flask listens on container port 5001. On the school Proxmox LXC host run `docker buildx use lxc-remote2` first (see `AGENTS.md`).

### Backend only

```bash
uv run server.py              # needs DATABASE_URL + JWT_SECRET in .env
uv run server.py --debug      # Werkzeug reloader
python -m db.migrate up       # apply migrations
python -m db.bootstrap_admin  # first-run super-admin
python -m services.llm_jobs worker   # LLM grading worker loop
```

### Frontend only

```bash
cd frontend
pnpm install
pnpm dev      # http://localhost:5173, proxies /api and /images
pnpm build    # includes tsc type-check; output frontend/dist/ served by Flask
pnpm lint
```

### Tests

```bash
# Docker-safe runner (creates/uses quizparty_test, sets TEST_DATABASE_URL)
scripts/run_tests_safe.sh tests/

# Host alternative — DB name MUST contain "test" (conftest refuses otherwise)
DATABASE_URL=postgresql:///quizparty_test uv run pytest tests/
```

Never run bare `pytest` inside the app container: its `DATABASE_URL` is the real DB. Migration `004_block_production_truncate.sql` blocks `TRUNCATE` in non-test databases as a second guard.

## Architecture

```
server.py                # App factory: env check, pool init, blueprints, SPA/static serving
routes/
  auth.py                # /api/auth/*        login, password change, student join
  quiz.py                # /api/quiz/*        student flow: start, resume, save-answer, submit
  teacher.py             # /api/teacher/*     snapshots, sessions, scores, archives, images, email
  super_admin.py         # /api/super-admin/* accounts, classes, sync, global scores
auth/
  jwt_utils.py           # HS256 encode/decode (teacher 12h, student session-scoped, pw-change 15min)
  decorators.py          # require_teacher / require_student / require_super_admin → g.current_user
  google_sync.py         # Google Workspace Directory API sync (super-admin triggered)
services/
  grading.py             # PURE: grade(), score_open(), format_detailed_answers()
  quiz_session.py        # Plan + session lifecycle; FOR UPDATE + ownership in one transaction
  score_transforms.py    # transform_scores() — the single seam for review/recalculate/regrade
  snapshots.py           # JSONC import/export ↔ question_snapshots
  images.py              # uploads to images/{teacher_id}/{snapshot_id}/, manifest in JSONB
  llm_jobs.py            # async grading job queue (FOR UPDATE SKIP LOCKED) + worker loop
  session_scores.py, classroom_sync.py, ...
db/
  __init__.py            # psycopg ConnectionPool, get_conn() context manager
  queries.py             # ALL SQL as named constants, parameterized
  migrate.py             # migration runner; db/migrations/NNN_*.sql
utils.py                 # pure string/JSON helpers only
llm_evaluator.py         # LLM call wrapper (llm library; subprocess + timeout + retries)
email_service.py         # SMTP result emails (live, optional)
```

### Roles and auth

Three JWT roles: `teacher`, `super_admin` (same login flow, elevated role), `student` (joins with email + 6-char join code, token scoped to one session via `sid`). Tokens travel as `Authorization: Bearer <token>`. Decorators set `g.current_user`; teacher ID is `g.current_user['sub']` (stringified int).

### Critical patterns

1. **Raw parameterized SQL, no ORM** — a deliberate, documented decision. All SQL lives in `db/queries.py` as named constants with `%s` / `%(name)s` placeholders. Never interpolate values into SQL; dynamic fragments only from hardcoded allowlists.

2. **Ownership checks inside the transaction.** Every teacher-owned resource query either includes `teacher_id` in the SQL or calls an ownership guard (e.g. `_assert_session_owner`) within the same transaction as the mutation, often under `FOR UPDATE`. Multi-tenant isolation has dedicated tests (`tests/test_isolation.py`) — keep them passing.

3. **Score mutations go through `transform_scores()`** (`services/score_transforms.py`). Review (manual override), Recalculate (full regrade vs current snapshot), and Regrade-open (open questions only) are callbacks into that one seam. Changes are audited in `score_history`. Don't add a fourth path that updates `score_entries.answers` directly.

4. **Async LLM grading.** Submission grades closed questions immediately; open questions get `llm_status='pending'` and zero points. A separate worker process (`python -m services.llm_jobs worker`, own compose service) claims jobs with `FOR UPDATE SKIP LOCKED`, grades one answer at a time, updates the score entry and `score_history`. Teacher endpoints expose pending counts / `grading_complete`. Regrades are rate-limited per session (`last_regrade_at` cooldown).

5. **Server-authoritative quiz state.** A student's progression lives in the `quiz_plans` row (shuffled question/option order + `{current_index, answers}`). Answers are immutable once saved; only forward progression. The client never stores quiz state — TanStack Query refetches from the server. Submit grades the plan, inserts a `score_entry`, deletes the plan, all in one transaction.

6. **JSONC at the boundary only.** Import parses with `commentjson` (never stdlib `json` for question files), validates, and stores plain JSONB. Export emits clean JSON.

### Data model (PostgreSQL — see `db/migrations/`)

`teachers`, `students`, `classes`, `class_teachers`, `class_students` (identity);
`question_snapshots` (teacher-owned quiz content, JSONB + image manifest);
`quiz_sessions` (draft → active → closed; unique join_code while active), `session_classes`;
`quiz_plans` (per-student progression); `score_entries` (one per student per session, self-contained `answers` JSONB with embedded question snapshots);
`score_archives`, `student_list_snapshots`; `llm_grading_jobs`, `score_history`; `sync_runs`.

### Frontend

React 19 + Vite + TanStack Query + Tailwind v4, SPA served by Flask from `frontend/dist/`.

- `src/api.ts` — all API functions + hand-written types; `apiFetch()` injects the Bearer token
- `src/lib/session.ts` — JWTs in `sessionStorage` (`qp_teacher` / `qp_student`)
- `src/main.tsx` — routes: `/teacher/*` (login, dashboard, sessions, snapshots, classes, archives…), `/super-admin`, student flow `/` → `/quiz/:id` → `/finish`; legacy `/admin/*` redirects
- Server state via TanStack Query only; client state via `useState`; no Redux/Zustand
- **All user-facing text in Italian** (`it-IT` dates); internal identifiers in English
- Design system: Neon Noir (`docs/DESIGN.md`), binding color mapping — **primary** cyan = Domande/Quiz, **secondary** magenta = Punteggi, **tertiary** green = Studenti/Classi

## Environment Variables

Required: `DATABASE_URL`, `JWT_SECRET` (32+ chars; app refuses to start without them), `POSTGRES_PASSWORD` (compose).
Optional groups (see `env.example`): Google Workspace sync (`GOOGLE_SA_KEY_PATH`, `GOOGLE_DELEGATED_SUBJECT`, `GOOGLE_TEACHER_GROUP`, `GOOGLE_STUDENT_OU_PATHS`…), Google OAuth (`GOOGLE_OAUTH_CLIENT_ID` + `VITE_…`), email (`EMAIL_SENDER`/`EMAIL_PASSWORD`/SMTP), LLM grading (`USE_LLM_EVAL=1`, `LLM_MODEL`, provider API keys, `LLM_TIMEOUT_SECONDS`, `LLM_RETRIES`), backups (`BACKUP_INTERVAL_SECONDS`, `BACKUP_RETENTION_DAYS`).

Secrets live in `.env` and `secrets/` — both gitignored. Never commit them.

## Gotchas

1. **Question IDs** may be int or string — always `str(q_id)` when comparing.
2. **Detailed answers** keep the option index in formatted text: extract with `re.search(r'\(Index:\s*(\d+)\)', ...)` for legacy entries.
3. **Each score entry is self-contained**: every detailed answer embeds a `question_snapshot` deep copy. Regrade prefers the stored snapshot; recalculate uses the current Quiz version. Vocabulary in `docs/CONTEXT.md` §Scoring.
4. **Student identity** is the lowercased school email, provisioned by Workspace sync — students have no passwords.
5. **API response shapes are a contract** with `frontend/src/api.ts` — keep them compatible or update both sides.
6. **`banks/`, `scripts/migrate_v260_to_platform.py`, `scripts/recover_legacy_quizparty.py`** are legacy v2.6.0 migration/recovery tooling, not part of the running app.

## Testing

Integration tests against a real test database: auth, quiz lifecycle, multi-tenant isolation, 30-student concurrency, LLM regrade flow, migrations. Follow the vertical tracer-bullet TDD workflow in `AGENTS.md`. After any backend change run `scripts/run_tests_safe.sh tests/`; after frontend changes run `pnpm build` (includes type-check).
