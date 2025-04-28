# utils.py
import commentjson as json
from werkzeug.exceptions import NotFound, BadRequest, Conflict, InternalServerError
from pathlib import Path
import os, re, unicodedata
from dotenv import load_dotenv
import shutil

# --- Load Environment Variables ---
load_dotenv()

# --- Constants (Consider moving to a config.py if they grow) ---
QUEST_FILE = 'questions.jsonc'
SCORE_FILE = 'scores.jsonc'
STUDENTS_FILE = 'students.jsonc'
QUIZ_FOLDER = 'quizzes'
IMAGES_FOLDER = 'images'
QUESTION_BANK_FOLDER = 'question_bank' # New constant for the question bank directory
SCORES_BANK_FOLDER = 'scores_bank'     # NEW: Directory for scores bank files

# --- Load Admin Password from Environment Variable ---
ADMIN_PW = os.getenv('ADMIN_PW') # <-- Get password from environment
if not ADMIN_PW:
    print("Error: ADMIN_PW environment variable not set.")
    print("Please create a .env file in the project root with ADMIN_PW='your_password'")
    # Decide how to handle this: exit or raise an exception
    raise EnvironmentError("ADMIN_PW environment variable is required but not set.")
    #import sys; sys.exit(1)


os.makedirs(QUIZ_FOLDER, exist_ok=True) # Ensure QUIZ_FOLDER exists
os.makedirs(QUESTION_BANK_FOLDER, exist_ok=True) # Ensure question_bank folder exists
os.makedirs(SCORES_BANK_FOLDER, exist_ok=True) # NEW: Ensure scores_bank folder exists

# --- Load initial student data ---
try:
    with open(STUDENTS_FILE, encoding='utf-8') as f:
        VALID_STUDENTS = {s.lower() for s in json.load(f)}
    if not VALID_STUDENTS:
        print(f"Warning: No valid students found in {STUDENTS_FILE}. Quiz start may fail.")
except FileNotFoundError:
    print(f"Error: {STUDENTS_FILE} not found. Quiz start will likely fail.")
    VALID_STUDENTS = set()
except ValueError as e:
    print(f"Error loading {STUDENTS_FILE}: {e}. Quiz start may fail.")
    VALID_STUDENTS = set()
except Exception as e:
    print(f"Unexpected error loading {STUDENTS_FILE}: {e}. Quiz start may fail.")
    VALID_STUDENTS = set()


# --- Utilities ---
SAFE = re.compile(r'[^A-Za-z0-9_.-]')
def safe_id(raw: str) -> str:
    """Creates a filesystem-safe ID from a raw string."""
    return SAFE.sub('_', raw)

# --- Helper to format image path for client ---
def format_image_url(image_path):
    """Prepends the base image route if the path is valid."""
    if image_path and isinstance(image_path, str):
        # Simple check to avoid adding prefix multiple times or to absolute URLs
        if not image_path.startswith(f"/{IMAGES_FOLDER}/") and not image_path.startswith("http"):
             # Remove leading slash if present to avoid //
            clean_path = image_path.lstrip('/')
            return f"/{IMAGES_FOLDER}/{clean_path}"
    return None # Return None if no valid path


