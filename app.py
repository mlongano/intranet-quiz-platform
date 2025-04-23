# app.py
import commentjson as json
from flask import Flask, request, jsonify, send_from_directory, abort
from werkzeug.exceptions import NotFound, BadRequest, Conflict, InternalServerError
from pathlib import Path
import datetime
import os, uuid, re, unicodedata, random


# Initialize Flask WITHOUT specifying static_folder/static_url_path here
# if we handle it manually. Or configure it if preferred.
APP = Flask(__name__) # Removed static_folder='static'

# --- Constants ---
QUEST_FILE = 'questions.jsonc'
SCORE_FILE = 'scores.jsonc'
STUDENTS_FILE = 'students.jsonc'
QUIZ_FOLDER = 'quizzes'
ADMIN_PW = 'change‑this‑password' # Still recommend moving this out

os.makedirs(QUIZ_FOLDER, exist_ok=True)

# --- Load initial data ---
try:
    with open(STUDENTS_FILE, encoding='utf-8') as f:
        VALID_STUDENTS = {s.lower() for s in json.load(f)}
    if not VALID_STUDENTS:
        raise ValueError("No valid students found in students.jsonc")
except FileNotFoundError:
    print(f"Error: {STUDENTS_FILE} not found.")
    VALID_STUDENTS = set()
except ValueError as e:
    print(f"Error loading {STUDENTS_FILE}: {e}")
    VALID_STUDENTS = set()


# --- Utilities ---
SAFE = re.compile(r'[^A-Za-z0-9_.-]')
def safe_id(raw: str) -> str:
    return SAFE.sub('_', raw)

def load_scores():
    if not os.path.exists(SCORE_FILE):
        return []
    try:
        with open(SCORE_FILE, encoding='utf-8') as f:
            # Use commentjson consistently
            return json.load(f)
    except ValueError:
        print(f"Warning: Could not decode {SCORE_FILE}. Returning empty list.")
        return []
    except Exception as e:
        print(f"Error reading {SCORE_FILE}: {e}. Returning empty list.")
        return []

def save_scores(data):
    try:
        with open(SCORE_FILE, 'w', encoding='utf-8') as f:
            # Use commentjson consistently
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving scores to {SCORE_FILE}: {e}") # Log error

def load_questions():
    """Loads the master question bank."""
    try:
        with open(QUEST_FILE, encoding='utf-8') as f:
             # Use commentjson consistently
            return json.load(f)
    except FileNotFoundError:
         # Use specific Werkzeug exceptions for clearer HTTP responses
         raise InternalServerError(description=f"Master question file '{QUEST_FILE}' not found.")
    except ValueError:
         raise InternalServerError(description=f"Could not decode master question file '{QUEST_FILE}'. Check for syntax errors.")
    except Exception as e:
         raise InternalServerError(description=f"Error loading question bank '{QUEST_FILE}': {e}")

# --- Grading Logic (keep the corrected grade function from previous step) ---
def normalise(txt: str) -> str:
    txt = unicodedata.normalize('NFKD', txt).lower()
    txt = re.sub(r'\s+', ' ', txt, flags=re.MULTILINE).strip()
    return txt

def score_open(user_ans: str, q: dict) -> float:
    ua = normalise(user_ans)
    if 'acceptable' in q:
        for a in q['acceptable']:
            if ua == normalise(a):
                return 1.0
    if 'keywords' in q:
        kw   = [normalise(k) for k in q['keywords']]
        hits = sum(1 for k in kw if k in ua)
        if 'min_keywords' in q:
            return 1.0 if hits >= q['min_keywords'] else 0.0
        elif kw:
            return hits / len(kw)
    return 0.0

