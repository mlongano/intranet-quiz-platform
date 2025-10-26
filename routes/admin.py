# routes/admin.py
from flask import Blueprint, request, jsonify, abort
from pathlib import Path
from werkzeug.exceptions import Unauthorized, BadRequest, NotFound, InternalServerError, Conflict
import datetime

# Import necessary functions and data from utils
from utils import (
    ADMIN_PW,
    load_scores, # NOW HANDLES LOADING FROM BANK IF FILENAME IS PROVIDED
    save_scores, # Saves to SCORE_FILE
    list_scores_bank_files, # NEW import
    load_scores_from_bank,  # NEW import
    save_scores_to_bank,    # NEW import
    load_questions,
    save_questions,
    list_question_bank_files, # New function
    load_quiz_from_bank,      # New function
    save_quiz_to_bank,
    delete_quiz_from_bank,    # New function for deleting
    list_students_bank_files, # NEW import for students bank
    load_students_from_bank,  # NEW import for students bank
    save_students_to_bank,    # NEW import for students bank
    load_quiz_status,         # NEW import for quiz status
    save_quiz_status,         # NEW import for quiz status
)

# Import email service
from email_service import send_quiz_result_email, send_bulk_quiz_results, is_valid_email

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

def load_target_scores(student_id, quiz_id):
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

    return scores, target_submission, target_submission_index

def apply_overrides(target_submission, overrides, student_id):
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
    return target_submission, updated_count

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
    scores, target_submission, target_submission_index = load_target_scores(student_id, quiz_id)

    # 4. Apply Overrides
    target_submission, updated_count = apply_overrides(target_submission, overrides, student_id)

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
            # Load in lenient mode to allow editing of invalid format files
            quiz_data = load_questions(lenient=True)
            return jsonify(quiz_data)  # Return the whole object with title, questions, and optionally warning
        except BadRequest as e:
            # Return detailed validation error to client
            return jsonify({'error': e.description or str(e)}), 400
        except NotFound as e:
            return jsonify({'error': e.description or 'Questions file not found'}), 404
        except InternalServerError as e:
            return jsonify({'error': e.description or 'Internal server error'}), 500
        except Exception as e:
            print(f"Error loading questions: {e}")
            return jsonify({'error': f'Failed to load questions: {str(e)}'}), 500

    if request.method == 'PUT':
         # Validate the new format
         if data is None:
             raise BadRequest(description="No data provided")

         # Must be object with 'questions' field
         if not isinstance(data, dict):
             raise BadRequest(description="Invalid data format: Must be an object with 'title' and 'questions' fields")

         if 'questions' not in data:
             raise BadRequest(description="Invalid data format: Missing 'questions' field")

         if not isinstance(data['questions'], list):
             raise BadRequest(description="Invalid data format: 'questions' field must be an array")

         # **Add more validation here if needed** (e.g., check structure of each question)
         try:
             save_questions(data)
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
        warning = load_quiz_from_bank(filename)
        response = {
            "success": True,
            "message": f"Successfully loaded '{filename}' into active quiz."
        }
        if warning:
            response["warning"] = warning
        return jsonify(response)
    except BadRequest as e:
        # Return detailed validation error to client
        return jsonify({'error': e.description or str(e)}), 400
    except NotFound as e:
        return jsonify({'error': e.description or 'File not found'}), 404
    except InternalServerError as e:
        print(f"Internal error loading quiz from bank '{filename}': {e}")
        return jsonify({'error': e.description or 'Internal server error'}), 500
    except Exception as e:
        print(f"Error loading from bank: {e}")
        return jsonify({'error': f'Internal server error loading quiz from bank: {str(e)}'}), 500

