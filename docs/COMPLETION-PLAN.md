# QuizParty Completion Plan

This plan covers the remaining work needed to stabilize and complete the
multi-teacher QuizParty platform.

References:
- `AGENTS.md` for coding, testing, SQL, UI language, and commit rules
- `docs/ARCHITECTURE.md` for the target multi-tenant architecture
- `docs/CONTEXT.md` for domain vocabulary
- `../local-quizzies/` for the single-tenant baseline implementation

## Summary

Some fixes are necessary before the project should be considered complete. The
main priority is not an ORM migration. The project should keep explicit raw
PostgreSQL, as documented in `AGENTS.md`, and improve safety through
parameterized queries, ownership checks, tests, and deeper service modules.

Recommended order:

1. Stabilize the backend test suite.
2. Run a raw SQL security audit.
3. Extract teacher workflows out of `routes/teacher.py`.
4. Compare feature parity with `../local-quizzies/`.
5. Add real frontend workflow tests.
6. Resolve or document the production build path.
7. Finish deployment and operational documentation.

## 1. Stabilize The Test Suite

Goal: make backend tests trustworthy before more refactoring.

Current issue: `tests/conftest.py` helper functions use hardcoded emails such
as `teacher@test.it` and `student@test.it`. Running multiple tests in the same
database session can cause `UNIQUE` collisions.

Work:

- Make `make_teacher`, `make_student`, `make_class`, and `make_snapshot`
  generate unique defaults.
- Prefer deterministic names using a counter or UUID suffix.
- Run backend tests inside Docker using the command documented in `AGENTS.md`.
- Keep tests focused on public interfaces, not internal implementation details.

Acceptance:

- Backend pytest passes reliably.
- No test depends on global fixture ordering.
- Test helpers remain simple enough for future agents to reuse safely.

## 2. Run A Raw SQL Security Audit

Goal: verify the current code matches the database policy in `AGENTS.md`.

Work:

- Search every `conn.execute(...)` and `executemany(...)` call.
- Confirm every dynamic value uses `%s` or `%(name)s` placeholders.
- Confirm dynamic SQL fragments exist only when chosen from hardcoded
  allowlists.
- Review `routes/super_admin.py` dynamic `SET` construction. It appears
  allowlist-based, so it is likely acceptable, but it should be documented
  locally in code.
- Confirm every Teacher-owned resource query includes `teacher_id` directly in
  SQL or uses a service-layer ownership guard inside the same transaction.

Acceptance:

- No f-string, interpolation, or concatenation of user-controlled values into
  SQL.
- Teacher-owned resources cannot be read or mutated across tenants.
- Any dynamic SQL has an obvious hardcoded allowlist.

## 3. Extract Teacher Workflow Modules

Goal: reduce `routes/teacher.py`, currently around 746 lines, without changing
behavior.

The target architecture in `docs/ARCHITECTURE.md` already points toward a
service layer. `services/score_transforms.py`, `services/quiz_session.py`,
`services/snapshots.py`, and `services/images.py` are the model for the next
extractions.

Proposed modules:

- `services/classes.py`
  - List a Teacher's Classes.
  - List Students for a Class.
  - Enforce Teacher/Class ownership.

- `services/archives.py`
  - List Score archives.
  - Get/export/delete/rename a Score archive.
  - Keep archive ownership checks close to archive SQL.

- `services/student_snapshots.py`
  - List/create/get/delete/rename/export Student list Snapshots.
  - Keep JSON serialization and ownership checks out of route handlers.

- `services/session_scores.py` or additions to `services/quiz_session.py`
  - List Session Score entries.
  - Delete draft Sessions.
  - Archive Session scores.
  - Keep Session ownership checks inside the transaction.

Keep `services/score_transforms.py` as the Score mutation seam for Review,
Recalculate, and Regrade.

Acceptance:

- Route handlers mostly parse request data, call a service function, and return
  JSON.
- SQL remains explicit raw PostgreSQL.
- Public API response shapes stay compatible with `frontend/src/api.ts`.
- Existing backend tests still pass after each extraction.

## 4. Compare Against The Single-Tenant Baseline

Goal: make sure the multi-tenant app preserves the important workflows from
`../local-quizzies/`.

Single-tenant concepts and their multi-tenant replacements:

| Single-tenant concept | Multi-tenant concept |
| --- | --- |
| `questions.jsonc` active quiz | Question Snapshot |
| One global quiz status | Quiz Session lifecycle |
| `students.jsonc` | Students from Google Workspace OU sync |
| `quizzes/{email}.json` | Quiz Plan row |
| `scores.jsonc` | Score entry rows |
| Question bank files | Snapshots |
| Scores bank files | Score archives |
| One shared admin password | Teacher / Super-admin JWT auth |

Work:

- Build a parity checklist for old student routes:
  - Start/join quiz.
  - Resume quiz.
  - Save answer.
  - Submit quiz.
  - Finish page score display.

- Build a parity checklist for old teacher workflows:
  - Snapshot import/export/edit/rename/delete.
  - Image upload/list/delete/clear.
  - Session create/activate/close/regenerate code/delete.
  - Score list/review/recalculate/regrade-open.
  - Score archive create/list/detail/export/delete/rename.
  - Student list Snapshot create/list/detail/export/delete/rename.
  - Email one result / email all results.
  - LLM info display.

- Treat Google Classroom as the class-roster source when the school does not
  maintain per-class Google Groups:
  - Super-admin sync provisions Teachers from `GOOGLE_TEACHER_GROUP`.
  - Super-admin sync provisions Students from `GOOGLE_STUDENT_OU_PATHS`.
  - Teachers sync their own Classroom courses into local Classes.
  - Classroom rosters populate `class_students`.

- Mark intentionally removed or postponed features:
  - Flat-file Git sync for `banks/`.
  - Any old global admin route that no longer makes sense in a multi-teacher
    system.

Acceptance:

- No important Teacher or Student workflow from `../local-quizzies/` is
  accidentally missing.
- Any deliberate omission is documented.
- The frontend exposes each retained workflow in Italian.

## 5. Add Frontend Workflow Tests

Goal: cover real Teacher and Student workflows, not only example components.

Work:

- Add tests for:
  - `TeacherLoginPage`
  - `SessionsPage`
  - `SnapshotsListPage`
  - `SessionScoresPage`
  - `QuizPage`

- Mock `frontend/src/api.ts` at the API-interface level.
- Use TanStack Query in tests the same way the app does.
- Keep all user-facing strings in Italian, matching `AGENTS.md`.

Acceptance:

- Frontend tests pass with `pnpm test` or the Docker vitest command.
- At least one test covers each core path:
  - Teacher login.
  - Snapshot listing/import.
  - Session creation/activation.
  - Student join.
  - Answer progression.
  - Score review.

## 6. Resolve Or Document Production Build Path

Goal: make production setup reproducible.

Known issue from the handoff: host `pnpm build` fails with a Rollup native
module resolution error, but Docker build works.

Work:

- Decide whether Docker is the supported production build path.
- If Docker is canonical, document that clearly in README/deployment docs.
- If host builds are required, fix the Rollup native dependency issue by
  refreshing the host dependency installation and lockfile state.
- Use Docker build as the production gate unless there is a strong reason not
  to.

Acceptance:

- `docker compose -f compose.yaml -f compose-debug.yaml up -d --build`
  succeeds.
- Frontend production assets are built and served by Flask.
- README documents the canonical setup path.

## 7. Finish Operational Hardening

Goal: make the school-intranet deployment maintainable.

Work:

- Confirm `JWT_SECRET` length validation remains enforced.
- Confirm the Docker app process runs as a non-root user.
- Add database backup and restore instructions.
- Add image volume backup and restore instructions for
  `images/{teacher_id}/{snapshot_id}/`.
- Add first-run Super-admin/bootstrap instructions.
- Document Google Workspace sync prerequisites and failure modes.
- Document offline behavior after sync.

Acceptance:

- A fresh machine can be installed from documentation.
- PostgreSQL data and uploaded images can be backed up and restored.
- The app can run offline after sync, as described in `docs/ARCHITECTURE.md`.

## Non-Goals For Completion

- Do not migrate to an ORM as part of this completion pass.
- Do not reintroduce flat-file persistence for active app state.
- Do not preserve single-tenant global assumptions such as one active quiz,
  one global admin password, or one global scores file.
- Do not add speculative abstractions that do not improve locality or leverage.
