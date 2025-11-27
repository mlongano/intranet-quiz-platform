# utils.py
import commentjson as json
from werkzeug.exceptions import NotFound, BadRequest, Conflict, InternalServerError
from pathlib import Path
import os, re, unicodedata
from dotenv import load_dotenv
import shutil
import tempfile
from filelock import FileLock, Timeout

# --- Load Environment Variables ---
load_dotenv()

# --- Constants (Consider moving to a config.py if they grow) ---
QUEST_FILE = 'questions.jsonc'
SCORE_FILE = 'scores.jsonc'
STUDENTS_FILE = 'students.jsonc'
QUIZ_STATUS_FILE = 'quiz_status.jsonc'
QUIZ_FOLDER = 'quizzes'
IMAGES_FOLDER = 'images'
BANKS_BASE = 'banks' # NEW: Base directory for all banks
QUESTION_BANK_FOLDER = os.path.join(BANKS_BASE, 'question_bank') # Question bank directory
SCORES_BANK_FOLDER = os.path.join(BANKS_BASE, 'scores_bank')     # Scores bank directory
STUDENTS_BANK_FOLDER = os.path.join(BANKS_BASE, 'students_bank') # Students bank directory

# --- Cache for questions (reduce disk I/O) ---
_questions_cache = None
_questions_mtime = 0

def invalidate_questions_cache():
    """Invalidates the questions cache, forcing a reload on next access."""
    global _questions_cache, _questions_mtime
    _questions_cache = None
    _questions_mtime = 0
    print("Questions cache invalidated")

# --- Load Admin Password from Environment Variable ---
ADMIN_PW = os.getenv('ADMIN_PW') # <-- Get password from environment
print(f"[UTILS] Loading ADMIN_PW from environment...")
if not ADMIN_PW:
    print("[UTILS] ✗ Error: ADMIN_PW environment variable not set.")
    print("Please create a .env file in the project root with ADMIN_PW='your_password'")
    # Decide how to handle this: exit or raise an exception
    raise EnvironmentError("ADMIN_PW environment variable is required but not set.")
    #import sys; sys.exit(1)
else:
    print(f"[UTILS] ✓ ADMIN_PW loaded successfully (length: {len(ADMIN_PW)}, value: {'*' * len(ADMIN_PW)})")


os.makedirs(QUIZ_FOLDER, exist_ok=True) # Ensure QUIZ_FOLDER exists
os.makedirs(BANKS_BASE, exist_ok=True) # NEW: Ensure banks base folder exists
os.makedirs(QUESTION_BANK_FOLDER, exist_ok=True) # Ensure question_bank folder exists
os.makedirs(SCORES_BANK_FOLDER, exist_ok=True) # NEW: Ensure scores_bank folder exists
os.makedirs(STUDENTS_BANK_FOLDER, exist_ok=True) # NEW: Ensure students_bank folder exists

# --- Load initial student data ---
try:
    with open(STUDENTS_FILE, encoding='utf-8') as f:
        students_data = json.load(f)
        VALID_STUDENTS = set()

        # Handle different student formats
        for item in students_data:
            if isinstance(item, str):
                # Simple string format: "email@example.com"
                VALID_STUDENTS.add(item.lower())
            elif isinstance(item, dict):
                if 'email' in item:
                    # Individual format: {"email": "...", "group": "..."}
                    VALID_STUDENTS.add(item['email'].lower())
                elif 'emails' in item:
                    # Group format: {"group": "...", "emails": [...]}
                    for email in item.get('emails', []):
                        VALID_STUDENTS.add(email.lower())

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

def sanitize_filename(filename: str) -> str:
    """
    Sanitizes a filename by removing or replacing dangerous characters.
    - Removes path separators (/, \)
    - Removes parent directory references (..)
    - Removes other dangerous characters
    - Preserves file extension
    """
    # Remove path separators and parent directory references
    safe_name = filename.replace('/', '_').replace('\\', '_').replace('..', '_')
    # Remove any remaining dangerous characters but keep alphanumeric, dots, dashes, underscores
    safe_name = re.sub(r'[^\w\s.-]', '', safe_name)
    # Remove leading/trailing whitespace and dots
    safe_name = safe_name.strip('. ')
    return safe_name

def slugify(text: str) -> str:
    """
    Convert text to a URL-friendly slug.
    Removes accents, converts to lowercase, replaces spaces with hyphens.
    """
    # Normalize unicode characters (remove accents)
    text = unicodedata.normalize('NFKD', text)
    text = text.encode('ascii', 'ignore').decode('ascii')
    # Convert to lowercase
    text = text.lower()
    # Replace spaces and underscores with hyphens
    text = re.sub(r'[\s_]+', '-', text)
    # Remove any character that's not alphanumeric or hyphen
    text = re.sub(r'[^a-z0-9-]', '', text)
    # Remove consecutive hyphens
    text = re.sub(r'-+', '-', text)
    # Strip hyphens from start and end
    text = text.strip('-')
    return text or 'untitled'