def grade(answers: list, plan: dict, qbank: dict) -> dict:
    """Calculates score based on answers, the specific quiz plan, and the master question bank.
       NOW returns per-question scores as well.
    """
    total = 0.0
    maximum = 0.0
    # *** ADDED: List to store score for each question ***
    per_question_scores = []
    qbank_map = {q['id']: q for q in qbank}

    for i, step in enumerate(plan.get('plan', [])):
        q_id = step.get('id')
        question_score = 0.0 # Score for this specific question

        if not q_id or q_id not in qbank_map:
            print(f"Warning: Question ID '{q_id}' from plan step {i} not found in question bank.")
            per_question_scores.append(question_score) # Append 0 score for missing question
            continue # Skip processing this step

        q = qbank_map[q_id]
        user_ans = answers[i] if i < len(answers) else None

        w = q.get('weight', 1)
        maximum += w

        overridden_score = q.get('override_points')
        if overridden_score is not None:
             question_score = overridden_score # Use override if exists
             total += question_score
             per_question_scores.append(question_score)
             continue # Skip automatic grading

        q_type = q.get('type')
        if q_type == 'open':
            # Calculate score for this open question
            open_score_fraction = score_open(user_ans or '', q)
            question_score = w * open_score_fraction
        elif q_type == 'single':
            original_correct_index = q.get('correct')
            shuffled_options = step.get('option_order', [])
            if original_correct_index is None or not isinstance(shuffled_options, list):
                 print(f"Warning: Missing 'correct' answer or 'option_order' for single choice q {q_id}")
            else:
                try:
                     current_correct_index = shuffled_options.index(original_correct_index)
                     if user_ans == current_correct_index:
                          question_score = w # Award full weight
                except ValueError:
                     print(f"Warning: Correct answer index {original_correct_index} not found in shuffled options for q {q_id}")
        elif q_type == 'multiple':
            original_correct_indices = q.get('correct', [])
            shuffled_options = step.get('option_order', [])
            if not isinstance(original_correct_indices, list) or not isinstance(shuffled_options, list):
                 print(f"Warning: Invalid 'correct' or 'option_order' for multiple choice q {q_id}")
            else:
                original_indices_selected = []
                if isinstance(user_ans, list):
                     for ans_index in user_ans:
                          if isinstance(ans_index, int) and 0 <= ans_index < len(shuffled_options):
                               original_indices_selected.append(shuffled_options[ans_index])
                if sorted(original_indices_selected) == sorted(original_correct_indices):
                     question_score = w # Award full weight

        # Accumulate total and store per-question score
        total += question_score
        per_question_scores.append(round(question_score, 2)) # Store rounded score for this question

    # *** MODIFIED Return Value ***
    return {
        'raw_points': round(total, 2),
        'max_points': maximum,
        'percent': round(total / maximum * 100, 2) if maximum else 0,
        'scores_per_question': per_question_scores # Include the list of scores
    }

# --- Refactored Helper Functions for api_submit ---

def _load_quiz_plan_by_student(student_id: str) -> dict: # Renamed and takes student_id
    """Finds, reads, and parses the quiz plan file using the safe student_id."""
    # *** FIX: Use safe_id(student_id) for filename ***
    safe_student = safe_id(student_id)
    plan_path = Path(QUIZ_FOLDER) / f'{safe_student}.json'

    if not plan_path.exists():
        # No fallback needed here based on user preference
        raise NotFound(description=f"Quiz plan file not found for student '{student_id}' (expected '{plan_path.name}')")

    try:
        return json.loads(plan_path.read_text('utf-8'))
    except ValueError:
        raise InternalServerError(description=f"Could not decode plan file '{plan_path.name}'. It might be malformed.")
    except Exception as e:
        raise InternalServerError(description=f"Error reading plan file '{plan_path.name}': {e}")

def _validate_submission_data(data: dict) -> tuple[str, str, list]: # Now returns student_id too
    """Validates input data for submission, requires student_id."""
    quiz_id = data.get('quiz_id', '')
    # *** FIX: Expect student_id (or name) from client ***
    student_id = data.get('student_id', '').strip().lower() # Get student ID, normalize
    answers = data.get('answers')

    if not quiz_id:
         raise BadRequest(description='Missing quiz_id')
    if not student_id:
         raise BadRequest(description='Missing student_id') # Added check
    if not isinstance(answers, list) or len(answers) == 0:
        raise BadRequest(description='Invalid or missing answers')

    # Optionally re-validate student_id against VALID_STUDENTS here if needed
    # if student_id not in VALID_STUDENTS:
    #     raise BadRequest(description='Invalid student_id submitted')

    return quiz_id, student_id, answers

# _check_duplicate_submission remains the same (it already takes student_id)
def _check_duplicate_submission(student_id: str, scores: list):
    if any(r.get('student') == student_id for r in scores):
        raise Conflict(description='Already submitted') # 409 Conflict

