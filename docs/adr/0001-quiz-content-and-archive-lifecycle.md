---
status: accepted
---

# Separate Question bank, Saved quiz, Quiz version, Quiz session, and Score archive

QuizParty will stop using bare “Snapshot” as domain language because it is ambiguous for Teachers: the UI should speak about Questions, Saved quizzes, Quiz sessions, and archives, while the implementation may keep `question_snapshots` as the current storage table. The architectural term for the immutable frozen quiz used by a Quiz session is **Quiz version** (`quiz_snapshot` when a technical qualifier is useful): future reusable Questions may live in a Question bank and be assembled into Saved quizzes, but every Quiz session must use an immutable Quiz version, and each Detailed answer still stores a `question_snapshot` embedding so Score entries remain self-contained.

Score entries linked to Quiz sessions are the primary results model. `score_archives` is reserved for document-style copies, raw legacy imports, manual-review recovery files, or explicit JSON exports; archiving a closed Quiz session should move it out of the operational Session list (for example with `quiz_sessions.archived_at`) without creating a second normal representation of the same results.

## Consequences

- The current `question_snapshots` table can remain, but code and docs should avoid introducing more user-facing “Snapshot” terminology.
- Question data must continue to support images on both Questions and options, and Markdown text with syntax-highlighted code; future rendering should allow Mermaid diagrams and LaTeX formulas in Markdown.
- Reusable Questions need metadata such as tags, category, difficulty, and ownership, but live Question edits must never change the Quiz version used by an already-created Quiz session.
- The archive UI should distinguish archived Quiz sessions from raw/manual-review Score archives instead of showing duplicated results as if both were the same object.
