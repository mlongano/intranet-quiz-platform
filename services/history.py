"""Anonymous history: what outlives the students' data.

When retention deletes a session (``services/retention.py``), ``archive_session``
first copies into ``history_*`` what serves the long run — how each question
performed, and every answer with its points and motivation — in a form that
leads back to no one (migration 017 explains the rules). Anonymous data is
outside the GDPR, so the history has no expiry.

Free text is scrubbed with what the school's directory knows: every email
address, the full names of students and teachers, and any capitalised word
that is a name of the session's participants or of their classmates. It errs
towards replacing too much: an identifying slip costs more than a lost word.
"""

from __future__ import annotations

import json
import os
import random
import re
from typing import Any

from db import queries as Q
from utils import ensure_list

PLACEHOLDER_NAME = '[nome]'
PLACEHOLDER_EMAIL = '[email]'
_EMAIL = re.compile(r'[\w.+-]+@[\w-]+(\.[\w-]+)+')
_GRADE = re.compile(r'(?<![0-9A-Za-z])([1-5])\s?[A-Za-z]{1,3}(?![A-Za-z])')


# Dates, times and class codes in a quiz title ('20250430_074731_3CI-finale')
# say when and who: they go.
_TITLE_NOISE = (
    re.compile(r'(?<!\d)\d{8}(?:[_T-]?\d{4,6})?(?!\d)'),          # 20250430, 20250430_074731
    re.compile(r'(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)'),                # 2025-04-30
    re.compile(r'(?<!\d)\d{1,2}[/.]\d{1,2}(?:[/.]\d{2,4})?(?!\d)'),  # 30/4, 30/04/2025
    re.compile(r'(?<!\d)\d{6}(?!\d)'),                              # 074731
    _GRADE,                                                         # 3CI, 4 BI
)


def clean_title(title: str) -> str:
    for pattern in _TITLE_NOISE:
        title = pattern.sub(' ', title)
    title = re.sub(r'^\s*Was:\s*', '', title)
    title = re.sub(r'[\s_\-]{2,}|^[\s_\-]+|[\s_\-]+$', lambda m: '' if m.start() == 0 or m.end() == len(title) else ' ', title)
    return title.strip(' _-') or 'Quiz'


def min_submissions() -> int:
    return int(os.environ.get('HISTORY_MIN_SUBMISSIONS', 5))


# ── scrubbing ────────────────────────────────────────────────────────────────

class Scrubber:
    """Replaces the people a text may name: built once per session."""

    def __init__(self, full_names: list[str], name_words: set[str]):
        names = sorted({n for n in full_names if len(n) >= 5}, key=len, reverse=True)
        self._full = re.compile(r'\b(' + '|'.join(map(re.escape, names)) + r')\b', re.IGNORECASE) if names else None
        words = sorted({w for w in name_words if len(w) >= 3}, key=len, reverse=True)
        # Capitalised only: 'porta 80' stays, 'Porta' (a classmate) goes.
        self._words = re.compile(r'\b(' + '|'.join(map(re.escape, words)) + r')\b') if words else None

    def __call__(self, text: Any) -> Any:
        if not isinstance(text, str) or not text:
            return text
        text = _EMAIL.sub(PLACEHOLDER_EMAIL, text)
        if self._full:
            text = self._full.sub(PLACEHOLDER_NAME, text)
        if self._words:
            text = self._words.sub(PLACEHOLDER_NAME, text)
        return text


def _name_variants(display_name: str) -> tuple[list[str], set[str]]:
    parts = [p for p in re.split(r'\s+', display_name.strip()) if p]
    full = [display_name.strip()]
    if len(parts) >= 2:
        full.append(' '.join(reversed(parts)))
    words = {p.capitalize() for p in parts if p.isalpha() or '\'' in p}
    words |= {p for p in parts}
    return full, words


def build_scrubber(conn, session_id: int) -> Scrubber:
    """Full names of everyone in the school; single names of the session's people."""
    full_names: list[str] = []
    for (name,) in conn.execute(Q.HISTORY_ALL_PEOPLE).fetchall():
        full_names += _name_variants(name or '')[0]
    words: set[str] = set()
    for (name,) in conn.execute(Q.HISTORY_SESSION_PEOPLE, {'session_id': session_id}).fetchall():
        words |= _name_variants(name or '')[1]
    return Scrubber(full_names, words)


# ── archiving ────────────────────────────────────────────────────────────────

def _school_year(ts) -> str:
    start = ts.year if ts.month >= 9 else ts.year - 1
    return f"{start}-{start + 1}"


def _grade(class_rows: list[tuple[str, str]], school_year: str) -> int | None:
    """The year of course, only when every class of that school year agrees."""
    grades = set()
    for name, year in class_rows:
        if year != school_year:
            return None          # a class of another year says nothing about then
        found = {m.group(1) for m in _GRADE.finditer(name or '')}
        if len(found) != 1:
            return None
        grades |= found
    return int(grades.pop()) if len(grades) == 1 else None


def _original_choice(answer: dict, options: list) -> Any:
    """The chosen option(s) as indices into the quiz's own order (not the shuffled one)."""
    raw = answer.get('raw_student_answer')
    order = answer.get('option_order') or list(range(len(options)))

    def original(i):
        return order[i] if isinstance(i, int) and 0 <= i < len(order) else None

    if answer.get('type') == 'single':
        return original(raw)
    if isinstance(raw, list):
        return sorted(x for x in (original(i) for i in raw) if x is not None)
    return None


