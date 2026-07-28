"""Score change sets, per-answer revisions and revert.

Migration 006 enforces new_revision = old_revision + 1 on every score_history
row, so revisions in score_entries.answers and the recorded history must be
computed by the same seam (services.score_transforms.record_answer_changes).
"""
import json

import pytest

from tests.conftest import (
    make_class, make_session, make_snapshot, make_student, make_teacher, teacher_token,
)

OPEN_QUIZ = json.dumps({
    'title': 'Open Quiz',
    'questions': [
        {'id': 'q1', 'type': 'single', 'text': '2+2?', 'options': ['3', '4'],
         'correct': 1, 'weight': 1},
        {'id': 'q2', 'type': 'open', 'text': 'Spiega.',
         'acceptable': ['Risposta completa.'], 'weight': 2},
    ],
})


def _answer(question_id, q_type, *, points, status, weight=1, feedback=None, revision=0):
    return {
        'question_id': question_id,
        'type': q_type,
        'question_snapshot': {
            'id': question_id, 'type': q_type, 'text': 'Spiega.',
            'acceptable': ['Risposta completa.'], 'weight': weight,
        },
        'question_text': 'Spiega.',
        'student_answer': 'Risposta parziale.',
        'raw_student_answer': 'Risposta parziale.',
        'correct_answer': ['Risposta completa.'],
        'raw_correct_answer': ['Risposta completa.'],
        'weight': weight,
        'points_awarded': points,
        'raw_points': points,
        'llm_status': status,
        'llm_feedback': feedback,
        'llm_verdict': None,
        'llm_error': None,
        'llm_updated_at': None,
        'answer_revision': revision,
        'option_order': [],
    }


@pytest.fixture()
def session_with_open_answer(db_conn):
    """A session holding one score entry with a graded open answer."""
    teacher_id = make_teacher(db_conn, email='hist-teacher@test.it')
    student_id = make_student(db_conn, email='hist-student@test.it')
    cls = make_class(db_conn)
    db_conn.execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)",
                    (cls, teacher_id))
    snapshot_id = make_snapshot(db_conn, teacher_id, jsonc=OPEN_QUIZ)
    session_id = make_session(db_conn, teacher_id, snapshot_id, class_ids=[cls], status='active')

    answers = [_answer('q2', 'open', points=1.0, status='graded', weight=2,
                       feedback='Valutazione iniziale')]
    row = db_conn.execute(
        """INSERT INTO score_entries
           (session_id, student_id, teacher_id, raw_points, max_points, percent, answers)
           VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb) RETURNING id""",
        (session_id, student_id, teacher_id, 1.0, 2, 50, json.dumps(answers)),
    ).fetchone()
    db_conn.commit()
    return {
        'teacher_id': teacher_id, 'session_id': session_id, 'score_id': row[0],
        'email': 'hist-teacher@test.it',
    }


def _headers(ctx):
    return {'Authorization': f"Bearer {teacher_token(ctx['teacher_id'], email=ctx['email'])}"}


def _answers(db_conn, score_id):
    return db_conn.execute(
        "SELECT answers FROM score_entries WHERE id = %s", (score_id,)
    ).fetchone()[0]


def _history(db_conn, session_id):
    return db_conn.execute(
        """SELECT scs.id, scs.reason, scs.actor_type, scs.changed_by
           FROM score_change_sets scs WHERE scs.session_id = %s
           ORDER BY scs.created_at""",
        (session_id,),
    ).fetchall()


# ── the diff-and-bump seam ───────────────────────────────────────────────────

def test_unchanged_answers_keep_their_revision(db_conn, session_with_open_answer):
    """A transform that touches one answer must not bump the others."""
    from services import score_transforms

    ctx = session_with_open_answer
    extra = _answer('q1', 'single', points=1, status='not_applicable', revision=3)
    current = _answers(db_conn, ctx['score_id'])
    db_conn.execute(
        "UPDATE score_entries SET answers = %s::jsonb WHERE id = %s",
        (json.dumps(current + [extra]), ctx['score_id']),
    )
    db_conn.commit()

    def touch_first(_sid, answers, _qbank):
        answers[0]['points_awarded'] = 2.0
        return answers

    score_transforms.transform_scores(
        ctx['session_id'], ctx['teacher_id'],
        transform_fn=touch_first, reason='manual_review',
    )

    stored = _answers(db_conn, ctx['score_id'])
    assert stored[0]['answer_revision'] == 1     # changed -> bumped
    assert stored[1]['answer_revision'] == 3     # untouched -> unchanged