@admin_bp.route('/admin/bank/save', methods=['POST'])
def api_save_to_bank():
    """Saves the current QUEST_FILE to the question_bank with the provided filename."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename_suffix', '') # Frontend sends full filename in 'filename_suffix' field

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403) # Forbidden
    if not filename:
        abort(400, description="Filename is required.")

    try:
        save_quiz_to_bank(filename)
        return jsonify({"success": True, "message": f"Successfully saved quiz as '{filename}' to bank."})
    except Conflict as e:
        abort(409, description=e.description)
    except (BadRequest, InternalServerError) as e:
         abort(e.code, description=e.description) if e.code else abort(500, description="Internal server error saving quiz to bank.")
    except Exception as e:
        print(f"Error saving to bank: {e}")
        abort(500, description="Internal server error saving quiz to bank.")

@admin_bp.route('/admin/bank/delete', methods=['POST'])
def api_delete_from_bank():
    """Deletes a specified quiz file from the question_bank."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403) # Forbidden
    if not filename:
        abort(400, description="Missing filename in request body.")

    try:
        delete_quiz_from_bank(filename)
        return jsonify({"success": True, "message": f"Successfully deleted '{filename}' from bank."})
    except NotFound as e:
        return jsonify({'error': e.description or 'File not found'}), 404
    except InternalServerError as e:
        print(f"Internal error deleting quiz from bank '{filename}': {e}")
        return jsonify({'error': e.description or 'Internal server error'}), 500
    except Exception as e:
        print(f"Error deleting from bank: {e}")
        return jsonify({'error': f'Internal server error deleting quiz from bank: {str(e)}'}), 500

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
    except BadRequest as e:
        # Return detailed validation error to client
        return jsonify({'error': e.description or str(e)}), 400
    except NotFound as e:
        return jsonify({'error': e.description or 'File not found'}), 404
    except InternalServerError as e:
        print(f"Internal error previewing bank file '{filename}': {e}")
        return jsonify({'error': e.description or 'Internal server error'}), 500
    except Exception as e:
        print(f"Error previewing bank file '{filename}': {e}")
        return jsonify({'error': f'Internal server error previewing bank file: {str(e)}'}), 500


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
    """Saves the current SCORE_FILE to the scores_bank with the provided filename."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename_suffix', '') # Frontend sends full filename in 'filename_suffix' field

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403)
    if not filename:
        abort(400, description="Filename is required.")

    try:
        save_scores_to_bank(filename)
        return jsonify({"success": True, "message": f"Successfully saved scores as '{filename}' to bank."})
    except Conflict as e:
        abort(409, description=e.description)
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

@admin_bp.route('/admin/scores/recalculate', methods=['POST'])
def api_recalculate_all_scores():
    """Re-grades all submissions against the current question bank.

    Extracts original answer indices from formatted answer strings like "'text' (Index: 2)"
    This allows full recalculation even for old submissions without option_order saved.
    """
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    try:
        # Import necessary functions from utils
        from utils import load_questions
        import shutil
        import os
        from datetime import datetime

        # Create a timestamped backup before recalculation
        score_file = os.getenv('SCORE_FILE', './scores.jsonc')
        if os.path.exists(score_file):
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            backup_file = f"{score_file}.backup_{timestamp}"
            try:
                shutil.copy2(score_file, backup_file)
                print(f"Created backup: {backup_file}")
            except Exception as e:
                print(f"Warning: Could not create backup: {e}")

        # Load current scores and questions
        scores = load_scores()
        quiz_data = load_questions()
        questions = quiz_data['questions']
        quiz_title = quiz_data.get('title')

        # Create a question bank map for quick lookup
        qbank_map = {q['id']: q for q in questions}

        recalculated_count = 0
        errors = []

        for score_entry in scores:
            try:
                if 'answers' not in score_entry or not isinstance(score_entry['answers'], list):
                    errors.append(f"Student {score_entry.get('student')}: Missing or invalid answers field")
                    continue

                student_id = score_entry.get('student', '')

                # Check if this submission has option_order data
                has_option_order = any(
                    'option_order' in ans and ans.get('option_order')
                    for ans in score_entry['answers']
                )

                # Helper function to extract indices from formatted answers like "'text' (Index: 2)"
                import re
                def extract_indices_from_formatted_answer(formatted_answer):
                    """Extract original indices from formatted answer strings."""
                    if isinstance(formatted_answer, str):
                        # Single answer: "'text' (Index: 2)"
                        match = re.search(r'\(Index:\s*(\d+)\)', formatted_answer)
                        if match:
                            return int(match.group(1))
                        return None
                    elif isinstance(formatted_answer, list):
                        # Multiple answers: ["'text1' (Index: 2)", "'text2' (Index: 3)"]
                        indices = []
                        for item in formatted_answer:
                            if isinstance(item, str):
                                match = re.search(r'\(Index:\s*(\d+)\)', item)
                                if match:
                                    indices.append(int(match.group(1)))
                        return indices if indices else None
                    return None

                # Recalculate scores (works with or without option_order)
                total_score = 0.0
                max_score = 0.0

                for answer_detail in score_entry['answers']:
                    q_id = answer_detail.get('question_id')

                    if q_id not in qbank_map:
                        errors.append(f"Student {student_id}: Question {q_id} not found in current question bank")
                        continue

                    current_question = qbank_map[q_id]
                    q_type = current_question.get('type')
                    weight = current_question.get('weight', 1)
                    max_score += weight

                    current_correct_answer = current_question.get('correct')
                    current_options = current_question.get('options', [])

                    # Helper to get text from an option (string or object)
                    def get_option_text(option):
                        return option.get('text', '') if isinstance(option, dict) else str(option)

                    # Update stored correct answer (both raw and formatted)
                    answer_detail['raw_correct_answer'] = current_correct_answer

                    # Regenerate formatted correct_answer to reflect current question bank
                    if q_type == 'single' and isinstance(current_correct_answer, int) and 0 <= current_correct_answer < len(current_options):
                        option_text = get_option_text(current_options[current_correct_answer])
                        answer_detail['correct_answer'] = f"'{option_text}' (Index: {current_correct_answer})"
                    elif q_type == 'multiple' and isinstance(current_correct_answer, list):
                        formatted_correct = [
                            f"'{get_option_text(current_options[idx])}' (Index: {idx})"
                            for idx in current_correct_answer
                            if 0 <= idx < len(current_options)
                        ]
                        answer_detail['correct_answer'] = formatted_correct
                    elif q_type == 'open':
                        # For open questions, keep existing or use keywords/acceptable
                        if 'acceptable' in current_question:
                            answer_detail['correct_answer'] = current_question['acceptable']
                        elif 'keywords' in current_question:
                            answer_detail['correct_answer'] = {"keywords": current_question['keywords']}
                        # else keep existing formatted answer

                    # Calculate score
                    question_score = 0.0

                    if q_type == 'open':
                        # Keep existing score for open questions
                        question_score = answer_detail.get('points_awarded', 0)
                    elif q_type == 'single':
                        # Extract student's original index from formatted answer
                        student_original_index = None

                        if has_option_order and 'option_order' in answer_detail:
                            # Use option_order if available
                            raw_student_answer = answer_detail.get('raw_student_answer')
                            option_order = answer_detail.get('option_order', [])
                            if isinstance(raw_student_answer, int) and raw_student_answer < len(option_order):
                                student_original_index = option_order[raw_student_answer]
                        else:
                            # Parse from formatted student_answer
                            formatted_answer = answer_detail.get('student_answer', '')
                            student_original_index = extract_indices_from_formatted_answer(formatted_answer)

                        if student_original_index is not None and student_original_index == current_correct_answer:
                            question_score = weight

                    elif q_type == 'multiple':
                        current_correct_indices = current_correct_answer if isinstance(current_correct_answer, list) else []
                        student_original_indices = None

                        if has_option_order and 'option_order' in answer_detail:
                            # Use option_order if available
                            raw_student_answer = answer_detail.get('raw_student_answer')
                            option_order = answer_detail.get('option_order', [])
                            if isinstance(raw_student_answer, list):
                                student_original_indices = []
                                for shuffled_idx in raw_student_answer:
                                    if isinstance(shuffled_idx, int) and shuffled_idx < len(option_order):
                                        student_original_indices.append(option_order[shuffled_idx])
                        else:
                            # Parse from formatted student_answer
                            formatted_answer = answer_detail.get('student_answer', [])
                            student_original_indices = extract_indices_from_formatted_answer(formatted_answer)

                        if student_original_indices is not None:
                            num_options = len(current_question.get('options', []))
                            num_correct_total = len(current_correct_indices)
                            num_user_correct = len([idx for idx in student_original_indices if idx in current_correct_indices])
                            num_user_wrong = len([idx for idx in student_original_indices if idx not in current_correct_indices])

                            if num_correct_total > 0:
                                points_per_correct = weight / num_correct_total
                                points_per_wrong = weight / (num_options - num_correct_total) if (num_options - num_correct_total) > 0 else weight
                                calculated_score = (num_user_correct * points_per_correct) - (num_user_wrong * points_per_wrong)
                                question_score = max(0.0, calculated_score)

                    # Update both score fields
                    answer_detail['points_awarded'] = round(question_score, 2)
                    answer_detail['raw_points'] = round(question_score, 2)
                    total_score += question_score

                # Update totals
                old_score = score_entry.get('raw_points', 0)
                new_score = round(total_score, 2)
                new_percent = round(total_score / max_score * 100, 2) if max_score > 0 else 0

                score_entry['raw_points'] = new_score
                score_entry['max_points'] = max_score
                score_entry['percent'] = new_percent

                # Add quiz_title if not present
                if 'quiz_title' not in score_entry and quiz_title:
                    score_entry['quiz_title'] = quiz_title

                if abs(old_score - new_score) > 0.01:
                    recalculated_count += 1
                    print(f"Recalculated score for {student_id}: {old_score} -> {new_score}")
                else:
                    print(f"No change for {student_id}: score remains {old_score}")

            except Exception as e:
                errors.append(f"Student {score_entry.get('student', 'unknown')}: {str(e)}")
                print(f"Error processing {score_entry.get('student')}: {e}")
                import traceback
                traceback.print_exc()
                continue

        # Save updated scores (always save, as individual question scores may have changed)
        save_scores(scores)

        result_message = f"Recalculated {recalculated_count} out of {len(scores)} submissions"
        if recalculated_count < len(scores):
            result_message += f" ({len(scores) - recalculated_count} had no total score change)"
        result_message += "."
        if errors:
            result_message += f" Encountered {len(errors)} errors."

        return jsonify({
            "success": True,
            "message": result_message,
            "updated_count": recalculated_count,
            "total_count": len(scores),
            "errors": errors[:10]
        })

    except Exception as e:
        print(f"Error during score recalculation: {e}")
        import traceback
        traceback.print_exc()
        abort(500, description=f"Failed to recalculate scores: {str(e)}")

@admin_bp.route('/admin/scores/clear', methods=['POST'])
def api_clear_scores():
    """Clears all scores after creating a temporary backup."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    try:
        from utils import clear_scores_with_backup
        result = clear_scores_with_backup()
        return jsonify(result)
    except InternalServerError as e:
        abort(500, description=e.description)
    except Exception as e:
        print(f"Error clearing scores: {e}")
        abort(500, description=f"Failed to clear scores: {str(e)}")

