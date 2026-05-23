# intranet-quiz-platform

Multi-teacher, multi-class quiz platform for school intranets. One central server, ~150 teachers, ~40 classes, ~800 students, PostgreSQL as single source of truth, JSONC as import/export authoring format only.

## Language

### Identity

**Teacher**:
A staff member who owns quizzes, runs sessions, and views their own classes' scores. Authenticated via bcrypt password + JWT. Role: `teacher`.
_Avoid_: instructor, professor, admin (ambiguous with super_admin).

**Student**:
A learner identified by school email. Authenticated via join code + JWT. Has no password.
_Avoid_: pupil, user, participant.

**Super-admin**:
IT staff member who manages all accounts, runs Google Workspace sync, and has global visibility. Role: `super_admin`.
_Avoid_: admin, root, system administrator.

**Join code**:
A 6-character alphanumeric code that students use to enter an active quiz session. Generated when a teacher activates a session, invalidated when the session closes. Unique per active session (enforced by partial unique index).

### Content

**Snapshot** (Question snapshot):
A teacher-owned, versioned set of questions stored as JSONB in `question_snapshots`. Created by importing a JSONC file. Each snapshot is immutable — editing a snapshot replaces its content and bumps `updated_at`. Sessions reference snapshots by FK.
_Avoid_: question bank, quiz file, document.

**Question**:
A single assessment item within a snapshot. Has an `id` (int or string), `type` (single | multiple | open), `text` (Markdown), optional `question_image`, `options`, `correct` answer, and `weight`. Open questions may have `acceptable` answers, `keywords`, and `min_keywords`.
_Avoid_: item, problem, exercise.

**Question snapshot embedding** (`question_snapshot`):
A deep copy of the full question data stored inside each `DetailedAnswer` at submission time. Makes score entries self-contained — interpretable without the original snapshot.
_Avoid_: embedded question, question copy, frozen question.

### Session

**Quiz session** (Session):
A time-bounded instance of a quiz, scoped to one teacher + one snapshot + one or more classes. Has a status lifecycle: `draft → active → closed`. Students join via join code during the `active` phase.
_Avoid_: exam, test, assessment run.

**Quiz plan** (Plan):
A per-student, per-session record that stores the shuffled question order, shuffled option order, and answer progression. Created on first `start`, deleted on `submit`. Schemaless JSONB — the plan itself is internal to the quiz-taking flow.
_Avoid_: state, session state, game state.

**Progression**:
The `{current_index, answers: {index → answer}}` dict inside a quiz plan. Tracks which question the student is on and what they've answered so far. Answers are immutable once saved; only forward progression allowed.
_Avoid_: progress tracker, step counter.

### Scoring

**Score entry**:
A row in `score_entries` representing one student's completed quiz submission. Contains `raw_points`, `max_points`, `percent`, and a JSONB `answers` array of `DetailedAnswer` objects. Uniquely scoped to `(session_id, student_id)`.
_Avoid_: result, submission, grade record.

**Detailed answer** (Answer detail):
One element in a score entry's `answers` array. Contains the formatted student answer, correct answer, awarded points, option order, raw values, LLM feedback/verdict, and the `question_snapshot` embedding.
_Avoid_: answer record, score detail.

**Score archive**:
A snapshot of a session's scores copied into `score_archives` for long-term preservation. Immutable reference to how scores looked at archive time. Can be exported as JSON.
_Avoid_: backup, export, historical record.

**Recalculate**:
Re-running the full `grade()` function on all score entries in a session against the **current** snapshot. Used after the teacher edits questions (typos, weights, correct answers). Updates every entry.
_Avoid_: regrade (ambiguous — see Regrade).

**Regrade (open questions)**:
Re-running `score_open()` (and optionally LLM evaluation) on only open-ended answers in a session or archive. Used after changing `acceptable`/`keywords` or after a failed LLM call. Touches only answers where `question.type == "open"`.
_Avoid_: rescore, re-evaluate.

**Review (score review)**:
Manually overriding per-question points for specific score entries. Teacher provides `{score_id → {question_id → new_points}}`. Does not re-run grading — points are set explicitly.
_Avoid_: override, correction, adjustment.

**Override**:
A single `{question_id: new_points}` mapping within a review operation.
_Avoid_: correction, fix, change.

### Data flow

**Import (JSONC → Snapshot)**:
Parsing a JSONC file (with `commentjson`), validating questions, stripping comments, storing as JSONB in `question_snapshots`. JSONC never persists on the server.

**Export (Snapshot → JSONC)**:
Serializing a snapshot's JSONB content back to a JSON file for download. The comments are gone — export produces clean JSON, not JSONC.

**Sync (Google Workspace → local DB)**:
Pulling teacher and student accounts from Google Workspace Directory API, upserting into `teachers` and `students`, creating classes from Google Groups, assigning memberships. Runs on-demand by super-admin. Requires internet during the sync window only.
_Avoid_: import, provisioning, account creation.

## Example dialogue

> **Dev**: When a teacher changes a question's weight and hits recalculate, what happens to scores that were already submitted?
>
> **Domain expert**: Every score entry in that session is re-graded against the current snapshot. The `raw_points` and `percent` get updated, but the stored `question_snapshot` in each answer detail keeps the *original* question data — so the student can still see what the question looked like when they answered it.
>
> **Dev**: And regrade-open — does that also use the current snapshot?
>
> **Domain expert**: First it tries the stored `question_snapshot` in the answer detail. If that's missing (legacy scores from before we stored snapshots), it falls back to the current snapshot. But the intent is the same: re-score the open-text answer, usually because the teacher updated the `acceptable` keywords or wants to retry an LLM evaluation that failed.
>
> **Dev**: So recalculate touches everything, regrade-open only touches open questions, and review lets the teacher manually set points?
>
> **Domain expert**: Exactly. Recalculate is "I fixed the quiz, re-grade everyone." Regrade-open is "I fixed the open-question rubric, re-score just those." Review is "this one student's answer deserves 4 points, not 2."