def test_metadata_only_change_is_recorded(db_conn, session_with_open_answer):
    """Same points, new feedback is still a change worth auditing."""
    from services import score_transforms

    ctx = session_with_open_answer

    def rewrite_feedback(_sid, answers, _qbank):
        answers[0]['llm_feedback'] = 'Motivazione riscritta'
        return answers

    score_transforms.transform_scores(
        ctx['session_id'], ctx['teacher_id'],
        transform_fn=rewrite_feedback, reason='manual_review',
    )

    stored = _answers(db_conn, ctx['score_id'])
    assert stored[0]['llm_feedback'] == 'Motivazione riscritta'
    assert stored[0]['answer_revision'] == 1

    rows = db_conn.execute(
        "SELECT old_revision, new_revision FROM score_history WHERE score_entry_id = %s",
        (ctx['score_id'],),
    ).fetchall()
    assert rows == [(0, 1)]


def test_noop_transform_creates_no_change_set(db_conn, session_with_open_answer):
    """A transform that changes nothing must not litter the history."""
    from services import score_transforms

    ctx = session_with_open_answer

    updated = score_transforms.transform_scores(
        ctx['session_id'], ctx['teacher_id'],
        transform_fn=lambda _sid, answers, _qbank: answers,
        reason='recalculate',
    )

    assert updated == 0
    assert _history(db_conn, ctx['session_id']) == []


def test_llm_updated_at_alone_is_not_a_change(db_conn, session_with_open_answer):
    """Re-running an evaluation with identical results must not bump revisions."""
    from services import score_transforms

    ctx = session_with_open_answer

    def restamp(_sid, answers, _qbank):
        answers[0]['llm_updated_at'] = '2026-07-28T10:00:00+00:00'
        return answers

    updated = score_transforms.transform_scores(
        ctx['session_id'], ctx['teacher_id'], transform_fn=restamp, reason='llm_regrade',
    )

    assert updated == 0
    assert _answers(db_conn, ctx['score_id'])[0]['answer_revision'] == 0


# ── revert ───────────────────────────────────────────────────────────────────

def test_revert_restores_points_and_moves_revision_forward(
    client, db_conn, session_with_open_answer,
):
    """The whole point of C3: a real revert must not violate the revision CHECK."""
    from services import score_transforms

    ctx = session_with_open_answer

    def regrade(_sid, answers, _qbank):
        answers[0]['points_awarded'] = 2.0
        answers[0]['raw_points'] = 2.0
        answers[0]['llm_feedback'] = 'Rivalutata'
        return answers

    score_transforms.transform_scores(
        ctx['session_id'], ctx['teacher_id'], transform_fn=regrade, reason='llm_regrade',
    )
    assert _answers(db_conn, ctx['score_id'])[0]['points_awarded'] == 2.0

    change_sets = _history(db_conn, ctx['session_id'])
    assert len(change_sets) == 1
    cs_id = change_sets[0][0]

    resp = client.post(
        f"/api/teacher/sessions/{ctx['session_id']}/score-history/{cs_id}/revert",
        headers=_headers(ctx),
    )
    assert resp.status_code == 200, resp.get_data(as_text=True)

    restored = _answers(db_conn, ctx['score_id'])[0]
    assert restored['points_awarded'] == 1.0            # original grade back
    assert restored['llm_feedback'] == 'Valutazione iniziale'
    assert restored['answer_revision'] == 2             # 0 -> 1 -> 2, never backwards

    entry = db_conn.execute(
        "SELECT raw_points, percent FROM score_entries WHERE id = %s", (ctx['score_id'],)
    ).fetchone()
    assert float(entry[0]) == 1.0
    assert float(entry[1]) == 50


def test_second_revert_of_same_change_set_conflicts(
    client, db_conn, session_with_open_answer,
):
    from services import score_transforms

    ctx = session_with_open_answer

    def regrade(_sid, answers, _qbank):
        answers[0]['points_awarded'] = 2.0
        return answers

    score_transforms.transform_scores(
        ctx['session_id'], ctx['teacher_id'], transform_fn=regrade, reason='llm_regrade',
    )
    cs_id = _history(db_conn, ctx['session_id'])[0][0]

    first = client.post(
        f"/api/teacher/sessions/{ctx['session_id']}/score-history/{cs_id}/revert",
        headers=_headers(ctx),
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/teacher/sessions/{ctx['session_id']}/score-history/{cs_id}/revert",
        headers=_headers(ctx),
    )
    assert second.status_code == 409