@admin_bp.route('/admin/scores/restore', methods=['POST'])
def api_restore_scores():
    """Restores scores from the temporary backup file."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    try:
        from utils import restore_scores_from_backup
        result = restore_scores_from_backup()
        return jsonify(result)
    except NotFound as e:
        abort(404, description=e.description)
    except BadRequest as e:
        abort(400, description=e.description)
    except InternalServerError as e:
        abort(500, description=e.description)
    except Exception as e:
        print(f"Error restoring scores: {e}")
        abort(500, description=f"Failed to restore scores: {str(e)}")

# --- Email Endpoints ---

@admin_bp.route('/admin/email/send-result', methods=['POST'])
def api_send_single_result_email():
    """Send quiz result email to a single student."""
    print("=== Single Email Endpoint Called ===")
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')

    if not auth_pw or auth_pw != ADMIN_PW:
        print("Authentication failed")
        abort(403, description="Admin authentication failed.")

    student_email = data.get('student_email')
    quiz_id = data.get('quiz_id')
    subject = data.get('subject')  # Optional custom subject
    include_details = data.get('include_details', True)  # Default to True

    print(f"Attempting to send email to: {student_email} for quiz: {quiz_id}")
    if subject:
        print(f"Custom subject: {subject}")
    print(f"Include details: {include_details}")

    if not student_email or not quiz_id:
        print("Missing required parameters")
        abort(400, description="Missing student_email or quiz_id.")

    try:
        # Load scores and find the specific submission
        scores = load_scores()
        print(f"Loaded {len(scores)} score entries")
        submission = None

        for score_entry in scores:
            if score_entry.get('student') == student_email and score_entry.get('quiz_id') == quiz_id:
                submission = score_entry
                print(f"Found submission for {student_email}")
                break

        if not submission:
            print(f"No submission found for {student_email} with quiz_id {quiz_id}")
            abort(404, description=f"No submission found for {student_email} with quiz_id {quiz_id}")

        # Send email with optional custom subject and include_details
        print(f"Calling send_quiz_result_email for {student_email}")
        success, message = send_quiz_result_email(student_email, submission, subject, include_details)

        if success:
            print(f"Email sent successfully: {message}")
            return jsonify({"success": True, "message": message})
        else:
            print(f"Email failed: {message}")
            abort(500, description=message)

    except Exception as e:
        print(f"Error sending email: {e}")
        import traceback
        traceback.print_exc()
        abort(500, description=f"Failed to send email: {str(e)}")

@admin_bp.route('/admin/email/send-all-results', methods=['POST'])
def api_send_all_results_email():
    """Send quiz result emails to all students."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    subject = data.get('subject')  # Optional custom subject
    include_details = data.get('include_details', True)  # Default to True

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    try:
        # Load all scores
        scores = load_scores()

        # Filter to only valid email addresses
        valid_submissions = [
            s for s in scores
            if is_valid_email(s.get('student', ''))
        ]

        if not valid_submissions:
            return jsonify({
                "success": True,
                "message": "No valid email addresses found in submissions.",
                "success_count": 0,
                "failed_count": 0,
                "errors": []
            })

        # Send emails with optional custom subject and include_details
        results = send_bulk_quiz_results(valid_submissions, subject, include_details)

        return jsonify({
            "success": True,
            "message": f"Sent {results['success_count']} emails, {results['failed_count']} failed.",
            "success_count": results['success_count'],
            "failed_count": results['failed_count'],
            "errors": results['errors'][:10]  # Limit error list
        })

    except Exception as e:
        print(f"Error sending bulk emails: {e}")
        import traceback
        traceback.print_exc()
        abort(500, description=f"Failed to send bulk emails: {str(e)}")

