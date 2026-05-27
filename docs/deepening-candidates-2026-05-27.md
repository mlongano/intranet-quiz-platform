# Deepening Candidates — QuizParty Backend Architecture

Scout run 2026-05-27, using domain vocabulary from `docs/CONTEXT.md` and
architecture glossary from `docs/ARCHITECTURE.md` §10 (Seams Map).

---

## Summary

The architecture review from 2026-05-23 identified five deepening opportunities
(score-transform collapse, qbank extraction, transaction gap, route depth,
JSON guards). All five are ✅ Done. The codebase now has a mature service layer
with `score_transforms.py` as a deep module.

However, four service modules (`session_scores.py`, `classes.py`, `archives.py`,
`student_snapshots.py`) define interfaces that **zero route handlers call** —
they are dead seams. Routes inline all their logic. Additionally, two
cross-module duplication patterns surfaced.

---

## Candidate 1 — Dead seams: four service modules with zero adapters

**Files:**
- `services/session_scores.py` (lines 1–100) — `list_sessions_for_teacher`,
  `list_session_scores`, `delete_draft_session`, `archive_session_scores`
- `services/classes.py` (lines 1–35) — `list_classes_for_teacher`,
  `list_students_for_class`
- `services/archives.py` (lines 1–65) — `list_archives`, `get_archive`,
  `export_archive`, `delete_archive`, `rename_archive`
- `services/student_snapshots.py` (lines 1–68) — CRUD + rename + export

**Routes that inline instead of calling services:**
- `routes/teacher.py` (lines 349–394) — `list_classes`, `list_class_students`
  inline `conn.execute(Q.LIST_CLASSES_FOR_TEACHER, ...)` and
  `conn.execute(Q.LIST_STUDENTS_FOR_CLASS, ...)`
- `routes/teacher.py` (lines 304–342) — `list_sessions`, `create_session`
  inline session logic despite `quiz_session.py` being imported
- `routes/teacher.py` (lines 555–600) — `list_archives`, `get_archive`,
  `export_archive`, `delete_archive`, `rename_archive` all inline
  `conn.execute(Q.LIST_ARCHIVES, ...)` etc.
- `routes/teacher.py` (lines 604–673) — `list_student_snapshots`, `create_*`,
  `get_*`, `delete_*`, `rename_*`, `export_*` all inline DB queries

**Problem (deletion test):** Delete `services/session_scores.py` — nothing
breaks. Delete `services/classes.py` — nothing breaks. Delete
`services/archives.py` — nothing breaks. Delete
`services/student_snapshots.py` — nothing breaks. These are interfaces with
no adapters. The `ARCHITECTURE.md` §10 seams map declares these as existing
seams ("Deep — 3 callers" etc.), but the code tells a different story: the
seams exist as file boundaries but not as call-graph edges.

This is the worst kind of shallow module: the interface (a function
signature) is exactly as large as the implementation (a DB query + row
mapping). Without adapters, there is no **leverage** — the module serves
nobody.

**Solution:** Two options, ranked:

1. **(Preferred) Route handlers call the service functions.** This aligns
   with the documented architecture. Each route handler becomes a thin
   adapter (~5 lines: parse request, call service, serialize response). The
   service module gains **leverage** (multiple route handlers → one function).
   Example:
   ```python
   # routes/teacher.py — before (13 lines)
   @teacher_bp.get('/classes')
   @require_teacher
   def list_classes():
       with db.get_conn() as conn:
           rows = conn.execute(Q.LIST_CLASSES_FOR_TEACHER, (_teacher_id(),)).fetchall()
       return jsonify([
           {'id': r[0], 'name': r[1], 'academic_year': r[2], 'student_count': r[3]}
           for r in rows
       ]), 200

   # routes/teacher.py — after (5 lines)
   @teacher_bp.get('/classes')
   @require_teacher
   def list_classes():
       return jsonify(services.classes.list_classes_for_teacher(_teacher_id())), 200
   ```

2. **(Fallback) Delete the dead modules.** If the team decides routes
   *should* be the only place for simple read queries, delete the four
   unused service modules to eliminate confusion. But this contradicts
   `ARCHITECTURE.md` §7 and loses the seam for future deepening.

**Benefits:**
- **Locality:** DB queries + row mapping co-locate in service modules.
  Routes own only HTTP concerns (parse request, call service, serialize
  response).
