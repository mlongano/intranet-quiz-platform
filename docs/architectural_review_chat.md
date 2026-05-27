# Architectural Review Chat Handoff

Generated: 2026-05-27

## Purpose

This handoff summarizes the architecture/recovery/testing discussion so a fresh agent can continue without replaying the whole chat. It intentionally references existing artifacts instead of duplicating their content.

## Suggested skills

- `improve-codebase-architecture`: continue exploring/refining module seams, especially Session/archive semantics and Teacher workflow modules.
- `grill-with-docs`: use if the next step is to challenge domain terminology and update `docs/CONTEXT.md` / ADRs inline.
- `tdd`: use for implementing the next behavior slice, especially session archive lifecycle or frontend workflow tests.
- `diagnose`: use for operational bugs such as Docker/LXC, Classroom sync, or data import issues.
- `review`: use before committing the large recovery/test-safety/session changes.

## Current high-level state

The conversation moved through several connected areas:

1. Fixed unfriendly `ALREADY_SUBMITTED` display.
2. Solved Docker build issues in Proxmox LXC via `lxc-remote2` BuildKit builder.
3. Recovered production data after tests were accidentally run against the real DB.
4. Added test database safety guard and safe Docker test runner.
5. Added ability to reopen closed Quiz sessions.
6. Diagnosed Google Classroom 400 as a missing/misnamed service-account path and fixed `.env` locally.
7. Reviewed architecture and clarified domain language around Question bank / Saved quiz / Quiz version / Quiz session / Score archive.
8. Created an ADR for that domain decision.

## Important committed work already done

Three commits were created earlier:

```text
0a53d0e docs(deployment): document LXC debug build workflow
6fc8d8f chore(docker): support LXC runtime constraints
8bc430b fix(quiz): show friendly already-submitted errors
```

Do not duplicate those changes unless checking for regressions.

## Important uncommitted work

`git status --short` currently shows many uncommitted changes. Some are intentional, some are unrelated local artifacts.

Intentional changes to review/commit logically:

- `db/queries.py`
- `routes/teacher.py`
- `services/quiz_session.py`
- `frontend/src/api.ts`
- `frontend/src/pages/SessionsPage.tsx`
- `tests/test_isolation.py`
- `tests/test_session_reopen.py`
  - Implements reopening closed Quiz sessions.
- `tests/conftest.py`
- `scripts/run_tests_safe.sh`
- `README.md`
- `AGENTS.md`
  - Implements and documents safe test runner / DB-name guard.
- `scripts/recover_legacy_quizparty.py`
- `recovery_reports/`
  - Recovery script/report from legacy QuizParty import.
- `docs/CONTEXT.md`
- `docs/adr/0001-quiz-content-and-archive-lifecycle.md`
  - Domain language / ADR around Question bank, Saved quiz, Quiz version, Score archive.
- `docs/deepening-candidates-2026-05-27.md`
- `docs/frontend-architecture-friction.md`
- `scout-findings.md`
  - Scout notes from architecture review; user said to keep them for now.
- `docs/architectural_review_chat.md`
  - This handoff.

Unrelated/suspicious local changes not created as part of intended work:

- Deleted files under `images/test/*` — do not commit without user confirmation.
- `.claude/`, `.env-1`, `compose-bad.yaml` — leave alone unless user asks.

## Data recovery summary

A critical mistake happened: pytest was run inside the `app` container while `DATABASE_URL` pointed at the real DB. Test fixtures truncated production tables. This was acknowledged and mitigated.

Recovery was performed from `/srv/QuizParty` legacy files using:

- `scripts/recover_legacy_quizparty.py`
- Reports under `/app/backups/recovery/` and repo `recovery_reports/`

Post-recovery database counts verified:

```text
teachers: 2
students: 130
classes: 6
question_snapshots: 55
quiz_sessions: 41
score_entries: 537
score_archives: 50
```

All imported `Score entries.answers[]` had both `question_snapshot` and `type` after verification.

Backups created:

```text
/app/backups/recovery/pre-recovery-empty-2026-05-27-122803.dump
/app/backups/recovery/post-recovery-2026-05-27-124341.dump
```

Sensitive temporary passwords were printed during recovery; they are intentionally not repeated here. If needed, inspect `/app/backups/recovery/legacy_recovery_apply_summary.json` only with appropriate care and redact before sharing.

## Test safety changes

`tests/conftest.py` now refuses to run if the effective database name does not contain `test`.