@admin_bp.route('/admin/students', methods=['GET'])
def api_get_students():
    """Get the current students list."""
    data = request.args if request.method == 'GET' else request.get_json(silent=True) or {}
    auth_pw = data.get('pw') if isinstance(data, dict) else request.headers.get('X-Admin-Password')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    try:
        from utils import STUDENTS_FILE
        import commentjson

        students_path = Path(STUDENTS_FILE)
        if not students_path.exists():
            return jsonify([])

        with students_path.open(encoding='utf-8') as f:
            students = commentjson.load(f)

        return jsonify(students)
    except Exception as e:
        print(f"Error loading students: {e}")
        abort(500, description=f"Failed to load students: {str(e)}")

@admin_bp.route('/admin/students', methods=['PUT'])
def api_update_students():
    """Update the students list with validation."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    students_data = data.get('students')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    if students_data is None:
        abort(400, description="Missing 'students' field in request body.")

    # Validate students data
    if not isinstance(students_data, list):
        abort(400, description="Students data must be an array.")

    # Validate each student entry
    for idx, student in enumerate(students_data):
        if isinstance(student, str):
            # Simple email string format (backward compatible)
            if not is_valid_email(student):
                abort(400, description=f"Invalid email format at index {idx}: {student}")
        elif isinstance(student, dict):
            # Check if it's a group entry with emails array
            if 'emails' in student:
                # Group format: { "group": "...", "emails": [...] }
                if 'group' not in student:
                    abort(400, description=f"Missing 'group' field for emails array at index {idx}.")
                if not isinstance(student['group'], str):
                    abort(400, description=f"Group must be a string at index {idx}.")
                if not isinstance(student['emails'], list):
                    abort(400, description=f"Emails must be an array at index {idx}.")
                # Validate each email in the array
                for email_idx, email in enumerate(student['emails']):
                    if not isinstance(email, str):
                        abort(400, description=f"Email at index {idx}, position {email_idx} must be a string.")
                    if not is_valid_email(email):
                        abort(400, description=f"Invalid email format at index {idx}, position {email_idx}: {email}")
            elif 'email' in student:
                # Single student format: { "email": "...", "group": "..." }
                if not is_valid_email(student['email']):
                    abort(400, description=f"Invalid email format at index {idx}: {student['email']}")
                # Group is optional but must be string if present
                if 'group' in student and not isinstance(student['group'], str):
                    abort(400, description=f"Group must be a string at index {idx}.")
            else:
                abort(400, description=f"Invalid student entry at index {idx}. Must have 'email' or 'emails' field.")
        else:
            abort(400, description=f"Invalid student entry at index {idx}. Must be string or object.")

    try:
        from utils import STUDENTS_FILE
        import commentjson

        students_path = Path(STUDENTS_FILE)

        # Create backup before saving
        if students_path.exists():
            backup_path = students_path.with_suffix('.jsonc.bak')
            import shutil
            shutil.copy2(students_path, backup_path)

        # Save the new students list
        with students_path.open('w', encoding='utf-8') as f:
            commentjson.dump(students_data, f, indent=2, ensure_ascii=False)

        return jsonify({"success": True, "message": "Students list updated successfully."})

    except Exception as e:
        print(f"Error saving students: {e}")
        abort(500, description=f"Failed to save students: {str(e)}")


# --- Students Bank Endpoints ---

@admin_bp.route('/admin/students-bank/files', methods=['POST'])
def api_list_students_bank_files():
    """Lists available students files (jsonc) in the students_bank folder."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    try:
        available_files = list_students_bank_files()
        return jsonify({"files": available_files})
    except Exception as e:
        print(f"Error listing students bank files: {e}")
        abort(500, description=f"Failed to list students bank files: {str(e)}")