def _delete_plan_file_by_student(student_id: str): # Renamed
    """Deletes the plan file named after the safe student_id."""
    # *** FIX: Use safe_id(student_id) for filename ***
    path_to_delete = Path(QUIZ_FOLDER) / f'{safe_id(student_id)}.json'

    if path_to_delete.exists():
        try:
            path_to_delete.unlink()
        except OSError as e:
            print(f"Warning: Could not delete plan file {path_to_delete}: {e}")


# --- API Routes ---

# ... (Keep /admin routes as they are or modify as needed) ...
@APP.route('/admin/<path:filename>')
def admin_static(filename):
    return send_from_directory('frontend/dist', filename)

@APP.route('/admin/')
def admin_index():
    return send_from_directory('frontend/dist', 'index.html')


@APP.route('/api/start', methods=['POST'])
def api_start():
    data = request.get_json(force=True, silent=True) or {}
    student = data.get('name', '').strip()[:60].lower()
    if not student:
        abort(400, 'missing name')

    if student not in VALID_STUDENTS:
        return jsonify(error="Unknown student"), 403

    scores = load_scores()
    if any(rec.get('student') == student for rec in scores):
        return jsonify(error="You have already completed the quiz"), 409

    # *** FIX: Revert check to look for specific student file ***
    student_plan_path = Path(QUIZ_FOLDER) / f'{safe_id(student)}.json'
    if student_plan_path.exists():
         try:
              with student_plan_path.open(encoding='utf-8') as f: # Use utf-8
                   meta = json.load(f)
              # Ensure student matches - good practice
              if meta.get('student') == student:
                   # Return the specific quiz_id from the existing plan
                   return jsonify(error="Quiz already started", quiz_id=meta.get('quiz_id')), 409
              else:
                  # This case (filename mismatch with content) is unlikely if created by this app
                  print(f"Warning: Plan file {student_plan_path} exists but contains wrong student ID.")
                  # Decide how to handle: overwrite or error? Let's proceed to overwrite.
         except Exception as e:
              print(f"Error reading existing plan {student_plan_path}: {e}")
              # Proceed to create a new one if reading fails

    # --- Create new quiz ---
    qbank = load_questions()
    random.shuffle(qbank)
    quiz_plan_steps = []
    stripped_questions = []
    # ... (logic for building quiz_plan_steps/stripped_questions - unchanged) ...
    for q in qbank:
        option_order = []
        options_for_client = []
        if q['type'] != 'open':
            q_options = q.get('options', [])
            option_order = list(range(len(q_options)))
            random.shuffle(option_order)
            options_for_client = [q_options[i] for i in option_order]
        quiz_plan_steps.append({"id": q['id'], "option_order": option_order})
        stripped_questions.append({
            "qid": q['id'], "type": q['type'], "weight": q.get('weight', 1),
            "text": q['text'], "options": options_for_client
        })


    quiz_id = uuid.uuid4().hex[:12] # Unique ID for the *attempt*

    # *** FIX: Save the plan file using safe_id(student) again ***
    output_plan_path = Path(QUIZ_FOLDER) / f'{safe_id(student)}.json'

    meta = {
        "quiz_id": quiz_id, # Still store the unique attempt ID inside
        "student": student,
        "created": datetime.datetime.utcnow().isoformat(timespec='seconds'),
        "plan": quiz_plan_steps
    }
    try:
        with open(output_plan_path, 'w', encoding='utf-8') as f:
            json.dump(meta, f, indent=2)
    except Exception as e:
        print(f"Error saving quiz plan for student {student}: {e}")
        raise InternalServerError(description=f"Could not save quiz plan file: {e}")

    # Return the unique quiz_id for this attempt
    return jsonify({"quiz_id": quiz_id, "student": student, "questions": stripped_questions})


