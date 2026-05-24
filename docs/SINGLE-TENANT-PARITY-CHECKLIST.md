# Single-Tenant Parity Checklist

This checklist compares the old `../local-quizzies/` single-tenant app with
the current multi-teacher QuizParty platform.

Vocabulary follows `docs/CONTEXT.md`: Snapshot, Quiz session, Quiz plan, Score
entry, Score archive, Review, Recalculate, and Regrade.

## Concept Mapping

| Single-tenant implementation | Multi-tenant implementation | Status |
| --- | --- | --- |
| `questions.jsonc` active quiz | Teacher-owned Snapshot | Implemented |
| Global quiz enabled flag | Quiz session `draft -> active -> closed` | Implemented |
| `students.jsonc` flat email list | Students from Workspace OUs, Classes from Classroom rosters | Implemented |
| `quizzes/{email}.json` plan files | `quiz_plans` rows keyed by `quiz_id` | Implemented |
| `scores.jsonc` global score file | `score_entries` rows scoped to Session and Teacher | Implemented |
| Question bank files | Snapshot list/import/export/edit | Implemented |
| Scores bank files | Score archive list/detail/export | Implemented |
| Students bank files | Student list Snapshot list/detail/export | Implemented |
| Shared admin password | Teacher/Super-admin bcrypt login + JWT | Implemented |
| Active image folder | `images/{teacher_id}/{snapshot_id}/` | Implemented |
| Git sync for `banks/` | No direct replacement | Intentionally postponed |

## Student Workflow

| Workflow | Current route/module | Status |
| --- | --- | --- |
| Join active quiz by email and join code | `POST /api/auth/student-join` | Implemented |
| Get Session info | `GET /api/quiz/session-info` | Implemented |
| Start or resume Quiz plan | `POST /api/quiz/start` | Implemented |
| Resume current question | `GET /api/quiz/resume/<quiz_id>` | Implemented |
| Save answer and advance | `POST /api/quiz/save-answer` | Implemented |
| Submit and create Score entry | `POST /api/quiz/submit` | Implemented |
| Prevent duplicate submissions | `score_entries UNIQUE (session_id, student_id)` | Implemented |

## Teacher Workflow

| Workflow | Current route/module | Status |
| --- | --- | --- |
| Login | `POST /api/auth/teacher-login` | Implemented |
| Forced password change | `POST /api/auth/teacher-change-password` | Implemented |
| List Snapshots | `GET /api/teacher/snapshots` | Implemented |
| Import Snapshot from JSONC | `POST /api/teacher/snapshots` | Implemented |
| Edit Snapshot | `PUT /api/teacher/snapshots/<id>` | Implemented |
| Rename Snapshot | `POST /api/teacher/snapshots/<id>/rename` | Implemented |
| Export Snapshot | `GET /api/teacher/snapshots/<id>/export` | Implemented |
| Delete Snapshot | `DELETE /api/teacher/snapshots/<id>` | Implemented |
| Upload/list/delete/clear Snapshot images | `services/images.py` routes | Implemented |
| List Classes and Students | `services/classes.py` | Implemented |
| Sync Teacher Classroom rosters | `services/classroom_sync.py` | Implemented |
| Create/activate/close/regenerate/delete Session | `services/quiz_session.py`, `services/session_scores.py` | Implemented |
| List Session Score entries | `services/session_scores.py` | Implemented |
| Review Score entries | `services/score_transforms.py` | Implemented |
| Recalculate Score entries | `services/score_transforms.py` | Implemented |
| Regrade open questions | `services/score_transforms.py` | Implemented |
| Create Score archive from Session | `services/session_scores.py` | Implemented |
| List/detail/export/delete/rename Score archives | `services/archives.py` | Implemented |
| List/detail/export/delete/rename Student list Snapshots | `services/student_snapshots.py` | Implemented |
| Email one result | `POST /api/teacher/email/send-result` | Implemented |
| Email all Session results | `POST /api/teacher/sessions/<id>/email/send-all` | Implemented |
| LLM configuration info | `GET /api/teacher/llm-info` | Implemented |

## Super-Admin Workflow

| Workflow | Current route/module | Status |
| --- | --- | --- |
| Create Teacher with temp password | `POST /api/super-admin/teachers` | Implemented |
| List Teachers | `GET /api/super-admin/teachers` | Implemented |
| Update Teacher role/status | `PUT /api/super-admin/teachers/<id>` | Implemented |
| Reset Teacher password | `POST /api/super-admin/teachers/<id>/reset-password` | Implemented |
| List Students and Classes | `GET /api/super-admin/students`, `/classes` | Implemented |
| Assign Teacher to Class | `POST /api/super-admin/classes/<id>/teachers` | Implemented |
| Trigger Google Workspace Sync | `POST /api/super-admin/sync` | Implemented |
| Read Sync status | `GET /api/super-admin/sync/<run_id>` | Implemented |
| Provision Students from OUs | `GOOGLE_STUDENT_OU_PATHS` | Implemented |
| Global Score view | `GET /api/super-admin/scores` | Implemented |

## Intentional Differences

- JSONC is import/export only. It is never the active server persistence format.
- There is no global active quiz. Teachers create independent Quiz sessions.
- There is no global score file. Score entries are scoped to Session, Student,
  and Teacher.
- The old flat-file Git sync for `banks/` is postponed. PostgreSQL backups and
  image-volume backups are the supported operational mechanism.
- In-flight single-tenant plan files are not migrated. Stop the old server
  before migration.
