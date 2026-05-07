# Prompt: Multi-Teacher / Multi-Class Refactoring Plan for QuizParty

## How to use this document

Feed this prompt — together with `docs/ARCHITECTURE-CURRENT.md` — to an AI architect or planning session. The goal is a complete, actionable refactoring plan. The plan should be prescriptive: specific data models, specific API shapes, specific migration steps. Avoid hand-wavy "you could use X or Y" sections; commit to concrete choices and justify them.

---

## Context

QuizParty is a self-contained, offline-first quiz platform for classroom assessments. Read `docs/ARCHITECTURE-CURRENT.md` in full before proceeding. That document describes the current as-is single-tenant architecture at v2.5.0, including every file, every data schema, the complete API surface, and — critically — Section 11, which enumerates every single-tenant assumption that needs to change.

The current system was designed for one teacher running one quiz at a time on a LAN. It needs to be extended to support the full staff of a technical secondary school.

### Fork Strategy

This refactor lives on a **separate branch** from the existing codebase. The current single-teacher version (`main` branch) is preserved as-is for teachers who want a self-hosted, zero-infrastructure setup. The new branch targets **deployment on a central school server** managed by IT staff. The two versions do not need to stay in sync after the fork — they are separate products serving different deployment contexts.

The plan should treat this as a greenfield design that reuses the existing quiz-taking UI, not as an incremental patch to the single-tenant code.

---

## Target Requirements

### Scale

- **Teachers:** up to ~150 accounts, renewed yearly (staff turnover)
- **Classes:** up to ~40 classes per year, each with ~20 students (~800 student accounts total)
- **Concurrent quiz sessions:** multiple teachers can run quizzes simultaneously; a reasonable peak is 5–10 concurrent quiz sessions (each is one teacher + one class, ~20 students)
- The system does NOT need to scale beyond a single server process on a school LAN — this is not a cloud service

### Identity

- Teacher and student accounts must be **tied to the school's Google Workspace** (currently `@liceoaltieri.edu.it` or similar)
- **Authentication must work fully offline** — students and teachers authenticate against the local server, with no outbound internet connection required during a quiz session
- The student network is **cut off from the internet** during assessments (firewall policy, not software policy); the solution must not depend on any outbound connection to function
- Google Workspace is the **source of truth for account provisioning** — accounts are not created manually in QuizParty; they are imported/synced from Google Workspace by an admin
- Account sync from Google Workspace happens **on-demand or scheduled** by a school IT admin, during a time when the server does have internet access (e.g., before the school day starts)

### Authorization Model

- A **teacher** owns their own quizzes and sees only their own classes' scores
- A **class** belongs to one or more teachers (a class may be co-taught)
- A **student** belongs to one or more classes
- A teacher can assign a quiz to one or more of their classes; students in those classes can take that quiz
- **Super-admin role** (IT staff): can manage all accounts, all quizzes, all scores, and sync from Google Workspace
- Teachers cannot see other teachers' quiz content or scores

### Simultaneous Quizzes

- Multiple teachers must be able to run different quizzes at the same time without interfering
- Each quiz session is scoped to: one teacher + one quiz (question set) + one or more classes
- Students from class A taking quiz X and students from class B taking quiz Y must be fully isolated at every layer (data, API, status flags)

### Operational Constraints