# --- Helper to format image path for client ---
def format_image_url(image_path):
    """Prepends the base image route if the path is valid."""
    if image_path and isinstance(image_path, str):
        # Simple check to avoid adding prefix multiple times or to absolute URLs
        # Allow paths starting with /images/ or /banks/ (for quiz-specific images)
        if not image_path.startswith(f"/{IMAGES_FOLDER}/") and not image_path.startswith("/banks/") and not image_path.startswith("http"):
             # Remove leading slash if present to avoid //
            clean_path = image_path.lstrip('/')
            return f"/{IMAGES_FOLDER}/{clean_path}"
        # If already properly formatted or is http URL, return as-is
        return image_path
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
    """Saves scores to the scores file with file locking to prevent race conditions."""
    lock_path = f"{SCORE_FILE}.lock"
    lock = FileLock(lock_path, timeout=10)

    try:
        with lock:
            # Read current scores to merge (in case another process wrote during our operation)
            current_scores = []
            if Path(SCORE_FILE).exists():
                try:
                    with open(SCORE_FILE, 'r', encoding='utf-8') as f:
                        current_scores = json.load(f)
                except (ValueError, FileNotFoundError):
                    current_scores = []

            # Merge: append new scores if they're not already present
            # Assuming 'data' is the complete list to save (not just new entries)
            # If data is meant to be appended, adjust logic here

            # Write atomically using temp file
            temp_fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(SCORE_FILE) or '.', suffix='.tmp')
            try:
                with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2)
                os.replace(temp_path, SCORE_FILE)  # Atomic on POSIX systems
            except Exception as e:
                if os.path.exists(temp_path):
                    os.unlink(temp_path)
                raise e
    except Timeout:
        print(f"Error: Could not acquire lock on {SCORE_FILE} within timeout")
        raise InternalServerError(description="Could not save scores due to lock timeout. Please try again.")
    except Exception as e:
        print(f"Error saving scores to {SCORE_FILE}: {e}")
        raise InternalServerError(description=f"Error saving scores: {e}")

def clear_scores_with_backup():
    """Clears all scores by saving to a temporary backup file and emptying the main scores file."""
    backup_file = f"{SCORE_FILE}.temp_backup"

    try:
        # Read current scores
        current_scores = load_scores()

        if not current_scores or len(current_scores) == 0:
            return {"success": True, "message": "No scores to clear.", "backup_file": None}

        # Save to temporary backup
        backup_path = Path(backup_file)
        with backup_path.open('w', encoding='utf-8') as f:
            json.dump(current_scores, f, indent=2)
        print(f"Created temporary backup at {backup_file} with {len(current_scores)} scores")

        # Clear the main scores file
        save_scores([])

        return {
            "success": True,
            "message": f"Cleared {len(current_scores)} scores. Backup saved to {backup_file}",
            "backup_file": backup_file,
            "cleared_count": len(current_scores)
        }
    except Exception as e:
        print(f"Error clearing scores: {e}")
        raise InternalServerError(description=f"Error clearing scores: {e}")

def restore_scores_from_backup():
    """Restores scores from the temporary backup file."""
    backup_file = f"{SCORE_FILE}.temp_backup"
    backup_path = Path(backup_file)

    if not backup_path.exists():
        raise NotFound(description="No temporary backup file found. Please clear scores first to create a backup.")

    try:
        # Read backup
        with backup_path.open('r', encoding='utf-8') as f:
            backup_scores = json.load(f)

        if not isinstance(backup_scores, list):
            raise BadRequest(description="Backup file has invalid format.")

        # Save to main scores file
        save_scores(backup_scores)

        print(f"Restored {len(backup_scores)} scores from {backup_file}")

        return {
            "success": True,
            "message": f"Restored {len(backup_scores)} scores from temporary backup.",
            "restored_count": len(backup_scores)
        }
    except FileNotFoundError:
        raise NotFound(description="Temporary backup file not found.")
    except json.JSONDecodeError:
        raise BadRequest(description="Backup file is corrupted or not valid JSON.")
    except Exception as e:
        print(f"Error restoring scores: {e}")
        raise InternalServerError(description=f"Error restoring scores: {e}")

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


