# Architecture Assessment — 2026-06-10

Step-back evaluation of the overall project and its architectural choices,
written after a full review of the codebase, docs, and a stabilization pass
(CLAUDE.md rewrite, teacher.py service extraction, frontend api/ split,
dead-code removal, login rate limiting, LLM ops runbook).

Audience: future analyses and review sessions. Read together with
[`ARCHITECTURE.md`](./ARCHITECTURE.md) (what the system is) and
[`CONTEXT.md`](./CONTEXT.md) (domain vocabulary). This document records
*judgments*: what is deliberately good, which trade-offs have named costs,
and where the future pressure points are.

---

## 1. The constraints are the architecture

The system answers an unusual but crisp set of constraints:

- one server in a school closet (Proxmox LXC), ~150 teachers / ~40 classes / ~800 students;
- exams must work with the internet cut off;
- grades are quasi-legal records — contested artifacts;
- **one maintainer**, working solo with AI agents.

Every major choice reads as a correct answer to those constraints rather than
to fashion:

- **Boring tech on one box** (Flask + Waitress + PostgreSQL + docker compose)
  scales *up*, not *out*. Peak load is a few classes submitting at once;
  8 threads and a pool of 8 is generous. Anything distributed would be
  self-harm at this scale. This is a deliberate, load-bearing assumption —
  in-process state (e.g. the login rate limiter) is allowed *because* of it.
- **Offline-first auth** (local bcrypt + HS256 JWT; Google contacted only
  during sync windows) matches exam-room reality exactly.
- **Postgres as the job queue** (`FOR UPDATE SKIP LOCKED` + a separate worker
  container) instead of Celery/Redis: one less stateful service to operate,
  and the queue shares the database's backup/restore story for free.

## 2. What is genuinely excellent — do not regress these

### 2.1 The grading data model

The chain *Saved quiz → immutable Quiz version → Score entry with embedded
question snapshots* means a grade can always be interpreted exactly as the
student saw it, regardless of later edits. The redundancy is deliberate and
justified. The two-table `score_history` change sets with revert complete the
picture: **event-sourcing-lite applied only where the domain demands
auditability** (grade mutations), without the ceremony of doing it everywhere.

### 2.2 The single mutation seam

`services/score_transforms.py::transform_scores()` — review, recalculate, and
regrade-open are callbacks into one transactional path, so invariants (history
recording, ownership checks, change detection) cannot be bypassed. Any new
score-mutating feature must go through this seam, never update
`score_entries.answers` directly.

### 2.3 Server-authoritative quiz state

Plans live server-side; answers are immutable once saved; progression is
forward-only. Entire classes of bugs and cheating are eliminated at the model
level instead of patched at the UI level.

### 2.4 Documentation as infrastructure

CONTEXT.md's domain glossary, AGENTS.md conventions, all SQL as named
reviewable constants, ADRs, tracer-bullet TDD. For a single-maintainer project
developed with AI agents, this documentation **is** the mitigation for bus
factor — the biggest systemic risk in the project is not in the code at all.
Keep the docs current; a stale CLAUDE.md (as found and fixed on this date)
actively poisons agent sessions.

## 3. Named trade-offs — the honest costs of the strengths

These are structural, not a punch list. Each is the cost side of a deliberate
choice; they are acceptable *as long as they remain conscious*.

### 3.1 Positional row unpacking (highest-value fix available)

Raw parameterized SQL is safe and reviewable, but every caller does
`r[0], r[6], r[7]`. Reordering one SELECT breaks silently at runtime,
possibly mid-exam. psycopg's `dict_row` row factory would keep the raw-SQL
philosophy intact while removing the entire failure class. If one structural
improvement is made, make it this one.

### 3.2 Hand-written TypeScript ↔ Flask contract

