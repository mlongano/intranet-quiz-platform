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

`.env` sets `APP_PORT` (host port, default 5002); Flask listens on container port 5001. On the school Proxmox LXC host run `docker buildx use lxc-remote2` first; the daemon behind it is `infra/buildkit/` (see its README).

Everything runs in containers. There is no supported host-side workflow: the
host has no virtualenv, and `frontend/node_modules` is bind-mounted from the
Alpine `frontend` container, so it holds musl binaries that a glibc host cannot
execute. Run the commands below through `docker compose exec` instead.

### Backend

```bash
DC="docker compose -f compose.yaml -f compose-debug.yaml"
$DC exec app python -m db.migrate status      # which migrations are applied
$DC exec app python -m db.migrate up          # apply pending migrations
$DC exec app python -m db.bootstrap_admin     # first-run super-admin
```

The app and worker are already running as their own services; the entrypoint
applies migrations at startup, so `migrate up` is only for out-of-band runs.

### Frontend

The `frontend` service (Vite HMR on :5173) exists only in `compose-debug.yaml`.

```bash
$DC exec frontend sh -c "cd /app && pnpm build"   # tsc -b + vite build → frontend/dist/
$DC exec frontend sh -c "cd /app && pnpm lint"
$DC exec frontend sh -c "cd /app && npx vitest run"
```

### Tests

```bash
# Docker-safe runner (creates/uses quizparty_test, sets TEST_DATABASE_URL)
scripts/run_tests_safe.sh tests/
```

On the production stack it runs pytest in a one-off debug container and never
touches the running services; on the debug stack it execs into `app`.

The runner also repairs stale source in the app container before running: the
top-level modules (`server.py`, `utils.py`, `email_service.py`) are
bind-mounted one file at a time, and because Docker
resolves a single-file mount to an inode, a `git pull` leaves the container
serving pre-pull code while the working tree looks correct.

Never run bare `pytest` inside the app container: its `DATABASE_URL` is the real DB. Migration `004_block_production_truncate.sql` blocks `TRUNCATE` in non-test databases as a second guard.

## Architecture

```
server.py                # App factory: env check, pool init, blueprints, SPA/static serving
routes/
  auth.py                # /api/auth/*        login, password change, student join
  quiz.py                # /api/quiz/*        student flow: start, resume, save-draft, save-answer, submit
  teacher.py             # /api/teacher/*     snapshots, sessions, scores, archives, images, email
  super_admin.py         # /api/super-admin/* accounts, classes, sync, global scores
auth/
  jwt_utils.py           # HS256 encode/decode (teacher 12h, student session-scoped, pw-change 15min)
  decorators.py          # require_teacher / require_student / require_super_admin → g.current_user
  google_sync.py         # Google Workspace Directory API sync (super-admin triggered)
services/
  grading.py             # PURE: grade(), grade_open_answer(), format_detailed_answers()
  llm_provider.py        # Direct OpenAI/Anthropic SDK calls (deepseek = OpenAI protocol)
  llm_config.py          # Resolves endpoint/model + the teacher's own key for it
  llm_endpoints.py       # Admin-managed allowlist: the only thing admins control
  credentials.py         # Fernet encryption for teacher keys (per endpoint) + rotation
  teacher_llm_settings.py# A teacher's endpoint/model choice and keys (redacted reads)
  llm_errors.py          # Typed LLM failures + validate_llm_env()
  llm_parsing.py         # Parses/normalises a model's grading response
  prompts.py             # Immutable versioned prompts, prompts/<name>/v<N>-<sha8>.md
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
email_service.py         # SMTP result emails (live, optional)
```

### Roles and auth

JWT roles: `teacher`, `super_admin` (same login flow, elevated role), `student` (joins with email + 6-char join code, token scoped to one session via `sid`), `student_results` (Google login of a provisioned student; opens only their own published results at `/risultati`, never a quiz). Tokens travel as `Authorization: Bearer <token>`. Decorators set `g.current_user`; teacher ID is `g.current_user['sub']` (stringified int).

### Critical patterns

1. **Raw parameterized SQL, no ORM** — a deliberate, documented decision. All SQL lives in `db/queries.py` as named constants with `%s` / `%(name)s` placeholders. Never interpolate values into SQL; dynamic fragments only from hardcoded allowlists.

2. **Ownership checks inside the transaction.** Every teacher-owned resource query either includes `teacher_id` in the SQL or calls an ownership guard (e.g. `_assert_session_owner`) within the same transaction as the mutation, often under `FOR UPDATE`. Multi-tenant isolation has dedicated tests (`tests/test_isolation.py`) — keep them passing.

3. **Score mutations go through `transform_scores()`** (`services/score_transforms.py`). Review (manual override), Recalculate (full regrade vs current snapshot), and Regrade-open (open questions only) are callbacks into that one seam. Changes are audited in `score_history`. Don't add a fourth path that updates `score_entries.answers` directly.

