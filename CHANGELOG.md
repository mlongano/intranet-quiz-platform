# Changelog

All notable changes to intranet-quiz-platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

(Refactor in design phase — see `docs/REFACTOR-PLAN-PROMPT.md`)

---

## [1.0.0-alpha] - 2026-05-07

Fork point from `mlongano/intranet-quiz-manager` at v2.6.0 (commit 5fd8ad5).
Codebase still reflects the single-tenant architecture; multi-tenant refactor not yet started.
See `docs/ARCHITECTURE-CURRENT.md` for the as-is baseline and `docs/REFACTOR-PLAN-PROMPT.md` for the refactor plan.

---

## [2.6.0] - 2026-05-07

### Added

- **Open questions shuffled to end of plan** — when building a student's quiz plan, non-open questions (single/multiple choice) are placed first in randomised order, followed by open-ended questions in their own randomised group; this keeps the more objective questions together and avoids students running out of time on structured questions

### Changed

- **Score backup filenames include quiz slug** — timestamped backup files now embed the slugified quiz title for easier identification, e.g. `scores.jsonc.backup_2026-05-06_ospf-nat-acl` instead of a fixed name
- **Score backup filename format** — backup filenames use a `YYYY-MM-DD` timestamp prefix instead of a fixed suffix, making backups sortable chronologically on the filesystem

---

## [2.5.0] - 2026-04-05

### Added

#### Design System & Theming

- **Dark-first CSS design token system** — comprehensive custom-property palette in `main.css` covering surface colours, neon-blue/purple accent palette, typography scale, border-radius steps, and shadow levels; consumed by Tailwind's `@theme` block so every utility class is automatically available
- **Google Fonts** — Space Grotesk (headings) and Manrope (body) loaded via preconnect hints
- **ThemeToggle component** — Sun/Moon button that persists the user's light/dark preference to `localStorage` and updates the `data-theme` attribute on `<html>`; available in both admin and student UIs
- **Prism syntax themes** (`prism-themes.css`) — dark and light code-block highlight overrides integrated with the design token palette
- **`lib/theme.ts`** — `initTheme()` / `toggleTheme()` helpers called on app boot

#### Accessibility

- **Floating AccessibilityPanel** — persistent panel for students with live controls:
  - Font size adjustment (four steps)
  - Line-spacing adjustment
  - Dyslexia-friendly font toggle (OpenDyslexic)
  - High-contrast mode toggle
- **`useAccessibility` hook** — manages and persists all accessibility preferences to `localStorage`

#### Admin Layout & Navigation

- **Collapsible sidebar** with sticky top header — replaces the previous full-page outlet shell
- **Expandable navigation sections** for the Archives group (questions bank, scores bank, students bank)
- **Animated StatCards** on the dashboard — live counts for quiz status, students, and submissions, with entry animations via Framer Motion
- **Sticky question-editor toolbar** — stays visible when scrolling through long question lists
- **Title colour customisation** — admins can set a custom accent colour for the quiz title in the editor
- **Edit shortcut from Scores Bank Review** — navigate directly into the question editor from a review card

#### Dependencies

- `framer-motion` — UI animations (StatCard entries, sidebar transitions)
- `lucide-react` — icon set replacing ad-hoc emoji/SVG usage throughout the app

#### Documentation

- `docs/DESIGN.md` — design-system reference and token catalogue
- `docs/PROJECT.md` — full project overview and architecture guide
- `docs/AdminDashboard.png` / `docs/AdminDashboard.html` — visual reference for the admin dashboard

### Changed

- **Complete UI migration** — all admin pages (Dashboard, Scores, ScoresBank, ScoresBankReview, QuestionEditor, BankManager, ImageManager, Students, StudentBank, LoginPage) and all student pages (Start, Quiz, Finish, Error) migrated to the new `AdminLayout` shell and CSS design tokens
- **Shared components** (`ImagePicker`, `JsonSafeField`, `LoadingSpinner`, `QuestionDisplay`, `SubmissionDetailView`) updated to design tokens
- **LLM evaluator** — migrated from custom HTTP calls to OpenAI/Anthropic APIs to the unified `llm` Python library; provider is now configured entirely through `llm`'s plugin system; `LLM_PROVIDER` env var removed; `/api/llm-info` endpoint simplified
- **`.env.example`** — updated to reflect new `llm`-library configuration (removed `LLM_PROVIDER`, added `llm keys set` instructions)
- **Email subject default** — improved pre-filled subject line for bulk score notifications

