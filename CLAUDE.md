# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**QuizParty** is a self-contained quiz application for secure, offline classroom assessments. It runs on a local network without requiring internet, designed for controlled testing in schools and educational institutions.

**Key Characteristics:**
- Offline-first design with optional email functionality
- Flask backend + React (TypeScript) frontend
- JSONC for data storage (questions, scores, students)
- File-based architecture with atomic operations to prevent data corruption
- Server-authoritative quiz state (not client-side local storage)

## Development Commands

### Backend (Python)

```bash
# Start development server
uv run server.py

# Check Python syntax
python3 -m py_compile <file.py>

# Server runs on http://localhost:5001
```

### Frontend (React + TypeScript)

```bash
cd frontend

# Install dependencies
pnpm install

# Development server (with hot reload)
pnpm dev
# Runs on http://localhost:5173

# Build for production
pnpm build
# Output: frontend/dist/ → copied to backend static folder

# Type checking
pnpm run build  # includes: tsc -b

# Lint
pnpm lint
```

### Testing Production Build

```bash
# Build frontend first
cd frontend && pnpm build && cd ..

# Start backend (serves both API and built frontend)
uv run server.py
# Access at http://localhost:5001
```

## Architecture

### Backend Structure

```
server.py              # Flask app entry point, routes registration
utils.py               # Core utilities, file operations, grading logic
email_service.py       # Email functionality (optional)
routes/
  ├── quiz.py          # Student endpoints: /api/start, /api/submit, /api/resume
  └── admin.py         # Admin endpoints: scores, questions, banks, email
```

### Critical Backend Patterns

#### 1. **Server-Authoritative Quiz State**

Quiz progression is stored SERVER-SIDE in `quizzes/{student_id}.json` files:
- Each student gets ONE active quiz identified by `quiz_id`
- Progression tracks: `current_index`, `answers`, `last_updated`
- Students can resume from any device using their `quiz_id`
- Client NEVER stores quiz state in localStorage

#### 2. **Atomic File Operations (Race Condition Prevention)**

**CRITICAL:** Always use atomic operations for concurrent writes:

```python
# CORRECT - Atomic append (quiz submission)
from utils import append_score_atomic
append_score_atomic(score_entry)  # Entire read-modify-write is locked

# CORRECT - Atomic update (admin operations)
from utils import update_scores_atomic
def my_update(scores):
    # Modify scores list
    return scores
update_scores_atomic(my_update)  # Callback executed within lock

# WRONG - Race condition vulnerable
scores = load_scores()
scores.append(new_score)
save_scores(scores)  # Another process could overwrite!
```

**Key functions in utils.py:**
- `append_score_atomic(score_entry)` - Append single score with duplicate check
- `update_scores_atomic(callback)` - Atomic read-modify-write for bulk updates
- Uses `FileLock` with 10-second timeout and `os.replace()` for crash safety

#### 3. **File Format: JSONC (JSON with Comments)**

All data files use JSONC format via `commentjson` library:
- `questions.jsonc` - Master question bank with answers and weights
- `scores.jsonc` - All submitted quiz results
- `students.jsonc` - Allowed student emails (supports groups)
- `quiz_status.jsonc` - Quiz enabled/disabled state

**Questions file structure:**
```jsonc
{
  "title": "Quiz Title",  // Required
  "questions": [
    {
      "id": "q1",
      "type": "single" | "multiple" | "open",
      "text": "Question text",
      "question_image": "path/to/image.jpg",  // Optional
      "options": ["Option 1", "Option 2"] or [{"text": "...", "image": "..."}],
      "correct": 0 or [0, 2] or ["keyword1", "keyword2"],
      "weight": 1
    }
  ]
}
```

#### 4. **Randomization Strategy**

Questions and options are shuffled ONCE per student and saved:
- When student starts: generate `quiz_id`, shuffle questions, shuffle options per question
- Save `option_order` array in plan file to maintain consistency
- Student sees same order even if they refresh or switch devices
- Prevents gaming by reloading page

#### 5. **Grading Architecture**

Location: `utils.py` - `grade()` function

