# routes/quiz.py
import commentjson as json
from flask import Blueprint, request, jsonify, abort
from werkzeug.exceptions import NotFound, InternalServerError, HTTPException, BadRequest
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
    append_score_atomic,
    load_questions,
    load_quiz_status,
    grade,
    load_quiz_plan_by_student,
    validate_submission_data,
    delete_plan_file_by_student,
    find_plan_by_quiz_id,
    format_detailed_answers,
    safe_id,
)

quiz_bp = Blueprint("quiz", __name__, url_prefix="/api")


@quiz_bp.route("/quiz-info", methods=["GET"])
def api_quiz_info():
    """Public endpoint to get basic quiz information (title only)"""
    try:
        quiz_data = load_questions()
        return jsonify(
            {
                "title": quiz_data.get("title", "Quiz"),
                "question_count": len(quiz_data.get("questions", [])),
            }
        )
    except Exception as e:
        print(f"Error loading quiz info: {e}")
        return jsonify({"title": "Quiz", "question_count": 0})


def build_quiz_plan(qbank):
    """Init the quiz_id and the quiz paln"""
    quiz_plan_steps = []
    for q in qbank:
        option_order = []
        if q["type"] != "open":
            q_options = q.get("options", [])
            option_order = list(range(len(q_options)))
            random.shuffle(option_order)
            # --- Process options (string or object) ---
        quiz_plan_steps.append({"id": q["id"], "option_order": option_order})

    quiz_id = uuid.uuid4().hex[:12]
    return quiz_id, quiz_plan_steps


def build_questions(qbank):
    """Builds a list of questions from the given question bank."""
    quiz_plan_steps = []
    stripped_questions = []
    for q in qbank:
        option_order = []
        options_for_client = []
        if q["type"] != "open":
            q_options = q.get("options", [])
            option_order = list(range(len(q_options)))
            random.shuffle(option_order)
            # --- Process options (string or object) ---
            for i in option_order:
                # Defensive: skip indices that are out of range (could happen if bank changed)
                if i is None or not isinstance(i, int) or i < 0 or i >= len(q_options):
                    print(
                        f"Warning: option index {i} out of range for question {q.get('id')}, skipping."
                    )
                    continue
                original_option = q_options[i]
                if isinstance(original_option, dict):
                    # Option is an object: format image path, keep text
                    options_for_client.append(
                        {
                            "text": original_option.get("text", ""),
                            "image": format_image_url(original_option.get("image")),
                        }
                    )
                else:
                    # Option is a simple string
                    options_for_client.append(str(original_option))  # Send as string
        quiz_plan_steps.append({"id": q["id"], "option_order": option_order})
        stripped_questions.append(
            {
                "id": q["id"],
                "type": q["type"],
                "weight": q.get("weight", 1),
                "text": q["text"],
                "question_image": format_image_url(
                    q.get("question_image")
                ),  # <-- Add formatted question image URL
                "options": options_for_client,  # <-- Send processed options
            }
        )

    quiz_id = uuid.uuid4().hex[:12]
    return quiz_id, stripped_questions, quiz_plan_steps


@quiz_bp.route("/start", methods=["POST"])
def api_start():
    print("Starting quiz...")
    data = request.get_json(force=True, silent=True) or {}
    student = data.get("name", "").strip()[:60].lower()
    if not student:
        abort(400, "missing name")

    # Check if quiz is enabled
    try:
        quiz_status = load_quiz_status()
        if not quiz_status.get("enabled", True):
            return jsonify(error="Quiz is currently disabled by the administrator"), 403
    except Exception as e:
        print(f"Error checking quiz status: {e}")
        # If we can't read status, allow quiz to proceed (fail-open)
        pass

    if (
        VALID_STUDENTS and student not in VALID_STUDENTS
    ):  # Check if VALID_STUDENTS is populated
        return jsonify(error="Email non riconosciuta"), 403

    scores = load_scores()
    if any(rec.get("student") == student for rec in scores):
        return jsonify(error="Hai già completato il quiz"), 409

    student_plan_path = Path(QUIZ_FOLDER) / f"{safe_id(student)}.json"
    if student_plan_path.exists():
        try:
            with student_plan_path.open(encoding="utf-8") as f:
                meta = json.load(f)
            if meta.get("student") == student:
                return jsonify(
                    error="Quiz already started", quiz_id=meta.get("quiz_id")
                ), 409
            else:
                print(
                    f"Warning: Plan file {student_plan_path} exists but contains wrong student ID."
                )
        except Exception as e:
            print(f"Error reading existing plan {student_plan_path}: {e}")

    # --- Create new quiz ---
    try:
        quiz_data = (
            load_questions()
        )  # Can raise NotFound/BadRequest/InternalServerError
        qbank = quiz_data["questions"]
    except HTTPException as e:
        # Known HTTP errors: return JSON with proper status code
        print(f"Error loading questions for start: {e}")
        return jsonify(error=str(e.description)), e.code
    except Exception as e:
        # Unexpected errors
        print(f"Unexpected error loading questions for start: {e}")
        return jsonify(error="Internal server error while loading quiz data"), 500
    quiz_title = quiz_data.get("title")
    random.shuffle(qbank)
    quiz_id, quiz_plan_steps = build_quiz_plan(qbank)

    output_plan_path = Path(QUIZ_FOLDER) / f"{safe_id(student)}.json"
    meta = {
        "quiz_id": quiz_id,
        "student": student,
        "quiz_title": quiz_title,  # Store the quiz title
        "created": datetime.datetime.now(datetime.timezone.utc).isoformat(
            timespec="seconds"
        ),
        "plan": quiz_plan_steps,
    }

    # Write atomically to prevent partial writes during concurrent access
    try:
        temp_fd, temp_path = tempfile.mkstemp(dir=QUIZ_FOLDER, suffix=".tmp")
        try:
            with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)
            os.replace(temp_path, str(output_plan_path))  # Atomic on POSIX
        except Exception as e:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise e
    except Exception as e:
        raise InternalServerError(description=f"Could not save quiz plan file: {e}")
    return jsonify({"quiz_id": quiz_id})