def save_scores_to_bank(filename: str):
    """Saves the current SCORE_FILE to the scores_bank with the provided filename."""
    source_path = Path(SCORE_FILE)
    if not source_path.exists() or not source_path.is_file():
        # If the main scores file doesn't exist, maybe we shouldn't save an empty one?
        # Or save an empty list? Let's raise an error for now for clarity.
        raise InternalServerError(description=f"Current scores file '{SCORE_FILE}' not found. Cannot save empty/non-existent file.")

    # Validate and sanitize the filename
    if not filename:
        raise BadRequest(description="Filename is required.")

    # Ensure filename ends with .jsonc
    if not filename.endswith('.jsonc'):
        filename += '.jsonc'

    # Sanitize the filename
    safe_filename = sanitize_filename(filename)

    target_path = Path(SCORES_BANK_FOLDER) / safe_filename

    if target_path.exists():
        raise Conflict(description=f"File '{safe_filename}' already exists in '{SCORES_BANK_FOLDER}'.")

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
    """Overwrites QUEST_FILE with the content of the specified file from the question_bank.
    Returns a warning message if the file format is invalid, otherwise returns None."""
    source_path = Path(QUESTION_BANK_FOLDER) / filename
    target_path = Path(QUEST_FILE)

    if not source_path.exists() or not source_path.is_file():
         raise NotFound(description=f"Quiz file '{filename}' not found in '{QUESTION_BANK_FOLDER}'.")

    warning_message = None

    # Load and validate JSON format
    try:
        with source_path.open(encoding='utf-8') as f:
            quiz_data = json.load(f)

            # Check if it's the old format or missing required fields
            if not isinstance(quiz_data, dict):
                warning_message = (
                    f"Warning: '{filename}' uses old array format. "
                    f"Please convert to new format with 'title' and 'questions' fields. "
                    f"The file was loaded but may not work correctly."
                )
            elif 'questions' not in quiz_data:
                warning_message = (
                    f"Warning: '{filename}' is missing 'questions' field. "
                    f"Expected format: {{\"title\": \"Quiz Title\", \"questions\": [...]}}. "
                    f"The file was loaded but may not work correctly."
                )
            elif not isinstance(quiz_data.get('questions'), list):
                warning_message = (
                    f"Warning: '{filename}' has invalid 'questions' field (must be an array). "
                    f"The file was loaded but may not work correctly."
                )
    except ValueError as e:
        raise BadRequest(description=f"File '{filename}' is not valid JSON: {e}")
    except Exception as e:
        raise InternalServerError(description=f"Error reading source file '{filename}': {e}")

    try:
        # Create a backup of the current QUEST_FILE before overwriting
        if target_path.exists():
            backup_file = f"{target_path}.bak"
            shutil.copy2(target_path, backup_file)
            print(f"Backed up current {QUEST_FILE} to {backup_file}")

        # Check if there are images to copy
        source_images_folder = get_quiz_images_folder(filename)
        target_images_folder = get_quiz_images_folder(QUEST_FILE)

        images_copied = False
        if source_images_folder.exists() and source_images_folder.is_dir():
            # Backup existing images folder if it exists
            if target_images_folder.exists():
                backup_images_folder = Path(str(target_images_folder) + '.bak')
                if backup_images_folder.exists():
                    shutil.rmtree(backup_images_folder)
                shutil.move(str(target_images_folder), str(backup_images_folder))
                print(f"Backed up current images to {backup_images_folder}")

            # Copy images folder from bank to active quiz location
            try:
                shutil.copytree(source_images_folder, target_images_folder)
                images_copied = True
                print(f"Copied images from '{source_images_folder}' to '{target_images_folder}'")

                # Update image paths in the quiz data to point to new location
                source_basename = Path(filename).stem
                target_basename = Path(QUEST_FILE).stem
                old_path_prefix = f"/banks/question_bank/{source_basename}_images/"
                new_path_prefix = f"/banks/question_bank/{target_basename}_images/"

                # Update image paths in questions
                if 'questions' in quiz_data:
                    for question in quiz_data['questions']:
                        # Update question image
                        if 'question_image' in question and question['question_image']:
                            if question['question_image'].startswith(old_path_prefix):
                                question['question_image'] = question['question_image'].replace(old_path_prefix, new_path_prefix)

                        # Update option images
                        if 'options' in question and isinstance(question['options'], list):
                            for option in question['options']:
                                if isinstance(option, dict) and 'image' in option and option['image']:
                                    if option['image'].startswith(old_path_prefix):
                                        option['image'] = option['image'].replace(old_path_prefix, new_path_prefix)

                print(f"Updated image paths from '{old_path_prefix}' to '{new_path_prefix}'")
            except Exception as e:
                print(f"Warning: Error copying images: {e}")
                # Don't fail the whole operation if image copy fails

        # Save the quiz file with updated paths
        with target_path.open('w', encoding='utf-8') as f:
            json.dump(quiz_data, f, indent=2)
        print(f"Copied '{filename}' from '{QUESTION_BANK_FOLDER}' to '{QUEST_FILE}'.")

        # Invalidate the cache to force reload of the new file
        invalidate_questions_cache()

        return warning_message
    except Exception as e:
        print(f"Error loading quiz from bank: {e}")
        raise InternalServerError(description=f"Error copying file from bank: {e}")


def save_quiz_to_bank(filename: str):
    """Saves the current QUEST_FILE to the question_bank with the provided filename."""
    source_path = Path(QUEST_FILE)
    if not source_path.exists() or not source_path.is_file():
        raise InternalServerError(description=f"Current quiz file '{QUEST_FILE}' not found.")

    # Validate and sanitize the filename
    if not filename:
        raise BadRequest(description="Filename is required.")

    # Ensure filename ends with .jsonc
    if not filename.endswith('.jsonc'):
        filename += '.jsonc'

    # Sanitize the filename
    safe_filename = sanitize_filename(filename)

    target_path = Path(QUESTION_BANK_FOLDER) / safe_filename

    if target_path.exists():
        raise Conflict(description=f"File '{safe_filename}' already exists in '{QUESTION_BANK_FOLDER}'.")

    # Load and validate the source file content
    try:
        with source_path.open(encoding='utf-8') as f:
            quiz_data = json.load(f)
    except ValueError:
        raise InternalServerError(description=f"Current file '{QUEST_FILE}' is not a valid JSONC format.")
    except Exception as e:
        raise InternalServerError(description=f"Error reading current file '{QUEST_FILE}': {e}")

    # Check if there are images to copy
    source_images_folder = get_quiz_images_folder(QUEST_FILE)
    target_images_folder = get_quiz_images_folder(safe_filename)

    images_copied = False
    if source_images_folder.exists() and source_images_folder.is_dir():
        # Copy images folder to new location
        try:
            if target_images_folder.exists():
                print(f"Warning: Target images folder '{target_images_folder}' already exists")
            else:
                shutil.copytree(source_images_folder, target_images_folder)
                images_copied = True
                print(f"Copied images from '{source_images_folder}' to '{target_images_folder}'")

            # Update image paths in the quiz data to point to new location
            if images_copied:
                source_basename = Path(QUEST_FILE).stem
                target_basename = Path(safe_filename).stem
                old_path_prefix = f"/banks/question_bank/{source_basename}_images/"
                new_path_prefix = f"/banks/question_bank/{target_basename}_images/"

                # Update image paths in questions
                if 'questions' in quiz_data:
                    for question in quiz_data['questions']:
                        # Update question image
                        if 'question_image' in question and question['question_image']:
                            if question['question_image'].startswith(old_path_prefix):
                                question['question_image'] = question['question_image'].replace(old_path_prefix, new_path_prefix)

                        # Update option images
                        if 'options' in question and isinstance(question['options'], list):
                            for option in question['options']:
                                if isinstance(option, dict) and 'image' in option and option['image']:
                                    if option['image'].startswith(old_path_prefix):
                                        option['image'] = option['image'].replace(old_path_prefix, new_path_prefix)

                print(f"Updated image paths from '{old_path_prefix}' to '{new_path_prefix}'")
        except Exception as e:
            print(f"Warning: Error copying images: {e}")
            # Don't fail the whole operation if image copy fails

    # Save the quiz file with updated paths
    try:
        with target_path.open('w', encoding='utf-8') as f:
            json.dump(quiz_data, f, indent=2)
        print(f"Saved '{QUEST_FILE}' to '{target_path}'.")
    except Exception as e:
        # Cleanup: remove copied images if file save fails
        if images_copied and target_images_folder.exists():
            shutil.rmtree(target_images_folder)
        print(f"Error saving quiz to bank: {e}")
        raise InternalServerError(description=f"Error copying file to bank: {e}")