@APP.route('/api/submit', methods=['POST'])
def api_submit():
    """Handles submission, grades, saves detailed score with correct answers and points,
       and deletes student plan."""
    data = request.get_json(silent=True) or {}
    quiz_id, student_id, answers = _validate_submission_data(data)
    plan = _load_quiz_plan_by_student(student_id)
    qbank = load_questions()
    scores = load_scores()
    _check_duplicate_submission(student_id, scores)

    qbank_map = {q['id']: q for q in qbank}

    # --- Grade the submission (captures per-question scores) ---
    # The returned dict now includes 'scores_per_question'
    calc_results = grade(answers, plan, qbank)

    # --- Build Detailed Answers for Storage ---
    detailed_answers = []
    plan_steps = plan.get('plan', [])
    scores_list = calc_results.get('scores_per_question', []) # Get the scores list

    for i, step in enumerate(plan_steps):
        q_id = step.get('id')
        question_detail = qbank_map.get(q_id)
        student_answer_raw = answers[i] if i < len(answers) else None
        formatted_student_answer = student_answer_raw
        formatted_correct_answer = "[N/A]" # Default correct answer text
        question_text = "[Question not found in bank]"
        points = scores_list[i] if i < len(scores_list) else 0 # Get score for this question
        question_weight = 0 # Default weight

        # Ensure correct_answer_raw is always defined
        correct_answer_raw = None

        if question_detail:
            question_text = question_detail.get('text', '[Text missing]')
            question_weight = question_detail.get('weight', 1)

            q_type = question_detail.get('type')
            original_options = question_detail.get('options', [])
            shuffled_option_order = step.get('option_order', [])
            correct_answer_raw = question_detail.get('correct')

            # Format student answer (same logic as before)
            if q_type == 'single' and isinstance(student_answer_raw, int) and 0 <= student_answer_raw < len(shuffled_option_order):
                 original_index = shuffled_option_order[student_answer_raw]
                 if 0 <= original_index < len(original_options):
                     formatted_student_answer = f"'{original_options[original_index]}' (Index: {original_index})"
                 else: formatted_student_answer = f"[Invalid Shuffled Index: {student_answer_raw}]"
            elif q_type == 'multiple' and isinstance(student_answer_raw, list):
                 original_indices = [shuffled_option_order[idx] for idx in student_answer_raw if isinstance(idx, int) and 0 <= idx < len(shuffled_option_order)]
                 formatted_student_answer = [f"'{original_options[orig_idx]}' (Index: {orig_idx})" for orig_idx in original_indices if 0 <= orig_idx < len(original_options)]
            # else: open question answer is already formatted (raw string)

            # *** Format correct answer ***
            if q_type == 'single' and isinstance(correct_answer_raw, int) and 0 <= correct_answer_raw < len(original_options):
               formatted_correct_answer = f"'{original_options[correct_answer_raw]}' (Index: {correct_answer_raw})"
            elif q_type == 'multiple' and isinstance(correct_answer_raw, list):
                formatted_correct_answer = [f"'{original_options[idx]}' (Index: {idx})" for idx in correct_answer_raw if 0 <= idx < len(original_options)]
            elif q_type == 'open':
                # For open questions, maybe show acceptable answers or keywords?
                if 'acceptable' in question_detail:
                    print("Acceptable answers:", question_detail['acceptable'])
                    formatted_correct_answer = question_detail['acceptable'] # Show list
                elif 'keywords' in question_detail:
                    formatted_correct_answer = {"keywords": question_detail['keywords']} # Show keywords
                else:
                    formatted_correct_answer = "[Manual Grading Required]"
            else: # Should not happen if question bank is valid
                formatted_correct_answer = "[Invalid Question Type]"


        detailed_answers.append({
            "question_id": q_id,
            "question_text": question_text,
            "student_answer": formatted_student_answer,
            "correct_answer": formatted_correct_answer, # Store formatted correct answer
            "weight": question_weight,
            "points_awarded": points, # Store points for this question
            # Optionally keep raw answers too if needed for reprocessing
            "raw_student_answer": student_answer_raw,
            "raw_correct_answer": correct_answer_raw if question_detail else None,
        })
    # --- End Build Detailed Answers ---

    scores.append({
        'student':    student_id,
        'quiz_id':    quiz_id,
        'answers':    detailed_answers, # Store the enriched list
        # Store the overall calculated results as before
        'raw_points': calc_results['raw_points'],
        'max_points': calc_results['max_points'],
        'percent': calc_results['percent'],
        'timestamp':  datetime.datetime.utcnow().isoformat(timespec='seconds')
    })
    save_scores(scores)
    _delete_plan_file_by_student(student_id)

    # Return only the summary calculation to the frontend
    return jsonify({
         'raw_points': calc_results['raw_points'],
         'max_points': calc_results['max_points'],
         'percent': calc_results['percent'],
    })