def _question_record(q: dict, scrub: Scrubber) -> dict:
    keep = ('text', 'options', 'correct', 'acceptable', 'weight', 'type', 'keywords')
    record = {k: q[k] for k in keep if k in q}
    for k in ('text', 'acceptable'):
        if isinstance(record.get(k), str):
            record[k] = scrub(record[k])
    return record


def archive_session(conn, session_id: int) -> bool:
    """Copy one session into the anonymous history. False when it is too small."""
    meta = conn.execute(Q.HISTORY_SESSION_META, (session_id,)).fetchone()
    if not meta:
        return False
    teacher_id, quiz_title, reference_at = meta
    entries = conn.execute(Q.HISTORY_SESSION_ENTRIES, (session_id,)).fetchall()
    if len(entries) < min_submissions():
        return False

    school_year = _school_year(reference_at)
    classes = conn.execute(Q.HISTORY_SESSION_CLASSES, (session_id,)).fetchall()
    scrub = build_scrubber(conn, session_id)

    # Per question, every student's answer — then shuffled, so the rows of one
    # student cannot be lined up across questions.
    by_question: dict[str, dict] = {}
    for (answers,) in entries:
        for a in ensure_list(answers):
            key = str(a.get('question_id'))
            slot = by_question.setdefault(key, {'q': a.get('question_snapshot') or {}, 'type': a.get('type'),
                                                'rows': []})
            slot['rows'].append(a)

    quiz_id = conn.execute(Q.INSERT_HISTORY_QUIZ, {
        'teacher_id': teacher_id, 'title': clean_title(scrub(quiz_title)), 'school_year': school_year,
        'grade': _grade(classes, school_year), 'submissions': len(entries),
    }).fetchone()[0]

    for position, (key, slot) in enumerate(by_question.items()):
        q = dict(slot['q']); q_type = slot['type'] or q.get('type')
        q.setdefault('type', q_type)
        if not q.get('text'):
            q['text'] = slot['rows'][0].get('question_text') or ''
        question_id = conn.execute(Q.INSERT_HISTORY_QUESTION, {
            'quiz_id': quiz_id, 'position': position, 'question_key': key, 'type': q_type,
            'question': json.dumps(_question_record(q, scrub)),
        }).fetchone()[0]
        rows = slot['rows'][:]
        random.SystemRandom().shuffle(rows)
        options = q.get('options') or []
        for a in rows:
            pending = q_type == 'open' and a.get('llm_status') == 'pending'
            if q_type == 'open':
                raw = a.get('raw_student_answer')
                answer = scrub(raw) if isinstance(raw, str) else None
            else:
                answer = _original_choice({**a, 'type': q_type}, options)
            reviewed = bool(a.get('manual_override'))
            conn.execute(Q.INSERT_HISTORY_ANSWER, {
                'question_id': question_id,
                'answer': json.dumps(answer),
                'points': None if pending else a.get('points_awarded'),
                'max_points': a.get('weight') or q.get('weight') or 1,
                'motivation': scrub(a.get('teacher_feedback') or a.get('llm_feedback')),
                'model_points': a.get('original_points_awarded') if reviewed else None,
                'teacher_reviewed': reviewed,
                'llm_model': a.get('llm_model'),
                'prompt_version': a.get('prompt_version'),
            })
    return True


# ── reading ──────────────────────────────────────────────────────────────────

def list_for_teacher(conn, teacher_id: int) -> list[dict]:
    rows = conn.execute(Q.LIST_HISTORY_FOR_TEACHER, (teacher_id,)).fetchall()
    return [{'id': r[0], 'title': r[1], 'school_year': r[2], 'grade': r[3], 'submissions': r[4],
             'archived_at': r[5].isoformat(), 'questions': r[6]} for r in rows]


def detail_for_teacher(conn, teacher_id: int, quiz_id: int, with_answers: bool) -> dict | None:
    head = conn.execute(Q.GET_HISTORY_QUIZ, (quiz_id, teacher_id)).fetchone()
    if not head:
        return None
    questions = []
    for qid, key, q_type, question in conn.execute(Q.LIST_HISTORY_QUESTIONS, (quiz_id,)).fetchall():
        answers = conn.execute(Q.LIST_HISTORY_ANSWERS, (qid,)).fetchall()
        graded = [float(a[1]) for a in answers if a[1] is not None]
        item = {
            'question_key': key, 'type': q_type, 'question': question,
            'answers': len(answers),
            'average_points': round(sum(graded) / len(graded), 2) if graded else None,
            'max_points': float(answers[0][2]) if answers else None,
            'full_marks': sum(1 for a in answers if a[1] is not None and float(a[1]) >= float(a[2])),
            'teacher_reviewed': sum(1 for a in answers if a[4]),
        }
        if q_type in ('single', 'multiple'):
            counts = [0] * len(question.get('options') or [])
            for a in answers:
                chosen = a[0] if isinstance(a[0], list) else [a[0]]
                for i in chosen:
                    if isinstance(i, int) and 0 <= i < len(counts):
                        counts[i] += 1
            item['option_counts'] = counts
        if with_answers:
            item['rows'] = [{'answer': a[0], 'points': None if a[1] is None else float(a[1]),
                             'max_points': float(a[2]), 'motivation': a[3], 'teacher_reviewed': a[4],
                             'model_points': None if a[5] is None else float(a[5]),
                             'llm_model': a[6], 'prompt_version': a[7]} for a in answers]
        questions.append(item)
    return {'id': head[0], 'title': head[1], 'school_year': head[2], 'grade': head[3],
            'submissions': head[4], 'archived_at': head[5].isoformat(), 'questions': questions}