Types in `frontend/src/api/types.ts` are duplicated by hand from route
response shapes. Drift has already happened once (`score_count` missing,
`snapshot_id` fictional on the list endpoint; fixed 2026-06-10). A full
OpenAPI pipeline is probably more ceremony than a solo project warrants, but
a single pytest asserting response keys against the TS interfaces would turn
silent drift into a red test.

### 3.3 `score_entries.answers` is a JSONB blob doing relational work

Each answer carries a status machine (`llm_status`), `answer_revision`,
override flags, and an embedded question snapshot — manipulated as Python
dicts in several places; the "per domanda" view aggregates over full payloads
client-side. The history tables relieve some pressure. **Designated breaking
point:** if cross-session reporting ever becomes a requirement ("how did 4AI
do on recursion questions this year?"), the natural refactor is a relational
`score_answers` table. Do not build it preemptively.

### 3.4 JWTs cannot be revoked mid-window

Decorators verify signature only and never re-check `teachers.status` against
the DB: a teacher disabled by the super-admin keeps a working token for up to
12 hours. Small risk on an intranet; the fix is one indexed SELECT in the
guard. Decide consciously, don't leave it accidental. Same family:
`student-join` has no rate limit on the 6-character join code — the
`auth/rate_limit.py` limiter (added 2026-06-10 for teacher-login) applies
there in a few lines.

### 3.5 Backups live on the host they protect

The 6-hour backup loop with 30-day retention is well built, but `./backups/`
on the same machine does not survive the failure mode that matters (disk
death, LXC host death). One rsync/restic job to any other location closes the
biggest operational hole.

### 3.6 No CI

Test discipline exists (`scripts/run_tests_safe.sh`, isolation and
concurrency suites) but is enforced by habit. With commits now flowing from
multiple machines/sessions, a GitHub Action with a Postgres service container
would turn the suite from a ritual into a gate.

## 4. The looming fork: Reusable Questions

CONTEXT.md already names the future seam: a Question bank with Reusable
Questions (tags, category, difficulty), with Saved quizzes becoming ordered
references. Two things to hold onto when that work starts:

1. **The invariant survives:** a Quiz session must never depend on a mutable
   live Question — always an immutable Quiz version. The glossary already
   guarantees this; keep it.
2. **Do it together with §3.3.** Questions-as-rows and answers-as-rows are
   the same schema migration pressure from two directions. When the feature
   becomes real, tracer-bullet both at once rather than bolting a question
   table onto the document model and migrating answers later.

This is the largest schema change in the project's future. Until it is
actually needed, the current document model is the right amount of design.

## 5. Verdict

Well-architected — not because it is clever, but because nearly every choice
traces to an explicit constraint; the one domain invariant that matters
(grade integrity) is protected structurally rather than procedurally; and
complexity is spent only where the domain is genuinely complex (score
mutation, async grading) while everything else stays deliberately boring.

The weaknesses are the honest costs of the strengths: raw SQL costs
positional fragility (§3.1), hand-written types cost drift (§3.2), the
document model costs future reporting flexibility (§3.3). None are urgent;
all are worth knowing the names of.

| Aspect | Judgment |
|---|---|
| Fit to constraints (scale, offline, solo maintainer) | Excellent — constraints drove choices |
| Grade-integrity model (versions, snapshots, history+revert) | Excellent — protect at all costs |
| Service seams (`transform_scores`, `quiz_session`, job queue) | Deep where it matters |
| Raw SQL policy | Right call; mitigate with `dict_row` (§3.1) |
| Frontend (React 19 + TanStack Query, sessionStorage JWT) | Solid; contract drift is the watch item (§3.2) |
| Operations (compose, backups, runbooks) | Professional; needs off-host backup copy (§3.5) and CI (§3.6) |
| Biggest systemic risk | Bus factor — mitigated by docs; keep them current |

---

*Previous review artifacts: `architecture-review-2026-05-23.html`,
`architecture-review-quizparty-20260527-152444.html`,
`deepening-candidates-2026-05-27.md`, `frontend-architecture-friction.md`
(candidates #1–#3 resolved 2026-06-10).*