@admin_bp.route('/admin/students-bank/load', methods=['POST'])
def api_load_students_from_bank():
    """Loads a specified students file from the students_bank into STUDENTS_FILE."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    if not filename:
        abort(400, description="Missing 'filename' in request body.")

    try:
        load_students_from_bank(filename)
        return jsonify({"success": True, "message": f"Loaded '{filename}' from students bank."})
    except (NotFound, BadRequest, InternalServerError) as e:
        abort(e.code, description=e.description)
    except Exception as e:
        print(f"Unexpected error loading students from bank: {e}")
        abort(500, description=f"Unexpected error: {str(e)}")

@admin_bp.route('/admin/students-bank/save', methods=['POST'])
def api_save_students_to_bank():
    """Saves the current STUDENTS_FILE to the students_bank with the provided filename."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    if not filename:
        abort(400, description="Missing 'filename' in request body.")

    try:
        save_students_to_bank(filename)
        return jsonify({"success": True, "message": f"Saved current students list to '{filename}' in students bank."})
    except (Conflict, BadRequest, InternalServerError) as e:
        abort(e.code, description=e.description)
    except Exception as e:
        print(f"Unexpected error saving students to bank: {e}")
        abort(500, description=f"Unexpected error: {str(e)}")

@admin_bp.route('/admin/students-bank/preview', methods=['POST'])
def api_preview_students_bank_file():
    """Reads and returns the JSON content of a specified file in the students_bank for preview."""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')
    filename = data.get('filename')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    if not filename:
        abort(400, description="Missing 'filename' in request body.")

    try:
        from utils import STUDENTS_BANK_FOLDER
        import commentjson as json

        file_path = Path(STUDENTS_BANK_FOLDER) / filename
        if not file_path.exists() or not file_path.is_file():
            abort(404, description=f"File '{filename}' not found in students bank.")

        with file_path.open(encoding='utf-8') as f:
            students_data = json.load(f)

        return jsonify({"students": students_data, "filename": filename})

    except json.JSONLibraryException:
        abort(400, description=f"File '{filename}' is not a valid JSONC format.")
    except Exception as e:
        print(f"Error previewing students bank file: {e}")
        abort(500, description=f"Failed to preview file: {str(e)}")