- **Leverage:** Each service function serves multiple potential callers
  (route handlers, tests, future CLI/admin tools).
- **Interface:** Route handlers shrink from ~15 lines to ~5 lines. The
  service seam gains real **depth** — the interface (a function signature)
  is smaller than the implementation (query + mapping + error handling).
- **Consistency:** Matches the pattern already used by `services/snapshots.py`
  and `services/quiz_session.py`, which routes *do* call.

**Effort:** ~2 hours. Move inline blocks from `routes/teacher.py` into the
existing service functions (the code is already written — it just lives in
the wrong file). Four modules × ~5 route handlers each = ~20 small edits.

---

## Candidate 2 — Score-totals calculation duplicated across modules

**Files:**
- `services/score_transforms.py` (lines 79–81) — inline in `transform_scores`:
  ```python
  new_raw = round(sum(a.get("points_awarded", 0) for a in new_answers), 2)
  new_max = round(sum(a.get("weight", 0) for a in new_answers), 2)
  new_pct = round(new_raw / new_max * 100, 2) if new_max else 0
  ```
- `services/llm_jobs.py` (lines 338–342) — private `_score_totals`:
  ```python
  def _score_totals(answers: list[dict]) -> tuple[float, float, float]:
      raw_points = round(sum(float(a.get('points_awarded') or 0) for a in answers), 2)
      max_points = round(sum(float(a.get('weight') or 0) for a in answers), 2)
      percent = round(raw_points / max_points * 100, 2) if max_points else 0.0
      return raw_points, max_points, percent
  ```
  Called at lines 77 and 217 (in `enqueue_regrade_session` and
  `_process_next_answer_for_score`).

**Problem:** Identical business logic — "sum `points_awarded` and `weight`
across answers, compute `percent`" — lives in two modules. The
`_score_totals` helper in `llm_jobs.py` is private (underscore-prefixed),
preventing `score_transforms.py` from importing it. The
`score_transforms.py` version is slightly different (no `float()` cast, no
`or 0` fallback, `"points_awarded"` vs `'points_awarded'`).

This is a classic **locality** failure: the algorithm for deriving a score
entry's aggregate numbers from its constituent answers should live in one
place. Currently, changing the rounding strategy or the fallback default
requires finding and updating both copies.

**Solution:** Promote `_score_totals` from `llm_jobs.py` to `utils.py` (or a
new `services/score_utils.py`) as a public function. Both `llm_jobs.py` and
`score_transforms.py` import it.

```python
# utils.py (or services/score_utils.py)
def compute_score_totals(answers: list[dict]) -> tuple[float, float, float]:
    """Return (raw_points, max_points, percent) from a list of DetailedAnswer dicts."""
    raw = round(sum(float(a.get("points_awarded") or 0) for a in answers), 2)
    maximum = round(sum(float(a.get("weight") or 0) for a in answers), 2)
    pct = round(raw / maximum * 100, 2) if maximum else 0.0
    return raw, maximum, pct
```

**Benefits:**
- **Locality:** Score-totals algorithm in one place. Change once, both
  callers benefit.
- **Leverage:** Two modules → one function. If a third module needs this
  (e.g., a future score-export CLI), it imports from the same place.
- **Depth:** The function hides the edge cases (zero max_points, float
  conversion, rounding) behind a simple interface.
- **Test surface:** One function to test with various answer lists.

**Effort:** ~30 minutes. Extract function, update two imports, remove
private `_score_totals`, verify both callers produce identical output.

---

## Candidate 3 — Email dispatch logic leaks through the route/service seam

**Files:**
- `routes/teacher.py` (lines 700–748) — `send_result_email`: fetches score
  entry from DB, parses JSONB answers, lazy-imports `email_service`, calls
  `send_result_to_student`, catches exceptions
- `routes/teacher.py` (lines 751–800) — `send_all_emails`: fetches all
  scores for session, loops, lazy-imports `email_service`, calls
  `send_result_to_student` per entry, accumulates sent/errors
- `services/` — no email dispatch service module exists

**Problem:** Two route handlers duplicate ~30 lines of mixed concerns:
- DB access (`conn.execute(...)` with JOIN across `score_entries`,
  `students`, `quiz_sessions`)
