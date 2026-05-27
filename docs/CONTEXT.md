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

**Question bank**:
The teacher-facing collection of reusable Questions. The current implementation does not yet store Questions as independent rows; today reuse happens mostly by reusing a whole Saved quiz / Quiz version. Architecturally, the Question bank is the future seam for searching and reusing individual Questions by tags, category, difficulty, type, and text.
_Avoid_: snapshot, archive.

**Question**:
A single assessment item. Has an `id` (int or string), `type` (single | multiple | open), `text` (Markdown), optional `question_image`, `options`, `correct` answer, and `weight`. Options may be plain strings or objects with option text plus option image. Open questions may have `acceptable` answers, `keywords`, and `min_keywords`. Question text and option text support Markdown with syntax-highlighted code today; future Markdown rendering should be able to embed Mermaid diagrams and LaTeX formulas.
_Avoid_: item, problem, exercise.

**Reusable Question**:
A Question with its own identity in the future Question bank. Expected metadata includes `teacher_id`, `tags`, `category`, `difficulty`, `created_at`, and `updated_at`, in addition to the Question fields. A Reusable Question can appear in multiple Saved quizzes, but a Quiz session must never depend on a mutable live Question.
_Avoid_: shared snapshot question, global question.

**Saved quiz**:
A teacher-owned set of Questions prepared for reuse. This is the teacher-facing concept currently shown in the UI as quiz/domande. In the current implementation, Saved quizzes are stored in `question_snapshots`, but the user-facing name should not be “Snapshot”. A Saved quiz may later become an ordered list of references to Reusable Questions.
_Avoid_: snapshot, question file, document.

**Quiz version** (`quiz_snapshot`):
An immutable frozen copy of a Saved quiz used by a Quiz session. This is the precise technical role previously called “Snapshot”. The current storage table is still `question_snapshots`, but architectural language should prefer “Quiz version” or the explicit qualifier `quiz_snapshot`; avoid bare “Snapshot” because it is ambiguous and teacher-hostile. A Quiz version contains complete Question data, including images and Markdown-capable text.
_Avoid_: Snapshot by itself, live quiz, question bank.

**Question snapshot embedding** (`question_snapshot`):
A deep copy of the full Question data stored inside each Detailed answer at submission time. Makes Score entries self-contained — interpretable without the original Quiz version or future Reusable Question. This is intentionally redundant with the Quiz version because it preserves the exact Question seen by the Student.
_Avoid_: embedded question, question copy, frozen question.

### Session

**Quiz session** (Session):
A time-bounded instance of a quiz, scoped to one Teacher + one Quiz version + one or more Classes. Has a status lifecycle: `draft → active → closed`; an additional archived marker may move closed Sessions out of the operational list without changing their Score entries. Students join via Join code during the `active` phase.
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
One element in a Score entry's `answers` array. Contains the formatted Student answer, correct answer, awarded points, option order, raw values, LLM feedback/verdict, and the `question_snapshot` embedding.
_Avoid_: answer record, score detail.

**Score archive**:
A document-style copy of scores stored in `score_archives`. It is not the primary model for normal results. The primary, queryable result model is Quiz session + Score entries. Score archives are for legacy/raw imports, external JSON preservation, manual-review recovery files, or explicit document exports. Archiving a Quiz session should not create a confusing second “normal” representation of the same results.
_Avoid_: primary results, moved session, backup.

**Recalculate**:
Re-running the full `grade()` function on all Score entries in a Quiz session against the **current** Quiz version. Used after the Teacher edits questions (typos, weights, correct answers). Updates every entry.
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

**Import (JSONC → Saved quiz / Quiz version)**:
Parsing a JSONC file (with `commentjson`), validating Questions, stripping comments, storing as JSONB in the current `question_snapshots` table. JSONC never persists on the server. Until Reusable Questions exist, import creates a whole Saved quiz / Quiz version rather than individual Question rows.

**Export (Quiz version → JSON)**:
Serializing a Quiz version's JSONB content back to a JSON file for download. The comments are gone — export produces clean JSON, not JSONC.

**Archive Session**:
Moving a closed Quiz session out of the operational Session list while keeping its Score entries as the source of truth. The preferred future implementation is an `archived_at` marker on `quiz_sessions`, not a duplicate Score archive. If a document copy is needed, expose that as a separate export/copy operation.
_Avoid_: duplicate scores, JSON-only archive.

**Sync (Google Workspace → local DB)**:
Pulling teacher and student accounts from Google Workspace Directory API, upserting into `teachers` and `students`, creating classes from Google Groups, assigning memberships. Runs on-demand by super-admin. Requires internet during the sync window only.
_Avoid_: import, provisioning, account creation.

## Example dialogue

> **Dev**: When a teacher changes a question's weight and hits recalculate, what happens to scores that were already submitted?
>
> **Domain expert**: Every Score entry in that Quiz session is re-graded against the current Quiz version. The `raw_points` and `percent` get updated, but the stored `question_snapshot` in each Detailed answer keeps the exact Question data the Student saw — so the submission remains interpretable even if the Saved quiz changes later.
>
> **Dev**: If we later add reusable Questions, can a Session point directly to the live Question bank?
>
> **Domain expert**: No. Reusable Questions are for composing Saved quizzes. A Quiz session always uses an immutable Quiz version. This protects historical scores from later edits to the Question bank.
>
> **Dev**: And regrade-open — does that also use the current Quiz version?
>
> **Domain expert**: First it tries the stored `question_snapshot` in the Detailed answer. If that's missing (legacy scores from before we stored Question snapshot embeddings), it falls back to the current Quiz version. The intent is the same: re-score the open-text answer, usually because the teacher updated the `acceptable` keywords or wants to retry an LLM evaluation that failed.
>
> **Dev**: So Recalculate touches everything, Regrade open questions only touches open questions, and Review lets the Teacher manually set points?
>
> **Domain expert**: Exactly. Recalculate is “I fixed the quiz, re-grade everyone.” Regrade open questions is “I fixed the open-question rubric, re-score just those.” Review is “this one Student's answer deserves 4 points, not 2.”
>
> **Dev**: What should happen when a Teacher archives a closed Quiz session?
>
> **Domain expert**: The Quiz session should move out of the operational list, but its Score entries remain the primary results. A Score archive is only a document/raw copy, not the normal place to read results.