# ===========================
# Quiz Status Endpoints
# ===========================

@admin_bp.route('/admin/quiz-status', methods=['GET'])
def api_get_quiz_status():
    """Get the current quiz enabled/disabled status (public endpoint, no auth required)"""
    try:
        status = load_quiz_status()
        return jsonify(status)
    except Exception as e:
        print(f"Error getting quiz status: {e}")
        abort(500, description=f"Failed to get quiz status: {str(e)}")


@admin_bp.route('/admin/quiz-status', methods=['POST'])
def api_set_quiz_status():
    """Set the quiz enabled/disabled status (requires admin authentication)"""
    data = request.get_json(silent=True) or {}
    auth_pw = data.get('pw')

    if not auth_pw or auth_pw != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    enabled = data.get('enabled')
    if enabled is None:
        abort(400, description="Missing 'enabled' field in request body.")

    if not isinstance(enabled, bool):
        abort(400, description="'enabled' field must be a boolean.")

    try:
        status = {"enabled": enabled}
        save_quiz_status(status)
        return jsonify({"success": True, "message": f"Quiz {'enabled' if enabled else 'disabled'} successfully.", "status": status})
    except (BadRequest, InternalServerError) as e:
        abort(e.code if hasattr(e, 'code') else 500, description=e.description if hasattr(e, 'description') else str(e))
    except Exception as e:
        print(f"Error setting quiz status: {e}")
        abort(500, description=f"Failed to set quiz status: {str(e)}")