### Fixed

- **Stale quiz plan detection** — on start/resume, the server now validates that the stored plan's question IDs still exist in the active question bank; stale plans are automatically discarded, preventing `KeyError` crashes and silent progress corruption after bank edits

---

## [2.4.0] - 2026-04-05

### Added

#### Scores Bank Review

- **Admin Scores Bank Review page** (`/admin/scores-bank-review`) — new page to deep-dive into archived score files
  - Summary statistics: total students, completed count, average score
  - **Student view**: grid of cards; click any card to see full question-by-question breakdown
  - **Question view**: per-question performance with correctness statistics across all submissions
  - Navigation shortcut from the Archives card on the admin dashboard
  - Inline editing of individual score entries directly on the review page
  - GitHub source-link integration for quick cross-reference

- **Scores bank override endpoint** (`POST /api/admin/scores-bank/update`) — update an archived score file in place

#### LLM Re-grading from Scores Bank

- **LLM info endpoint** (`GET /api/admin/llm-info`) — returns the active model name and availability
- **LLM re-grade endpoint** (`POST /api/admin/scores-bank/regrade`) — re-score open-ended questions in any archived scores file using the configured LLM, without touching the active quiz

#### Bank File Editing

- **Direct bank file editing** — edit question bank files in-place from the bank manager without loading them as the active quiz
  - New `save_questions_to_bank()` utility with atomic write, backup creation, and file locking
  - Bank file update endpoint (`POST /api/admin/questions-bank/update`) with lenient-preview option
  - Frontend bank quiz editing API functions (`loadBankQuiz`, `saveBankQuiz`)

#### Tests

- **pytest configuration** (`pyproject.toml`) and initial API test suite (`tests/`)
- **Load tests** for concurrent API requests to validate atomic file operations under stress

### Changed

- **Dynamic student loading** — replaced the static `VALID_STUDENTS` module-level cache with `load_valid_students()`, which re-reads `students.jsonc` on every request; no server restart required after editing the student list
- **Admin route rename** — `/api/admin/bank` changed to `/api/admin/questions-bank` for clarity; frontend updated accordingly

### Fixed

- **Timezone-aware datetime** — replaced deprecated `datetime.utcnow()` with `datetime.now(timezone.utc)` throughout the backend

### Code Quality

- Standardized string quote style across `email_service.py`, `routes/admin.py`, and quiz-related modules
- Added `AGENTS.md` coding guidelines for AI agents working on this codebase

---

## [2.3.0] - 2025-12-13

### Fixed

- **Race Conditions**: Implemented atomic file operations for backend scores and bank management to prevent data corruption during concurrent requests.
- **Window Open Issue**: Fixed an issue in Admin Dashboard where `window.open` was not functioning correctly; replaced with robust window opening logic.
- **Rename Feature**: Restored the missing rename functionality for files in the bank management pages (Scores, Students, Questions).

### Added

- **Rename UI**: Added rename buttons and modals to bank management interfaces.

---

## [2.2.0] - 2025-10-26

### Added

#### Image Management System

- **Image upload and management** for quiz questions and answer options
- New `/admin/images` page with drag-and-drop file upload interface
- Support for PNG, JPG, JPEG, GIF, and WEBP image formats (max 5MB per file)
- Grid-based image gallery with preview and delete functionality
- Quiz-specific image folders: `banks/question_bank/{quiz_basename}_images/`
- Images automatically saved with quiz to bank (including image folder)
- Images loaded from bank when quiz is restored
- Backend API endpoints for image operations (`POST /api/admin/upload-images`, `GET /api/admin/list-images`, `DELETE /api/admin/delete-image`)
- Image picker integrated into question editor with thumbnail previews
- Image count display in question editor header
- Clear all images functionality with inline confirmation
- Static file serving for quiz images via Flask

