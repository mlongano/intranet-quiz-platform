"""
Student-facing quiz routes.

GET  /api/quiz/session-info          (uses student JWT to get session details)
POST /api/quiz/start                 (create or resume a quiz plan)
GET  /api/quiz/resume/<quiz_id>      (current question + progress)
POST /api/quiz/save-answer           (save one answer, advance index)
POST /api/quiz/submit                (grade and record submission)
"""

import json

from flask import Blueprint, g, jsonify, request

import db
from db import queries as Q
from auth.decorators import require_student
from services import quiz_session as qs
from services.score_transforms import load_qbank_for_session

quiz_bp = Blueprint('quiz', __name__, url_prefix='/api/quiz')


@quiz_bp.get('/session-info')
@require_student
def session_info():
    """Returns quiz title and question count for the student's active session."""
    session_id = g.current_user['sid']
    with db.get_conn() as conn:
        row = conn.execute(
            """SELECT qs.title, qs.opens_at, qs.closes_at,
                      jsonb_array_length(snap.content->'questions') AS question_count
               FROM quiz_sessions qs
               JOIN question_snapshots snap ON snap.id = qs.snapshot_id
               WHERE qs.id = %s""",
            (session_id,),
        ).fetchone()
    if not row:
        return jsonify({'error': 'SESSION_NOT_FOUND'}), 404
    return jsonify({
        'title': row[0],
        'opens_at': row[1].isoformat() if row[1] else None,
        'closes_at': row[2].isoformat() if row[2] else None,
        'question_count': row[3],
    }), 200


@quiz_bp.post('/start')
@require_student
def start():
    """Create or resume the quiz plan for the authenticated student + session."""
    session_id = g.current_user['sid']
    student_id = g.current_user['sub']

    plan = qs.get_or_create_plan(session_id, student_id)
    return jsonify({'quiz_id': plan['quiz_id']}), 200


@quiz_bp.get('/resume/<quiz_id>')
@require_student
def resume(quiz_id: str):
    """Return current question and progression state."""
    student_id = g.current_user['sub']
    plan_data = qs.find_plan_by_quiz_id(quiz_id)

    if not plan_data:
        return jsonify({'error': 'NOT_FOUND'}), 404

    if plan_data['student_id'] != student_id:
        return jsonify({'error': 'FORBIDDEN'}), 403

    progression = plan_data['progression']
    if isinstance(progression, str):
        progression = json.loads(progression)

    plan_steps = plan_data['plan']
    if isinstance(plan_steps, dict):
        plan_steps = plan_steps.get('plan', [])

    current_index = int(progression.get('current_index', 0))
    total = len(plan_steps)

    if plan_data.get('completed_at') or current_index >= total:
        return jsonify({'is_complete': True, 'current_index': current_index, 'total': total}), 200

    with db.get_conn() as conn:
        session_id = plan_data['session_id']
        qbank_map = load_qbank_for_session(conn, session_id)

    if not qbank_map:
        return jsonify({'error': 'SNAPSHOT_NOT_FOUND'}), 404

    step = plan_steps[current_index]
    q_id = str(step.get('id'))
    q = qbank_map.get(q_id)

    if not q:
        return jsonify({'error': 'QUESTION_NOT_FOUND'}), 500

    option_order = step.get('option_order', list(range(len(q.get('options', [])))))
    options = q.get('options', [])
    shuffled_options = [options[i] for i in option_order if i < len(options)]

    return jsonify({
        'is_complete': False,
        'current_index': current_index,
        'total_questions': total,
        'current_question': {
            'id': q['id'],
            'type': q.get('type'),
            'text': q.get('text'),
            'question_image': q.get('question_image'),
            'options': shuffled_options,
        },
    }), 200


@quiz_bp.post('/save-answer')
@require_student
def save_answer():
    """Save one answer and advance the question index."""
    data = request.get_json(silent=True) or {}
    quiz_id = (data.get('quiz_id') or '').strip()
    if not quiz_id:
        return jsonify({'error': 'MISSING_QUIZ_ID'}), 400
    if 'answer' not in data:
        return jsonify({'error': 'MISSING_ANSWER'}), 400

    student_id = g.current_user['sub']
    result = qs.save_answer(quiz_id, data['answer'], student_id)
    return jsonify(result), 200


@quiz_bp.post('/submit')
@require_student
def submit():
    """Grade the completed quiz and record the score."""
    data = request.get_json(silent=True) or {}
    quiz_id = (data.get('quiz_id') or '').strip()
    if not quiz_id:
        return jsonify({'error': 'MISSING_QUIZ_ID'}), 400

    student_id = g.current_user['sub']
    result = qs.submit_plan(quiz_id, student_id)
    return jsonify(result), 200