@quiz_bp.route("/save-answer", methods=["POST"])
def api_save_answer():
    """
    Saves a single answer for the current question and advances progression.
    Security: Only allows forward progression, answers are immutable once saved.
    """
    data = request.get_json(silent=True) or {}
    quiz_id = data.get("quiz_id", "").strip()
    answer = data.get("answer")

    if not quiz_id or len(quiz_id) != 12:
        abort(400, description="Invalid quiz ID format.")

    if answer is None:
        abort(400, description="Missing answer.")

    # Find and load the plan file
    quiz_folder_path = Path(QUIZ_FOLDER)
    plan, student_id, plan_file_path = find_plan_by_quiz_id(quiz_id, quiz_folder_path)

    if plan is None or not student_id or not plan_file_path:
        raise NotFound(
            description=f"Could not find active quiz plan matching ID '{quiz_id}'"
        )

    # Initialize progression if not present
    if "progression" not in plan:
        plan["progression"] = {
            "current_index": 0,
            "answers": {},
            "last_updated": datetime.datetime.now(datetime.timezone.utc).isoformat(
                timespec="seconds"
            ),
        }

    progression = plan["progression"]
    current_index = progression.get("current_index", 0)
    answers = progression.get("answers", {})
    total_questions = len(plan.get("plan", []))

    # Security check: prevent going back or skipping questions
    if current_index >= total_questions:
        return jsonify(error="Quiz already completed"), 400

    # Security check: prevent overwriting existing answers
    answer_key = str(current_index)
    if answer_key in answers:
        return jsonify(error="Answer already submitted for this question"), 400

    # Save the answer immutably
    answers[answer_key] = answer
    progression["answers"] = answers
    progression["current_index"] = current_index + 1
    progression["last_updated"] = datetime.datetime.now(
        datetime.timezone.utc
    ).isoformat(timespec="seconds")

    # Write updated plan atomically
    try:
        temp_fd, temp_path = tempfile.mkstemp(dir=QUIZ_FOLDER, suffix=".tmp")
        try:
            with os.fdopen(temp_fd, "w", encoding="utf-8") as f:
                json.dump(plan, f, indent=2)
            os.replace(temp_path, str(plan_file_path))
        except Exception as e:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise e
    except Exception as e:
        raise InternalServerError(description=f"Could not save progression: {e}")

    # Return progression status
    is_complete = progression["current_index"] >= total_questions
    return jsonify(
        {
            "success": True,
            "current_index": progression["current_index"],
            "total_questions": total_questions,
            "is_complete": is_complete,
        }
    )


@quiz_bp.route("/submit", methods=["POST"])
def api_submit():
    """
    Handles submission, grades, saves detailed score, and deletes plan.
    Uses answers from server-side progression instead of client submission.
    """
    data = request.get_json(silent=True) or {}
    quiz_id = data.get("quiz_id", "").strip()

    if not quiz_id or len(quiz_id) != 12:
        abort(400, description="Invalid quiz ID format.")

    # Find and load the plan file
    quiz_folder_path = Path(QUIZ_FOLDER)
    plan, student_id, _ = find_plan_by_quiz_id(quiz_id, quiz_folder_path)

    if plan is None or not student_id:
        raise NotFound(
            description=f"Could not find active quiz plan matching ID '{quiz_id}'"
        )

    # Ensure progression exists
    if "progression" not in plan:
        return jsonify(
            error="No progression data found. Please answer questions first."
        ), 400

    progression = plan["progression"]
    total_questions = len(plan.get("plan", []))

    # Validate that all questions have been answered
    if progression.get("current_index", 0) < total_questions:
        return jsonify(
            error=f"Quiz not complete. Answered {progression.get('current_index', 0)} of {total_questions} questions."
        ), 400

    # Get answers from server-side progression (convert string keys to int)
    server_answers = progression.get("answers", {})
    answers = [server_answers.get(str(i)) for i in range(total_questions)]

    try:
        quiz_data = load_questions()  # Handles InternalServerError
    except HTTPException as e:
        print(f"Error preparing submission handling: {e}")
        return jsonify(error=str(e.description)), e.code
    except Exception as e:
        print(f"Unexpected error preparing submission handling: {e}")
        return jsonify(error="Internal server error"), 500

    qbank = quiz_data["questions"]
    quiz_title = quiz_data.get("title")

    qbank_map = {q["id"]: q for q in qbank}
    calc_results = grade(answers, plan, qbank)

    detailed_answers = format_detailed_answers(
        plan,
        qbank_map,
        answers,
        calc_results.get("scores_per_question", []),
        calc_results.get("feedbacks_per_question", []),
        calc_results.get("verdicts_per_question", []),
    )

    # Build the score entry
    score_entry = {
        "student": student_id,
        "quiz_id": quiz_id,
        "quiz_title": quiz_title,  # Add quiz title to score record
        "answers": detailed_answers,
        "raw_points": calc_results["raw_points"],
        "max_points": calc_results["max_points"],
        "percent": calc_results["percent"],
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(
            timespec="seconds"
        ),
    }

    # Atomically append the score (includes duplicate check within lock)
    # This prevents race conditions where concurrent submissions could overwrite each other
    append_score_atomic(score_entry)

    # Only delete plan file after successful score save
    delete_plan_file_by_student(student_id)

    return jsonify(
        {
            "raw_points": calc_results["raw_points"],
            "max_points": calc_results["max_points"],
            "percent": calc_results["percent"],
        }
    )