#### User Experience Improvements

- **Replaced all browser alerts** (`window.confirm`, `window.alert`) with inline confirmation UI
- Toast notification system with color-coded messages (success=green, error=red, warning=yellow)
- Close buttons on toast notifications for dismissible messages
- Inline confirmation panels for destructive actions (Delete? Yes/No buttons)
- Visual feedback for all file operations (load, save, delete)
- Consistent confirmation UX across all bank management pages

#### Bank Management Enhancements

- **Delete functionality** added to scores bank and students bank pages
- Inline confirmation UI for delete operations (matching question bank pattern)
- Load confirmation for students bank (prevents accidental overwrites)
- Delete buttons with inline Yes/No confirmation in all bank pages
- Email subject validation with inline error messages (no alerts)
- Improved button states during async operations (Loading..., Deleting..., etc.)

#### Admin Scores Page Improvements

- **Inline confirmation UI** for dangerous operations:
  - Recalculate all scores - "Re-grade all submissions?"
  - Clear all scores - "Clear all scores?"
  - Restore scores - "Restore from backup?"
- Email subject validation in both single and bulk email modals
- Inline error messages instead of browser alerts
- **CSV export with smart filenames** - Uses slugified quiz title in format: `YYYY-MM-DD_quiz-title_scores.csv`

#### Code Quality

- **Centralized `slugify` utility function** in `frontend/src/lib/utils.ts`
- Removed duplicate slugify implementations across multiple files
- Consistent slug generation for filenames throughout the application
- JSDoc documentation for utility functions

### Changed

- Admin password no longer required when navigating between admin pages (session preserved)
- Image management integrated directly into question editor workflow
- All confirmation dialogs now use inline UI components instead of browser modals
- CSV export filenames now include date prefix and slugified quiz title
- File upload validation errors shown inline instead of alerts

### Fixed

- Race conditions in file operations eliminated
- Caching issues with file list refreshes resolved
- Visual feedback for invalid file format uploads
- Back button in image manager no longer requires password re-entry

### Technical Details

#### Backend (`utils.py`)

- `delete_scores_from_bank(filename)` - Delete scores file with validation
- `delete_students_from_bank(filename)` - Delete students file with validation
- Image file handling with secure path validation
- Static route configuration for image serving

#### Backend (`routes/admin.py`)

- `POST /api/admin/upload-images` - Multi-file upload with validation
- `GET /api/admin/list-images` - List images for current quiz
- `DELETE /api/admin/delete-image` - Delete single image with validation
- `POST /api/admin/scores-bank/delete` - Delete scores file from bank
- `POST /api/admin/students-bank/delete` - Delete students file from bank
- `POST /api/admin/clear-quiz-images` - Clear all images for active quiz

#### Frontend

- **New Components**:
  - `ImagePicker.tsx` - Reusable image selection component with thumbnails
  - Toast notification system (inline, not a separate component)

- **New Pages**:
  - `AdminImagesPage.tsx` - Dedicated image management interface

- **Updated API Functions** (`frontend/src/api.ts`):
  - `uploadImages(files, password)` - Upload multiple images
  - `listQuizImages(password)` - Get images for current quiz
  - `deleteImage(filename, password)` - Delete single image
  - `deleteScoresFromBank(filename, password)` - Delete scores file
  - `deleteStudentsFromBank(filename, password)` - Delete students file
  - `clearQuizImages(password)` - Delete all images for active quiz

- **New Utilities** (`frontend/src/lib/utils.ts`):
  - `slugify(text)` - Convert text to URL-safe slug format

- **UI Updates**:
  - All bank management pages now have delete functionality with inline confirmations
  - AdminScoresPage has inline confirmations for all dangerous operations
  - Email modals show validation errors inline
  - Question editor integrates ImagePicker component
  - Image count display in editor header

---

## [2.1.0] - 2025-10-26

### Added

#### Quiz Enable/Disable Feature