# ===========================
# Git Sync Endpoints
# ===========================

@admin_bp.route('/admin/git-sync/status', methods=['POST'])
def api_git_sync_status():
    """Get Git sync configuration and status"""
    print("\n[API] Git sync status request received")
    password = request.json.get('password')
    if password != ADMIN_PW:
        print("[API] Git sync status: Authentication failed")
        abort(403, description="Admin authentication failed.")

    try:
        from git_sync import get_sync_status
        status = get_sync_status()
        print(f"[API] Git sync status response: {status}")
        return jsonify(status)
    except Exception as e:
        print(f"[API] Error getting Git sync status: {e}")
        import traceback
        traceback.print_exc()
        abort(500, description=f"Failed to get sync status: {str(e)}")


@admin_bp.route('/admin/git-sync/init', methods=['POST'])
def api_git_sync_init():
    """Initialize Git repository in banks directory"""
    password = request.json.get('password')
    if password != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    try:
        from git_sync import init_git_repo
        result = init_git_repo()
        if result['success']:
            return jsonify(result)
        else:
            abort(400, description=result['message'])
    except Exception as e:
        print(f"Error initializing Git sync: {e}")
        abort(500, description=f"Failed to initialize: {str(e)}")


@admin_bp.route('/admin/git-sync/sync', methods=['POST'])
def api_git_sync():
    """Sync banks with remote Git repository"""
    print("\n[API] Git sync request received")
    password = request.json.get('password')
    if password != ADMIN_PW:
        print("[API] Git sync: Authentication failed")
        abort(403, description="Admin authentication failed.")

    pull_first = request.json.get('pull_first', True)
    print(f"[API] Starting sync (pull_first={pull_first})")

    try:
        from git_sync import sync_banks
        result = sync_banks(pull_first=pull_first)
        print(f"[API] Sync result: {result}")
        if result['success']:
            return jsonify(result)
        else:
            print(f"[API] Sync failed: {result['message']}")
            abort(400, description=result['message'])
    except Exception as e:
        print(f"[API] Error syncing banks: {e}")
        import traceback
        traceback.print_exc()
        abort(500, description=f"Failed to sync: {str(e)}")