- **Offline-first is non-negotiable.** Every feature must work without internet after the initial account sync.
- **Storage:** **PostgreSQL** (running on the same machine) is the single source of truth for all data — accounts, classes, sessions, scores, tokens, question content (stored as JSONB), question bank snapshots, and student quiz plans. The filesystem is used only for: images (binary assets), `.env` secrets, `pg_dump` backups, and TLS certificates.
- **JSONC as authoring format:** JSONC files are not stored on the server — they are the import/export format teachers use when authoring questions outside the web UI. The server parses JSONC on import (stripping comments via `commentjson`) and stores the result as JSONB in PostgreSQL. On export, the server produces clean JSONC. This means inline `// comments` are an authoring-time tool only and do not persist in the database — which is already the case in the current system.
- The system runs as a **single Python process** served by Waitress, plus a local PostgreSQL instance, on the school's central server.
- The existing **Neon Noir design system** and React/TypeScript frontend stack are retained.
- **No separate microservices, no cloud dependencies.** One application server, one database, one machine.
- Migration tooling from the v2.5.0 single-tenant format is required (Mauro Longano's existing data is the test case).

---

## The Core Technical Problems to Solve

The plan must address each of these explicitly. Do not defer them to "future work."

### 1. Offline Authentication Against Google Workspace Accounts

This is the hardest constraint. The plan must specify exactly how it works.

The challenge: Google OAuth2 / OpenID Connect requires internet connectivity to validate tokens. The school's student network has no internet. The solution must allow a student or teacher to prove they are who they claim to be (tied to their `@school.it` Google account) without any outbound request at the moment of login.

Consider and choose between (or combine) approaches such as:
- **Pre-issued JWT tokens:** during a sync window (when internet is available), the server issues signed JWTs to every known account. Tokens are long-lived (e.g., 1 year) and self-contained. Login = present the token, server verifies signature with its own private key. Token distribution requires an internet-connected step, but token validation is fully offline.
- **Password-based fallback:** during sync, the server sets a local bcrypt-hashed password derived from or alongside the Google account. Login = email + password. The Google account is the identity source, but the credential checked at login is local.
- **LDAP/Google Directory Sync:** if the school runs a local LDAP directory (or Google Cloud Directory Sync to on-premise AD), students authenticate against LDAP. Offline if LDAP is on-prem.
- **Pre-provisioned session tokens:** during a pre-quiz setup step (when teacher has internet), teacher initiates a "prepare session" action that contacts Google to verify all student accounts and issues per-student tokens. Students use these tokens, valid for the duration of the session.

The plan must commit to one approach, explain why it fits the constraints (offline, Google-tied identity, 800 students, school IT admin capacity), and specify the data structures and flows involved.

### 2. Multi-Tenant Data Isolation

Currently: one flat `questions.jsonc`, one flat `scores.jsonc`, one flat `students.jsonc`, one `quiz_status.jsonc`, all at the project root. Everything is global.

The plan must specify:
- The PostgreSQL schema for the core entities: Teacher, Student, Class, QuizSession, ScoreEntry. Include foreign keys, constraints, and indexes.
- How is a "quiz session" — the combination of a teacher, a JSONC question file, one or more classes, and an enabled/disabled flag — modeled in the database?
- How are student plan files scoped to a session? Currently they are `quizzes/{safe_id(email)}.json` with no namespacing. In the new model a student could theoretically be in two simultaneous sessions from different teachers; the plan must either handle or explicitly exclude this edge case.
- How are scores stored? Replace the flat `scores.jsonc` append model with PostgreSQL rows. Define the table schema, the write path (what replaces `append_score_atomic`), and how a teacher queries only their own scores.
- How are student quiz plans stored? Replace `quizzes/{safe_id}.json` with a `quiz_plans` table. This eliminates the `find_plan_by_quiz_id()` linear disk scan and makes session scoping (teacher_id, session_id) a query rather than a directory convention.
- How are question bank snapshots stored? Replace `banks/question_bank/*.jsonc` files with a `question_snapshots` table (teacher_id, created_at, title, content JSONB). JSONC import/export becomes a serialization operation on this table, not a file copy. The Git sync feature (`git_sync.py`) is dropped; versioning is handled by snapshot rows and `pg_dump` backups.

### 3. API Namespacing and Auth

Currently: admin authentication is a single shared password checked inline 30+ times. There is no session, no token, no concept of "which teacher is making this request."

The plan must specify:
- The new authentication flow for teachers (login endpoint, token format, token lifetime)
- The new authentication flow for students (tied to the answer in problem 1)
- How the API is namespaced (e.g., `/api/teacher/{id}/...`, or context from the auth token, or a session concept)
- How the super-admin role is differentiated from teacher role
- How the frontend session model changes (currently: password in `location.state`)

### 4. Account Provisioning and Sync

Currently: `students.jsonc` is edited manually. There is no teacher account concept at all.

The plan must specify:
- The data schema for teacher accounts (fields stored locally)
- The data schema for student accounts (fields stored locally, mapped to Google identity)
- The data schema for classes (group of students, assigned to teacher(s))
- The sync flow: how does an IT admin pull the current class roster from Google Workspace into QuizParty? What Google Workspace APIs are used? What happens to accounts that disappear from Google (graduated students, departed teachers)?
- What can be done without internet: which admin operations require sync vs. work fully offline?

### 5. Bank System Replacement

Currently: `banks/question_bank/`, `banks/scores_bank/`, `banks/students_bank/` are flat shared directories of JSONC files managed with a custom Git sync.

The bank system is replaced entirely by PostgreSQL snapshot tables. The plan must specify:
- The schema for `question_snapshots`, `score_archives`, and `student_list_snapshots` tables, including the teacher ownership FK and timestamp fields
- How the existing "save to bank" and "load from bank" operations map to INSERT and SELECT queries
- How JSONC export (download) and import (upload) work against these tables — this is the only point where JSONC files appear on the server, transiently, during a request
- That `git_sync.py` is removed; the replacement backup story is `pg_dump` to a local directory, optionally pushed to a remote by the IT admin as a scheduled job

### 6. Migration Path

Currently deployed instances have existing `banks/`, `scores.jsonc`, `students.jsonc`, and `questions.jsonc` belonging to a single teacher (the current user, Mauro Longano).

The plan must specify:
- A migration script that transforms the existing single-tenant data into the new multi-tenant schema
- How the existing teacher's data is preserved and assigned to their new teacher account
- Whether the migration is reversible
- What manual steps the IT admin must perform vs. what is automated

---

## Deliverables Expected from the Plan

The plan must produce all of the following. Each section should be specific enough to implement without further design decisions.

### D1. Data Schema

For every entity (Teacher, Student, Class, QuizSession, QuizPlan, ScoreEntry, QuestionSnapshot, ScoreArchive, Token/Credential):
- Full PostgreSQL table definition (column names, types, constraints, indexes, foreign keys)
- Entity relationship diagram or equivalent textual description

No entity remains file-based. The only filesystem artifacts are images and the transient JSONC payloads during import/export requests.

### D2. File and Directory Layout

The filesystem is now minimal. Specify the complete new directory tree, which should contain only:
- `images/{teacher_id}/` — per-teacher quiz images (binary assets served by Nginx)
- `.env` — secrets (DB credentials, JWT signing key, Google Workspace API credentials)
- `backups/` — `pg_dump` output files
- TLS certificate path (for Nginx)

For every constant in `utils.py` that currently points to a JSONC file or directory (`QUEST_FILE`, `SCORE_FILE`, `STUDENTS_FILE`, `QUIZ_STATUS_FILE`, `QUIZ_FOLDER`, `BANKS_BASE`, etc.), specify that it is removed and replaced by a database query. List which Python modules and constants are deleted entirely.

### D3. Authentication Flows

Step-by-step sequences for:
- IT admin initial setup (first run, creates super-admin account)
- Google Workspace account sync (what happens, what is stored, when internet is required)
- Teacher login (request → token issuance → session)
- Student login during a quiz (request → validation → quiz_id)
- Token refresh or session renewal
- What happens when a token expires mid-quiz

### D4. New API Surface

For every new or changed endpoint:
- HTTP method + path
- Request body / query params
- Response schema
- Auth requirement (none / student token / teacher token / super-admin token)
- Which current endpoint it replaces (if any)

Endpoints that are unchanged should be listed as "retained" with a note on whether their auth mechanism changes.

### D5. Modified `utils.py` and Route Files

A list of every function in `utils.py` that must change, with:
- The current signature
- The new signature
- What changes and why

And for each route file (`routes/quiz.py`, `routes/admin.py`):
- Which handlers are removed, renamed, or split
- What new handlers are added
- Whether a new route file (e.g., `routes/auth.py`) is needed

### D6. Frontend Changes

- New pages required (login flows, teacher dashboard scoping, super-admin panel)
- Pages that are removed or merged
- Changes to the admin password threading pattern (`location.state`) — what replaces it?
- Whether the student-facing routes (`/`, `/quiz/:quizId`, `/finish`) change

### D7. Migration Script Specification

Pseudocode or step-by-step description of the migration script that converts a v2.5.0 single-tenant instance to the new multi-tenant schema. Include rollback procedure.

### D8. Dependency Changes

Any new Python or Node.js packages required. For each:
- Package name and version
- Why it is needed
- Whether it introduces an internet dependency at runtime (must be justified if yes)

Must include the PostgreSQL driver choice for Python (e.g., `psycopg3`, `asyncpg`) and any ORM or query builder if recommended, with justification.

### D9. Deployment Changes

What changes in the production setup for the central server deployment:
- Systemd units required (application server, PostgreSQL if not already running)
- Environment variables and `.env` file changes
- Database initialization (schema creation, first-run script)
- Nginx config changes (the central server is expected to use Nginx; HTTPS with a self-signed cert is recommended)
- How the IT admin runs the Google Workspace sync (cron job, manual script, or admin UI trigger)
- Recommended backup strategy: `pg_dump` (all application data) + `rsync` or `tar` of `images/` (the only filesystem data). Specify retention policy and whether this runs as a cron job or systemd timer

---

## Constraints Summary (non-negotiable)

| Constraint | Implication |
|-----------|-------------|
| Fully offline during quiz | No outbound HTTP at auth time; all credential validation is local |
| Google Workspace tied | Account identity must be traceable to a Google account; sync is allowed during setup windows |
| Student internet cut off | No client-side internet access; no CDN, no Google OAuth redirect in the student browser |
| PostgreSQL is the single source of truth | All data in PostgreSQL including question content (JSONB); JSONC is import/export only |
| Filesystem for images and ops only | images/, .env, pg_dump backups, TLS certs — nothing else |
| No separate microservices | One application process + one local PostgreSQL instance, one machine |
| ~800 student accounts, ~150 teacher accounts | Scale is modest; simplicity beats sophistication |
| Central server, intranet LAN only | HTTPS via self-signed cert + Nginx; no cloud, no Let's Encrypt |
| Existing data must be preservable | Migration path from v2.5.0 single-tenant format is required |
| Offline bank Git sync is optional | Not required for the core multi-tenant feature; can be dropped or adapted |

---

## What the Plan Should NOT Do

- Do not propose a cloud deployment or any service that requires permanent internet connectivity
- Do not propose OAuth2 redirects to `accounts.google.com` as part of the runtime login flow — that requires outbound internet from the student's browser
- Do not store any application data as files on the server — question content, plans, scores, bank snapshots all go in PostgreSQL; JSONC appears only transiently during import/export requests
- Do not redesign the quiz-taking UI unless a specific change is required by the new auth or session model
- Do not scope-creep into features not required by multi-teacher/multi-class (e.g., do not redesign the grading system, the email system, or the LLM integration)
- Do not leave open design decisions: every architectural choice must be committed to with a rationale

---

## Additional Context for the Planner

- The school uses **Google Workspace for Education** for all staff and students
- The school's IT infrastructure is a typical Italian secondary school setup: one server room, a managed switch, a firewall that can block student VLANs from the internet during exams
- The teacher running this today (Mauro Longano) is the only user of the current system and would become one of the ~150 teacher accounts; his existing quiz bank and scores are the migration test case
- The Neon Noir design system (`docs/DESIGN.md`) should be preserved; new UI should use the same tokens and component patterns
- The codebase has no automated test coverage (`tests/` has `test_api.py` and `test_api_load.py` but they are minimal); the plan should note where tests are critical but should not require full TDD adoption
