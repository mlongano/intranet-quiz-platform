# routes/admin.py
from flask import Blueprint, request, jsonify, abort
from werkzeug.exceptions import Unauthorized, BadRequest, NotFound, InternalServerError
import datetime

# Import necessary functions and data from utils
from utils import (
    ADMIN_PW,
    load_scores,
    save_scores
)

admin_bp = Blueprint('admin', __name__, url_prefix='/api')

@admin_bp.route('/scores', methods=['POST'])
def api_scores():
    data = request.get_json(silent=True) or {}
    # Consider using werkzeug.security.check_password_hash for real password checking
    if data.get('pw') != ADMIN_PW:
        abort(403) # Forbidden
    return jsonify(load_scores())

@admin_bp.route('/review', methods=['POST'])
def api_save_review():
    """Receives score overrides from admin and updates the scores file."""
    data = request.get_json(silent=True) or {}

    # 1. Authentication
    password = data.get('password')
    if not password or password != ADMIN_PW:
        raise Unauthorized(description="Admin authentication failed.")

    # 2. Validate Input Payload
    student_id = data.get('student_id')
    quiz_id = data.get('quiz_id') # Use quiz_id to pinpoint the exact submission
    overrides = data.get('overrides') # Expected: list of {'question_id': ..., 'points': ...}

    if not student_id or not quiz_id:
        raise BadRequest(description="Missing student_id or quiz_id.")
    if not isinstance(overrides, list):
        raise BadRequest(description="Invalid 'overrides' format, expected a list.")

    # 3. Load Scores
    scores = load_scores()
    target_submission_index = -1
    target_submission = None

    for i, record in enumerate(scores):
        if record.get('student') == student_id and record.get('quiz_id') == quiz_id:
            target_submission_index = i
            target_submission = record
            break

    if target_submission is None:
        raise NotFound(description=f"Submission not found for student '{student_id}' with quiz_id '{quiz_id}'.")

    # 4. Apply Overrides
    if 'answers' not in target_submission or not isinstance(target_submission['answers'], list):
        raise InternalServerError(description="Target submission record is missing or has invalid 'answers'.")

    answers_map = {str(ans.get('question_id')): ans for ans in target_submission['answers']}
    updated_count = 0

    for override_item in overrides:
        if not isinstance(override_item, dict): continue

        q_id_to_override = str(override_item.get('question_id'))
        new_points = override_item.get('points')

        if q_id_to_override is None or new_points is None: continue

        try:
            new_points = float(new_points)
        except (ValueError, TypeError):
            continue

        if q_id_to_override in answers_map:
            answer_detail = answers_map[q_id_to_override]
            max_points_for_q = answer_detail.get('weight', 1)

            if not (0 <= new_points <= max_points_for_q):
                print(f"Warning: Override points {new_points} out of range (0-{max_points_for_q}) for q_id {q_id_to_override}.")
                continue

            if answer_detail.get('points_awarded') != round(new_points, 2):
                print(f"Overriding points for q_id {q_id_to_override}: {answer_detail.get('points_awarded')} -> {round(new_points, 2)}")
                answer_detail['points_awarded'] = round(new_points, 2)
                updated_count += 1
        else:
            print(f"Warning: Question ID '{q_id_to_override}' not found in submission for student '{student_id}'.")

    # 5. Recalculate Totals if changes were made
    if updated_count > 0:
        new_raw_points = sum(ans.get('points_awarded', 0) for ans in target_submission['answers'])
        max_points = target_submission.get('max_points', 0)
        new_percent = round(new_raw_points / max_points * 100, 2) if max_points else 0

        target_submission['raw_points'] = round(new_raw_points, 2)
        target_submission['percent'] = new_percent
        target_submission['timestamp'] = datetime.datetime.utcnow().isoformat(timespec='seconds')

        scores[target_submission_index] = target_submission
        save_scores(scores)
        print(f"Saved {updated_count} overrides for student '{student_id}', quiz '{quiz_id}'.")
    else:
        print(f"No effective overrides applied for student '{student_id}', quiz '{quiz_id}'.")

    return jsonify({"success": True, "message": f"{updated_count} overrides applied."})