def delete_quiz_from_bank(filename: str):
    """Deletes a specified quiz file from the question_bank."""
    if not filename:
        raise BadRequest(description="Filename is required.")

    # Sanitize the filename
    safe_filename = sanitize_filename(filename)

    file_path = Path(QUESTION_BANK_FOLDER) / safe_filename

    if not file_path.exists():
        raise NotFound(description=f"File '{safe_filename}' not found in '{QUESTION_BANK_FOLDER}'.")

    if not file_path.is_file():
        raise BadRequest(description=f"'{safe_filename}' is not a file.")

    try:
        file_path.unlink()  # Delete the file
        print(f"Deleted '{safe_filename}' from '{QUESTION_BANK_FOLDER}'.")
    except Exception as e:
        print(f"Error deleting quiz from bank: {e}")
        raise InternalServerError(description=f"Error deleting file from bank: {e}")


def delete_scores_from_bank(filename: str):
    """Deletes a specified scores file from the scores_bank."""
    if not filename:
        raise BadRequest(description="Filename is required.")

    # Sanitize the filename
    safe_filename = sanitize_filename(filename)

    file_path = Path(SCORES_BANK_FOLDER) / safe_filename

    if not file_path.exists():
        raise NotFound(description=f"File '{safe_filename}' not found in '{SCORES_BANK_FOLDER}'.")

    if not file_path.is_file():
        raise BadRequest(description=f"'{safe_filename}' is not a file.")

    try:
        file_path.unlink()  # Delete the file
        print(f"Deleted '{safe_filename}' from '{SCORES_BANK_FOLDER}'.")
    except Exception as e:
        print(f"Error deleting scores from bank: {e}")
        raise InternalServerError(description=f"Error deleting file from bank: {e}")


def delete_students_from_bank(filename: str):
    """Deletes a specified students file from the students_bank."""
    if not filename:
        raise BadRequest(description="Filename is required.")

    # Sanitize the filename
    safe_filename = sanitize_filename(filename)

    file_path = Path(STUDENTS_BANK_FOLDER) / safe_filename

    if not file_path.exists():
        raise NotFound(description=f"File '{safe_filename}' not found in '{STUDENTS_BANK_FOLDER}'.")

    if not file_path.is_file():
        raise BadRequest(description=f"'{safe_filename}' is not a file.")

    try:
        file_path.unlink()  # Delete the file
        print(f"Deleted '{safe_filename}' from '{STUDENTS_BANK_FOLDER}'.")
    except Exception as e:
        print(f"Error deleting students from bank: {e}")
        raise InternalServerError(description=f"Error deleting file from bank: {e}")



def rename_quiz_in_bank(old_filename: str, new_filename: str):
    """
    Renames a quiz file in the question_bank.
    Also renames the associated images folder and updates image paths in the JSON.
    """
    if not old_filename or not new_filename:
        raise BadRequest(description="Both old and new filenames are required.")

    # Sanitize filenames
    if not old_filename.endswith('.jsonc'): old_filename += '.jsonc'
    if not new_filename.endswith('.jsonc'): new_filename += '.jsonc'

    safe_old = sanitize_filename(old_filename)
    safe_new = sanitize_filename(new_filename)

    old_path = Path(QUESTION_BANK_FOLDER) / safe_old
    new_path = Path(QUESTION_BANK_FOLDER) / safe_new

    if not old_path.exists():
        raise NotFound(description=f"File '{safe_old}' not found.")

    if new_path.exists():
        raise Conflict(description=f"File '{safe_new}' already exists.")

    try:
        # 1. Rename the JSON file
        old_path.rename(new_path)
        print(f"Renamed quiz file: {safe_old} -> {safe_new}")

        # 2. Handle Images Folder
        old_stem = Path(safe_old).stem
        new_stem = Path(safe_new).stem

        old_images_folder = Path(QUESTION_BANK_FOLDER) / f"{old_stem}_images"
        new_images_folder = Path(QUESTION_BANK_FOLDER) / f"{new_stem}_images"

        if old_images_folder.exists() and old_images_folder.is_dir():
            if new_images_folder.exists():
                print(f"Warning: Target images folder '{new_images_folder}' already exists. Merging/Overwriting.")
                # In a real scenario, we might want to be more careful. For now, let's just rename/move.
                pass

            old_images_folder.rename(new_images_folder)
            print(f"Renamed images folder: {old_images_folder.name} -> {new_images_folder.name}")

            # 3. Update paths inside the new JSON file
            try:
                with new_path.open('r', encoding='utf-8') as f:
                    quiz_data = json.load(f)

                updated = False
                old_path_prefix = f"/banks/question_bank/{old_stem}_images/"
                new_path_prefix = f"/banks/question_bank/{new_stem}_images/"

                if 'questions' in quiz_data:
                    for question in quiz_data['questions']:
                        # Update question image
                        if 'question_image' in question and question['question_image']:
                            if question['question_image'].startswith(old_path_prefix):
                                question['question_image'] = question['question_image'].replace(old_path_prefix, new_path_prefix)
                                updated = True

                        # Update option images
                        if 'options' in question and isinstance(question['options'], list):
                            for option in question['options']:
                                if isinstance(option, dict) and 'image' in option and option['image']:
                                    if option['image'].startswith(old_path_prefix):
                                        option['image'] = option['image'].replace(old_path_prefix, new_path_prefix)
                                        updated = True

                if updated:
                    with new_path.open('w', encoding='utf-8') as f:
                        json.dump(quiz_data, f, indent=2)
                    print(f"Updated image paths in '{safe_new}'")

            except Exception as e:
                print(f"Error updating image paths after rename: {e}")

    except Exception as e:
        print(f"Error renaming quiz: {e}")
        # Try to rollback JSON rename if it happened
        if new_path.exists() and not old_path.exists():
            try:
                new_path.rename(old_path)
            except:
                pass
        raise InternalServerError(description=f"Error renaming file: {e}")


