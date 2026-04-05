# QuizParty Frontend

Modern React + TypeScript interface for the QuizParty quiz management system — covering both the student-facing quiz experience and the full admin panel.

> 📖 **For full project documentation, installation instructions, and features, see the [main README](../README.md)**

## Overview

This is the frontend built with:

- **React 19** - Modern React with hooks
- **TypeScript** - Type-safe development (strict mode)
- **Vite 6** - Fast build tool and dev server
- **TanStack Query v5** - Server state management and caching
- **React Router v7** - Client-side routing
- **Tailwind CSS v4** - Utility-first styling with CSS design tokens
- **Framer Motion** - Smooth animations (StatCards, transitions)
- **Lucide React** - Icon set
- **React Markdown** - Markdown rendering with syntax support (PrismJS)

## Architecture

### Layouts

- **`AdminLayout`** — Shared admin shell with collapsible sidebar and sticky frosted-glass header. Renders a `ThemeToggle`, optional `headerActions`, and navigates while preserving the admin password via `location.state`. The Archives nav item is expandable to show Question / Scores / Students bank sub-pages.

### Pages

**Admin pages:**

- **`AdminLoginPage`** — Password-protected admin access
- **`AdminDashboardPage`** — Animated dashboard with real-time statistics (framer-motion StatCards), quiz enable/disable toggle, submissions tracker (30s auto-refresh), pending/submitted modals, cloud sync button
- **`AdminImageManagerPage`** — Drag-and-drop image upload, gallery with preview and delete, quiz-specific organisation
- **`AdminScoresPage`** — Score table with CSV export, recalculate, clear/restore, email individual/bulk, detailed submission view
- **`AdminScoresBankPage`** — Score archive management (save, load, rename, delete, preview)
- **`AdminScoresBankReviewPage`** — Inline review of archived scores with LLM re-grade capability
- **`AdminQuestionEditorPage`** — JSONC editor with sticky toolbar, live preview, image picker, toast notifications, bank-edit mode
- **`AdminBankManagerPage`** — Question bank management (save, load, rename, delete, preview, in-place edit)
- **`AdminStudentsPage`** — Student list JSONC editor with live preview, email validation, keyboard shortcuts
- **`AdminStudentsBankPage`** — Student list archive (save, load, rename, delete, preview)

**Student-facing pages:**

- **`StartPage`** — Email login with quiz-disabled guard; includes `AccessibilityPanel` and `ThemeToggle`
- **`QuizPage`** — Quiz taking UI with progress indicator; includes `AccessibilityPanel` and `ThemeToggle`
- **`FinishPage`** — Score display after submission
- **`ErrorPage`** — Generic error boundary page

### Components

Reusable components:

- **`ThemeToggle`** — Three-button toggle (System / Light / Dark); writes to `localStorage` and applies CSS class to `<html>`
- **`AccessibilityPanel`** — Floating a11y toolbar (font size, spacing, font family, contrast); dot indicator when non-default; close-on-outside-click
- **`QuestionDisplay`** — Renders questions with Markdown support and images
- **`SubmissionDetailView`** — Detailed score view with manual override capability
- **`ImagePicker`** — Reusable image selection component with thumbnails
- **`JsonSafeField`** — Controlled input that guards against accidental JSON corruption
- **`LoadingSpinner`** — Loading state indicator
- **`ErrorDisplay`** — Error message display

### API Layer (`api.ts`)

Centralized API communication with TypeScript interfaces:

- Question CRUD operations
- Score management and recalculation
- Email sending (single and bulk)
- Student list management (GET/PUT)
- **Image operations (upload, list, delete, clear all)**
- **Bank file management (questions, scores, students)**
- **Delete operations for all bank types**
- **Preview functionality for all bank types**
- **Git cloud sync operations (status, init, sync)**

### Utilities (`lib/utils.ts`)

Shared utility functions:

- **`slugify(text)`** - Convert text to URL-safe slug format
  - Used for generating consistent filenames across the app
  - Removes accents, special characters, normalizes spacing
  - Examples: "Java Quiz" → "java-quiz", "Test à l'école" → "test-a-lecole"

### State Management

Uses TanStack Query for:

- Server state caching and synchronization
- Automatic background refetching
- Optimistic updates
- Request deduplication
- Loading and error states

## Development

### Prerequisites

See the [main README](../README.md) for installation of Node.js and pnpm.

### Development Server

Start the development server with hot module replacement:

```bash
cd frontend
pnpm install
pnpm dev
```

The dev server runs on `http://localhost:5173` (or next available port).

### Building for Production