- **Quiz control toggle** in admin dashboard header
- Visual toggle switch with green (enabled) / red (disabled) color coding
- Animated toggle state transitions
- Real-time status updates without page refresh
- Quiz status persistence in `quiz_status.jsonc` file
- Backend API endpoints for quiz status management (`GET/POST /api/admin/quiz-status`)
- Student-facing warning banner on start page when quiz is disabled
- Full-page "Quiz Disabled" message with friendly UI when students try to access
- Disabled state prevents quiz start, resume, and submission at API level
- Silent toggle operation (no modal on success, only on error)

#### Backend

- **New utility functions** in `utils.py`:
  - `load_quiz_status()` - Load quiz enabled/disabled state from file
  - `save_quiz_status()` - Save quiz status with atomic writes
- **Updated `/api/start` endpoint** - Checks quiz status before allowing students to start
- **New API endpoints** in `routes/admin.py`:
  - `GET /api/admin/quiz-status` - Public endpoint to check if quiz is enabled
  - `POST /api/admin/quiz-status` - Admin endpoint to enable/disable quiz

#### Frontend

- **TypeScript Interface** in `frontend/src/api.ts`:
  - `QuizStatus` - Quiz enabled/disabled state
- **API Functions**:
  - `getQuizStatus()` - Fetch current quiz status
  - `setQuizStatus(enabled, password)` - Toggle quiz status (admin only)
- **UI Updates**:
  - `AdminDashboardPage.tsx` - Toggle switch in header with real-time status
  - `QuizPage.tsx` - Full-page disabled message with icon and back button
  - `StartPage.tsx` - Warning banner and disabled form inputs when quiz is off

---

## [2.0.0] - 2025-10-26

### Added

#### Cloud Sync Feature (Git-based)

- **Git-based cloud synchronization** for all banks (questions, scores, students)
- New `banks/` directory structure containing all three banks in one location
- Support for GitHub and GitLab (or any Git repository) as backup storage
- Automatic pull-commit-push workflow from the admin dashboard
- Personal access token authentication for secure cloud access (token-only format)
- Sync status display showing initialization state, last commit, and pending changes
- One-click sync button in Archives card on admin dashboard
- Sync results modal showing detailed operation feedback (files pulled/committed/pushed)
- Configuration via `.env` file: `BANKS_GIT_REMOTE`, `BANKS_GIT_TOKEN` (username optional)
- Comprehensive logging for debugging Git operations
- Smart error handling with user-friendly messages

#### Dashboard Enhancements

- **Auto-refresh functionality** with 30-second countdown timer
- **Pending students modal** - Click on pending submissions count to see list of students who haven't submitted
- **Submitted students modal** - Click on total submissions to see list of students who have submitted
- **Clickable statistics cards** - All dashboard cards now navigate to their respective pages
- **Cursor pointer styling** on all interactive elements for better UX
- **Archive breakdown** in bank manager cards - Separate clickable counts for questions, scores, and students archives

#### Migration Tools

- `migrate_banks.sh` - Bash script for macOS/Linux to migrate old bank structure to new `banks/` directory
- `migrate_banks.ps1` - PowerShell script for Windows to migrate old bank structure
- `fix_git_remote.sh` - Script to update existing Git repositories with correct authentication format
- Interactive migration with confirmation prompts for existing files
- Automatic cleanup of empty old directories after migration

### Changed

- **Directory Structure**: All banks now located in `banks/` directory:
  - `question_bank/` → `banks/question_bank/`
  - `scores_bank/` → `banks/scores_bank/`
  - `students_bank/` → `banks/students_bank/`
- Updated `.gitignore` to exclude `banks/` directory from main codebase repository
- Updated `utils.py` path constants to use new `banks/` structure
- Enhanced admin dashboard with real-time data updates and better navigation
- **Student format parsing** now supports three formats:
  - Simple email strings: `"email@example.com"`
  - Individual objects: `{"email": "...", "group": "..."}`
  - Group objects: `{"group": "...", "emails": [...]}`
- **Git authentication** changed to token-only format (no username required)
- **Sync button location** moved from header to Archives card for better context

### Fixed

