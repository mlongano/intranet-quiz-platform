# routes/admin.py
from flask import Blueprint, request, jsonify, abort
from werkzeug.exceptions import Unauthorized, BadRequest, NotFound, InternalServerError
import datetime

# Import necessary functions and data from utils
from utils import (
    ADMIN_PW,
    load_scores, # NOW HANDLES LOADING FROM BANK IF FILENAME IS PROVIDED
    save_scores, # Saves to SCORE_FILE
    list_scores_bank_files, # NEW import
    load_scores_from_bank,  # NEW import

    save_scores,
    list_scores_bank_files, # NEW import
    load_scores_from_bank,  # NEW import
    save_scores_to_bank,    # NEW import
    load_questions,
    save_questions,
    list_question_bank_files, # New function
    load_quiz_from_bank,      # New function
    save_quiz_to_bank,
    format_image_url    # New function
)

admin_bp = Blueprint('admin', __name__, url_prefix='/api')

@admin_bp.route('/scores', methods=['POST'])
def api_scores():
    data = request.get_json(silent=True) or {}
    # Consider using werkzeug.security.check_password_hash for real password checking
    if data.get('pw') != ADMIN_PW:
        abort(403) # Forbidden
    scores = []
    try:
        scores = load_scores()
    except FileNotFoundError:
        abort(404) # Not Found
    return jsonify(scores)

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
    scores = []

    try:
        scores = load_scores()
    except Exception as e:
        # Catch potential errors during score loading (though load_scores handles some)
        print(f"Error in /api/scores loading scores: {e}")
        raise InternalServerError(description="Failed to load scores.")

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

@admin_bp.route('/admin/questions', methods=['POST', 'PUT']) # Or PUT instead of POST
def manage_questions():
    # Authentication (reuse or adapt from /api/scores or /api/review)
    auth_pw = None
    data = request.get_json(silent=True) or {}
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        auth_pw = data.get('pw') # TODO: not secure
    elif request.method == 'PUT':
        # Get password from custom header X-Admin-Password
        auth_pw = request.headers.get('X-Admin-Pass')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403) # Forbidden
        #raise Unauthorized(description="Admin authentication failed.")

    if request.method == 'POST':
        try:
            questions = load_questions()
            return jsonify(questions)
        except Exception:
            abort(404)
            # Handle potential errors from load_questions (e.g., file not found)
            # raise InternalServerError(description=f"Failed to load questions: {e}")

    if request.method == 'PUT':
         # Assuming 'questions' is the key holding the list in the request body
         new_questions_data = data.get('questions') if data is not None else None
         if not isinstance(new_questions_data, list):
             raise BadRequest(description="Invalid data format: 'questions' must be a list.")
         # **Add more validation here if needed** (e.g., check structure of each question)
         try:
             save_questions(new_questions_data)
             return jsonify({"success": True, "message": "Questions updated successfully."})
         except Exception:
             abort(500)
             # Handle potential errors from save_questions
             #raise InternalServerError(description=f"Failed to save questions: {e}")

    # Fallback for unsupported methods
    abort(405)

# --- NEW Admin Endpoints for Question Bank Management ---

@admin_bp.route('/admin/bank/files', methods=['POST'])
def api_list_bank_files():
    """Lists available quiz files (jsonc) in the question_bank folder."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403) # Forbidden

    try:
        available_files = list_question_bank_files()
        return jsonify({"files": available_files})
    except Exception as e:
        print(f"Error listing bank files: {e}")
        abort(500, description="Internal server error listing bank files.")

@admin_bp.route('/admin/bank/load', methods=['POST'])
def api_load_from_bank():
    """Loads a specified quiz file from the question_bank into QUEST_FILE."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403) # Forbidden
    if not filename:
        abort(400, description="Missing filename in request body.")

    try:
        load_quiz_from_bank(filename)
        return jsonify({"success": True, "message": f"Successfully loaded '{filename}' into active quiz."})
    except (NotFound, BadRequest, InternalServerError) as e:
         abort(e.code, description=e.description) if e.code else abort(500, description="Internal server error loading quiz from bank.")
    except Exception as e:
        print(f"Error loading from bank: {e}")
        abort(500, description="Internal server error loading quiz from bank.")

