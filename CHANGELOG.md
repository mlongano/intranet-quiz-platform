# Changelog

All notable changes to QuizParty will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

(No unreleased changes yet)

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