def rename_scores_in_bank(old_filename: str, new_filename: str):
    """Renames a scores file in the scores_bank."""
    if not old_filename or not new_filename:
        raise BadRequest(description="Both old and new filenames are required.")

    if not old_filename.endswith('.jsonc'): old_filename += '.jsonc'
    if not new_filename.endswith('.jsonc'): new_filename += '.jsonc'

    safe_old = sanitize_filename(old_filename)
    safe_new = sanitize_filename(new_filename)

    old_path = Path(SCORES_BANK_FOLDER) / safe_old
    new_path = Path(SCORES_BANK_FOLDER) / safe_new

    if not old_path.exists():
        raise NotFound(description=f"File '{safe_old}' not found.")

    if new_path.exists():
        raise Conflict(description=f"File '{safe_new}' already exists.")

    try:
        old_path.rename(new_path)
        print(f"Renamed scores file: {safe_old} -> {safe_new}")
    except Exception as e:
        print(f"Error renaming scores file: {e}")
        raise InternalServerError(description=f"Error renaming file: {e}")


def rename_students_in_bank(old_filename: str, new_filename: str):
    """Renames a students file in the students_bank."""
    if not old_filename or not new_filename:
        raise BadRequest(description="Both old and new filenames are required.")

    if not old_filename.endswith('.jsonc'): old_filename += '.jsonc'
    if not new_filename.endswith('.jsonc'): new_filename += '.jsonc'

    safe_old = sanitize_filename(old_filename)
    safe_new = sanitize_filename(new_filename)

    old_path = Path(STUDENTS_BANK_FOLDER) / safe_old
    new_path = Path(STUDENTS_BANK_FOLDER) / safe_new

    if not old_path.exists():
        raise NotFound(description=f"File '{safe_old}' not found.")

    if new_path.exists():
        raise Conflict(description=f"File '{safe_new}' already exists.")

    try:
        old_path.rename(new_path)
        print(f"Renamed students file: {safe_old} -> {safe_new}")
    except Exception as e:
        print(f"Error renaming students file: {e}")
        raise InternalServerError(description=f"Error renaming file: {e}")


