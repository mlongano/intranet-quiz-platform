# Score Transforms

Design for the deepened module that consolidates the three score-mutation operations: review, recalculate, and regrade‑open.

## The seam

All three operations share the same scaffold:

```
1. Fetch score entries for the session (optionally filtered by id set)
2. Load current snapshot content (for fallback question data)
3. For each entry: for each answer: apply a transform function
4. If the entry changed: UPDATE the row
5. Return count of updated entries
```

What varies:
- **Which entries**: all entries, or a subset identified by score entry IDs
- **Which answers within an entry**: all, only `type == "open"`, or only specific `question_id`s
- **The transform**: manual point override, `grade()`, or `score_open()`
- **Data source for the question**: stored `question_snapshot` in the answer, or current snapshot from DB

## Interface

```python
# services/score_transforms.py

def transform_scores(
    session_id: int,
    teacher_id: int,
    *,
    entry_ids: Iterable[int] | None = None,   # None = all entries
    transform_fn: Callable[
        [list[dict], dict],                    # (answers, qbank_map)
        list[dict] | None,                     # new_answers, or None = skip
    ],
) -> int:
```

`transform_fn` receives:
- `answers`: the full `answers` list for one score entry (list of `DetailedAnswer` dicts)
- `qbank_map`: `{str(question_id) → question_dict}` from the current snapshot

It returns:
- `new_answers`: the modified list (recalculate `raw_points` and `percent` from this), or
- `None`: skip this entry (no changes)

The module handles:
- Loading the current snapshot once
- Building `qbank_map` once
- Fetching entries (all, or filtered by `entry_ids`)
- Iterating, calling `transform_fn`, detecting changes, updating rows
- The DB transaction boundary

## Callers become thin

**review_scores** route:
```python
overrides_by_id = {o['score_id']: o['per_question'] for o in data['overrides']}
def review_fn(answers, qbank_map):
    # qbank_map unused — answers are self-contained via question_snapshot
    entry_id = ...  # captured by closure
    per_q = overrides_by_id.get(entry_id)
    if not per_q:
        return None
    for ans in answers:
        q_id = str(ans['question_id'])
        if q_id in per_q:
            ans['points_awarded'] = ans['raw_points'] = per_q[q_id]
    return answers

updated = transform_scores(session_id, teacher_id,
    entry_ids=overrides_by_id.keys(),
    transform_fn=review_fn)
```

**recalculate_scores** route:
```python
from services.grading import grade

def recalc_fn(answers, qbank_map):
    raw_answers = [a.get('raw_student_answer') for a in answers]
    plan_steps = [{'id': str(a['question_id']), 'option_order': a.get('option_order', [])} for a in answers]
    result = grade(raw_answers, {'plan': plan_steps}, {'questions': list(qbank_map.values())})
    new_detailed = format_detailed_answers(
        {'plan': plan_steps}, qbank_map, raw_answers,
        result['scores_per_question'], result['feedbacks_per_question'],
        result['verdicts_per_question'])
    return new_detailed

updated = transform_scores(session_id, teacher_id, transform_fn=recalc_fn)
```

**regrade_open_questions** route:
```python
from services.grading import score_open

def regrade_open_fn(answers, qbank_map):
    changed = False
    for ans in answers:
        q = ans.get('question_snapshot')
        if not isinstance(q, dict):
            q = qbank_map.get(str(ans.get('question_id')))
        if not q or q.get('type') != 'open':
            continue
        new_pts = score_open(ans.get('raw_student_answer') or '', q) * q.get('weight', 1)
        if abs(new_pts - ans.get('raw_points', 0)) > 0.001:
            ans['points_awarded'] = ans['raw_points'] = round(new_pts, 2)
            changed = True
    return answers if changed else None

updated = transform_scores(session_id, teacher_id, transform_fn=regrade_open_fn)
```

## Future: per-question regrade

Same interface, caller filters by question_id inside the callback:

```python
TARGET_Q = "42"
def regrade_one_q_fn(answers, qbank_map):
    changed = False
    for ans in answers:
        if str(ans.get('question_id')) != TARGET_Q:
            continue
        q = ans.get('question_snapshot') or qbank_map.get(TARGET_Q)
        if not q:
            continue
        # re-grade using current qbank_map data...
        changed = True
    return answers if changed else None
```

## What stays separate

- `archive_session_scores` — copies scores to an archive row; different operation entirely
- The route handler boilerplate (parse request, validate, call `transform_scores`, return JSON)
- `email_service` integration

## Files changed

| File | Change |
|------|--------|
| `services/score_transforms.py` | **New** — the deepened module |
| `routes/teacher.py` `review_scores` | Replace body (~30 lines) with callback + `transform_scores` call |
| `routes/teacher.py` `recalculate_scores` | Replace body (~40 lines) with callback + `transform_scores` call |
| `routes/teacher.py` `regrade_open_questions` | Replace body (~50 lines) with callback + `transform_scores` call |
| `services/quiz_session.py` | Extract `_parse_json_field` → `utils.py` (candidate #5) |
| `utils.py` | Add `parse_json_field`, `ensure_list`, `ensure_dict` |
| `services/quiz_session.py` | Replace 4 duplicated snapshot-loading blocks with `get_qbank_for_session()` (candidate #2) |

## Tests

```python
# test_score_transforms.py

def test_transform_all_entries_noop():
    """transform_fn returns None for all → updated count = 0"""

def test_transform_subset_of_entries():
    """entry_ids filters to only specific score entries"""

def test_recalculate_updates_points():
    """simulate a weight change → recalc_fn produces different points"""

def test_regrade_open_only_touches_open_answers():
    """single-choice answers unchanged after regrade-open"""

def test_review_applies_override_to_correct_answer():
    """review_fn patches specific question's points"""
```