Build optimized production bundle:

```bash
pnpm build
```

Output goes to `../static/` directory, served by the Python backend.

### Type Checking

Run TypeScript type checking:

```bash
pnpm type-check
```

### Linting

Run ESLint:

```bash
pnpm lint
```

## Features Implemented

### Image Management System

- **Dedicated Image Management Page** (`/admin/images`):
  - Drag-and-drop file upload interface
  - Multi-file upload support
  - Grid-based image gallery with previews
  - Individual image deletion
  - Clear all images functionality with confirmation
  - File format validation (PNG, JPG, JPEG, GIF, WEBP)
  - File size limit (5MB per image)
  - Quiz-specific organization (images stored per quiz)
- **Integrated Image Picker**:
  - Embedded in question editor
  - Thumbnail previews of available images
  - Copy-to-clipboard functionality
  - Real-time image list updates
  - Image count display in editor header
- **Backend Integration**:
  - Images saved with quiz to bank (folder copied)
  - Images loaded from bank with quiz (folder restored)
  - Static file serving for image display
  - Secure path validation

### User Experience Improvements

- **No Browser Alerts**:
  - All `window.confirm` dialogs replaced with inline confirmations
  - All `window.alert` replaced with toast notifications or inline errors
  - Consistent UX across all admin pages
- **Toast Notifications**:
  - Color-coded messages (green=success, red=error, yellow=warning)
  - Close button for dismissible notifications
  - Auto-positioning and styling
- **Inline Confirmations**:
  - Delete operations show "Delete? Yes/No" panel
  - Load operations show "Load? Yes/No" panel
  - Clear operations show contextual confirmation
  - Yellow background with clear action buttons
  - Prevents accidental destructive actions

### Quiz Enable/Disable Control

- **Toggle Switch in Dashboard Header**:
  - Visual toggle with green (enabled) / red (disabled) color states
  - Smooth animations for state transitions
  - Real-time updates without page reload
  - Silent operation (no modal popup on success)
- **Student-Facing UI**:
  - Warning banner on start page when quiz is disabled
  - Disabled form inputs prevent quiz start attempts
  - Full-page "Quiz Disabled" message with friendly icon
  - Back to home navigation option
- **Backend Integration**:
  - API endpoints: `GET/POST /api/admin/quiz-status`
  - Quiz status persisted in `quiz_status.jsonc` file
  - `/api/start` endpoint checks status before allowing quiz
  - Status query via React Query for real-time sync

### Dashboard Enhancements

- **Real-time Statistics Cards**:
  - Current Quiz card - Shows quiz title, question count, links to editor
  - Submissions card - Auto-refreshes every 30s, shows submitted/pending counts
  - Students card - Shows enrolled count, links to management
  - Archives card - Shows total with breakdown (questions/scores/students) + Cloud Sync button
- **Interactive Elements**:
  - All cards clickable for quick navigation
  - Submission counts link to modals showing student lists
  - Archive counts link to respective bank pages
  - Manual refresh button alongside auto-refresh
- **Pending/Submitted Modals**:
  - View list of students who haven't submitted
  - View list of students who have submitted
  - Color-coded themes (orange for pending, green for submitted)
- **Cloud Sync Integration**:
  - Sync button integrated into Archives card
  - Shows sync status (Initialize/Sync to Cloud)
  - Displays last commit timestamp
  - Visual feedback during sync operations

### Cloud Sync Features

- **Git-based Synchronization**:
  - Sync all three banks (questions, scores, students) to GitHub/GitLab
  - Token-based authentication (secure, no password storage)
  - Automatic commit with timestamps
  - Pull-before-push workflow to prevent conflicts
- **UI Integration**:
  - Sync button in Archives card on dashboard
  - Loading states with animated spinner
  - Success/error modals with detailed feedback
  - Last commit info display
  - Configuration status indicators
- **Smart Error Handling**:
  - Detailed error messages for authentication failures
  - Automatic retry for transient errors
  - Clear instructions for token renewal

### Students Management

- **Three Format Support**:
  - Simple: `"email@example.com"`
  - Individual: `{ "email": "...", "group": "5CI" }`
  - Group: `{ "group": "5CI", "emails": ["...", "..."] }`
  - Automatic parsing handles mixed formats in same file
- **Live Preview**: Students grouped by class/section
- **Email Validation**: Visual indicators (✓ valid, ✗ invalid)
- **Bank Management**: Save/load different student lists
- **Collapsible Format Guide**: Help section with examples
- **Server-side Format Support**: Backend correctly parses all three formats

### Quiz Title Support