def load_questions(filename: str = QUEST_FILE, lenient: bool = False):
    """Reads and returns the JSON content of a specified file with caching for default file.

    Args:
        filename: Path to the questions file
        lenient: If True, returns raw data even if format is invalid (for editing).
                 Returns dict with 'data' (raw content) and 'warning' (error message if any).
    """
    global _questions_cache, _questions_mtime

    # Use cache only for the main QUEST_FILE
    if filename == QUEST_FILE:
        quest_path = Path(QUEST_FILE)
        if quest_path.exists():
            current_mtime = quest_path.stat().st_mtime
            if _questions_cache is not None and current_mtime <= _questions_mtime:
                print(f"Using cached questions  from '{QUEST_FILE}'")
                return _questions_cache

    # Load from file
    if filename != QUEST_FILE:
        file_path = Path(QUESTION_BANK_FOLDER) / filename
    else:
        file_path = Path(QUEST_FILE)
    print(f"Loading questions from '{file_path}'...")
    if not file_path.exists() or not file_path.is_file():
         raise NotFound(description=f"Quiz file '{filename}' not found in '{QUESTION_BANK_FOLDER}'.")

    try:
        with file_path.open(encoding='utf-8') as f:
            data = json.load(f)

            validation_error = None

            # Validate format: must be object with 'questions' array
            if not isinstance(data, dict):
                validation_error = (
                    f"Invalid format in '{file_path.name}': File uses old array format. "
                    f"Please convert to new format with 'title' and 'questions' fields. "
                    f"Example: {{\"title\": \"Quiz Title\", \"questions\": [...]}}. "
                    f"You can edit the file in the question editor or manually update it."
                )
                if not lenient:
                    raise ValueError(validation_error)
                # In lenient mode, convert old array format to new format for editing
                if isinstance(data, list):
                    data = {'title': '', 'questions': data}
                else:
                    data = {'title': '', 'questions': []}

            if validation_error is None and 'questions' not in data:
                validation_error = (
                    f"Invalid format in '{file_path.name}': Missing 'questions' field. "
                    f"Expected format: {{\"title\": \"Quiz Title\", \"questions\": [...]}}"
                )
                if not lenient:
                    raise ValueError(validation_error)
                # In lenient mode, add empty questions array
                data['questions'] = []

            if validation_error is None and not isinstance(data.get('questions'), list):
                validation_error = f"Invalid format in {file_path.name}: 'questions' field must be an array"
                if not lenient:
                    raise ValueError(validation_error)
                # In lenient mode, reset to empty array
                data['questions'] = []

            questions = data['questions']
            title = data.get('title', None)

            # Format image URLs
            for question in questions:
                question_image = question.get('question_image', None)
                if question_image:
                    question['question_image'] = format_image_url(question_image)
                if question.get('type', None) == 'multiple' or question.get('type', None) == 'single':
                    for opt in question.get('options', []):
                        if type(opt) == dict:
                            opt['image'] = format_image_url(opt.get('image', None))

            # Build result
            result = {
                'title': title,
                'questions': questions
            }

            # In lenient mode, add warning if there was a validation error
            if lenient and validation_error:
                result['warning'] = validation_error

            # Update cache for main file (only cache valid data, not lenient mode)
            if filename == QUEST_FILE and not lenient:
                _questions_cache = result
                _questions_mtime = file_path.stat().st_mtime
                print(f"Cached questions from '{QUEST_FILE}'")

            return result
    except FileNotFoundError:
        raise InternalServerError(description=f"Master question file '{file_path}' not found.")
    except ValueError as e:
        raise BadRequest(description=str(e))
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
    """Saves questions to the master question bank (QUEST_FILE) with backup and file locking."""
    backup_file_path = f"{QUEST_FILE}.bak"
    lock_path = f"{QUEST_FILE}.lock"
    lock = FileLock(lock_path, timeout=10)

    try:
        with lock:
            # --- Backup ---
            copy_file(
                source=QUEST_FILE,
                destination=backup_file_path,
                messages={
                    'success': f'Backup created of {QUEST_FILE} in {backup_file_path}',
                    'error': f'Warning: Could not create backup file of {QUEST_FILE} in {backup_file_path}:'})

            # --- Save ---
            try:
                # Validate format: must be object with 'questions' array
                if not isinstance(data, dict):
                    raise ValueError("Invalid data format: Must be an object with 'title' and 'questions' fields")

                if 'questions' not in data:
                    raise ValueError("Invalid data format: Missing 'questions' field")

                if not isinstance(data['questions'], list):
                    raise ValueError("Invalid data format: 'questions' field must be an array")

                save_data = data

                # Write atomically using temp file
                temp_fd, temp_path = tempfile.mkstemp(dir=os.path.dirname(QUEST_FILE) or '.', suffix='.tmp')
                try:
                    with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                        json.dump(save_data, f, indent=2)
                    os.replace(temp_path, QUEST_FILE)  # Atomic on POSIX

                    # Invalidate cache after successful save
                    invalidate_questions_cache()

                except Exception as e:
                    if os.path.exists(temp_path):
                        os.unlink(temp_path)
                    raise e

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
                        print(f"Error saving questions. Restored from backup: {backup_file_path}")
                    except Exception as restore_e:
                         print(f"CRITICAL: Failed to save questions AND failed to restore backup: {restore_e}")
                raise InternalServerError(description=f"I/O error saving questions to {QUEST_FILE}: {e}") # 500 for system errors
            except Exception as e: # Catch other unexpected errors
                # Attempt to restore from backup
                if os.path.exists(backup_file_path):
                     try:
                         shutil.copy2(backup_file_path, QUEST_FILE)
                         print(f"Error saving questions. Restored from backup: {backup_file_path}")
                     except Exception as restore_e:
                         print(f"CRITICAL: Failed to save questions AND failed to restore backup: {restore_e}")
                raise InternalServerError(description=f"Unexpected error saving questions: {e}")
    except Timeout:
        print(f"Error: Could not acquire lock on {QUEST_FILE} within timeout")
        raise InternalServerError(description="Could not save questions due to lock timeout. Please try again.")

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
    per_question_feedbacks = []
    per_question_verdicts = []
    qbank_map = {q['id']: q for q in qbank}

    for i, step in enumerate(plan.get('plan', [])):
        q_id = step.get('id')
        question_score = 0.0 # Score for this specific question

        if not q_id or q_id not in qbank_map:
            print(f"Warning: Question ID '{q_id}' from plan step {i} not found in question bank.")
            per_question_scores.append(question_score) # Append 0 score for missing question
            per_question_feedbacks.append(None)
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
            import os
            use_llm = os.getenv('USE_LLM_EVAL', '0') == '1'
            llm_feedback = None
            llm_verdict = None
            if use_llm:
                try:
                    from llm_evaluator import evaluate_open_question
                    correct_answers = q.get('acceptable') or q.get('keywords') or []
                    llm_result = evaluate_open_question(q.get('text', ''), user_ans or '', correct_answers)
                    open_score_fraction = float(llm_result.get('score', 0))
                    question_score = w * open_score_fraction
                    llm_feedback = llm_result.get('llm_feedback')
                    llm_verdict = llm_result.get('verdict')
                except Exception as e:
                    print(f"LLM evaluation failed: {e}. Falling back to classic scoring.")
                    open_score_fraction = score_open(user_ans or '', q)
                    question_score = w * open_score_fraction
            else:
                open_score_fraction = score_open(user_ans or '', q)
                question_score = w * open_score_fraction
            per_question_feedbacks.append(llm_feedback)
            per_question_verdicts.append(llm_verdict)
        else:
            per_question_feedbacks.append(None)
            per_question_verdicts.append(None)
        if q_type == 'single':
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
        'scores_per_question': per_question_scores, # Include the list of scores
        'feedbacks_per_question': per_question_feedbacks,
        'verdicts_per_question': per_question_verdicts
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

def format_detailed_answers(plan, qbank_map, answers, scores_list, feedbacks_list=None, verdicts_list=None):
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
        llm_feedback = None
        llm_verdict = None
        if feedbacks_list and i < len(feedbacks_list):
            llm_feedback = feedbacks_list[i]
        if verdicts_list and i < len(verdicts_list):
            llm_verdict = verdicts_list[i]
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
            "llm_feedback": llm_feedback,
            "llm_verdict": llm_verdict,
            "raw_student_answer": student_answer_raw,
            "raw_correct_answer": correct_answer_raw if question_detail else None,
            "option_order": shuffled_option_order,  # Save the shuffle order for recalculation
        })
    return detailed_answers