@quiz_bp.route("/resume/<quiz_id>")
def api_resume(quiz_id):
    """
    Resumes a quiz by finding the plan file containing the quiz_id.
    Returns only the current question based on server-side progression.
    Security: Client cannot see future questions or manipulate progression.
    """
    if not quiz_id or len(quiz_id) != 12:
        abort(400, description="Invalid quiz ID format.")

    quiz_folder_path = Path(QUIZ_FOLDER)
    if not quiz_folder_path.is_dir():
        raise InternalServerError(description="Quiz directory not found.")

    print(f"Resume attempt for quiz_id: {quiz_id}. Searching in {quiz_folder_path}...")
    plan, found_student_id, _ = find_plan_by_quiz_id(quiz_id, quiz_folder_path)

    if plan is None:
        raise NotFound(
            description=f"Could not find active quiz plan matching ID '{quiz_id}'"
        )
    if not found_student_id:
        raise InternalServerError(
            description=f"Plan file for quiz '{quiz_id}' is missing student identifier."
        )

    # Initialize progression if not present (for backward compatibility)
    if "progression" not in plan:
        plan["progression"] = {
            "current_index": 0,
            "answers": {},
            "last_updated": datetime.datetime.now(datetime.timezone.utc).isoformat(
                timespec="seconds"
            ),
        }

    try:
        quiz_data = load_questions()  # Can raise InternalServerError
        qbank = quiz_data["questions"]
    except HTTPException as e:
        print(f"Error loading questions for resume: {e}")
        return jsonify(error=str(e.description)), e.code
    except Exception as e:
        print(f"Unexpected error loading questions for resume: {e}")
        return jsonify(error="Internal server error while loading quiz data"), 500

    qbank_map = {q["id"]: q for q in qbank}
    progression = plan["progression"]
    current_index = progression.get("current_index", 0)
    quiz_plan = plan.get("plan", [])
    total_questions = len(quiz_plan)

    # Check if quiz is complete
    if current_index >= total_questions:
        return jsonify(
            {
                "quiz_id": quiz_id,
                "student": found_student_id,
                "is_complete": True,
                "current_index": current_index,
                "total_questions": total_questions,
                "message": "Quiz already completed. Please submit if not already done.",
            }
        )

    # Get only the current question
    current_step = quiz_plan[current_index]
    q_id = current_step.get("id")

    if not q_id or q_id not in qbank_map:
        raise InternalServerError(
            description=f"Question ID '{q_id}' not found in bank."
        )

    q = qbank_map[q_id]
    step_option_order = current_step.get("option_order", [])

    options_for_client = []
    if q["type"] != "open":
        q_options = q.get("options", [])
        # --- Process options (string or object) ---
        for i in step_option_order:
            # Defensive bounds-check: skip invalid indices
            if i is None or not isinstance(i, int) or i < 0 or i >= len(q_options):
                print(
                    f"Warning: resume - option index {i} out of range for question {q.get('id')}, skipping."
                )
                continue
            original_option = q_options[i]
            if isinstance(original_option, dict):
                # Option is an object: format image path, keep text
                options_for_client.append(
                    {
                        "text": original_option.get("text", ""),
                        "image": format_image_url(original_option.get("image")),
                    }
                )
            else:
                # Option is a simple string
                options_for_client.append(str(original_option))

    current_question = {
        "id": q["id"],
        "type": q["type"],
        "weight": q.get("weight", 1),
        "text": q["text"],
        "question_image": format_image_url(q.get("question_image")),
        "options": options_for_client,
    }

    return jsonify(
        {
            "quiz_id": quiz_id,
            "student": found_student_id,
            "current_question": current_question,
            "current_index": current_index,
            "total_questions": total_questions,
            "is_complete": False,
        }
    )