# --- Image Management Endpoints ---

@admin_bp.route('/admin/images/upload', methods=['POST'])
def api_upload_image():
    """Upload an image for a specific quiz"""
    password = request.form.get('password')
    if password != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    quiz_filename = request.form.get('quiz_filename')
    if not quiz_filename:
        abort(400, description="quiz_filename is required")

    if 'image' not in request.files:
        abort(400, description="No image file provided")

    image_file = request.files['image']
    if image_file.filename == '':
        abort(400, description="No image file selected")

    try:
        from utils import upload_image_to_quiz
        result = upload_image_to_quiz(quiz_filename, image_file, image_file.filename)
        return jsonify(result)
    except Conflict as e:
        abort(409, description=str(e))
    except Exception as e:
        print(f"Error uploading image: {e}")
        abort(500, description=f"Error uploading image: {str(e)}")


@admin_bp.route('/admin/images/list/<path:quiz_filename>', methods=['GET'])
def api_list_quiz_images(quiz_filename):
    """List all images for a specific quiz"""
    password = request.args.get('password')
    if password != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    try:
        from utils import list_quiz_images
        images = list_quiz_images(quiz_filename)
        return jsonify({"images": images})
    except Exception as e:
        print(f"Error listing images: {e}")
        abort(500, description=f"Error listing images: {str(e)}")


@admin_bp.route('/admin/images/delete', methods=['DELETE'])
def api_delete_quiz_image():
    """Delete an image from a quiz's images folder"""
    data = request.get_json(silent=True) or {}
    password = data.get('password')
    if password != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    quiz_filename = data.get('quiz_filename')
    image_filename = data.get('image_filename')

    if not quiz_filename or not image_filename:
        abort(400, description="quiz_filename and image_filename are required")

    try:
        from utils import delete_quiz_image
        result = delete_quiz_image(quiz_filename, image_filename)
        return jsonify(result)
    except NotFound as e:
        abort(404, description=str(e))
    except Exception as e:
        print(f"Error deleting image: {e}")
        abort(500, description=f"Error deleting image: {str(e)}")


@admin_bp.route('/admin/images/clear-active', methods=['POST'])
def api_clear_active_quiz_images():
    """Clear all images from the active quiz images folder"""
    data = request.get_json(silent=True) or {}
    password = data.get('password')
    if password != ADMIN_PW:
        abort(403, description="Admin authentication failed.")

    try:
        from utils import clear_active_quiz_images
        result = clear_active_quiz_images()
        return jsonify(result)
    except Exception as e:
        print(f"Error clearing active quiz images: {e}")
        abort(500, description=f"Error clearing images: {str(e)}")
