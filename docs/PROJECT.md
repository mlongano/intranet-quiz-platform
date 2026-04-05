# QuizParty — System Design & Technical Reference

> Version 2.3.0 · MIT License

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [Directory Layout](#4-directory-layout)
5. [Backend Architecture](#5-backend-architecture)
6. [Frontend Architecture](#6-frontend-architecture)
7. [Data Model](#7-data-model)
8. [Quiz Lifecycle](#8-quiz-lifecycle)
9. [Security Model](#9-security-model)
10. [Bank System & Cloud Sync](#10-bank-system--cloud-sync)
11. [Optional Integrations](#11-optional-integrations)
12. [Deployment](#12-deployment)
13. [Design Decisions & Rationale](#13-design-decisions--rationale)

---

## 1. Overview

QuizParty is a **self-contained, offline-first quiz platform** for classroom assessments. A teacher runs the server on a local machine; students connect via the same LAN (classroom WiFi or wired), take their quiz on any browser-equipped device, and results are instantly visible to the instructor.

**Core properties:**
- **No internet required** during a quiz session
- **No database** — all state lives in JSONC files on disk
- **Single process** — one Python process serves both the API and the built frontend
- **~50 concurrent students** — the stated design target, handled by file locking and a multi-threaded WSGI server

---

## 2. Tech Stack

### Backend

| Package | Version | Role |
|---|---|---|
| Python | ≥ 3.10 | Runtime |
| Flask | ≥ 3.1.0 | Web framework, Blueprint routing |
| Waitress | ≥ 3.0.2 | Production WSGI server (6 threads) |
| commentjson | ≥ 0.9.0 | JSONC parser (JSON with `//` and `/* */` comments) |
| filelock | ≥ 3.16.1 | Cross-platform file locking |
| python-dotenv | ≥ 1.1.0 | `.env` configuration loading |
| python-magic | ≥ 0.4.27 | MIME type detection for image uploads |
| llm | ≥ 0.19 | LLM CLI abstraction layer |
| llm-anthropic | ≥ 0.24 | Anthropic/Claude provider plugin |
| llm-deepseek | ≥ 0.1.6 | DeepSeek provider plugin |
| llm-ollama | ≥ 0.15.1 | Ollama (local models) provider plugin |

**Package manager:** [`uv`](https://astral.sh/uv) (fast Rust-based pip/venv replacement)

### Frontend

| Package | Version | Role |
|---|---|---|
| React | ^19.0.0 | UI framework |
| TypeScript | ~5.7.2 | Type safety |
| Vite | ^6.3.1 | Build tool & dev server |
| TanStack Query | ^5.74.4 | Server state, caching, invalidation |
| React Router | ^7.5.1 | Client-side SPA routing |
| Tailwind CSS | ^4.1.4 | Utility-first styling |
| react-markdown | ^9.0.1 | Markdown rendering in questions |
| remark-gfm | ^4.0.0 | GitHub Flavored Markdown extension |
| rehype-sanitize | ^6.0.0 | Safe HTML output from Markdown |
| rehype-prism-plus | ^1.2.0 | Syntax highlighting in Markdown |
| prismjs | ^1.29.0 | Syntax highlighting engine |
| lucide-react | ^0.500.0 | Icon set |
| framer-motion | ^12.0.0 | Animations |
| jsonc-parser | ^3.3.1 | Client-side JSONC validation in editor |

**Package manager:** `pnpm`

### Design System (Neon Noir)

| Token | Value |
|---|---|
| Background | `#0a0e14` |
| Accent cyan | `#81ecff` |
| Accent magenta | `#e966ff` |
| Accent green | `#c2ff99` |
| Headline font | Space Grotesk |
| Body font | Manrope |

The design system is defined as CSS custom properties (`@theme`) in `frontend/src/main.css` and consumed via Tailwind utility classes throughout all admin pages.

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────┐
│  Browser (Student)          Browser (Admin)                  │
│  React SPA — /              React SPA — /admin/**            │
└────────────────┬────────────────────────┬────────────────────┘
                 │  HTTP (LAN)            │  HTTP (LAN)
                 ▼                        ▼
┌──────────────────────────────────────────────────────────────┐
│  Waitress WSGI (6 threads)  :5001                            │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Flask App (server.py)                               │    │
│  │  ┌──────────────────┐  ┌──────────────────────────┐  │    │
│  │  │  quiz_bp         │  │  admin_bp                │  │    │
│  │  │  /api/start      │  │  /api/admin/scores       │  │    │
│  │  │  /api/submit     │  │  /api/admin/questions    │  │    │
│  │  │  /api/resume     │  │  /api/admin/students     │  │    │
│  │  │                  │  │  /api/admin/banks/*      │  │    │
│  │  │                  │  │  /api/admin/images/*     │  │    │
│  │  │                  │  │  /api/admin/sync/*       │  │    │
│  │  └──────────────────┘  └──────────────────────────┘  │    │
│  │                   utils.py                           │    │
│  │  (file I/O, locking, caching, slugify, bank ops)     │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  Static files: /static/  (built React app)                   │
│  Data files:  *.jsonc, quizzes/, banks/, images/             │
└──────────────────────────────────────────────────────────────┘
                         │
                   File System
          questions.jsonc  ·  scores.jsonc
          students.jsonc   ·  quiz_status.jsonc
          quizzes/{email}.json
          banks/question_bank/*.jsonc
          banks/scores_bank/*.jsonc
          banks/students_bank/*.jsonc
```

**Request flow (student quiz):**
1. Student GETs `/` → Flask serves `static/index.html` (React SPA)
2. Student POSTs `/api/start` with `{email}` → server shuffles questions, writes `quizzes/{email}.json`, returns shuffled set
3. Student POSTs `/api/submit` → server grades answers, appends to `scores.jsonc` via atomic write
4. Admin polls `/api/admin/scores` → reads `scores.jsonc`, returns structured summary

---

## 4. Directory Layout

```
/
├── server.py               # Flask app factory + Waitress entrypoint
├── utils.py                # ALL shared utilities (I/O, locking, caching, banks, slugify)
├── routes/
│   ├── quiz.py             # Student-facing API: start, submit, resume
│   └── admin.py            # Admin API: scores, questions, students, banks, images, sync
│
├── questions.jsonc         # Active quiz (master questions file — includes answers & weights)
├── scores.jsonc            # Active submissions (append-only during quiz)
├── students.jsonc          # Enrolled students (one of three supported formats)
├── quiz_status.jsonc       # Quiz enabled/disabled flag
│
├── quizzes/                # Per-student shuffle state files (auto-created)
│   └── {email}.json        # Shuffled question + option order for one student
│
├── banks/                  # All archiveable data (Git-syncable as a unit)
│   ├── question_bank/      # Saved quiz sets (.jsonc) + image subfolders
│   │   └── {slug}_images/  # Images belonging to a quiz in the bank
│   ├── scores_bank/        # Archived score sets (.jsonc)
│   └── students_bank/      # Saved student lists (.jsonc)
│
├── images/                 # Active quiz images (served as static files)
│
├── email_service.py        # SMTP email composition + sending
├── llm_evaluator.py        # Optional LLM grading for open-ended questions
├── git_sync.py             # Git-based cloud sync for banks/
│
├── frontend/
│   ├── src/
│   │   ├── main.tsx            # QueryClient + RouterProvider setup
│   │   ├── main.css            # @theme tokens, .glass-panel, global resets
│   │   ├── api.ts              # ALL API calls + TypeScript interface definitions
│   │   ├── components/
│   │   │   ├── AdminLayout.tsx     # Shared chrome: collapsible sidebar + sticky header
│   │   │   ├── QuestionDisplay.tsx # Renders questions with Markdown + images
│   │   │   ├── SubmissionDetailView.tsx
│   │   │   ├── ImagePicker.tsx     # Reusable image selector with thumbnails
│   │   │   └── LoadingSpinner.tsx
│   │   └── pages/
│   │       ├── AdminLoginPage.tsx
│   │       ├── AdminDashboardPage.tsx
│   │       ├── AdminQuestionEditorPage.tsx
│   │       ├── AdminScoresPage.tsx
│   │       ├── AdminStudentsPage.tsx
│   │       ├── AdminBankManagerPage.tsx
│   │       ├── AdminScoresBankPage.tsx
│   │       ├── AdminStudentsBankPage.tsx
│   │       ├── AdminScoresBankReviewPage.tsx
│   │       └── AdminImageManagerPage.tsx
│   ├── dist/               # Vite build output → copied to ../static/
│   └── package.json
│
├── pyproject.toml          # Python project config + dependency declarations
├── .env                    # Runtime secrets (not committed)
└── AGENTS.md               # Coding conventions for AI agents
```

---

## 5. Backend Architecture

### 5.1 Entry Point (`server.py`)

Flask is created as an app factory, Blueprints are registered, and the built frontend `static/` is wired up as Flask's static folder. In production, Waitress is started directly from `server.py` with 6 worker threads — one process, multi-threaded, no forking.

```python
serve(app, host="0.0.0.0", port=5001, threads=6)
```

The server also prints all LAN-accessible addresses at startup so students know which IP to connect to.

### 5.2 Routing (Blueprints)

**`quiz_bp`** — student-facing, no auth:

| Method | Route | Description |
|---|---|---|
| POST | `/api/start` | Validate student email, shuffle questions/options, persist shuffle, return quiz |
| POST | `/api/submit` | Grade answers, append to scores.jsonc atomically |
| POST | `/api/resume` | Return existing shuffle state for incomplete quiz |
| GET | `/api/quiz-status` | Return enabled/disabled flag |

**`admin_bp`** — every route checks `ADMIN_PW`:

| Method | Route | Description |
|---|---|---|
| GET/POST | `/api/admin/quiz-status` | Read/write quiz enable flag |
| GET | `/api/admin/scores` | Return all submissions with metadata |
| POST | `/api/admin/recalculate` | Re-grade all submissions against current questions |
| DELETE | `/api/admin/scores` | Clear scores (with automatic bank backup) |
| GET | `/api/admin/questions` | Read active questions.jsonc |
| PUT | `/api/admin/questions` | Overwrite active questions.jsonc |
| GET/PUT | `/api/admin/students` | Read/write students.jsonc |
| GET/POST/DELETE | `/api/admin/images` | List, upload, or delete images |
| GET/POST/DELETE | `/api/admin/banks/*` | All bank CRUD + load operations |
| POST | `/api/admin/sync/init` | Initialize Git repo in banks/ |
| POST | `/api/admin/sync/push` | Pull + commit + push banks/ |
| GET | `/api/admin/sync/status` | Return last commit info |
| POST | `/api/admin/email` | Send individual or bulk result emails |

### 5.3 Utilities (`utils.py`)

All shared logic lives here. Nothing is duplicated across routes.

**File I/O:**
- `load_scores()` / `save_scores()` — read/write `scores.jsonc` with `commentjson`
- `load_questions()` — reads with mtime-based cache invalidation (avoids re-parsing on every request)
- `load_students()` — parses all three student formats into a normalized list

**Atomic writes — critical pattern:**
```python
# temp file → fsync → os.replace (POSIX atomic)
def _atomic_write(path, data):
    fd, tmp = tempfile.mkstemp(dir=path.parent)
    with os.fdopen(fd, 'w') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)
```

**`append_score_atomic(entry)`** — acquires `FileLock`, reads current scores, appends, calls `_atomic_write`. Used by every quiz submission.

**`update_scores_atomic(transform_fn)`** — same pattern, but applies a caller-supplied transform function. Used for recalculation, clear, and restore.

**File locking:**
```python
FileLock(lock_path, timeout=10)  # 10s default, retried 3× with backoff
```
Prevents race conditions when ~50 students submit simultaneously.

**Slug utility:**
```python
slugify("Java Quiz 2025")  # → "java-quiz-2025"
```
Used for all bank filenames: `YYYY-MM-DD_HH-MM_{slug}.jsonc`.

**In-memory question cache:**
Questions are loaded once and stored in a module-level dict keyed by `(path, mtime)`. Cache is invalidated automatically when `questions.jsonc` is written.

### 5.4 JSONC File Format

All data files use JSONC (JSON with Comments), parsed by the `commentjson` library. This allows educators to annotate their question files with inline notes:

```jsonc
{
  "title": "Python Basics",
  "questions": [
    {
      "id": 1,
      "type": "single",
      "text": "What does `len()` return?",
      // 0 = "The length of the object"
      "correct": 0,
      "weight": 1
    }
  ]
}
```

**Rule**: everywhere Python reads or writes a `.jsonc` file, it uses `import commentjson as json` — never the stdlib `json`.

---

## 6. Frontend Architecture

### 6.1 App Shell (`main.tsx`)

```typescript
// QueryClient with 5-minute stale time
// BrowserRouter wrapping all routes
// Route table maps /admin/** to page components
```

All admin routes are protected by the login page. The admin password is passed via React Router `location.state` — it exists in memory only, is never written to `localStorage`, and is intentionally lost on a hard refresh (the user must re-login).

### 6.2 Routing Table

```
/                     → Student quiz (QuizPage)
/admin                → AdminLoginPage (redirects to /admin/dashboard on success)
/admin/dashboard      → AdminDashboardPage
/admin/questions      → AdminQuestionEditorPage
/admin/scores         → AdminScoresPage
/admin/students       → AdminStudentsPage
/admin/bank           → AdminBankManagerPage
/admin/scores-bank    → AdminScoresBankPage
/admin/students-bank  → AdminStudentsBankPage
/admin/images         → AdminImageManagerPage
```

### 6.3 `AdminLayout` Component

All admin pages are wrapped in `AdminLayout`, which provides:
- **Collapsible sidebar** with navigation links (Dashboard, Questions, Scores, Students, Archives)
- **Sticky top bar** with page title
- **Ambient glow blobs** (CSS background ornaments, part of Neon Noir identity)
- **Glass-panel** content container (backdrop blur + border + subtle glow)

Each page receives only its own content — chrome is never duplicated.

### 6.4 API Layer (`api.ts`)

All network calls are defined as typed async functions in a single file. TypeScript interfaces for all data shapes (`Question`, `Submission`, `BankFile`, etc.) are defined here and imported elsewhere. No inline `fetch` calls exist in page components.

Pattern:
```typescript
export async function fetchScores(password: string): Promise<Submission[]> {
  const res = await fetch('/api/admin/scores', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

### 6.5 Server State (TanStack Query)

All server data goes through TanStack Query. Direct `useState` + `useEffect` for data fetching is forbidden.

Key patterns:
```typescript
// Query
const { data, isLoading } = useQuery({
  queryKey: ['scores', password],
  queryFn: () => fetchScores(password),
});

// Mutation with invalidation
const mutation = useMutation({
  mutationFn: recalculateScores,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scores', password] }),
});
```

Query keys always include the admin password so cached data is scoped per session.

Auto-refresh is used only where live data matters (submissions tracker on the dashboard: 30-second interval).

### 6.6 Styling

Tailwind CSS v4, utility-classes only. No custom CSS except:
- `@theme` tokens in `main.css` (the Neon Noir palette and font variables)
- `.glass-panel` utility class (reused across all content containers)

Responsive breakpoints (`md:`, `lg:`, `xl:`) are used throughout for tablet/desktop layouts.

---

## 7. Data Model

### `questions.jsonc`

```jsonc
{
  "title": "Quiz Title",
  "questions": [
    {
      "id": 1,                         // integer or string
      "type": "single",                // "single" | "multiple" | "open"
      "text": "Question text (Markdown OK)",
      "question_image": "path/to/img", // optional
      "options": [                     // array of strings or objects with text+image
        "Option A",
        { "text": "Option B", "image": "path/to/img" }
      ],
      "correct": 0,                    // index (single) | [indices] (multiple)
      "weight": 1,                     // points for a correct answer
      // For open questions:
      "acceptable": ["keyword"],       // any match = full score
      "keywords": ["k1", "k2"],        // keyword list
      "min_keywords": 3                // minimum matches for full score
    }
  ]
}
```

### `scores.jsonc`

Array of submission objects, one per student per quiz attempt:

```jsonc
[
  {
    "student_id": "student@example.com",
    "quiz_id": "quiz-title",
    "submitted_at": "2025-01-15T10:30:00",
    "score": 8,
    "max_score": 10,
    "answers": { "1": 0, "2": [0, 2], "q7": "oxygen" },
    "option_order": { "1": [2, 0, 1, 3], ... }  // shuffle record for recalculation
  }
]
```

### `students.jsonc`

Three supported formats (can be mixed):
```jsonc
[
  "student@example.com",                              // simple
  { "email": "b@example.com", "group": "5CI" },       // individual
  { "group": "4BI", "emails": ["c@ex.com", "d@ex.com"] }  // group
]
```

### `quizzes/{email}.json`

Shuffle state persisted on `start`, read back on `resume`:
```json
{
  "student_id": "student@example.com",
  "quiz_id": "quiz-title",
  "question_order": [3, 0, 1, 2],
  "option_orders": { "1": [2, 0, 3, 1], "2": [1, 3, 0, 2] }
}
```

### Bank Filenames

All bank files follow the pattern:
- Questions: `YYYY-MM-DD_HH-MM_{slug}.jsonc`
- Scores: `YYYY-MM-DD_HH-MM_risultati_{slug}.jsonc`
- Students: `YYYY-MM-DD_HH-MM_students.jsonc`

Slugs are ASCII-safe, lowercase, hyphen-separated (e.g., `"Java Quiz 2025"` → `"java-quiz-2025"`).

---

## 8. Quiz Lifecycle

```
1. SETUP (admin)
   ├── Edit questions.jsonc via Question Editor
   ├── Upload images to images/
   ├── Load student list (or edit students.jsonc)
   └── Enable quiz via dashboard toggle → quiz_status.jsonc = {enabled: true}

2. START (student)
   ├── Student POSTs /api/start with {email}
   ├── Server validates email against students.jsonc
   ├── Shuffles question order + option order (seeded per-student)
   ├── Writes quizzes/{email}.json (shuffle record)
   └── Returns shuffled question set (no answers)

3. QUIZ (student)
   └── Student answers locally (React state), submits all at once

4. SUBMIT (student)
   ├── Student POSTs /api/submit with {email, answers, quiz_id}
   ├── Server loads quizzes/{email}.json (to map shuffled indices back)
   ├── Grades closed questions (exact index match)
   ├── Grades open questions (keyword matching or LLM if enabled)
   ├── Appends score entry to scores.jsonc via append_score_atomic()
   └── Returns score + percentage

5. REVIEW (admin)
   ├── Admin views scores on AdminScoresPage
   ├── Can click any submission for question-by-question breakdown
   ├── Can override individual question scores
   └── Can export CSV or send email results

6. ARCHIVE (admin)
   ├── Save questions to question_bank/ (with images)
   ├── Save scores to scores_bank/
   └── Optionally sync banks/ to Git remote
```

**Resume flow:** if a student navigates away and returns, `POST /api/resume` returns the same shuffled questions from `quizzes/{email}.json`. Their previously submitted answers are not returned (no partial-save — quiz is all-or-nothing submit).

**Recalculation:** when answer keys or weights change, admin triggers recalculation. The server reads every entry in `scores.jsonc`, re-grades using the current `questions.jsonc` and the stored `option_order` (so the correct answer index is always resolved against the student's original shuffle), and replaces `scores.jsonc` atomically. Old scores are auto-archived first.

---

## 9. Security Model

QuizParty is designed for **LAN-only, low-threat environments** (a classroom, not the internet). The security model reflects this explicitly:

| Concern | Approach |
|---|---|
| Admin auth | Single shared password in `.env`; required on every admin API call in request body |
| Password storage (client) | React Router `location.state` — memory only, lost on refresh, never `localStorage` |
| Student identity | Email address must exist in `students.jsonc`; no passwords, no tokens |
| Data confidentiality | No encryption at rest or in transit (HTTP, not HTTPS by default) |
| CORS | Not configured — same-origin only (Flask serves the SPA) |
| Rate limiting | None — not needed for 50-student LAN use |
| Input validation | Werkzeug exceptions (`abort(400/403/404)`) for malformed requests |
| Image uploads | MIME type validated with `python-magic`; max 5 MB; extensions allowlisted |

**HTTPS** can be added via Nginx reverse proxy (self-signed cert or Let's Encrypt) if the deployment environment requires it. See `README.md` for full setup instructions.

**Admin password is not hashed** — it is compared directly to the `.env` value. This is intentional for simplicity in a classroom context; the server is not exposed to the internet.

---

## 10. Bank System & Cloud Sync

### Bank Structure

All archiveable data lives under `banks/`, designed to be a single Git repository:

```
banks/
├── question_bank/        # Quiz question sets
│   ├── 2025-01-15_09-30_java-basics.jsonc
│   └── 2025-01-15_09-30_java-basics_images/
│       └── diagram.png
├── scores_bank/          # Score archives
│   └── 2025-01-15_11-00_risultati_java-basics.jsonc
└── students_bank/        # Student list snapshots
    └── 2025-01-15_09-00_students.jsonc
```

When a quiz is saved to the bank, its `images/` folder is **copied alongside it** as `{slug}_images/`. When loaded back, images are restored to the active `images/` directory. Image paths inside the JSONC are updated automatically on rename.

### Cloud Sync

`git_sync.py` wraps `subprocess` calls to `git` to implement:

1. `init_sync()` — `git init` + `git remote add origin {remote_url}` in `banks/`
2. `push_sync()` — pull (fast-forward) → `git add -A` → `git commit -m "Sync {timestamp}"` → `git push`
3. `sync_status()` — returns last commit hash + timestamp

Authentication uses a **personal access token** embedded in the remote URL:
```
https://{token}@github.com/user/repo.git
```

The token is never stored in `banks/.git/config` in plain text — it is injected at runtime from `.env`.

---

## 11. Optional Integrations

### LLM Grading (`llm_evaluator.py`)

Open-ended questions can optionally be graded by an LLM instead of keyword matching. Enabled via `USE_LLM_EVAL=1` in `.env`.

The `llm` library provides a unified interface over multiple providers:
- **Anthropic** (Claude) via `llm-anthropic`
- **DeepSeek** via `llm-deepseek`
- **Local models** (Ollama) via `llm-ollama`

The evaluator receives the question text, the acceptable answer list, and the student's response. It returns a score between 0 and the question weight.

Keyword matching remains the default and fallback — LLM grading is additive.

### Email (`email_service.py`)

Configured via SMTP environment variables. Sends HTML-formatted emails in Italian containing:
- Student name, quiz title, score, percentage, submission date
- Optional question-by-question breakdown

Gmail requires an App Password (2FA must be enabled). Other SMTP providers are supported via `SMTP_SERVER` / `SMTP_PORT`.

---

## 12. Deployment

### Development

```bash
# Backend
uv run server.py          # http://localhost:5001

# Frontend (separate terminal)
cd frontend
pnpm dev                  # http://localhost:5173 (proxies /api to :5001)
```

### Production

```bash
cd frontend && pnpm build  # outputs to ../static/
uv run server.py           # serves API + static files on :5001
```

Waitress serves all traffic — no separate frontend server needed in production.

### Production on Ubuntu (Recommended)

Systemd service + Nginx reverse proxy:
- Systemd: auto-restart, boot start, structured logging
- Nginx: static file caching, optional HTTPS termination, `client_max_body_size 10M`

See `README.md` → *Production Deployment on Ubuntu 22.04* for full systemd unit file and Nginx config.

### Docker

A `docker-compose.yml` pattern is described in `README.md`. Volumes bind-mount all data files (`banks/`, `*.jsonc`) so quiz data persists across container restarts.

---

## 13. Design Decisions & Rationale

### File-based storage (no database)

**Decision:** All data stored as JSONC files; no SQLite, PostgreSQL, or other database.

**Rationale:**
- A classroom quiz serving ≤ 50 concurrent users has no scalability requirement that justifies a database
- Teachers often want to inspect, edit, and version-control their data files directly
- Zero infrastructure dependencies — deploy by copying a folder
- JSONC supports inline comments, which educators use to annotate question files
- Atomic writes + file locking provide sufficient concurrency guarantees for the use case

**Trade-off:** Would not scale to thousands of concurrent users or support complex ad-hoc queries. Acknowledged as acceptable and noted in the TODO.

---

### JSONC over JSON

**Decision:** Use `commentjson` everywhere instead of stdlib `json`.

**Rationale:** Educators want to leave notes in their question files ("// this was the 2024 version"). Standard JSON forbids this. JSONC is a natural fit.

**Rule enforced in `AGENTS.md`:** `import commentjson as json` — never plain `import json`.

---

### Atomic writes via temp+replace

**Decision:** All file writes use `tempfile.mkstemp` + `os.replace`.

**Rationale:** `os.replace` is atomic on POSIX systems (rename syscall). If the server crashes mid-write, the original file is never corrupted — either the old file remains or the new file appears fully. This is critical during a live quiz where 50 students may submit in a short window.

---

### File locking with exponential backoff

**Decision:** `FileLock` with timeout + retry on every write, rather than a queue or in-memory lock.

**Rationale:**
- Cross-process safe (would work even if multiple server processes were started accidentally)
- Simple to reason about — no shared state required
- Backoff prevents thundering-herd on simultaneous submission bursts
- The `filelock` library handles Windows and POSIX uniformly

---

### Per-student shuffle stored on disk (not in-memory)

**Decision:** Shuffle state persisted to `quizzes/{email}.json` at quiz start, not held in a server session.

**Rationale:**
- Server process can restart during a quiz without losing student state
- Students can close their browser and resume later
- Score recalculation works correctly even after server restart, because `option_order` is in the score record

---

### Password via `location.state` (not `localStorage`)

**Decision:** Admin password is passed between React Router navigations via `location.state`.

**Rationale:**
- `localStorage` persists across browser sessions — a shared classroom computer would leave the admin session open permanently
- `location.state` lives in browser memory only; a hard refresh clears it
- Forces re-authentication after a page reload, which is desirable in a shared environment
- No token management, no expiry logic needed

---

### Single-process, multi-thread (Waitress, not Gunicorn + workers)

**Decision:** Waitress with 6 threads; no multi-process deployment.

**Rationale:**
- File locking is intra-process safe; multi-process would require a shared lock manager
- 6 threads is more than sufficient for ≤ 50 students
- Waitress is pure Python, runs on all platforms including Windows (important for teachers who may deploy on a Windows machine)
- Gunicorn does not support Windows

---

### TanStack Query for all server state

**Decision:** No direct `useEffect` + `fetch` in components. All server data goes through TanStack Query.

**Rationale:**
- Automatic deduplication, caching, and background invalidation with no boilerplate
- Query keys scoped to admin password — prevents data leakage between sessions
- Mutations auto-invalidate related queries, keeping the UI consistent
- Loading and error states are handled uniformly

---

### `api.ts` as single API surface

**Decision:** All `fetch` calls defined as typed functions in one file; never inline in components.

**Rationale:**
- Single place to update if the API changes
- TypeScript interfaces co-located with their usage ensure compile-time correctness
- Components stay presentational — they call functions, not URLs

---

### Stale plan detection on quiz start

**Decision:** When a student calls `/api/start` and a plan file already exists for them, the server validates that every question ID in the plan is still present in the current bank before returning the existing `quiz_id`. If any IDs are missing the plan is silently discarded and a fresh one is created.

**Background — the "resume if already started" guard:**
Each student has exactly one plan file (`quizzes/{safe_id}.json`). When `/api/start` is called and the file already exists, the server returns a `409` response containing the existing `quiz_id` so the frontend can redirect the student to their in-progress quiz. This protects against data loss when a student closes the browser tab, the machine powers off, or the session times out mid-quiz.

**The problem:**
If the question bank is replaced (e.g. the teacher loads a different quiz set from the bank) while a student's plan file still exists on disk, the plan contains question IDs that no longer exist in the new bank. The old guard would return the stale `quiz_id` to the frontend, which then calls `/api/resume`. The resume handler looks up each question ID in the current bank — if the first question is already missing, the call crashes.

Before the fix this produced a `500 Internal Server Error`. After the `api_resume` hardening it produces a `409 STALE_PLAN`, but the student was still stuck with no way forward.

**The fix:**
At `/api/start`, before returning the existing `quiz_id`, the server now:
1. Loads the current question bank.
2. Computes `stale = plan_question_ids − current_bank_ids`.
3. If `stale` is non-empty → deletes the plan file and falls through to create a new quiz.
4. If `stale` is empty → returns the existing `quiz_id` as before (normal resume path).
5. If the bank cannot be loaded during this check → fails safe by returning the existing `quiz_id` (the subsequent `api_resume` call will return `409 STALE_PLAN` with a user-friendly message).

**Known trade-off — partial progress loss:**
The stale check operates on the full set of plan question IDs, not just the ones the student has already answered. This means:

- If a student has answered questions 1–10 out of 25, and the teacher removes question 15 (which the student hasn't reached yet), `stale` will be non-empty and the plan — including the saved answers to 1–10 — will be discarded.
- In practice this only occurs when the teacher actively replaces the bank mid-session, which is an admin action that implicitly invalidates all in-flight sessions.
- Before the fix the same student would have been permanently stuck in a `500`/`STALE_PLAN` loop at question 15 anyway, so the net outcome is better.

**The happy path is fully preserved:**
If the bank has not changed since the plan was created, `stale` is always empty and the resume flow is identical to before the fix.

---

*End of document*