- Quiz titles displayed throughout admin interface
- Slugified titles used for automatic filename generation
- Format: `YYYY-MM-DD_HH-MM_slugified-title.jsonc`
- Scores use prefix: `YYYY-MM-DD_HH-MM_risultati_slugified-title.jsonc`

### File Management

- Custom filename control with intelligent defaults
- Preview functionality for all bank types (questions, scores, students)
- Formatted score preview matching detail view
- Automatic `.jsonc` extension handling
- **Delete functionality** for all bank types with inline confirmation
- **Smart filenames** with date prefix and slugified quiz titles
  - Questions: `YYYY-MM-DD_HH-MM_quiz-title.jsonc`
  - Scores: `YYYY-MM-DD_HH-MM_risultati_quiz-title.jsonc`
  - CSV exports: `YYYY-MM-DD_quiz-title_scores.csv`
- **Load confirmations** to prevent accidental overwrites (students bank)

### Score Management

- Detailed submission review
- Manual score override capability
- Bulk operations (recalculate, clear, restore) with inline confirmations
- CSV export with smart filenames (date + quiz title)
- Visual indicators (✓, ⚠, ❌) for answer correctness
- No browser alerts - all confirmations inline

### Email Integration

- Individual result emails
- Bulk email sending
- Customizable subject lines with inline validation
- Optional detailed breakdowns
- Email subject validation shown inline (no alerts)
- Italian language support

## Technology Stack Details

### React Query Setup

The app uses TanStack Query v5 with:

- 5-minute stale time for most queries
- Automatic invalidation on mutations
- Query keys structured hierarchically
- Background refetching disabled for most queries

### Routing Structure

```txt
/                    → StartPage (student login)
/quiz                → QuizPage (student quiz)
/finish              → FinishPage (student results)

/admin               → AdminLoginPage
/admin/dashboard     → AdminDashboardPage
/admin/scores        → AdminScoresPage
/admin/questions     → AdminQuestionEditorPage
/admin/students      → AdminStudentsPage
/admin/questions-bank → AdminBankManagerPage
/admin/scores-bank   → AdminScoresBankPage
/admin/students-bank → AdminStudentsBankPage
/admin/images        → AdminImageManagerPage
```

Password state is passed via React Router `location.state` (note: lost on refresh).

### Data Flow

1. User authenticates via password input
2. Password passed to API calls via request body
3. Backend validates password for each protected endpoint
4. React Query caches responses with password-based keys
5. Mutations trigger query invalidation for UI updates

## Security Notes

- Admin password stored in browser memory only (not persisted)
- Password required for all API operations
- No client-side data encryption (LAN-only operation)
- CORS not configured (same-origin only)

## Customization

### Styling

Tailwind CSS configuration in `tailwind.config.js`. Customize:

- Colors and theme
- Spacing and sizing
- Typography
- Component variants

### Markdown Rendering

Markdown support includes:

- GitHub Flavored Markdown (tables, strikethrough, etc.)
- Sanitized HTML output
- Math equations via KaTeX (configured in backend)

### Date/Time Format

Filenames use local timezone with format:

- Questions: `YYYY-MM-DD_HH-MM_title.jsonc`
- Scores: `YYYY-MM-DD_HH-MM_risultati_title.jsonc`

## Troubleshooting

### Cloud Sync Issues

- **Sync button not visible**:
  - Verify `BANKS_GIT_REMOTE` and `BANKS_GIT_TOKEN` are set in backend `.env`
  - Restart the backend server
  - Check browser console for API errors
- **"Invalid username or token"**:
  - GitHub token may have expired
  - Generate new token at <https://github.com/settings/tokens>
  - Update `.env` and restart server
- **Sync fails silently**:
  - Check backend server logs for detailed error messages
  - Verify repository exists and is accessible

### Port Already in Use

Vite will automatically try the next available port if 5173 is taken.

### Build Errors

Ensure TypeScript types are correct:

```bash
pnpm type-check
```

### API Connection Issues

The dev server proxies API requests to `http://localhost:5001`. Ensure the backend is running.

### State Lost on Refresh

Admin password is not persisted. This is by design for security. Re-login after page refresh.

## Contributing

When adding new features:

1. **Types First** - Define TypeScript interfaces in `api.ts`
2. **API Layer** - Add API functions with proper error handling
3. **Query/Mutation** - Use TanStack Query for server state
4. **Components** - Keep components focused and reusable
5. **Validation** - Validate data at both frontend and backend
6. **Testing** - Test with the backend running locally

## License

See [main project LICENSE](../LICENSE).