- **Single choice**: Full points if correct index matches
- **Multiple choice**: Proportional scoring with penalties
  ```python
  points_per_correct = weight / num_correct_total
  points_per_wrong = weight / (num_options - num_correct_total)
  score = (num_user_correct * points_per_correct) - (num_user_wrong * points_per_wrong)
  ```
- **Open questions**:
  - Keyword matching: partial credit based on `min_keywords`
  - LLM evaluation: Optional (requires `USE_LLM_EVAL=1` and API keys)

#### 6. **Image Management**

Images stored in two locations:
- `images/` - Active quiz images (served via `/images/<path>`)
- `banks/question_bank/<quiz-slug>/images/` - Archived with quiz

Images are quiz-specific and copied/restored when loading from question bank.

### Frontend Structure

```
frontend/src/
  ├── main.tsx              # App entry point
  ├── App.tsx               # Router setup
  ├── api.ts                # Backend API client functions
  ├── pages/                # Route components
  │   ├── HomePage.tsx      # Student login
  │   ├── QuizPage.tsx      # Quiz taking interface
  │   ├── AdminDashboardPage.tsx  # Admin overview
  │   └── ...               # Other admin pages
  └── components/           # Reusable UI components
```

### Critical Frontend Patterns

#### 1. **Server-Authoritative State Management**

Uses **TanStack Query (React Query)** for server state:

```typescript
// Quiz state comes from server
const { data: quizData } = useQuery({
  queryKey: ["quiz", quizId],
  queryFn: () => resumeQuiz(quizId),  // Fetches current question from server
});

// Progress is server-side
const saveAnswerMutation = useMutation({
  mutationFn: saveAnswer,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["quiz", quizId] });
    refetch();  // Get next question from server
  }
});
```

**Never store quiz state in localStorage** - server is source of truth.

#### 2. **Quiz Flow**

```
1. Student enters email → POST /api/start → returns quiz_id
2. GET /api/resume/{quiz_id} → returns current_question, current_index
3. Student answers → POST /api/save-answer → server saves and advances
4. Repeat step 2-3 until is_complete = true
5. POST /api/submit → server grades using stored answers
```

#### 3. **Admin UI Patterns**

- **No browser alerts**: Use inline confirmations and toast notifications
- **Optimistic updates**: Invalidate queries after mutations
- **Error handling**: Display errors inline, not in alerts
- **Live updates**: Auto-refresh stats every 30 seconds

## Data Persistence

### File Organization

```
.
├── questions.jsonc           # Active question bank
├── scores.jsonc              # Active score records
├── students.jsonc            # Active student list
├── quiz_status.jsonc         # Quiz enabled/disabled
├── quizzes/                  # Active quiz instances
│   └── {student_id}.json     # Per-student quiz plan + progression
├── images/                   # Active quiz images
└── banks/                    # Archives for all data types
    ├── question_bank/        # Saved quizzes with images
    ├── scores_bank/          # Archived results
    └── students_bank/        # Saved student lists
```

### Bank System

Banks allow saving/loading different quiz sets, score archives, and student lists:
- **Automatic naming**: `YYYY-MM-DD_HH-MM_<slugified-title>.jsonc`
- **Atomic operations**: All bank operations use file locking
- **Git sync**: Optional cloud backup to GitHub/GitLab (configured via `.env`)

## Important Quirks & Gotchas

### 1. **Race Conditions**

**Problem:** Concurrent quiz submissions could overwrite each other's scores.
**Solution:** Always use `append_score_atomic()` or `update_scores_atomic()` from utils.py.
**See:** Recent fix documented in conversation (2025-12-12).

### 2. **JSONC Comments**

Use `commentjson` library, not standard `json`:
```python
import commentjson as json  # Not: import json
```

### 3. **Environment Variables**

Required in `.env`:
```bash
ADMIN_PW=...                  # Required - admin password

# Optional - Email functionality
EMAIL_SENDER=...
EMAIL_PASSWORD=...
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587

# Optional - Git cloud sync
BANKS_GIT_REMOTE=...
BANKS_GIT_TOKEN=...
```

**Application fails to start if `ADMIN_PW` is not set.**

### 4. **Question IDs**

Question IDs can be strings or integers:
```python
q_id = str(answer_detail.get('question_id'))  # Always stringify for consistency
```