- JSONB parsing (`isinstance(r[4], list) else json.loads(...)`)
- Lazy import of `email_service` (guarded by `try/except`)
- Loop logic + error accumulation (in `send_all_emails`)
- Response serialization

This is the route layer doing business-logic work. The **seam** between HTTP
concerns and domain logic is blurry: `ARCHITECTURE.md` §7 says routes should
be thin adapters, but these two handlers are 50 and 50 lines respectively,
with only ~5 lines of HTTP-specific code each.

**Solution:** Extract a service module `services/email_dispatch.py`:

```python
# services/email_dispatch.py

def send_result_for_score(
    score_id: int, teacher_id: int, teacher_email: str,
    *, custom_subject: str | None = None,
    include_details: bool = True, include_feedback: bool = False,
) -> dict:
    """Fetch one score entry, send email to student. Returns {ok, sent_to} or {error}."""
    ...

def send_results_for_session(
    session_id: int, teacher_id: int, teacher_email: str,
    *, custom_subject: str | None = None,
    include_details: bool = True, include_feedback: bool = False,
) -> dict:
    """Fetch all scores for session, send to each student. Returns {sent, errors}."""
    ...
```

Route handlers become thin:

```python
@teacher_bp.post('/email/send-result')
@require_teacher
def send_result_email():
    data = request.get_json(silent=True) or {}
    result = email_dispatch.send_result_for_score(
        score_id=int(data['score_id']),
        teacher_id=_teacher_id(),
        teacher_email=g.current_user.get('email', ''),
        custom_subject=data.get('subject') or None,
    )
    return jsonify(result), 200 if result.get('ok') else 500
```

**Benefits:**
- **Locality:** All email-dispatch logic (DB fetch, JSON parse, email call,
  error handling) in one module. Routes own only request parsing + response
  serialization.
- **Leverage:** Two route handlers → two service functions sharing one
  internal helper (`_fetch_score_and_send`). Adding a third email endpoint
  (e.g., "send to class") costs one new service function.
- **Interface depth:** `send_result_for_score(score_id, teacher_id, ...)`
  hides ~30 lines of implementation behind a 4-parameter signature.
- **Test surface:** Service functions testable with a mock `email_service`,
  no Flask required. Route handlers testable with a mock service.
- **Consistency:** Matches the `score_transforms.py` pattern — routes pass
  callbacks/params, service does the work.

**Effort:** ~1.5 hours. Extract service module, wire routes, verify email
sending still works end-to-end.

---

## Architecture Summary

```
                    ┌──────────────────────────────────┐
                    │  routes/teacher.py  (781 lines)  │
                    │                                  │
                    │  ✓ calls services.snapshots      │
                    │  ✓ calls services.quiz_session   │
                    │  ✓ calls services.images         │
                    │  ✓ calls services.score_transforms│
                    │  ✓ calls services.grading        │
                    │  ✓ calls services.llm_jobs       │
                    │  ✓ calls services.classroom_sync │
                    │                                  │
                    │  ✗ DOES NOT call:                │
                    │     services.session_scores ← DEAD│
                    │     services.classes        ← DEAD│
                    │     services.archives       ← DEAD│
                    │     services.student_snapshots←DEAD│
                    │                                  │
                    │  ✗ Inlines email dispatch        │
                    │  ✗ Inlines archive CRUD          │
                    │  ✗ Inlines class/student lists   │
                    └──────────────────────────────────┘

                    ┌──────────────────────────────────┐
                    │  services/ layer                  │
                    │                                  │
                    │  score_transforms.py  → DEEP     │
                    │    load_qbank_for_session() used  │
                    │    by quiz_session.py too (locality│
                    │    tension — lives in score module│
                    │    but used by quiz-taking)       │
                    │                                  │
                    │  llm_jobs.py                      │
                    │    _score_totals() duplicates     │
                    │    logic from score_transforms.py │
                    └──────────────────────────────────┘
```

The priority order reflects impact:

1. **Dead seams** — fixes the architecture's stated design vs. actual code gap.
   Four modules exist but nobody calls them; routes do the work instead.

2. **Score-totals duplication** — small but clean win; removes a "two sources
   of truth" bug waiting to happen when someone changes one copy.

3. **Email dispatch leakage** — removes the last major pocket of business
   logic living at the route layer. After this, `routes/teacher.py` would
   be ~650 lines (down from 781) with every handler following the same
   pattern: parse → call service → serialize.