def load_scores(filename: str = SCORE_FILE):
    """Loads scores from the scores file or a specified file."""
    if filename != SCORE_FILE:
         file_path = Path(SCORES_BANK_FOLDER) / filename # Load from scores_bank
    else:
         file_path = Path(SCORE_FILE) # Load the active scores file
    print(f"Loading scores from {file_path}")
    if not file_path.exists() or not file_path.is_file():
        return []

    try:
        with file_path.open(encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        # This specific error for the main SCORE_FILE might be handled differently
        if filename == SCORE_FILE:
            print(f"Warning: {SCORE_FILE} not found. Returning empty list.")
            return [] # Return empty list if the main scores file doesn't exist
        else:
            raise NotFound(description=f"Scores file '{filename}' not found in '{SCORES_BANK_FOLDER}'.")
    except ValueError:
        raise BadRequest(description=f"File '{file_path}' is not a valid JSONC format.")
    except Exception as e:
        print(f"Error reading scores file '{file_path}': {e}")
        raise InternalServerError(description=f"Error reading scores file '{file_path}': {e}")

def save_scores(data):
    """Saves scores to the scores file."""
    try:
        with open(SCORE_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
    except Exception as e:
        print(f"Error saving scores to {SCORE_FILE}: {e}") # Log error

def list_scores_bank_files():
    """Lists available scores files (jsonc) in the scores_bank folder."""
    scores_files = []
    bank_path = Path(SCORES_BANK_FOLDER)
    if not bank_path.is_dir():
        return []
    for item in bank_path.iterdir():
        if item.is_file() and item.suffix.lower() == '.jsonc':
            scores_files.append(item.name)
    return sorted(scores_files)

def load_scores_from_bank(filename: str):
    """Overwrites SCORE_FILE with the content of the specified file from the scores_bank."""
    source_path = Path(SCORES_BANK_FOLDER) / filename
    target_path = Path(SCORE_FILE)

    if not source_path.exists() or not source_path.is_file():
         raise NotFound(description=f"Scores file '{filename}' not found in '{SCORES_BANK_FOLDER}'.")

    try:
        with source_path.open(encoding='utf-8') as f:
            json.load(f) # Just load to check if it's valid JSON
    except ValueError:
        raise BadRequest(description=f"File '{filename}' is not a valid JSONC format.")
    except Exception as e:
        raise InternalServerError(description=f"Error reading source file '{filename}': {e}")

    try:
        # Create a backup of the current SCORE_FILE before overwriting
        if target_path.exists():
            backup_file = f"{target_path}.bak"
            shutil.copy2(target_path, backup_file)
            print(f"Backed up current {SCORE_FILE} to {backup_file}")

        shutil.copy2(source_path, target_path)
        print(f"Copied '{filename}' from '{SCORES_BANK_FOLDER}' to '{SCORE_FILE}'.")
    except Exception as e:
        print(f"Error loading scores from bank: {e}")
        raise InternalServerError(description=f"Error copying file from bank: {e}")


def save_scores_to_bank(filename_suffix: str):
    """Saves the current SCORE_FILE to the scores_bank with a date prefix."""
    import datetime  # Fix: Ensure datetime is imported
    source_path = Path(SCORE_FILE)
    if not source_path.exists() or not source_path.is_file():
        # If the main scores file doesn't exist, maybe we shouldn't save an empty one?
        # Or save an empty list? Let's raise an error for now for clarity.
        raise InternalServerError(description=f"Current scores file '{SCORE_FILE}' not found. Cannot save empty/non-existent file.")

    if not filename_suffix:
         raise BadRequest(description="Filename suffix is required for saving.")

    date_prefix = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    safe_suffix = safe_id(filename_suffix)
    target_filename = f"{date_prefix}_{safe_suffix}.jsonc"
    target_path = Path(SCORES_BANK_FOLDER) / target_filename

    if target_path.exists():
        raise Conflict(description=f"File '{target_filename}' already exists in '{SCORES_BANK_FOLDER}'.")

    try:
        with source_path.open(encoding='utf-8') as f:
            json.load(f) # Just load to check if it's valid JSON
    except ValueError:
        raise InternalServerError(description=f"Current file '{SCORE_FILE}' is not a valid JSONC format.")
    except Exception as e:
        raise InternalServerError(description=f"Error reading current file '{SCORE_FILE}': {e}")


    try:
        shutil.copy2(source_path, target_path)
        print(f"Saved '{SCORE_FILE}' to '{target_path}'.")
    except Exception as e:
        print(f"Error saving scores to bank: {e}")
        raise InternalServerError(description=f"Error copying file to bank: {e}")



def list_question_bank_files():
    """Lists available quiz files (jsonc) in the question_bank folder."""
    quiz_files = []
    bank_path = Path(QUESTION_BANK_FOLDER)
    if not bank_path.is_dir():
        return []
    for item in bank_path.iterdir():
        if item.is_file() and item.suffix.lower() == '.jsonc':
            quiz_files.append(item.name)
    return sorted(quiz_files) # Return sorted list of filenames

def load_quiz_from_bank(filename: str):
    """Overwrites QUEST_FILE with the content of the specified file from the question_bank."""
    source_path = Path(QUESTION_BANK_FOLDER) / filename
    target_path = Path(QUEST_FILE)

    if not source_path.exists() or not source_path.is_file():
         raise NotFound(description=f"Quiz file '{filename}' not found in '{QUESTION_BANK_FOLDER}'.")

    # Optional: Basic validation of the source file content before copying
    try:
        with source_path.open(encoding='utf-8') as f:
            json.load(f) # Just load to check if it's valid JSON
    except ValueError:
        raise BadRequest(description=f"File '{filename}' is not a valid JSONC format.")
    except Exception as e:
        raise InternalServerError(description=f"Error reading source file '{filename}': {e}")

    try:
        # Create a backup of the current QUEST_FILE before overwriting
        if target_path.exists():
            backup_file = f"{target_path}.bak"
            shutil.copy2(target_path, backup_file)
            print(f"Backed up current {QUEST_FILE} to {backup_file}")

        shutil.copy2(source_path, target_path)
        print(f"Copied '{filename}' from '{QUESTION_BANK_FOLDER}' to '{QUEST_FILE}'.")
    except Exception as e:
        print(f"Error loading quiz from bank: {e}")
        raise InternalServerError(description=f"Error copying file from bank: {e}")


def save_quiz_to_bank(filename_suffix: str):
    """Saves the current QUEST_FILE to the question_bank with a date prefix."""
    import datetime  # Fix: Ensure datetime is imported
    source_path = Path(QUEST_FILE)
    if not source_path.exists() or not source_path.is_file():
        raise InternalServerError(description=f"Current quiz file '{QUEST_FILE}' not found.")

    if not filename_suffix:
         raise BadRequest(description="Filename suffix is required for saving.")

    # Generate date-prefixed filename
    date_prefix = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
    safe_suffix = safe_id(filename_suffix) # Ensure suffix is safe
    target_filename = f"{date_prefix}_{safe_suffix}.jsonc"
    target_path = Path(QUESTION_BANK_FOLDER) / target_filename

    if target_path.exists():
        raise Conflict(description=f"File '{target_filename}' already exists in '{QUESTION_BANK_FOLDER}'.")

    # Optional: Basic validation of the source file content before saving
    try:
        with source_path.open(encoding='utf-8') as f:
            json.load(f) # Just load to check if it's valid JSON
    except ValueError:
        raise InternalServerError(description=f"Current file '{QUEST_FILE}' is not a valid JSONC format.")
    except Exception as e:
        raise InternalServerError(description=f"Error reading current file '{QUEST_FILE}': {e}")


    try:
        shutil.copy2(source_path, target_path)
        print(f"Saved '{QUEST_FILE}' to '{target_path}'.")
    except Exception as e:
        print(f"Error saving quiz to bank: {e}")
        raise InternalServerError(description=f"Error copying file to bank: {e}")


def load_questions(filename: str = QUEST_FILE):
    """Reads and returns the JSON content of a specified file."""
    if filename != QUEST_FILE:
        file_path = Path(QUESTION_BANK_FOLDER) / filename
    else:
        file_path = Path(QUEST_FILE)
    print(f"Loading questions from '{file_path}'...")
    if not file_path.exists() or not file_path.is_file():
         raise NotFound(description=f"Quiz file '{filename}' not found in '{QUESTION_BANK_FOLDER}'.")

    try:
        with file_path.open(encoding='utf-8') as f:
            questions = json.load(f)
            for question in questions:
                question_image = question.get('question_image', None)
                if question_image:
                    question['question_image'] = format_image_url(question_image)
                if question.get('type', None) == 'multiple' or question.get('type', None) == 'single':
                    for opt in question.get('options', []):
                        if type(opt) == dict:
                            opt['image'] = format_image_url(opt.get('image', None))
            return questions
    except FileNotFoundError:
        raise InternalServerError(description=f"Master question file '{file_path}' not found.")
    except ValueError:
        raise BadRequest(description=f"File '{file_path}' is not a valid JSONC format.")
    except Exception as e:
        print(f"Error reading bank file '{file_path}': {e}")
        raise InternalServerError(description=f"Error reading bank file '{file_path}': {e}")

def load_questions1():
    """Loads the master question bank (QUEST_FILE)."""
    print(f'Loading questions from: {QUEST_FILE}')
    try:
        with open(QUEST_FILE, encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
         raise InternalServerError(description=f"Master question file '{QUEST_FILE}' not found.")
    except ValueError:
         raise InternalServerError(description=f"Could not decode master question file '{QUEST_FILE}'. Check syntax.")
    except Exception as e:
         raise InternalServerError(description=f"Error loading question bank '{QUEST_FILE}': {e}")

def copy_file(source, destination, messages={'success': 'file copied', 'error': 'Warning: Could not create the file copy:'}):
    if os.path.exists(source):
        try:
            shutil.copy2(source, destination)
            print(f"{messages['success']}")
        except Exception as e:
            print(f"{messages['error']}{e}")

def save_questions(data):
    """Saves questions to the master question bank (QUEST_FILE) with backup."""
    backup_file_path = f"{QUEST_FILE}.bak"
    # --- Backup ---
    copy_file(
        source=QUEST_FILE,
        destination=backup_file_path,
        messages={
            'success': f'Backup created of {QUEST_FILE} in {backup_file_path}',
            'error': f'Warning: Could not create backup file of {QUEST_FILE} in {backup_file_path}:'})

    # --- Save ---
    try:
        # Add basic validation: ensure data is a list
        if not isinstance(data, list):
             raise ValueError("Invalid data format: Top-level structure must be a list.")

        with open(QUEST_FILE, 'w', encoding='utf-8') as f:
            # Use commentjson if comments need preserving, else standard json
            # json.dump(data, f, indent=2) # For standard JSON
            json.dump(data, f, indent=2) # For commentjson
    except (ValueError, TypeError) as e: # Catch data format errors or JSON serialization errors
        # Attempt to restore from backup if saving failed
        copy_file(
            source=backup_file_path,
            destination= QUEST_FILE,
            messages={
                'success': f"Error saving questions. Restored from backup: {backup_file_path}",
                'error': f"CRITICAL: Failed to save questions AND failed to restore {QUEST_FILE} from backup {backup_file_path}:"})
        raise BadRequest(description=f"Invalid question data provided: {e}") # 400 Bad Request for data issues
    except IOError as e: # Catch file writing errors
        # Attempt to restore from backup
        if os.path.exists(backup_file_path):
            try:
                shutil.copy2(backup_file_path, QUEST_FILE)
                print(f"Error saving questions. Restored from backup: {copy_file}")
            except Exception as restore_e:
                 print(f"CRITICAL: Failed to save questions AND failed to restore backup: {restore_e}")
        raise InternalServerError(description=f"I/O error saving questions to {QUEST_FILE}: {e}") # 500 for system errors
    except Exception as e: # Catch other unexpected errors
        # Attempt to restore from backup
        if os.path.exists(backup_file_path):
             try:
                 shutil.copy2(backup_file_path, QUEST_FILE)
                 print(f"Error saving questions. Restored from backup: {copy_file}")
             except Exception as restore_e:
                 print(f"CRITICAL: Failed to save questions AND failed to restore backup: {restore_e}")
        raise InternalServerError(description=f"Unexpected error saving questions: {e}")

# --- Grading Logic ---
def normalise(txt: str) -> str:
    """Normalizes text for comparison (lowercase, NFKD, strip whitespace)."""
    if not isinstance(txt, str):
        return ""
    txt = unicodedata.normalize('NFKD', txt).lower()
    txt = re.sub(r'\s+', ' ', txt, flags=re.MULTILINE).strip()
    return txt

def score_open(user_ans: str, q: dict) -> float:
    """Scores an open-ended question."""
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
    """Calculates score based on answers, the specific quiz plan, and the master question bank."""
    total = 0.0
    maximum = 0.0
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

        # Check for manually overridden points first (from admin review)
        # Note: This assumes 'points_awarded' might be present in the question detail 'q' itself
        # if it was previously reviewed and saved back into the master bank (less ideal).
        # A better approach might be to check an 'override' field directly from the submission data
        # *if* this function were processing a full submission record rather than just raw answers.
        # For this refactor, we assume overrides are handled *after* initial grading via /api/review.

        q_type = q.get('type')
        if q_type == 'open':
            open_score_fraction = score_open(user_ans or '', q)
            question_score = w * open_score_fraction
        elif q_type == 'single':
            original_correct_index = q.get('correct')
            shuffled_options = step.get('option_order', [])
            if original_correct_index is not None and isinstance(shuffled_options, list):
                try:
                    current_correct_index = shuffled_options.index(original_correct_index)
                    if user_ans == current_correct_index:
                        question_score = w # Award full weight
                except ValueError:
                    print(f"Warning: Correct answer index {original_correct_index} not found in shuffled options for q {q_id}")
        elif q_type == 'multiple':
            original_correct_indices = q.get('correct', []) # Get correct indices from question bank
            shuffled_options = step.get('option_order', []) # Get the shuffled order for this quiz instance
            user_selected_indices = [] # Store the original indices the user selected

            if isinstance(user_ans, list): # Ensure user answer is a list for multiple choice
                for ans_index in user_ans:
                    # Convert the shuffled option index back to the original index
                    if isinstance(ans_index, int) and 0 <= ans_index < len(shuffled_options):
                            user_selected_indices.append(shuffled_options[ans_index])

            num_of_answers = len(step.get('option_order', []))
            num_correct_answers_total = len(original_correct_indices)
            num_user_correct_answers = len([idx for idx in user_selected_indices if idx in original_correct_indices])
            num_user_wrong_answers = len([idx for idx in user_selected_indices if idx not in original_correct_indices])

            # Implement the new scoring formula
            if num_correct_answers_total > 0:
                points_per_option = w / num_correct_answers_total if num_correct_answers_total > 0 else w # edge case with no correct answers
                points_per_wrong_option = w / (num_of_answers - num_correct_answers_total) if num_of_answers - num_correct_answers_total > 0 else w # edge case with no wrong answers
                num_user_correct_answers = max(1, num_user_correct_answers) # edge case with no correct answers
                calculated_score = (num_user_correct_answers * points_per_option) - (num_user_wrong_answers * points_per_wrong_option)
                # Set score to zero if it's negative
                question_score = max(0.0, calculated_score)
            else:
                # Handle case with no correct answers defined (e.g., award 0)
                question_score = 0.0

        total += question_score
        per_question_scores.append(round(question_score, 2)) # Store rounded score for this question

    return {
        'raw_points': round(total, 2),
        'max_points': maximum,
        'percent': round(total / maximum * 100, 2) if maximum else 0,
        'scores_per_question': per_question_scores # Include the list of scores
    }

# --- Helper Functions for api_submit and others ---

def load_quiz_plan_by_student(student_id: str) -> dict:
    """Finds, reads, and parses the quiz plan file using the safe student_id."""
    safe_student = safe_id(student_id)
    plan_path = Path(QUIZ_FOLDER) / f'{safe_student}.json'

    if not plan_path.exists():
        raise NotFound(description=f"Quiz plan file not found for student '{student_id}'")

    try:
        return json.loads(plan_path.read_text('utf-8'))
    except ValueError:
        raise InternalServerError(description=f"Could not decode plan file '{plan_path.name}'.")
    except Exception as e:
        raise InternalServerError(description=f"Error reading plan file '{plan_path.name}': {e}")

def validate_submission_data(data: dict) -> tuple[str, str, list]:
    """Validates input data for submission."""
    quiz_id = data.get('quiz_id', '')
    student_id = data.get('student_id', '').strip().lower()
    answers = data.get('answers')

    if not quiz_id:
         raise BadRequest(description='Missing quiz_id')
    if not student_id:
         raise BadRequest(description='Missing student_id')
    if not isinstance(answers, list) or len(answers) == 0:
        raise BadRequest(description='Invalid or missing answers')

    # Optionally re-validate student_id against VALID_STUDENTS here if needed
    # if student_id not in VALID_STUDENTS:
    #     raise BadRequest(description='Invalid student_id submitted')

    return quiz_id, student_id, answers

def check_duplicate_submission(student_id: str, scores: list):
    """Checks if a student has already submitted."""
    if any(r.get('student') == student_id for r in scores):
        raise Conflict(description='Already submitted') # 409 Conflict

def delete_plan_file_by_student(student_id: str):
    """Deletes the plan file named after the safe student_id."""
    path_to_delete = Path(QUIZ_FOLDER) / f'{safe_id(student_id)}.json'
    if path_to_delete.exists():
        try:
            path_to_delete.unlink()
        except OSError as e:
            print(f"Warning: Could not delete plan file {path_to_delete}: {e}")

def find_plan_by_quiz_id(quiz_id, folder_path):
    """Helper to find the plan file and student_id by quiz_id inside it."""
    for p in folder_path.glob('*.json'):
        try:
            if not p.is_file(): continue
            print(f"Checking file: {p.name}") # Log which file is checked
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

def format_detailed_answers(plan, qbank_map, answers, scores_list):
    """Formats answers for detailed storage."""
    detailed_answers = []
    plan_steps = plan.get('plan', [])

    for i, step in enumerate(plan_steps):
        q_id = step.get('id')
        question_detail = qbank_map.get(q_id)
        student_answer_raw = answers[i] if i < len(answers) else None
        formatted_student_answer = student_answer_raw
        option_student_image = None
        formatted_correct_answer = "[N/A]"
        option_correct_image = None
        question_text = "[Question not found]"
        question_image_path = None # <-- NEW: Store question image path
        points = scores_list[i] if i < len(scores_list) else 0
        question_weight = 0
        correct_answer_raw = None



        if question_detail:
            question_text = question_detail.get('text', '[Text missing]')
            question_image_path = question_detail.get('question_image', None)
            question_weight = question_detail.get('weight', 1)
            q_type = question_detail.get('type')
            original_options = question_detail.get('options', [])
            shuffled_option_order = step.get('option_order', [])
            correct_answer_raw = question_detail.get('correct')

            # Helper to get text from an option (string or object)
            def get_option_text(option):
                return option.get('text', '') if isinstance(option, dict) else str(option)

            def get_option_image(option):
                return option.get('image', None) if isinstance(option, dict) else None

            # Format student answer
            if q_type == 'single' and isinstance(student_answer_raw, int) and 0 <= student_answer_raw < len(shuffled_option_order):
                 original_index = shuffled_option_order[student_answer_raw]
                 if 0 <= original_index < len(original_options):
                     option_text = get_option_text(original_options[original_index])
                     option_student_image = get_option_image(original_options[original_index])
                     formatted_student_answer = f"'{option_text}' (Index: {original_index})"


                 else: formatted_student_answer = f"[Invalid Shuffled Index: {student_answer_raw}]"
            elif q_type == 'multiple' and isinstance(student_answer_raw, list):
                 original_indices = [shuffled_option_order[idx] for idx in student_answer_raw if isinstance(idx, int) and 0 <= idx < len(shuffled_option_order)]
                 formatted_student_answer = [f"'{get_option_text(original_options[orig_idx])}' (Index: {orig_idx})" for orig_idx in original_indices if 0 <= orig_idx < len(original_options)]
                 option_student_image = [get_option_image(original_options[orig_idx]) for orig_idx in original_indices if 0 <= orig_idx < len(original_options)]

            # Format correct answer
            if q_type == 'single' and isinstance(correct_answer_raw, int) and 0 <= correct_answer_raw < len(original_options):
               option_text = get_option_text(original_options[correct_answer_raw])
               option_correct_image = get_option_image(original_options[correct_answer_raw])
               formatted_correct_answer = f"'{option_text}' (Index: {correct_answer_raw})"

            elif q_type == 'multiple' and isinstance(correct_answer_raw, list):
                formatted_correct_answer = [f"'{get_option_text(original_options[idx])}' (Index: {idx})" for idx in correct_answer_raw if 0 <= idx < len(original_options)]
                option_correct_image = [get_option_image(original_options[idx]) for idx in correct_answer_raw if 0 <= idx < len(original_options)]
            elif q_type == 'open':
                if 'acceptable' in question_detail: formatted_correct_answer = question_detail['acceptable']
                elif 'keywords' in question_detail: formatted_correct_answer = {"keywords": question_detail['keywords']}
                else: formatted_correct_answer = "[Manual Grading Required]"
            else: formatted_correct_answer = "[Invalid Question Type]"

        detailed_answers.append({
            "question_id": q_id,
            "question_text": question_text,
            "question_image": question_image_path,
            "student_answer": formatted_student_answer,
            "option_student_image": option_student_image ,
            "option_correct_image": option_correct_image,
            "correct_answer": formatted_correct_answer,
            "weight": question_weight,
            "points_awarded": points,
            "raw_points": points,
            "raw_student_answer": student_answer_raw,
            "raw_correct_answer": correct_answer_raw if question_detail else None,
        })
    return detailed_answers