4. **Async LLM grading.** Submission grades closed questions immediately; open questions get `llm_status='pending'` and zero points. A separate worker process (`python -m services.llm_jobs worker`, own compose service) claims jobs with `FOR UPDATE SKIP LOCKED` and grades concurrently on a bounded thread pool (`LLM_WORKER_CONCURRENCY`, jobs `LLM_WORKER_MAX_JOBS`), updating the score entry and `score_history`. Submissions are claimed before regrades. The worker's connection pool is sized from those settings — a pool smaller than the concurrency deadlocks rather than queueing. Teacher endpoints expose pending counts / `grading_complete`. Regrades are rate-limited per session (`last_regrade_at` cooldown) and carry `scope` + `force_override_manual` on the job row, so a queued job keeps the behaviour it was enqueued with. A `manual_override` answer is protected from automatic regrades at three levels: the worker's `_should_grade()` predicate, the persisted job flag, and revert restoring the flag with the points.

5. **Server-authoritative quiz state.** A student's progression lives in the `quiz_plans` row (shuffled question/option order + `{current_index, answers}`). Answers are immutable once saved; only forward progression. The client never stores quiz state — TanStack Query refetches from the server. Submit grades the plan, inserts a `score_entry`, deletes the plan, all in one transaction. The one exception is a safety copy: the open answer being written is autosaved as `quiz_plans.draft` (`save-draft`, current question only, cleared by `save-answer`) and kept in `localStorage` until the server has it (`frontend/src/lib/answerDraft.ts`), so a crash, a closed browser or a lost connection costs seconds of work. Resume returns the draft; after a manual close, submit hands in a non-empty draft of the current open question. Open answers are capped at `OPEN_ANSWER_MAX_CHARS` (default 20000, 413 `ANSWER_TOO_LONG`).

6. **JSONC at the boundary only.** Import parses with `commentjson` (never stdlib `json` for question files), validates, and stores plain JSONB. Export emits clean JSON.

7. **Pending is never a grade.** `grade()` always defers open questions (0 points, `llm_status='pending'`); only the worker grades them. A failed evaluation leaves a never-graded answer `pending` with `llm_error`, and leaves an already-graded answer untouched — it is never written back as a `graded` zero. `grade_open_answer()` raises the typed errors from `services/llm_errors.py`.

8. **Session close has a grace window.** `save-answer` needs `status='active'`; `submit` and `save-draft` also accept `closed`, so a student caught by a manual close can still hand in. Both refuse past `closes_at + QUIZ_GRACE_SECONDS` (default 3600) with 409 `SESSION_CLOSED`.

9. **Endpoints are an admin-managed allowlist — and the only thing an admin controls about grading.** `llm_endpoints` holds every service grading may call, each with the `models` it may be asked for (at least one; the first is its default). The row marked `is_default` (enforced unique by a partial index) is where a teacher's grading goes unless they selected another enabled endpoint. There is no environment fallback: an empty table, or no enabled default, means nowhere to grade, and open answers stay pending. Only `enabled` rows ever resolve, so disabling one revokes it immediately. Teachers select an endpoint **by id** and can never supply a URL — that is what keeps the reachable set closed, so `base_url` must never become a free-text teacher field. Every model sent comes from the endpoint's list: a teacher's stored choice, or a one-off regrade override, outside it is never sent (the regrade route refuses it). A selection whose endpoint is later disabled falls back to the default, and the teacher's model choice does not follow. Resolution accepts an optional `conn`: it runs inside the submission transaction, and taking a second pooled connection there deadlocks under concurrent submissions.

10. **Grading authenticates only with the teacher's own key, bound to one endpoint.** There are no shared keys — none per endpoint, none in `.env`. A teacher stores a key per endpoint in `teacher_llm_credentials` (primary key `(teacher_id, endpoint_id)`), and `resolve_llm_config` sends only the key for the endpoint actually resolved. So a key saved for one service can never reach another, even after the default changes or a second endpoint is whitelisted, and every call is attributable to a teacher. A teacher without a key for their endpoint is a normal state, not a misconfiguration: their open answers stay pending with an `llm_error` naming the missing key. **Never add a fallback key** — that is how `OPENAI_API_KEY` once reached any OpenAI-compatible host an endpoint named. Keys are encrypted with `CREDENTIAL_ENCRYPTION_KEY`, which is *not* in the database, so a dump leaks nothing; no endpoint ever returns a key, reads report `configured` plus a fingerprint. `teachers.llm_config` holds only non-secret preferences and stores `endpoint_id`, never a URL. Rotating the master key requires `scripts/rotate_credential_key.py` **first**; replacing it without re-encrypting makes every stored key unreadable.

11. **A grading job is pinned at enqueue time.** Provider, model, `prompt_version` and `prompt_snapshot` are resolved when the job is created and stored on the `llm_grading_jobs` row; the worker reads them from there, never from the filesystem. Editing a prompt file or the endpoint's model list therefore cannot alter a job already queued. Credentials are the exception — they are secrets, always read live, never written to a job. Every graded answer records `llm_provider`/`llm_model`/`prompt_version` so a changed score can be explained. Published prompts (`prompts/<name>/v<N>-<sha8>.md`) are immutable: `services/prompts.py` refuses to load one whose content no longer matches the hash in its filename.

