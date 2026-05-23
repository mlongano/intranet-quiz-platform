# QuizParty — Current Architecture (Single-Tenant, File-Based)

> This document describes the as-is architecture as of v2.6.0, before the
> multi-tenant PostgreSQL refactor.
>
> The current architecture is described in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## Table of Contents

1. [System Boundaries](#1-system-boundaries)
2. [Identity and Authentication Model](#2-identity-and-authentication-model)
3. [Data Model](#3-data-model)
4. [File Layout and Path Constants](#4-file-layout-and-path-constants)
5. [Quiz Lifecycle](#5-quiz-lifecycle)
6. [API Surface](#6-api-surface)
7. [Frontend Session Model](#7-frontend-session-model)
8. [Concurrency and Isolation](#8-concurrency-and-isolation)
9. [Bank System](#9-bank-system)
10. [Image Management](#10-image-management)
11. [Single-Tenant Assumptions — Complete Inventory](#11-single-tenant-assumptions--complete-inventory)

---

## 1. System Boundaries

```
┌─────────────────────────────────────────────────────┐
│  Browser (Students)           Browser (Teacher)      │
│  React SPA — /                React SPA — /admin/**  │
└──────────────┬────────────────────────┬──────────────┘
               │  HTTP / LAN            │  HTTP / LAN
               ▼                        ▼
┌─────────────────────────────────────────────────────┐
│  Waitress WSGI  :5001  (6 threads, single process)  │
│  ┌──────────────────────────────────────────────┐   │
│  │  Flask App (server.py)                       │   │
│  │  quiz_bp  (/api/*)    admin_bp (/api/*)       │   │
│  │                  utils.py                    │   │
│  └──────────────────────────────────────────────┘   │
│                                                     │
│  File System (project root)                         │
│  questions.jsonc   scores.jsonc                     │
│  students.jsonc    quiz_status.jsonc                │
│  quizzes/*.json    banks/   images/                 │
└─────────────────────────────────────────────────────┘
```

One process. One teacher. One active quiz at a time. All students share the same `questions.jsonc`, `scores.jsonc`, and `students.jsonc`.

---

## 2. Identity and Authentication Model

### Teacher Identity

There is no teacher data record. The teacher is identified solely by a shared secret.

```python
# utils.py — loaded once at startup, aborts if unset
ADMIN_PW = os.getenv('ADMIN_PW')
if not ADMIN_PW:
    raise EnvironmentError("ADMIN_PW environment variable is not set.")
```

**Authentication mechanism:** Every admin endpoint receives the plaintext password in the request body (field `pw`) or in the `X-Admin-Pass` header and performs a direct string comparison:

```python
# routes/admin.py — repeated 30+ times, once per endpoint
auth_pw = data.get('pw') or request.headers.get('X-Admin-Pass', '')
if not auth_pw or auth_pw != ADMIN_PW:
    abort(403)
```

There is no session, no token, no JWT, no cookie. Each request is independently authenticated by re-sending the password.

### Student Identity

Students have no password. Their email address is both their identity and their credential:

- Login: `POST /api/start` with `{ name: "email@school.it" }`
- Validated against a flat set extracted from `students.jsonc`
- Used as the filename key: `quizzes/{safe_id(email)}.json`

No student account exists in any data file beyond the email address in `students.jsonc`.

---

## 3. Data Model

### `students.jsonc` — flat array at project root

Three formats supported simultaneously:

```jsonc
[
  "plain@example.com",                                    // bare string
  { "email": "one@example.com", "group": "5CI" },        // individual with group
  { "group": "5CI", "emails": ["a@x.it", "b@x.it"] }    // group with multiple emails
]
```

The `group` field is read by `load_valid_students()` and immediately discarded — it enters no index, has no effect on validation, and is invisible to all backend logic. It is used only by the frontend dashboard for display-only filtering (group tallies in the stats card). One group name `"Theacher"` is hardcoded in the frontend as excluded from these counts (`VITE_EXCLUDED_GROUP` env var can override it).

**Practical consequence:** There is no backend concept of "which class a student belongs to." All students in `students.jsonc` are treated identically — they all have access to the same quiz.

### `questions.jsonc` — flat file at project root

The one active quiz. Loaded via `load_questions()` with an mtime-based in-memory cache. The schema:

```jsonc
{
  "title": "Quiz Title",
  "questions": [
    {
      "id": 1,                          // int or string
      "type": "single|multiple|open",
      "text": "Markdown question text",
      "question_image": "path/to/img",  // optional
      "options": ["A", "B"] or [{"text": "...", "image": "..."}],
      "correct": 0,                     // index, [indices], or ["keyword"] for open
      "weight": 1,
      "acceptable": ["keyword"],        // open only: exact match = full score
      "keywords": ["k1", "k2"],         // open only: partial match
      "min_keywords": 2                 // open only: threshold for full score
    }
  ]
}
```

There is no teacher ID or class ID in this schema. One file → one quiz for everyone.

### `quiz_status.jsonc` — flat file at project root

```json
{ "enabled": true }
```

One global enabled/disabled flag. Checked only at `POST /api/start`. Does not affect students already holding a `quiz_id`.

### `quizzes/{safe_id(email)}.json` — one file per student

Written by `api_start`, updated by `api_save_answer`, deleted by `api_submit`:

```json
{
  "quiz_id": "411a0d21de35",
  "student": "student@school.it",
  "quiz_title": "Snapshot of title at quiz start",
  "created": "2025-12-12T10:00:00+00:00",
  "plan": [
    { "id": 25, "option_order": [3, 0, 1, 2] },
    { "id": 15, "option_order": [2, 0, 3, 1] }
  ],
  "progression": {
    "current_index": 3,
    "answers": {
      "0": 2,
      "1": [0, 2],
      "2": "open text answer"
    },
    "last_updated": "2025-12-12T10:05:00+00:00"
  }
}
```

Key observations:
- `quiz_id` is a 12-hex UUID fragment used as the resume token
- `plan` is the student's personal shuffled question order
- `answers` keys are stringified position indices (not question IDs)
- **No teacher ID, no class ID, no reference to which bank file produced this plan**
- `find_plan_by_quiz_id()` does a full linear scan of all `*.json` files in `quizzes/`

### `scores.jsonc` — flat array at project root

Append-only during a quiz session. Each entry:

```json
{
  "student": "student@school.it",
  "quiz_id": "411a0d21de35",
  "quiz_title": "Valutazione Formativa: OSPF, NAT, ACL",
  "answers": [
    {
      "question_id": 25,
      "question_text": "...",
      "student_answer": "'Option text' (Index: 2)",
      "correct_answer": "'Option text' (Index: 2)",
      "weight": 5,
      "points_awarded": 5.0,
      "raw_points": 5.0,
      "option_order": [3, 0, 1, 2],
      "llm_feedback": null,
      "llm_verdict": null
    }
  ],
  "raw_points": 12.0,
  "max_points": 100.0,
  "percent": 12.0,
  "timestamp": "2025-12-12T10:10:00+00:00"
}
```

**No teacher field. No class field. No group field.** The only identifiers are the student email and `quiz_title` (a string snapshot, not a foreign key). The duplicate check in `append_score_atomic` is `record.get('student') == student_id` — one submission per student per scores file lifetime.

---

## 4. File Layout and Path Constants

All file paths are string constants in `utils.py` resolved relative to the working directory where `server.py` runs. No environment variable controls any of these:

```python
QUEST_FILE           = 'questions.jsonc'
SCORE_FILE           = 'scores.jsonc'
STUDENTS_FILE        = 'students.jsonc'
QUIZ_STATUS_FILE     = 'quiz_status.jsonc'
QUIZ_FOLDER          = 'quizzes'
BANKS_BASE           = 'banks'
QUESTION_BANK_FOLDER = 'banks/question_bank'
SCORES_BANK_FOLDER   = 'banks/scores_bank'
STUDENTS_BANK_FOLDER = 'banks/students_bank'
```

There is no namespacing by teacher, class, or quiz instance. Every path points to a single shared resource.

`server.py` further hardcodes:
- Port: `5001`
- Thread count: `6`
- Static folder: `frontend/dist` relative to `APP_DIR`

---

## 5. Quiz Lifecycle

### Start

```
POST /api/start  { name: "email@school.it" }

1. Check quiz_status.jsonc → enabled?
2. Validate email in load_valid_students() flat set
3. Check scores.jsonc for existing completed submission → 409 if found
4. Check quizzes/{safe_id}.json for in-progress plan
   ├── If exists: validate all plan question IDs still in questions.jsonc
   │   ├── Stale IDs found → delete plan, create fresh
   │   └── All valid → return existing quiz_id (resume path)
   └── If absent: load questions.jsonc, shuffle, write plan file
5. Return { quiz_id }
```

### Question-by-Question Answering

```
GET  /api/resume/{quiz_id}        → current question + index + is_complete
POST /api/save-answer { quiz_id, answer }
     → save answer[current_index] in plan file, increment current_index
     → return { next_question | is_complete: true }
```

Answers are immutable once saved. Only forward progression allowed.

### Submission

```
POST /api/submit { quiz_id }

1. Load plan file, verify completion
2. Load questions.jsonc (for correct answers and weights)
3. grade(answers, plan, qbank) → score entries
4. append_score_atomic(score_entry) → scores.jsonc
5. Delete quizzes/{safe_id}.json
6. Return { score, max_score, percent }
```

### Recalculation (admin)

```
POST /api/admin/scores/recalculate

For each entry in scores.jsonc:
  - Load questions.jsonc
  - Re-run grade() using stored option_order to map shuffled indices back
  - Auto-backup scores.jsonc before overwrite
```

---

## 6. API Surface

### Student Routes (`quiz_bp`, prefix `/api`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/quiz-info` | None | Quiz title + question count |
| POST | `/api/start` | Email in `students.jsonc` | Create or resume quiz plan |
| GET | `/api/resume/<quiz_id>` | `quiz_id` lookup | Current question + progression |
| POST | `/api/save-answer` | `quiz_id` lookup | Save one answer, advance index |
| POST | `/api/submit` | `quiz_id` lookup | Grade and record submission |

### Admin Routes (`admin_bp`, prefix `/api`)

`GET /api/admin/quiz-status` is public. All others require `ADMIN_PW`.

**Scores:**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/scores` | Return all entries from `scores.jsonc` |
| POST | `/api/review` | Apply per-question point overrides |
| POST | `/api/admin/scores/recalculate` | Re-grade all against current `questions.jsonc` |
| POST | `/api/admin/scores/clear` | Clear `scores.jsonc` (auto-backup) |
| POST | `/api/admin/scores/restore` | Restore from last `.bak` |

**Questions:**

| Method | Path | Purpose |
|--------|------|---------|
| POST/PUT | `/api/admin/questions` | Read / overwrite `questions.jsonc` |

**Quiz Status:**

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/admin/quiz-status` | Read / set enabled flag |

**Students:**

| Method | Path | Purpose |
|--------|------|---------|
| GET/PUT | `/api/admin/students` | Read / overwrite `students.jsonc` |

**Question Bank (CRUD):**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/admin/bank/files` | List bank quiz files |
| POST | `/api/admin/bank/load` | Load bank file → `questions.jsonc` |
| POST | `/api/admin/bank/save` | Save `questions.jsonc` → bank |
| POST | `/api/admin/bank/delete` | Delete bank file |
| POST | `/api/admin/bank/preview` | Read bank file without activating |
| PUT | `/api/admin/bank/update` | Overwrite bank file in place |
| POST | `/api/admin/bank/rename` | Rename bank file + images folder |
| GET | `/api/admin/bank/download/<filename>` | Download bank file |

**Scores Bank (CRUD):**

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/admin/scores-bank/files` | List archived score files |
| POST | `/api/admin/scores-bank/load` | Load archive → `scores.jsonc` |
| POST | `/api/admin/scores-bank/save` | Save `scores.jsonc` → archive |
| POST | `/api/admin/scores-bank/delete` | Delete archive file |
| POST | `/api/admin/scores-bank/preview` | Read archive without activating |
| POST | `/api/admin/scores-bank/override` | Apply overrides to archived file |
| POST | `/api/admin/scores-bank/regrade-open` | Re-grade open questions in archive |
| POST | `/api/admin/scores-bank/rename` | Rename archive file |
| GET | `/api/admin/scores-bank/download/<filename>` | Download archive file |

**Students Bank, Images, Git Sync, LLM Info:**

| Method | Path | Purpose |
|--------|------|---------|
| POST/GET | `/api/admin/students-bank/*` | CRUD for student list archives |
| POST/GET/DELETE | `/api/admin/images/*` | Upload, list, delete quiz images |
| POST | `/api/admin/git-sync/status` | Git sync status |
| POST | `/api/admin/git-sync/init` | Init Git repo in `banks/` |
| POST | `/api/admin/git-sync/sync` | Pull + commit + push |
| POST | `/api/admin/email/send-result` | Email result to one student |
| POST | `/api/admin/email/send-all-results` | Email results to all |
| POST | `/api/admin/llm-info` | LLM configuration info |

---

## 7. Frontend Session Model

**No server-side session.** The teacher session exists entirely in React Router `location.state`.

```
AdminLoginPage
  → calls fetchScores(password) to validate
  → navigate("/admin/dashboard", { state: { adminPassword: password } })

Every admin page:
  const adminPassword = location.state?.adminPassword
  if (!adminPassword) navigate("/admin")  // guard

Every navigation between admin pages:
  navigate("/admin/scores", { state: { adminPassword } })
```

The plaintext password is threaded manually through every navigation call. There is no React context, no global store, no cookie. A hard refresh loses the session, requiring re-login — this is intentional (shared classroom computers).

TanStack Query keys always include the password: `["scores", adminPassword]`. In a single-teacher system this has no practical effect, but the mechanism is already present.

---

## 8. Concurrency and Isolation

**Simultaneous quizzes:** One. One `questions.jsonc` is active globally.

**Simultaneous students:** Up to ~50 (Waitress thread pool = 6; students mostly block on I/O). Each student has an isolated plan file, so per-student progression is independent.

**Between-group isolation:** None at the data layer. All students, regardless of the `group` field in `students.jsonc`, share the same quiz, the same `scores.jsonc`, and the same `quiz_status.jsonc`.

**Write protection:**

| Resource | Lock | Method |
|----------|------|--------|
| `scores.jsonc` | `FileLock` (10s timeout, 3 retries) | `os.replace()` atomic write |
| `questions.jsonc` | `FileLock` (10s timeout) | `os.replace()` atomic write |
| Plan files | None (per-student, no contention) | `os.replace()` atomic write |
| `students.jsonc` | None | Raw `open()` write |
| `quiz_status.jsonc` | None | Temp-file + `os.replace()` |

---

## 9. Bank System

**Flat directory structure, no namespacing:**

```
banks/
  question_bank/
    {YYYY-MM-DD_HH-MM}_{slug}.jsonc
    {YYYY-MM-DD_HH-MM}_{slug}_images/
  scores_bank/
    {YYYY-MM-DD_HH-MM}_risultati_{slug}.jsonc
  students_bank/
    {YYYY-MM-DD_HH-MM}_students.jsonc
```

All teachers (currently one) share these directories. File names are free-form.

**Load = overwrite active file.** Loading a bank quiz replaces `questions.jsonc` globally. If students are mid-quiz when this happens, their plan files may become stale (stale detection on next `api_start`, not on resume — so in-flight sessions can receive a `409 STALE_PLAN` on `api_resume`).

**Image co-location:** Saving a quiz to the bank also copies its images to `banks/question_bank/{slug}_images/`. Loading restores them to the active quiz images location (`banks/question_bank/questions_images/`). Image paths in the JSONC are rewritten to match.

**Git sync:** `git_sync.py` runs `git` subprocess commands against the `banks/` directory. The entire `banks/` tree is committed and pushed as a unit. No per-teacher or per-class branching.

---

## 10. Image Management

Image paths in `questions.jsonc` use URL paths: `/banks/question_bank/{stem}_images/{filename}`.

The active quiz's images live at `banks/question_bank/questions_images/` (derived from the `questions.jsonc` stem). Flask serves `/banks/<path>` as a static route.

**No isolation between quizzes in the active images folder.** Clearing active images clears all images for any currently loaded quiz.

---

## 11. Single-Tenant Assumptions — Complete Inventory

This section enumerates every place in the codebase where the single-teacher / single-active-quiz assumption is hardcoded, grouped by concern.

### A. Teacher Identity

| Location | What It Does | Notes |
|----------|-------------|-------|
| `utils.py:40–49` | `ADMIN_PW` loaded as single global | Would need per-teacher credential store |
| `routes/admin.py` (30+ sites) | `if auth_pw != ADMIN_PW: abort(403)` | Every endpoint has inline auth check |
| `AdminLoginPage.tsx:22–34` | Validates by calling `fetchScores(password)` | No dedicated login endpoint |
| All admin pages | `location.state?.adminPassword` | Password threaded manually through navigations |

### B. Active Quiz (One Quiz at a Time)

| Location | What It Does | Notes |
|----------|-------------|-------|
| `utils.py:17` | `QUEST_FILE = 'questions.jsonc'` | Single hardcoded path |
| `utils.py:load_questions()` | Module-level cache keyed to one file | Cache would need to be per-quiz-slot |
| `utils.py:invalidate_questions_cache()` | Invalidates the single global cache | |
| `routes/quiz.py:api_start` | Calls `load_questions()` once, assigns to all students | No quiz-to-student mapping |
| `routes/quiz.py:api_submit` | Grades against single `load_questions()` | |
| `routes/admin.py:api_recalculate_all_scores` | Grades against single `load_questions()` | |

### C. Active Scores (Flat Global Array)

| Location | What It Does | Notes |
|----------|-------------|-------|
| `utils.py:18` | `SCORE_FILE = 'scores.jsonc'` | Single hardcoded path |
| `utils.py:append_score_atomic()` | Appends to single file | |
| `utils.py:update_scores_atomic()` | Rewrites single file | |
| Score entry schema | No `teacher_id`, no `class_id`, no `group` | Would need tagging or partitioning |
| Duplicate check | `record['student'] == student_id` only | Would need to be scoped per quiz/class |

### D. Active Students (Flat Global List)

| Location | What It Does | Notes |
|----------|-------------|-------|
| `utils.py:19` | `STUDENTS_FILE = 'students.jsonc'` | Single hardcoded path |
| `utils.py:load_valid_students()` | Returns flat set; discards `group` field | Group is parsed but unused at runtime |
| `routes/quiz.py:api_start` | Validates against single flat set | No class-scoped access control |

### E. Quiz Status (One Global Toggle)

| Location | What It Does | Notes |
|----------|-------------|-------|
| `utils.py:20` | `QUIZ_STATUS_FILE = 'quiz_status.jsonc'` | Single flag |
| `routes/quiz.py:api_start` | Single global enabled check | No per-class or per-quiz enable |

### F. Student Plan Files

| Location | What It Does | Notes |
|----------|-------------|-------|
| `utils.py:21` | `QUIZ_FOLDER = 'quizzes'` | Single flat directory |
| Plan filename | `quizzes/{safe_id(email)}.json` | No teacher/class prefix |
| `utils.py:find_plan_by_quiz_id()` | Linear scan of all plan files | O(n) on disk, no index |
| Plan file schema | No `teacher_id`, no `class_id` | |

### G. Bank Directories

| Location | What It Does | Notes |
|----------|-------------|-------|
| `utils.py:23–26` | All bank paths hardcoded flat | No namespacing |
| All bank save/load functions | Operate on single shared directories | |
| Git sync | Commits entire `banks/` as one repo | No per-teacher branching |

### H. Image Storage

| Location | What It Does | Notes |
|----------|-------------|-------|
| `utils.py:get_quiz_images_folder()` | Derives folder from quiz filename stem only | No teacher/class prefix |
| Active images path | `banks/question_bank/questions_images/` | Fixed, derived from `QUEST_FILE` stem |

### I. Frontend Routing and URL Structure

| Location | What It Does | Notes |
|----------|-------------|-------|
| `main.tsx:33–91` | All admin routes under `/admin/**` flat | No `/admin/{teacher_id}/**` namespace |
| All admin pages | No concept of "which teacher is logged in" beyond the password | |
| `AdminDashboardPage.tsx` | Hardcodes exclusion of group `"Theacher"` | Magic string |

### J. Server Configuration

| Location | What It Does | Notes |
|----------|-------------|-------|
| `server.py:172` | Waitress 6-thread pool | May need tuning for multiple concurrent teachers |
| All path constants in `utils.py` | Relative to single working directory | Deployment assumes one instance = one teacher |