- **Route mismatch** causing 405 errors - Backend routes now include `/admin` prefix
- **GitHub authentication failures** - Updated to token-only HTTPS format
- **Student loading errors** - Fixed parsing to handle mixed student formats in same file
- **Environment variable documentation** - `.env.example` now accurately reflects all configurable variables

### Technical Details

#### Backend

- **New Module**: `git_sync.py` - Complete Git operations wrapper
  - `GitSyncError` exception class for sync-specific errors
  - `is_git_configured()` - Validates environment configuration with detailed logging
  - `is_git_initialized()` - Checks if Git repository exists in banks/
  - `init_git_repo()` - Initializes Git repository with remote
  - `sync_banks()` - Full sync workflow (pull, commit, push) with comprehensive logging
  - `get_sync_status()` - Returns current repository state
  - Token injection into HTTPS URLs for authentication (token-only format)
  - Error handling with full tracebacks for debugging

- **Updated API Endpoints** in `routes/admin.py`:
  - `POST /api/admin/git-sync/status` - Get sync configuration and status (fixed route prefix)
  - `POST /api/admin/git-sync/init` - Initialize Git repository
  - `POST /api/admin/git-sync/sync` - Perform synchronization with detailed logging
  - All endpoints include comprehensive error logging

#### Frontend

- **TypeScript Interfaces** in `frontend/src/api.ts`:
  - `GitSyncStatus` - Sync configuration and repository state
  - `GitSyncResult` - Sync operation results with detailed changes

- **API Functions**:
  - `getGitSyncStatus()` - Fetch current sync status
  - `initGitSync()` - Initialize Git repository
  - `syncBanks()` - Trigger synchronization

- **UI Components** in `AdminDashboardPage.tsx`:
  - Sync button in Archives card (context-aware: "Initialize Sync" or "Sync to Cloud")
  - Loading states with animated spinner during sync operations
  - Success/error modal with detailed feedback
  - Status display showing last commit timestamp and remote URL
  - Stop propagation on sync button to prevent card navigation
  - Debug console logging for troubleshooting

### Documentation

- Comprehensive **Cloud Sync for Banks** section in README.md:
  - Step-by-step setup guide for GitHub and GitLab
  - Personal access token generation instructions with expiration warnings
  - Token-only authentication format (no username required)
  - Environment variable configuration
  - Migration guide from old structure
  - Tips for regular syncing and multi-machine usage
  - **Cloud Sync Issues** troubleshooting section with common problems and solutions

- Updated **frontend/README.md**:
  - Cloud Sync Integration in Dashboard Enhancements
  - Complete Cloud Sync Features section
  - API layer documentation for Git operations
  - Students Management notes on mixed-format support
  - Cloud Sync Issues troubleshooting section

- Updated directory layout diagram in README.md
- Marked cloud sync as completed in TODO section
- Added `.env.example` documentation for Git sync variables with accurate path information
- Created `fix_git_remote.sh` script for updating existing repositories

### Security

- Personal access tokens stored in `.env` (never committed)
- Token injection into URLs (not visible in logs)
- Support for private repositories to protect student data
- `.env.example` includes security best practices

### Migration Path

Users with existing installations can:

1. Run migration script (`migrate_banks.sh` or `migrate_banks.ps1`)
2. Set up Git sync in `.env` (optional)
3. Continue using the application without interruption

All existing functionality remains backward compatible.

---

## [Previous Versions]

### Earlier Features (Already in Production)

- Email quiz results to students
- Score recalculation against updated question bank
- CSV export functionality
- Question bank management and archiving
- Quiz title support with slugified filenames
- Student management with group support and email validation
- Students bank for saving/loading different student lists
- Scores bank for managing score history
- Markdown support for questions and answers
- Real-time admin dashboard with statistics
- Automatic backups and file locking
- Fair randomization of questions and answers
- Support for single choice, multiple choice, and open-ended questions
- Image support for questions and answer options
- Keyword-based scoring for open responses
- Offline operation without internet connectivity

---

## Future Roadmap

See the TODO section in README.md for planned features including:

- Quiz timer functionality
- UI/UX improvements
- Internationalization (i18n)
- Docker deployment
- More question types (matching, fill-in-the-blank)
- Database migration for better scalability
- Feedback system for students
