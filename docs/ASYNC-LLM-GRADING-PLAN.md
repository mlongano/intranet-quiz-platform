# Async LLM Grading Refactor Plan

## Goal

Remove synchronous LLM calls from student submission and teacher regrade flows.
Student submissions must complete quickly even when the LLM provider is slow,
unavailable, or misconfigured.

## Current Problem

Open-question grading currently happens inside the request path:

- student submit calls grading;
- grading calls the LLM for open answers when `USE_LLM_EVAL=1`;
- teacher regrade also calls the same grading path;
- one slow LLM call can block the whole HTTP request.

The UI can remain stuck on `Ricalcolo...`, and a student submission can be
delayed by external LLM latency.

## Target Behavior

On student submit:

1. Save the submission immediately.
2. Grade deterministic questions (`single`, `multiple`) immediately.
3. Store open answers as `pending_llm`.
4. Return success quickly with a provisional score/status.

In background:

1. Process pending LLM grading jobs.
2. Update open-answer points, feedback, verdict, and status.
3. Recompute score totals and percent.
4. Mark the score as final when all open answers are done.

In teacher UI:

1. Show open-answer status: `in attesa`, `valutato`, `fallback`, `errore`.
2. Show whether the total score is provisional or final.
3. Start regrade as a background job.
4. Show progress instead of blocking the page.

## Data Model

Add a migration for a job table:

```sql
CREATE TABLE llm_grading_jobs (
  id BIGSERIAL PRIMARY KEY,
  teacher_id BIGINT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  session_id BIGINT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  score_entry_id BIGINT REFERENCES score_entries(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  job_type TEXT NOT NULL
    CHECK (job_type IN ('submission', 'regrade_score', 'regrade_session')),
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ
);

CREATE INDEX idx_llm_grading_jobs_status_created
  ON llm_grading_jobs (status, created_at);

CREATE INDEX idx_llm_grading_jobs_teacher_session
  ON llm_grading_jobs (teacher_id, session_id);
```

Extend each open-answer object inside `score_entries.answers`:

```json
{
  "llm_status": "pending",
  "llm_feedback": null,
  "llm_verdict": null,
  "llm_error": null,
  "llm_updated_at": null
}
```

Allowed `llm_status` values:

- `not_applicable`: non-open questions.
- `pending`: waiting for background grading.
- `graded`: LLM succeeded.
- `fallback`: LLM failed or timed out, keyword fallback was used.
- `error`: grading failed and no fallback score was applied.

## Scoring Policy

Recommended policy:

- Deterministic questions count immediately.
- Open questions are excluded from finality until graded.
- The displayed score is marked `provvisorio` while any open answer is pending.
- `max_points` remains the full quiz maximum.
- `percent` can be provisional, but UI must label it clearly.

Alternative rejected for now:

- Score open questions as `0` while pending. This is misleading for students and
  teachers.

## Backend Refactor

### 1. Split Deterministic and Open Grading

In `services/grading.py`:

- keep deterministic grading synchronous;
- create a helper to format pending open answers;
- keep `grade_open_answer()` as the single implementation for LLM/fallback open grading.

### 2. Submission Flow

In quiz submission service/route:

1. Save `score_entries` with deterministic points and pending open answers.
2. Create one `llm_grading_jobs` row when the submission contains open answers
   and `USE_LLM_EVAL=1`.
3. Return submit response immediately:

```json
{
  "raw_points": 4,
  "max_points": 10,
  "percent": 40,
  "status": "provisional",
  "llm_pending": true
}
```

### 3. Worker

Add `services/llm_jobs.py`:

- claim pending jobs with row-level locking;
- process open answers using `grade_open_answer()`;
- update the JSON answer payload;
- recompute `raw_points`, `max_points`, `percent`;
- update job progress and final status.

Use raw PostgreSQL with parameterized queries only.

Suggested claim query:

```sql
SELECT id
FROM llm_grading_jobs
WHERE status = 'pending'
ORDER BY created_at
FOR UPDATE SKIP LOCKED
LIMIT %s
```

### 4. Worker Execution

Short-term simple approach:

- CLI command:

```bash
python -m services.llm_jobs worker
```

- Docker debug/production can run it as a separate service later.

Longer-term:

- add a `worker` service in Compose using the same app image.

### 5. Regrade Flow

Replace blocking regrade:

- `POST /api/teacher/sessions/<id>/scores/regrade-open`
  - creates a `regrade_session` job;
  - marks open answers as `pending`;
  - returns `{ job_id, status }`.

Add:

- `GET /api/teacher/llm-jobs/<id>`
- `GET /api/teacher/sessions/<id>/llm-jobs/latest`

Ownership checks:

- teacher must own the session;
- job must belong to current teacher.

## Frontend Refactor

### Session Scores Page

Change regrade button behavior:

1. Click starts a job.
2. UI shows:
   - `Rivalutazione in coda`
   - `In corso: X/Y`
   - `Completata`
   - `Errore`
3. Poll job status while pending/running.
4. Invalidate `session-scores` when job completes.

### Review Modal

For each open answer, show:

- `In attesa LLM`
- `Valutato`
- `Fallback parole chiave`
- `Errore LLM`

Keep existing manual override cues.

### Score Display

Add a provisional/final cue:

- `Punteggio provvisorio` when any open answer is pending.
- `Punteggio finale` when no open answer is pending.

## Test Plan

Backend:

- submit with only deterministic questions returns final score immediately;
- submit with open questions creates pending answers and an LLM job;
- submit does not call the LLM synchronously;
- worker processes a pending job and updates score totals;
- worker records `fallback` and feedback when LLM times out/fails;
- regrade creates a job and does not block;
- job status endpoints enforce teacher ownership;
- manual overrides still work after async grading.

Frontend:

- regrade button starts a job and shows progress;
- pending open answers show `In attesa LLM`;
- fallback/error statuses are visible in review modal;
- score page labels provisional vs final score.

## Rollout Steps

1. Add migration and query constants.
2. Add job service with claim/process functions.
3. Add tests for worker behavior.
4. Change submission to store pending open answers and create jobs.
5. Add job status endpoints.
6. Change regrade endpoint to enqueue jobs.
7. Update teacher UI for statuses/progress.
8. Add Compose worker service after the CLI worker is stable.

## Product Decision

Students see a submission confirmation plus the provisional score, clearly
labeled as `provvisorio`, when open-question LLM grading is still pending.

When all open-question grading jobs complete, the score becomes final in the
teacher UI.
