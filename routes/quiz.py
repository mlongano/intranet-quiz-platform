# routes/quiz.py
import commentjson as json
from flask import Blueprint, request, jsonify, abort
from werkzeug.exceptions import NotFound, InternalServerError
from pathlib import Path
import datetime
import uuid
import random
import tempfile
import os

# Import necessary functions and data from utils
from utils import (
    VALID_STUDENTS,
    QUIZ_FOLDER,
    format_image_url,
    load_scores,
    save_scores,
    load_questions,
    grade,
    load_quiz_plan_by_student,
    validate_submission_data,
    check_duplicate_submission,
    delete_plan_file_by_student,
    find_plan_by_quiz_id,
    format_detailed_answers,
    safe_id
)

quiz_bp = Blueprint('quiz', __name__, url_prefix='/api')

def build_quiz_plan(qbank):
    """Init the quiz_id and the quiz paln"""
    quiz_plan_steps = []
    for q in qbank:
        option_order = []
        if q['type'] != 'open':
            q_options = q.get('options', [])
            option_order = list(range(len(q_options)))
            random.shuffle(option_order)
            # --- Process options (string or object) ---
        quiz_plan_steps.append({"id": q['id'], "option_order": option_order})

    quiz_id = uuid.uuid4().hex[:12]
    return quiz_id, quiz_plan_steps

def build_questions(qbank):
    """Builds a list of questions from the given question bank."""
    quiz_plan_steps = []
    stripped_questions = []
    for q in qbank:
        option_order = []
        options_for_client = []
        if q['type'] != 'open':
            q_options = q.get('options', [])
            option_order = list(range(len(q_options)))
            random.shuffle(option_order)
            # --- Process options (string or object) ---
            for i in option_order:
                original_option = q_options[i]
                if isinstance(original_option, dict):
                    # Option is an object: format image path, keep text
                    options_for_client.append({
                        "text": original_option.get("text", ""),
                        "image": format_image_url(original_option.get("image"))
                    })
                else:
                    # Option is a simple string
                    options_for_client.append(str(original_option)) # Send as string
        quiz_plan_steps.append({"id": q['id'], "option_order": option_order})
        stripped_questions.append({
            "id": q['id'],
            "type": q['type'],
            "weight": q.get('weight', 1),
            "text": q['text'],
            "question_image": format_image_url(q.get('question_image')), # <-- Add formatted question image URL
            "options": options_for_client # <-- Send processed options
        })

    quiz_id = uuid.uuid4().hex[:12]
    return quiz_id, stripped_questions, quiz_plan_steps

@quiz_bp.route('/start', methods=['POST'])
def api_start():
    print('Starting quiz...')
    data = request.get_json(force=True, silent=True) or {}
    student = data.get('name', '').strip()[:60].lower()
    if not student:
        abort(400, 'missing name')

    if VALID_STUDENTS and student not in VALID_STUDENTS: # Check if VALID_STUDENTS is populated
        return jsonify(error="Unknown student"), 403

    scores = load_scores()
    if any(rec.get('student') == student for rec in scores):
        return jsonify(error="You have already completed the quiz"), 409

    student_plan_path = Path(QUIZ_FOLDER) / f'{safe_id(student)}.json'
    if student_plan_path.exists():
        try:
            with student_plan_path.open(encoding='utf-8') as f:
                meta = json.load(f)
            if meta.get('student') == student:
                return jsonify(error="Quiz already started", quiz_id=meta.get('quiz_id')), 409
            else:
                print(f"Warning: Plan file {student_plan_path} exists but contains wrong student ID.")
        except Exception as e:
            print(f"Error reading existing plan {student_plan_path}: {e}")

    # --- Create new quiz ---
    quiz_data = load_questions() # Can raise InternalServerError
    qbank = quiz_data['questions']
    quiz_title = quiz_data.get('title')
    random.shuffle(qbank)
    quiz_id, quiz_plan_steps = build_quiz_plan(qbank)

    output_plan_path = Path(QUIZ_FOLDER) / f'{safe_id(student)}.json'
    meta = {
        "quiz_id": quiz_id,
        "student": student,
        "quiz_title": quiz_title,  # Store the quiz title
        "created": datetime.datetime.utcnow().isoformat(timespec='seconds'),
        "plan": quiz_plan_steps
    }

    # Write atomically to prevent partial writes during concurrent access
    try:
        temp_fd, temp_path = tempfile.mkstemp(dir=QUIZ_FOLDER, suffix='.tmp')
        try:
            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                json.dump(meta, f, indent=2)
            os.replace(temp_path, str(output_plan_path))  # Atomic on POSIX
        except Exception as e:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise e
    except Exception as e:
        raise InternalServerError(description=f"Could not save quiz plan file: {e}")
    return jsonify({"quiz_id": quiz_id})

