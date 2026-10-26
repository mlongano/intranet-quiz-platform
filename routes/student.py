"""
A student's own results.

GET /api/student/results               (every submission; scores once published)
GET /api/student/results/<session_id>  (one published submission, question by question)
"""

from flask import Blueprint, g, jsonify
from werkzeug.exceptions import NotFound

from auth.decorators import require_student_results
from services import student_results

student_bp = Blueprint('student', __name__, url_prefix='/api/student')


@student_bp.errorhandler(NotFound)
def _json_not_found(e):
    return jsonify({'error': e.description, 'code': 'NOT_FOUND'}), 404


@student_bp.get('/results')
@require_student_results
def results():
    return jsonify(student_results.list_for_student(int(g.current_user['sub']))), 200


@student_bp.get('/results/<int:session_id>')
@require_student_results
def result_detail(session_id: int):
    return jsonify(student_results.detail_for_student(int(g.current_user['sub']), session_id)), 200
