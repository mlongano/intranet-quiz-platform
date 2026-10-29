"""A student's own results, and the teacher's publication of them.

The student page shows a submission's score and motivations only after the
teacher publishes the session's results. Each score entry is self-contained
(every answer embeds its question snapshot), so the page reads nothing but
the student's own entry.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from werkzeug.exceptions import NotFound

import db
from db import queries as Q
from services.quiz_session import EditRefused
from utils import ensure_list


# ── publication (teacher) ────────────────────────────────────────────────────

def set_publication(session_id: int, teacher_id: int, *, published: bool, show_correct: bool = False,
                    show_acceptable: bool = False) -> dict:
    """Publish or withdraw a closed session's results. Owner only, under lock.

    show_correct: closed questions' correct answers; show_acceptable: open
    questions' acceptable answer, as written in the quiz (it may hold notes
    meant for grading, hence a choice of its own).
    """
    with db.get_conn() as conn:
        row = conn.execute(Q.LOCK_SESSION_STATUS, (session_id, teacher_id)).fetchone()
        if not row:
            raise NotFound(description="Session not found.")
        if published and row[0] != 'closed':
            raise EditRefused('SESSION_NOT_CLOSED',
                              "Si pubblicano i risultati di una sessione chiusa: chiudila prima.")
        published_at = datetime.now(timezone.utc) if published else None
        was_published = conn.execute(Q.SESSION_RESULTS_PUBLISHED, (session_id, teacher_id)).fetchone()[0]
        if published or was_published:
            record_event(conn, session_id, teacher_id,
                         'results_published' if published else 'results_withdrawn',
                         {'show_correct': bool(show_correct), 'show_acceptable': bool(show_acceptable)}
                         if published else {})
        conn.execute(Q.SET_RESULTS_PUBLICATION, {
            'id': session_id, 'teacher_id': teacher_id,
            'published_at': published_at, 'show_correct': bool(show_correct) if published else False,
            'show_acceptable': bool(show_acceptable) if published else False,
        })
        conn.commit()
    return {'results_published_at': published_at.isoformat() if published_at else None,
            'results_show_correct': bool(show_correct) if published else False,
            'results_show_acceptable': bool(show_acceptable) if published else False}


def record_event(conn, session_id: int, teacher_id: int | None, kind: str, details: dict) -> None:
    """One line in the session's Cronologia modifiche (publication, e-mail)."""
    conn.execute(Q.INSERT_SESSION_EVENT, {'session_id': session_id, 'teacher_id': teacher_id,
                                          'kind': kind, 'details': json.dumps(details)})


# ── the student's page ───────────────────────────────────────────────────────

def list_for_student(student_id: int) -> list[dict]:
    with db.get_conn() as conn:
        rows = conn.execute(Q.STUDENT_RESULTS_LIST, (student_id,)).fetchall()
    items = []
    for session_id, title, teacher, submitted_at, published_at, percent, raw, maximum in rows:
        item = {
            'session_id': session_id,
            'title': title,
            'teacher': teacher,
            'submitted_at': submitted_at.isoformat() if submitted_at else None,
            'published': published_at is not None,
        }
        if published_at is not None:
            item.update(percent=float(percent), raw_points=float(raw), max_points=float(maximum))
        items.append(item)
    return items


def detail_for_student(student_id: int, session_id: int) -> dict:
    with db.get_conn() as conn:
        row = conn.execute(Q.STUDENT_RESULT_DETAIL, (session_id, student_id)).fetchone()
    if not row:
        raise NotFound(description="Risultati non disponibili.")
    title, teacher, submitted_at, show_correct, raw, maximum, percent, answers, show_acceptable = row
    return {
        'session_id': session_id,
        'title': title,
        'teacher': teacher,
        'submitted_at': submitted_at.isoformat() if submitted_at else None,
        'raw_points': float(raw),
        'max_points': float(maximum),
        'percent': float(percent),
        'questions': [_question_view(a, show_correct, show_acceptable) for a in ensure_list(answers)],
    }


def _option_text(option: Any) -> str:
    return option.get('text', '') if isinstance(option, dict) else str(option)


def _question_view(answer: dict, show_correct: bool, show_acceptable: bool = False) -> dict:
    q = answer.get('question_snapshot') or {}
    q_type = answer.get('type') or q.get('type')
    options = q.get('options') or []
    order = answer.get('option_order') or list(range(len(options)))
    raw = answer.get('raw_student_answer')

    def original(shown_index: Any) -> str | None:
        """The text of the option shown at *shown_index* (options were shuffled)."""
        if not isinstance(shown_index, int) or not 0 <= shown_index < len(order):
            return None
        idx = order[shown_index]
        return _option_text(options[idx]) if 0 <= idx < len(options) else None

    if q_type == 'single':
        yours: Any = original(raw)
    elif q_type == 'multiple':
        yours = [t for t in (original(i) for i in (raw if isinstance(raw, list) else [])) if t is not None]
    else:
        yours = raw if isinstance(raw, str) else None

    pending = q_type == 'open' and answer.get('llm_status') == 'pending'
    # The teacher's motivation wins; the model's exists only for open answers.
    motivation = answer.get('teacher_feedback') or (
        answer.get('llm_feedback') if q_type == 'open' and not pending else None)

    view = {
        'question_id': str(answer.get('question_id')),
        'type': q_type,
        'text': q.get('text') or answer.get('question_text') or '',
        'question_image': q.get('question_image'),
        'options': [_option_text(o) for o in options] if q_type in ('single', 'multiple') else [],
        'your_answer': yours,
        'points': None if pending else float(answer.get('points_awarded') or 0),
        'max_points': float(answer.get('weight') or q.get('weight') or 1),
        'pending': pending,
        'motivation': motivation,
    }
    # Only closed questions have a correct answer. An open question's acceptable
    # answer is written for grading (it may hold weights and partial-credit
    # notes): the student gets the motivation, and the acceptable answer only
    # when the teacher chose to show it — never labelled "correct".
    if show_acceptable and q_type == 'open' and q.get('acceptable'):
        view['acceptable_answer'] = q.get('acceptable')
    if show_correct:
        correct = q.get('correct')
        if q_type == 'single' and isinstance(correct, int) and 0 <= correct < len(options):
            view['correct_answer'] = _option_text(options[correct])
        elif q_type == 'multiple' and isinstance(correct, list):
            view['correct_answer'] = [_option_text(options[i]) for i in correct
                                      if isinstance(i, int) and 0 <= i < len(options)]
    return view