@quiz_bp.route('/submit', methods=['POST'])
def api_submit():
    """Handles submission, grades, saves detailed score, and deletes plan."""
    data = request.get_json(silent=True) or {}
    quiz_id, student_id, answers = validate_submission_data(data)
    plan = load_quiz_plan_by_student(student_id) # Handles NotFound, InternalServerError
    quiz_data = load_questions() # Handles InternalServerError
    qbank = quiz_data['questions']
    quiz_title = quiz_data.get('title')
    scores = load_scores()
    check_duplicate_submission(student_id, scores) # Handles Conflict

    qbank_map = {q['id']: q for q in qbank}
    calc_results = grade(answers, plan, qbank)

    detailed_answers = format_detailed_answers(
        plan, qbank_map, answers, calc_results.get('scores_per_question', [])
    )

    scores.append({
        'student':    student_id,
        'quiz_id':    quiz_id,
        'quiz_title': quiz_title,  # Add quiz title to score record
        'answers':    detailed_answers,
        'raw_points': calc_results['raw_points'],
        'max_points': calc_results['max_points'],
        'percent': calc_results['percent'],
        'timestamp':  datetime.datetime.utcnow().isoformat(timespec='seconds')
    })
    save_scores(scores)
    delete_plan_file_by_student(student_id)

    return jsonify({
         'raw_points': calc_results['raw_points'],
         'max_points': calc_results['max_points'],
         'percent': calc_results['percent'],
    })

@quiz_bp.route('/resume/<quiz_id>')
def api_resume(quiz_id):
    """Resumes a quiz by finding the plan file containing the quiz_id."""
    if not quiz_id or len(quiz_id) != 12:
        abort(400, description="Invalid quiz ID format.")

    quiz_folder_path = Path(QUIZ_FOLDER)
    if not quiz_folder_path.is_dir():
        raise InternalServerError(description="Quiz directory not found.")

    print(f"Resume attempt for quiz_id: {quiz_id}. Searching in {quiz_folder_path}...")
    plan, found_student_id, _ = find_plan_by_quiz_id(quiz_id, quiz_folder_path)

    if plan is None:
        raise NotFound(description=f"Could not find active quiz plan matching ID '{quiz_id}'")
    if not found_student_id:
        raise InternalServerError(description=f"Plan file for quiz '{quiz_id}' is missing student identifier.")

    quiz_data = load_questions() # Can raise InternalServerError
    qbank = quiz_data['questions']

    qbank_map = {q['id']: q for q in qbank}
    stripped = []
    for step in plan.get('plan', []):
        q_id = step.get('id')
        if not q_id or q_id not in qbank_map:
            print(f"Warning: Question ID '{q_id}' during resume not found in bank.")
            continue
        q = qbank_map[q_id]
        q_options = q.get('options', [])
        step_option_order = step.get('option_order', [])

        options_for_client = []
        if q['type'] != 'open':
            q_options = q.get('options', [])
            # --- Process options (string or object) ---
            for i in step_option_order:
                original_option = q_options[i]
                if isinstance(original_option, dict):
                    # Option is an object: format image path, keep text
                    options_for_client.append({
                        "text": original_option.get("text", ""),
                        "image": original_option.get("image")
                    })
                else:
                    # Option is a simple string
                    options_for_client.append(str(original_option)) # Send as string

        stripped.append({
            "id": q['id'],
            "type": q['type'],
            "weight": q.get('weight', 1),
            "text": q['text'],
            "question_image": q.get('question_image'),
            "options": options_for_client # <-- Send processed options
        })

    return jsonify({
        "quiz_id": quiz_id,
        "student": found_student_id,
        "questions": stripped
    })