@APP.route('/api/resume/<quiz_id>')
def api_resume(quiz_id):
    """Resume requires finding the plan file by searching for quiz_id inside."""
    if not quiz_id or len(quiz_id) != 12:  # Basic validation on quiz_id format
        abort(400, description="Invalid quiz ID format.")

    quiz_folder_path = Path(QUIZ_FOLDER)
    if not quiz_folder_path.is_dir():
        raise InternalServerError(description="Quiz directory not found.")

    print(f"Resume attempt for quiz_id: {quiz_id}. Searching in {quiz_folder_path}...")  # Log search attempt

    def find_plan_by_quiz_id(quiz_id, folder_path):
        """Helper to find the plan file and student_id by quiz_id."""
        for p in folder_path.glob('*.json'):
            try:
                if not p.is_file():
                    continue
                print(f"Checking file: {p.name}")  # Log which file is checked
                with p.open(encoding='utf-8') as f:
                    meta = json.load(f)
                if meta.get('quiz_id') == quiz_id:
                    found_student_id = meta.get('student')
                    print(f"Found matching plan for student {found_student_id} in file {p.name}")
                    return meta, found_student_id, p
            except ValueError:
                print(f"Warning: Could not decode JSON in {p.name} during resume search.")
                continue
            except OSError as e:
                print(f"Warning: OS error reading {p.name} during resume search: {e}")
                continue
            except Exception as e:
                print(f"Warning: Unexpected error processing {p.name} during resume search: {e}")
                continue
        return None, None, None

    plan, found_student_id, plan_file_path = find_plan_by_quiz_id(quiz_id, quiz_folder_path)

    if plan is None:
        print(f"Resume failed: No plan file found containing quiz_id '{quiz_id}'")
        raise NotFound(description=f"Could not find active quiz plan matching ID '{quiz_id}'")
    if not found_student_id:
        plan_file_name = plan_file_path.name if plan_file_path else "[unknown]"
        print(f"Resume failed: Plan file {plan_file_name} found but missing 'student' field.")
        raise InternalServerError(description=f"Plan file for quiz '{quiz_id}' is missing student identifier.")

    try:
        qbank = load_questions()  # Load questions (handles its own errors)
    except InternalServerError as e:
        raise e
    except Exception as e:
        raise InternalServerError(description=f"Unexpected error loading question bank: {e}")

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
        opts = [q_options[i] for i in step_option_order if q['type'] != 'open' and 0 <= i < len(q_options)]

        stripped.append({
            "qid": q['id'], "type": q['type'], "weight": q.get('weight', 1),
            "text": q['text'], "options": opts
        })

    return jsonify({
        "quiz_id": quiz_id,
        "student": found_student_id,
        "questions": stripped
    })

# --- Other API routes (scores, resume) ---

@APP.route('/api/scores', methods=['POST'])
def api_scores():
    data = request.get_json(silent=True) or {}
    # Consider using werkzeug.security.check_password_hash for real password checking
    if data.get('pw') != ADMIN_PW:
        abort(403) # Forbidden
    return jsonify(load_scores())