# --- Students Bank Functions ---

def list_students_bank_files():
    """Lists available students files (jsonc) in the students_bank folder."""
    students_files = []
    bank_path = Path(STUDENTS_BANK_FOLDER)
    if not bank_path.is_dir():
        return []
    for item in bank_path.iterdir():
        if item.is_file() and item.suffix.lower() == '.jsonc':
            students_files.append(item.name)
    return sorted(students_files)

def load_students_from_bank(filename: str):
    """Overwrites STUDENTS_FILE with the content of the specified file from the students_bank."""
    source_path = Path(STUDENTS_BANK_FOLDER) / filename
    target_path = Path(STUDENTS_FILE)

    if not source_path.exists() or not source_path.is_file():
         raise NotFound(description=f"Students file '{filename}' not found in '{STUDENTS_BANK_FOLDER}'.")

    try:
        with source_path.open(encoding='utf-8') as f:
            json.load(f) # Just load to check if it's valid JSONC
    except ValueError:
        raise BadRequest(description=f"File '{filename}' is not a valid JSONC format.")
    except Exception as e:
        raise InternalServerError(description=f"Error reading source file '{filename}': {e}")

    try:
        # Create a backup of the current STUDENTS_FILE before overwriting
        if target_path.exists():
            backup_file = f"{target_path}.bak"
            shutil.copy2(target_path, backup_file)
            print(f"Backed up current {STUDENTS_FILE} to {backup_file}")

        shutil.copy2(source_path, target_path)
        print(f"Copied '{filename}' from '{STUDENTS_BANK_FOLDER}' to '{STUDENTS_FILE}'.")
    except Exception as e:
        print(f"Error loading students from bank: {e}")
        raise InternalServerError(description=f"Error copying file from bank: {e}")


def save_students_to_bank(filename: str):
    """Saves the current STUDENTS_FILE to the students_bank with the provided filename."""
    source_path = Path(STUDENTS_FILE)
    if not source_path.exists() or not source_path.is_file():
        raise InternalServerError(description=f"Current students file '{STUDENTS_FILE}' not found. Cannot save empty/non-existent file.")

    # Validate and sanitize the filename
    if not filename:
        raise BadRequest(description="Filename is required.")

    # Ensure filename ends with .jsonc
    if not filename.endswith('.jsonc'):
        filename += '.jsonc'

    # Sanitize the filename
    safe_filename = sanitize_filename(filename)

    target_path = Path(STUDENTS_BANK_FOLDER) / safe_filename

    if target_path.exists():
        raise Conflict(description=f"File '{safe_filename}' already exists in '{STUDENTS_BANK_FOLDER}'.")

    try:
        with source_path.open(encoding='utf-8') as f:
            json.load(f) # Just load to check if it's valid JSONC
    except ValueError:
        raise InternalServerError(description=f"Current file '{STUDENTS_FILE}' is not a valid JSONC format.")
    except Exception as e:
        raise InternalServerError(description=f"Error reading current file '{STUDENTS_FILE}': {e}")

    try:
        shutil.copy2(source_path, target_path)
        print(f"Saved '{STUDENTS_FILE}' to '{target_path}'.")
    except Exception as e:
        print(f"Error saving students to bank: {e}")
        raise InternalServerError(description=f"Error copying file to bank: {e}")


# --- Quiz Status Management ---

def load_quiz_status():
    """
    Loads the quiz enabled/disabled status from QUIZ_STATUS_FILE.
    Returns a dict with 'enabled' boolean field.
    If file doesn't exist, creates it with enabled=True (default).
    """
    status_path = Path(QUIZ_STATUS_FILE)

    # If file doesn't exist, create it with default enabled state
    if not status_path.exists():
        default_status = {"enabled": True}
        try:
            with status_path.open('w', encoding='utf-8') as f:
                json.dump(default_status, f, indent=2)
            print(f"Created {QUIZ_STATUS_FILE} with default enabled=True")
            return default_status
        except Exception as e:
            print(f"Error creating quiz status file: {e}")
            # Return default status even if file creation fails
            return default_status

    # Load existing status
    try:
        with status_path.open(encoding='utf-8') as f:
            status = json.load(f)

        # Validate the status structure
        if not isinstance(status, dict) or 'enabled' not in status:
            print(f"Warning: Invalid quiz status format in {QUIZ_STATUS_FILE}, resetting to enabled=True")
            status = {"enabled": True}
            save_quiz_status(status)

        return status
    except json.JSONLibraryException as e:
        print(f"Error parsing {QUIZ_STATUS_FILE}: {e}")
        raise InternalServerError(description=f"Quiz status file is corrupted: {e}")
    except Exception as e:
        print(f"Error reading {QUIZ_STATUS_FILE}: {e}")
        raise InternalServerError(description=f"Error reading quiz status: {e}")


def save_quiz_status(status):
    """
    Saves the quiz status to QUIZ_STATUS_FILE.
    Expected format: {"enabled": boolean}
    """
    if not isinstance(status, dict) or 'enabled' not in status:
        raise BadRequest(description="Invalid status format. Expected: {'enabled': boolean}")

    if not isinstance(status['enabled'], bool):
        raise BadRequest(description="'enabled' field must be a boolean")

    status_path = Path(QUIZ_STATUS_FILE)

    try:
        # Use atomic write with temp file for safety
        temp_fd, temp_path = tempfile.mkstemp(dir='.', suffix='.tmp')
        try:
            with os.fdopen(temp_fd, 'w', encoding='utf-8') as f:
                json.dump(status, f, indent=2)
            os.replace(temp_path, str(status_path))  # Atomic on POSIX
            print(f"Updated quiz status: enabled={status['enabled']}")
        except Exception as e:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise e
    except Exception as e:
        print(f"Error saving quiz status: {e}")
        raise InternalServerError(description=f"Error saving quiz status: {e}")