`docker compose ... exec app pytest ...` was verified to fail before touching data.

Safe runner added:

```bash
scripts/run_tests_safe.sh tests/
```

It creates/uses `quizparty_test` and sets `TEST_DATABASE_URL`.

Use this runner for backend tests. Do not run pytest directly in the app container.

## Session reopen feature

Implemented but not committed:

- New SQL `REOPEN_SESSION` in `db/queries.py`.
- New `reopen_session()` in `services/quiz_session.py`.
- New route `POST /api/teacher/sessions/<id>/reopen` in `routes/teacher.py`.
- New frontend API `reopenSession()` in `frontend/src/api.ts`.
- `SessionsPage` shows `Riapri` button for closed sessions.
- Tests added:
  - `tests/test_session_reopen.py`
  - extra isolation test in `tests/test_isolation.py`

Verified before recovery with:

```bash
docker compose -f compose.yaml -f compose-debug.yaml exec -T app pytest tests/test_session_reopen.py tests/test_isolation.py::TestSessionIsolation -q
```

After the safety fix, use:

```bash
scripts/run_tests_safe.sh tests/test_session_reopen.py tests/test_isolation.py::TestSessionIsolation -q
```

## Google Classroom sync issue

The frontend error “Impossibile caricare i corsi Classroom: 400” was diagnosed. Backend response was:

```text
File service account non trovato: /app/secrets/google-service-account.json
```

The container had:

```text
/app/secrets/google-sa-key.json
```

`.env` was updated locally to point at the existing file. After app restart, `/api/teacher/classroom/courses` returned HTTP 200 and course data.

This `.env` change is not tracked by git.

## Architecture review artifacts

HTML report generated in temp:

```text
/tmp/architecture-review-quizparty-20260527-152444.html
```

`xdg-open` was unavailable, so it was not opened automatically.

Scout notes kept in repo at user request:

```text
docs/deepening-candidates-2026-05-27.md
docs/frontend-architecture-friction.md
scout-findings.md
```

Top recommendation from report: wire the dead Teacher workflow seams. Existing modules like `services/session_scores.py`, `services/classes.py`, `services/archives.py`, and `services/student_snapshots.py` exist but `routes/teacher.py` mostly does not call them.

## Domain/architecture decisions captured

`docs/CONTEXT.md` was updated to clarify:

- Avoid bare “Snapshot” in domain/user-facing language.
- Use **Quiz version** (`quiz_snapshot` when a technical qualifier is useful) for the immutable frozen quiz used by a Quiz session.
- Introduce **Question bank**, **Reusable Question**, **Saved quiz**, **Quiz version**, **Archive Session**.
- Future Reusable Questions should include metadata like tags/category/difficulty and remain searchable/reusable.
- Question text and option text must preserve Markdown/code support; future rendering should support Mermaid and LaTeX.
- Quiz sessions must never depend on mutable live Questions.
- Score entries are the primary results model; Score archives are document/raw/manual-review/export copies.

ADR created:

```text
docs/adr/0001-quiz-content-and-archive-lifecycle.md
```

## Open architecture question to continue

The user is concerned with robust data flows and service logic before more code. The key unresolved design is the Session/archive model:

- Today archiving a session creates a `score_archives` JSON copy but the original Session remains listed.
- User considers this semantically incoherent.
- Proposed direction: add `quiz_sessions.archived_at` and make “Archive Session” move a closed Quiz session out of operational Sessions while retaining `score_entries` as source of truth.
- Keep `score_archives` for raw/manual-review/import/export document copies only.

This should probably be the next design/grilling focus before implementation.

## Operational warnings

- Always use `scripts/run_tests_safe.sh` for backend tests.
- Do not run destructive DB/test commands without checking `DATABASE_URL`.
- Do not commit deleted `images/test/*` unless explicitly confirmed.
- Do not include secrets, API keys, or temporary passwords in commits or handoffs.

## Suggested next steps

1. Review uncommitted diff and separate logical commits:
   - session reopen feature;
   - test safety runner/guard/docs;
   - recovery script/report docs if desired;
   - domain context + ADR.
2. Decide whether to implement `quiz_sessions.archived_at` now.
3. If yes, use TDD through public interface:
   - archived closed session disappears from `/teacher/sessions`;
   - appears in archive/history view;
   - Score entries remain queryable through the archived-session detail;
   - `score_archives` raw/manual-review files remain distinct.
4. Wire dead Teacher workflow seams from `routes/teacher.py` into existing service modules.