def test_revert_after_later_modification_conflicts(
    client, db_conn, session_with_open_answer,
):
    from services import score_transforms

    ctx = session_with_open_answer

    def bump_points(value):
        def _fn(_sid, answers, _qbank):
            answers[0]['points_awarded'] = value
            return answers
        return _fn

    score_transforms.transform_scores(
        ctx['session_id'], ctx['teacher_id'],
        transform_fn=bump_points(2.0), reason='llm_regrade',
    )
    cs_id = _history(db_conn, ctx['session_id'])[0][0]

    # A later manual review moves the answer past the change set's revision.
    score_transforms.transform_scores(
        ctx['session_id'], ctx['teacher_id'],
        transform_fn=bump_points(1.5), reason='manual_review',
    )

    resp = client.post(
        f"/api/teacher/sessions/{ctx['session_id']}/score-history/{cs_id}/revert",
        headers=_headers(ctx),
    )
    assert resp.status_code == 409


def test_submission_change_set_cannot_be_reverted(client, db_conn, session_with_open_answer):
    ctx = session_with_open_answer
    row = db_conn.execute(
        """INSERT INTO score_change_sets (session_id, reason, actor_type, changed_by)
           VALUES (%s, 'submission', 'system', NULL) RETURNING id""",
        (ctx['session_id'],),
    ).fetchone()
    db_conn.execute(
        """INSERT INTO score_history
           (change_set_id, score_entry_id, question_id, answer_index,
            old_revision, new_revision, old_answer, new_answer,
            old_raw_points, new_raw_points, old_percent, new_percent)
           VALUES (%s, %s, 'q2', 0, 0, 0, '{}'::jsonb, '{}'::jsonb, 0, 1, 0, 50)""",
        (row[0], ctx['score_id']),
    )
    db_conn.commit()

    resp = client.post(
        f"/api/teacher/sessions/{ctx['session_id']}/score-history/{row[0]}/revert",
        headers=_headers(ctx),
    )
    assert resp.status_code == 400


# ── submission records a system change set ───────────────────────────────────

def test_submission_change_set_has_no_teacher_actor(client, db_conn):
    """The submission is the student's action, not a teacher edit."""
    teacher_id = make_teacher(db_conn, email='submit-teacher@test.it')
    student_id = make_student(db_conn, email='submit-student@test.it')
    cls = make_class(db_conn)
    db_conn.execute("INSERT INTO class_teachers (class_id, teacher_id) VALUES (%s, %s)",
                    (cls, teacher_id))
    db_conn.execute("INSERT INTO class_students (class_id, student_id) VALUES (%s, %s)",
                    (cls, student_id))
    snapshot_id = make_snapshot(db_conn, teacher_id, jsonc=OPEN_QUIZ)
    session_id = make_session(db_conn, teacher_id, snapshot_id, class_ids=[cls], status='active')
    db_conn.execute("UPDATE quiz_sessions SET join_code='HIST01' WHERE id=%s", (session_id,))
    db_conn.commit()

    token = client.post(
        '/api/auth/student-join',
        json={'email': 'submit-student@test.it', 'join_code': 'HIST01'},
    ).get_json()['token']
    auth = {'Authorization': f'Bearer {token}'}

    quiz_id = client.post('/api/quiz/start', json={}, headers=auth).get_json()['quiz_id']
    while True:
        state = client.get(f'/api/quiz/resume/{quiz_id}', headers=auth).get_json()
        if state.get('is_complete'):
            break
        q = state['current_question']
        answer = 0 if q['type'] == 'single' else ([0] if q['type'] == 'multiple' else 'testo')
        client.post('/api/quiz/save-answer', json={'quiz_id': quiz_id, 'answer': answer},
                    headers=auth)
    client.post('/api/quiz/submit', json={'quiz_id': quiz_id}, headers=auth)

    change_sets = _history(db_conn, session_id)
    assert [(cs[1], cs[2], cs[3]) for cs in change_sets] == [('submission', 'system', None)]