12. **Grading problems never stop the app.** At startup `validate_llm_env()` only warns when `USE_LLM_EVAL=1` but no enabled default endpoint exists, and never checks keys. The allowlist is edited at runtime, so refusing to boot would let disabling the only endpoint take quizzes offline at the next restart.

13. **A session is edited only as far as its status allows.** `PATCH /api/teacher/sessions/<id>` (`edit_session`) changes title, quiz, classes and the join window (`opens_at`/`closes_at`, time-zone aware). Draft: everything. Active: the quiz only before any student has started or handed in; classes may be added, and removed unless that strands a student who has started. Closed: only the title — its schedule sets the grace window and its results belong to the quiz and classes it had. `GET /sessions/<id>` returns `edit` so the form disables what the server would refuse.

### Data model (PostgreSQL — see `db/migrations/`)

`teachers`, `students`, `classes`, `class_teachers`, `class_students` (identity);
`question_snapshots` (teacher-owned quiz content, JSONB + image manifest);
`quiz_sessions` (draft → active → closed; unique join_code while active), `session_classes`;
`quiz_plans` (per-student progression); `score_entries` (one per student per session, self-contained `answers` JSONB with embedded question snapshots);
`score_archives`, `student_list_snapshots`; `llm_grading_jobs`, `score_history`; `llm_endpoints`, `llm_endpoint_credentials`, `teacher_llm_credentials`; `sync_runs`.

### Frontend

React 19 + Vite + TanStack Query + Tailwind v4, SPA served by Flask from `frontend/dist/`.

- `src/api.ts` — barrel re-exporting `src/api/*` (`client.ts`, `scores.ts`, `sessions.ts`, `types.ts`, …); `apiFetch()` injects the Bearer token
- `src/lib/session.ts` — JWTs in `sessionStorage` (`qp_teacher` / `qp_student`)
- `src/main.tsx` — routes: `/teacher/*` (login, dashboard, sessions, snapshots, classes, archives…), `/super-admin`, student flow `/` → `/quiz/:id` → `/finish`; legacy `/admin/*` redirects
- Server state via TanStack Query only; client state via `useState`; no Redux/Zustand
- **All user-facing text in Italian** (`it-IT` dates); internal identifiers in English
- Design system: Neon Noir (`docs/DESIGN.md`), binding color mapping — **primary** cyan = Domande/Quiz, **secondary** magenta = Punteggi, **tertiary** green = Studenti/Classi

## Environment Variables

Required: `DATABASE_URL`, `JWT_SECRET` (32+ chars; app refuses to start without them), `POSTGRES_PASSWORD` (compose).
Optional groups (see `.env.example`): Google Workspace sync (`GOOGLE_SA_KEY_PATH`, `GOOGLE_DELEGATED_SUBJECT`, `GOOGLE_TEACHER_GROUP`, `GOOGLE_STUDENT_OU_PATHS`…), Google OAuth (`GOOGLE_OAUTH_CLIENT_ID` + `VITE_…`), email (`EMAIL_SENDER`/`EMAIL_PASSWORD`/SMTP), LLM grading (`USE_LLM_EVAL=1`, `CREDENTIAL_ENCRYPTION_KEY` — required for teachers to store keys, `LLM_TIMEOUT_SECONDS` (120), `LLM_MAX_TOKENS` (4096 — reasoning models think inside it), `LLM_RETRIES`, worker concurrency; destinations and models come from `llm_endpoints`, keys from teachers — `.env` holds neither), `CONTAINER_DNS` for LAN-only endpoints, backups (`BACKUP_INTERVAL_SECONDS`, `BACKUP_RETENTION_DAYS`).

Secrets live in `.env` and `secrets/` — both gitignored. Never commit them.

## Gotchas

1. **Question IDs** may be int or string — always `str(q_id)` when comparing.
2. **Detailed answers** keep the option index in formatted text: extract with `re.search(r'\(Index:\s*(\d+)\)', ...)` for legacy entries.
3. **Each score entry is self-contained**: every detailed answer embeds a `question_snapshot` deep copy. Regrade prefers the stored snapshot; recalculate uses the current Quiz version. Vocabulary in `docs/CONTEXT.md` §Scoring.
4. **Student identity** is the lowercased school email, provisioned by Workspace sync — students have no passwords.
5. **API response shapes are a contract** with `frontend/src/api.ts` — keep them compatible or update both sides.
6. **No legacy migration tooling remains.** The v2.6.0 import/recovery scripts, the `banks/` JSONC tree and the `data/` prototype schema were deleted once the migration was finished and verified — PostgreSQL is the only source of truth. The legacy app is maintained separately at `mlongano/intranet-quiz-manager`; recover history from git if a v2.6.0 import is ever needed again.

## Testing

Integration tests against a real test database: auth, quiz lifecycle, multi-tenant isolation, 30-student concurrency, LLM regrade flow, migrations. Follow the vertical tracer-bullet TDD workflow in `AGENTS.md`. After any backend change run `scripts/run_tests_safe.sh tests/`; after frontend changes run `pnpm build` (includes type-check).