@admin_bp.route('/admin/bank/save', methods=['POST'])
def api_save_to_bank():
    """Saves the current QUEST_FILE to the question_bank with a date prefix and suffix."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename_suffix = data.get('filename_suffix') # Expect a suffix from the client

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403) # Forbidden
    if not filename_suffix:
        abort(400, description="Missing filename_suffix in request body.")

    try:
        save_quiz_to_bank(filename_suffix)
        return jsonify({"success": True, "message": "Successfully saved active quiz to bank."}) # Message will contain the generated filename
    except (BadRequest, InternalServerError) as e:  # Removed Conflict, which is undefined
         abort(e.code, description=e.description) if e.code else abort(500, description="Internal server error saving quiz to bank.")
    except Exception as e:
        print(f"Error saving to bank: {e}")
        abort(500, description="Internal server error saving quiz to bank.")

@admin_bp.route('/admin/bank/preview', methods=['POST'])
def api_preview_bank_file():
    """Reads and returns the JSON content of a specified file in the question_bank for preview."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403) # Forbidden
    if not filename:
        abort(400, description="Missing filename in request body.")

    try:
        # Use the updated load_questions function to read the file from the bank
        file_content = load_questions(filename=filename)
        return jsonify(file_content)
    except (NotFound, BadRequest, InternalServerError) as e:
         abort(e.code, description=e.description) if e.code else abort(500, description="Internal server error previewing bank file.")
    except Exception as e:
        print(f"Error previewing bank file '{filename}': {e}")
        abort(500, description="Internal server error previewing bank file.")


# --- NEW Admin Endpoints for Scores Bank Management ---

@admin_bp.route('/admin/scores-bank/files', methods=['POST'])
def api_list_scores_bank_files():
    """Lists available scores files (jsonc) in the scores_bank folder."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403)

    try:
        available_files = list_scores_bank_files()
        return jsonify({"files": available_files})
    except Exception as e:
        print(f"Error listing scores bank files: {e}")
        abort(500, description="Internal server error listing scores bank files.")

@admin_bp.route('/admin/scores-bank/load', methods=['POST'])
def api_load_scores_from_bank():
    """Loads a specified scores file from the scores_bank into SCORE_FILE."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403)
    if not filename:
        abort(400, description="Missing filename in request body.")

    try:
        load_scores_from_bank(filename)
        return jsonify({"success": True, "message": f"Successfully loaded scores from '{filename}'."})
    except (NotFound, BadRequest, InternalServerError) as e:
         abort(e.code, description=e.description) if e.code else abort(500, description="Internal server error loading scores from bank.")
    except Exception as e:
        print(f"Error loading scores from bank: {e}")
        abort(500, description="Internal server error loading scores from bank.")

@admin_bp.route('/admin/scores-bank/save', methods=['POST'])
def api_save_scores_to_bank():
    """Saves the current SCORE_FILE to the scores_bank with a date prefix and suffix."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename_suffix = data.get('filename_suffix')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403)
    if not filename_suffix:
        abort(400, description="Missing filename_suffix in request body.")

    try:
        save_scores_to_bank(filename_suffix)
        return jsonify({"success": True, "message": "Successfully saved scores to bank."})
    except (BadRequest, InternalServerError) as e:
         abort(e.code if hasattr(e, 'code') and e.code is not None else 500, description=getattr(e, 'description', "Internal server error saving scores to bank."))
    except Exception as e:
        print(f"Error saving scores to bank: {e}")
        abort(500, description="Internal server error saving scores to bank.")

@admin_bp.route('/admin/scores-bank/preview', methods=['POST'])
def api_preview_scores_bank_file():
    """Reads and returns the JSON content of a specified file in the scores_bank for preview."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403)
    if not filename:
        abort(400, description="Missing filename in request body.")

    try:
        # Use the updated load_scores function to read the file from the bank
        file_content = load_scores(filename=filename)
        # Note: Previewing scores data might require different frontend rendering than questions
        return jsonify(file_content)
    except (NotFound, BadRequest, InternalServerError) as e:
         abort(e.code, description=e.description) if e.code and e.description else abort(500, description="Internal server error previewing scores bank file.")
    except Exception as e:
        print(f"Error previewing scores bank file '{filename}': {e}")
        abort(500, description="Internal server error previewing scores bank file.")