### 5. **Option Order Preservation**

When recalculating scores, extract original indices from formatted answers:
```python
# Formatted: "'Option text' (Index: 2)"
match = re.search(r'\(Index:\s*(\d+)\)', formatted_answer)
```

This allows recalculation even for old submissions without stored `option_order`.

### 6. **Email vs Student Names**

Student identifier is their **email address** (lowercased). It's used as:
- Login credential
- File naming: `quizzes/{safe_id(email)}.json`
- Score record key

### 7. **Frontend Build Process**

Build output goes to `frontend/dist/`, then served by Flask:
```python
STATIC_FOLDER = os.path.join(APP_DIR, 'frontend', 'dist')
```

Frontend must be built before production deployment.

## Common Tasks

### Adding a New Admin Endpoint

1. Add route in `routes/admin.py`:
```python
@admin_bp.route('/admin/my-feature', methods=['POST'])
def api_my_feature():
    data = request.get_json(silent=True) or {}
    password = data.get('pw')
    if not password or password != ADMIN_PW:
        raise Unauthorized(description="Admin authentication failed.")
    # ... implementation
```

2. Add API function in `frontend/src/api.ts`:
```typescript
export async function myFeature(password: string): Promise<Result> {
  const response = await fetch(`${API_BASE}/admin/my-feature`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pw: password }),
  });
  return handleResponse<Result>(response);
}
```

3. Use in component with React Query:
```typescript
const mutation = useMutation({
  mutationFn: () => myFeature(password),
  onSuccess: (data) => {
    // Update UI
  }
});
```

### Modifying Grading Logic

Location: `utils.py` → `grade(answers, plan, qbank)` function

When modifying:
1. Test with existing scores
2. Consider backward compatibility
3. Admin can recalculate all scores after changes

### Adding a New Question Type

1. Update grading in `utils.py` → `grade()`
2. Add UI in `frontend/src/components/QuestionDisplay.tsx`
3. Update question schema validation
4. Update email templates in `email_service.py`

## Testing Recommendations

### Manual Testing Checklist

**Quiz Flow:**
- [ ] Student can start quiz
- [ ] Questions display correctly (text, images, options)
- [ ] Answer submission saves to server
- [ ] Page refresh maintains progress (resume works)
- [ ] Switching devices works (server-side state)
- [ ] Quiz completion and submission

**Race Conditions (Important!):**
- [ ] Multiple students submit simultaneously → all scores saved
- [ ] Admin recalculate during submission → no corruption
- [ ] Concurrent bank operations → no data loss

**Admin Features:**
- [ ] View scores, export CSV
- [ ] Edit questions, save/load from bank
- [ ] Recalculate scores after question changes
- [ ] Send emails (if configured)
- [ ] Enable/disable quiz access

## Security Notes

- **Admin password**: Required in environment, never hardcoded
- **Student validation**: Emails must be in `students.jsonc`
- **Path traversal**: Flask's `send_from_directory()` provides protection
- **Concurrent access**: File locking prevents corruption
- **No external dependencies**: Offline-first design

## Dependencies

**Backend (Python):**
- Flask - Web framework
- Werkzeug - WSGI utilities (provides exceptions)
- Waitress - Production WSGI server
- commentjson - JSONC parsing
- filelock - File locking for atomic operations
- python-dotenv - Environment variable loading

**Frontend (Node.js):**
- React 19 - UI framework
- React Router - Client-side routing
- TanStack Query - Server state management
- Tailwind CSS - Styling
- Vite - Build tool
- TypeScript - Type safety

## Production Deployment

Recommended: **Systemd service + Nginx reverse proxy** (see README.md).

Key considerations:
- Run backend with Waitress (not Flask dev server)
- Build frontend before deployment
- Configure firewall for LAN-only access
- Set up log rotation
- Create backup scripts for `banks/`, `scores.jsonc`, `students.jsonc`

## Recent Changes

**2025-12-12: Race Condition Fix**
- Added `append_score_atomic()` and `update_scores_atomic()` in utils.py
- Updated `/api/submit`, `/admin/review`, `/admin/scores/recalculate` to use atomic operations
- Prevents data loss when multiple operations happen concurrently
- See conversation history for detailed explanation