# --- NEW: Endpoint to handle score overrides ---
@APP.route('/api/review', methods=['POST'])
def api_save_review():
    """Receives score overrides from admin and updates the scores file."""
    from werkzeug.exceptions import Unauthorized  # Fix: Import Unauthorized

    data = request.get_json(silent=True) or {}

    # 1. Authentication
    password = data.get('password')
    if not password or password != ADMIN_PW:
        # Use 401 Unauthorized for missing/incorrect credentials
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

    # Find the specific submission record
    for i, record in enumerate(scores):
        if record.get('student') == student_id and record.get('quiz_id') == quiz_id:
            target_submission_index = i
            target_submission = record
            break

    if target_submission is None:
        raise NotFound(description=f"Submission not found for student '{student_id}' with quiz_id '{quiz_id}'.")

    # 4. Apply Overrides
    if 'answers' not in target_submission or not isinstance(target_submission['answers'], list):
        raise InternalServerError(description="Target submission record is missing or has invalid 'answers' structure.")

    # Create a map for quick lookup of answers within the submission by question_id
    # Ensure IDs are compared as strings for consistency
    answers_map = {str(ans.get('question_id')): ans for ans in target_submission['answers']}
    updated_count = 0

    for override_item in overrides:
        if not isinstance(override_item, dict):
            print(f"Warning: Skipping invalid override item format: {override_item}")
            continue

        q_id_to_override = str(override_item.get('question_id')) # Ensure string ID
        new_points = override_item.get('points')

        if q_id_to_override is None or new_points is None:
            print(f"Warning: Skipping override with missing question_id or points: {override_item}")
            continue

        # Ensure points are numeric (float or int)
        try:
            new_points = float(new_points)
        except (ValueError, TypeError):
             print(f"Warning: Skipping override with non-numeric points for q_id {q_id_to_override}: {new_points}")
             continue

        # Find the answer detail to update
        if q_id_to_override in answers_map:
            answer_detail = answers_map[q_id_to_override]
            # Validate new_points against question weight (optional but recommended)
            max_points_for_q = answer_detail.get('weight', 1) # Use stored weight
            if new_points < 0 or new_points > max_points_for_q:
                 print(f"Warning: Skipping override for q_id {q_id_to_override}. Points {new_points} out of range (0-{max_points_for_q}).")
                 continue

            # Update points if different
            if answer_detail.get('points_awarded') != round(new_points, 2):
                 print(f"Overriding points for q_id {q_id_to_override}: {answer_detail.get('points_awarded')} -> {round(new_points, 2)}")
                 answer_detail['points_awarded'] = round(new_points, 2)
                 updated_count += 1
        else:
            print(f"Warning: Question ID '{q_id_to_override}' from override not found in submission answers for student '{student_id}'.")

    # 5. Recalculate Totals if changes were made
    if updated_count > 0:
        new_raw_points = sum(ans.get('points_awarded', 0) for ans in target_submission['answers'])
        max_points = target_submission.get('max_points', 0) # Use existing max_points
        new_percent = round(new_raw_points / max_points * 100, 2) if max_points else 0

        target_submission['raw_points'] = round(new_raw_points, 2)
        target_submission['percent'] = new_percent
        target_submission['timestamp'] = datetime.datetime.utcnow().isoformat(timespec='seconds') # Update timestamp

        # Replace the old record with the updated one in the scores list
        scores[target_submission_index] = target_submission

        # 6. Save Updated Scores
        save_scores(scores)
        print(f"Saved {updated_count} overrides for student '{student_id}', quiz '{quiz_id}'. New score: {new_raw_points}/{max_points}")
    else:
        print(f"No effective overrides applied for student '{student_id}', quiz '{quiz_id}'.")


    # 7. Return Success Response
    return jsonify({"success": True, "message": f"{updated_count} overrides applied."})


# --- Flask App Setup & Serving ---

# --- Route to serve static assets (JS, CSS, images) ---
# Vite typically puts built assets in an 'assets' subfolder
@APP.route('/assets/<path:filename>')
def serve_assets(filename):
    # Ensure assets folder exists and is correctly targeted
    if not os.path.exists(ASSETS_FOLDER):
         abort(404, description="Assets directory not found.")
    return send_from_directory(ASSETS_FOLDER, filename)

# Define the static folder relative to app.py location
# Assumes 'frontend/dist' exists at the same level as app.py
STATIC_FOLDER = os.path.join(os.path.dirname(__file__), 'frontend', 'dist')
ASSETS_FOLDER = os.path.join(STATIC_FOLDER, 'assets')


# --- Route to serve frontend application (index.html) ---
# This catch-all route should come AFTER your specific /api routes
# and the /assets route.
@APP.route('/', defaults={'path': ''})
@APP.route('/<path:path>') # Handles /, /quiz/..., /admin/..., etc.
def serve_react_app(path):
    # Ensure index.html exists
    index_path = os.path.join(STATIC_FOLDER, 'index.html')
    if not os.path.exists(index_path):
        return "React app not built or index.html missing!", 500

    # Check if the requested path corresponds to a static file in the root
    # (e.g., favicon.ico, manifest.json). Serve it if it exists.
    # This part might need adjustment depending on Vite's output structure.
    # Often, only index.html and the assets folder are relevant.
    potential_file = os.path.join(STATIC_FOLDER, path)
    if path != "" and os.path.exists(potential_file) and os.path.isfile(potential_file):
        return send_from_directory(STATIC_FOLDER, path)
    else:
        # Otherwise, serve the main index.html for React Router to handle routing
        return send_from_directory(STATIC_FOLDER, 'index.html')



# --- Main Execution ---
if __name__ == '__main__':
    # Use a production-ready server like Waitress
    from waitress import serve
    print(f"Serving React app from: {STATIC_FOLDER}")
    print(f"Serving assets from: {ASSETS_FOLDER}")
    serve(APP, host='0.0.0.0', port=5001)
    # Or use Flask's dev server for testing the build (not recommended for actual deployment)
    # APP.run(host='0.0.0.0', port=5001, debug=False)