# --- Image Management Functions ---

def get_quiz_images_folder(quiz_filename):
    """
    Get the images folder path for a specific quiz file.
    Format: /banks/question_bank/{quiz_basename}_images/
    """
    print(f"[DEBUG] get_quiz_images_folder called with: {quiz_filename}")
    quiz_path = Path(quiz_filename)
    quiz_basename = quiz_path.stem  # Get filename without extension
    images_folder = Path(QUESTION_BANK_FOLDER) / f"{quiz_basename}_images"
    print(f"[DEBUG] Images folder path: {images_folder}")
    return images_folder


def upload_image_to_quiz(quiz_filename, image_file, original_filename):
    """
    Upload an image file for a specific quiz.

    Args:
        quiz_filename: The quiz file name (e.g., "20251024_164801_5CI-TPSIT-Java_Thread.jsonc")
        image_file: File object (from Flask request.files)
        original_filename: Original filename of the uploaded image

    Returns:
        dict: {"success": True, "path": "/banks/question_bank/...", "filename": "..."}
    """
    # Sanitize the filename
    safe_filename = sanitize_filename(original_filename)

    # Get or create the quiz images folder
    images_folder = get_quiz_images_folder(quiz_filename)
    images_folder.mkdir(parents=True, exist_ok=True)

    # Create full path for the image
    image_path = images_folder / safe_filename

    # Check if file already exists
    if image_path.exists():
        raise Conflict(description=f"Image '{safe_filename}' already exists for this quiz")

    # Save the file
    try:
        image_file.save(str(image_path))
        # Convert to absolute path first, then get relative path
        absolute_path = image_path.resolve()
        relative_path = str(absolute_path.relative_to(Path.cwd().resolve()))
        print(f"Uploaded image: {relative_path}")
        return {
            "success": True,
            "path": f"/{relative_path}",
            "filename": safe_filename
        }
    except Exception as e:
        print(f"Error uploading image: {e}")
        raise InternalServerError(description=f"Error uploading image: {e}")


def list_quiz_images(quiz_filename):
    """
    List all images for a specific quiz.

    Args:
        quiz_filename: The quiz file name

    Returns:
        list: Array of image info dicts with path, filename, size
    """
    try:
        images_folder = get_quiz_images_folder(quiz_filename)

        if not images_folder.exists():
            return []

        images = []
        for image_file in images_folder.iterdir():
            if image_file.is_file() and image_file.suffix.lower() in ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp']:
                # Convert to absolute path first, then get relative path
                absolute_path = image_file.resolve()
                relative_path = str(absolute_path.relative_to(Path.cwd().resolve()))
                images.append({
                    "filename": image_file.name,
                    "path": f"/{relative_path}",
                    "size": image_file.stat().st_size
                })

        return images
    except Exception as e:
        print(f"Error in list_quiz_images for '{quiz_filename}': {e}")
        import traceback
        traceback.print_exc()
        raise InternalServerError(description=f"Error listing images: {e}")


def delete_quiz_image(quiz_filename, image_filename):
    """
    Delete an image file from a quiz's images folder.

    Args:
        quiz_filename: The quiz file name
        image_filename: The image filename to delete

    Returns:
        dict: {"success": True, "message": "..."}
    """
    # Sanitize the image filename to prevent path traversal
    safe_image_filename = sanitize_filename(image_filename)

    images_folder = get_quiz_images_folder(quiz_filename)
    image_path = images_folder / safe_image_filename

    # Validate that the path is within the images folder
    try:
        image_path = image_path.resolve()
        images_folder = images_folder.resolve()
        if not str(image_path).startswith(str(images_folder)):
            raise BadRequest(description="Invalid image path")
    except Exception:
        raise BadRequest(description="Invalid image path")

    # Check if file exists
    if not image_path.exists():
        raise NotFound(description=f"Image '{image_filename}' not found")

    # Delete the file
    try:
        image_path.unlink()
        print(f"Deleted image: {image_path}")
        return {
            "success": True,
            "message": f"Image '{image_filename}' deleted successfully"
        }
    except Exception as e:
        print(f"Error deleting image: {e}")
        raise InternalServerError(description=f"Error deleting image: {e}")


def clear_active_quiz_images():
    """
    Clear all images in the active quiz images folder (questions_images).
    This is useful to clean up unused images that accumulate over time.

    Returns:
        dict: {"success": True, "message": "...", "deleted_count": int}
    """
    images_folder = get_quiz_images_folder(QUEST_FILE)

    if not images_folder.exists():
        return {
            "success": True,
            "message": "No images folder to clear",
            "deleted_count": 0
        }

    try:
        # Count files before deletion
        image_files = [f for f in images_folder.iterdir() if f.is_file()]
        count = len(image_files)

        # Delete all files in the folder
        for image_file in image_files:
            try:
                image_file.unlink()
                print(f"Deleted: {image_file.name}")
            except Exception as e:
                print(f"Warning: Could not delete {image_file.name}: {e}")

        print(f"Cleared {count} images from {images_folder}")
        return {
            "success": True,
            "message": f"Deleted {count} image(s) from active quiz folder",
            "deleted_count": count
        }
    except Exception as e:
        print(f"Error clearing images: {e}")
        raise InternalServerError(description=f"Error clearing images: {e}")
