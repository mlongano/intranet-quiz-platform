# QuizParty Frontend

Modern React + TypeScript admin interface for the QuizParty quiz management system.

> 📖 **For full project documentation, installation instructions, and features, see the [main README](../README.md)**

## Overview

This is the admin frontend built with:

- **React 18** - Modern React with hooks
- **TypeScript** - Type-safe development
- **Vite** - Fast build tool and dev server
- **TanStack Query (React Query)** - Server state management and caching
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first styling
- **React Markdown** - Markdown rendering with syntax support

## Architecture

### Pages

The frontend provides a comprehensive admin interface:

- **`AdminLoginPage`** - Password-protected admin access
- **`AdminDashboardPage`** - Modern dashboard with real-time statistics:
  - Interactive statistics cards (clickable for navigation)
  - Current quiz overview
  - Auto-refreshing submissions tracker (30-second interval)
  - Pending/submitted students modals
  - Archive breakdown by type
  - Organized feature categories (Quiz/Results/Students Management)
- **`AdminScoresPage`** - View all submissions with:
  - Score table with quiz titles
  - CSV export functionality
  - Recalculate all scores
  - Email individual or bulk results
  - Detailed submission view with score overrides
- **`AdminQuestionEditorPage`** - JSONC editor with:
  - Live preview with answer highlighting
  - Batch weight operations
  - Format validation
  - Quiz title display
- **`AdminStudentsPage`** - Student list management:
  - JSONC editor with syntax highlighting
  - Live preview grouped by class/section
  - Email validation with visual indicators
  - Support for three student formats (simple, individual, group)
  - Keyboard shortcuts (Ctrl/Cmd+S to save)
- **`AdminBankManagerPage`** - Question bank management:
  - Save/load quiz files
  - Preview question banks
  - Custom filename control with slugified titles
- **`AdminScoresBankPage`** - Score archive management:
  - Save/load score files
  - Formatted preview of archived scores
  - Custom filename control
- **`AdminStudentsBankPage`** - Student list archive management:
  - Save/load student lists for different classes
  - Preview students grouped by class
  - Email validation in preview
  - Quick switching between different student lists

### Components

Reusable components for the interface:

- **`QuestionDisplay`** - Renders questions with markdown support and images
- **`SubmissionDetailView`** - Detailed score view with override capability
- **`LoadingSpinner`** - Loading state indicator
- **`ErrorDisplay`** - Error message display

### API Layer (`api.ts`)

Centralized API communication with TypeScript interfaces:

- Question CRUD operations
- Score management and recalculation
- Email sending (single and bulk)
- Student list management (GET/PUT)
- Bank file management (questions, scores, students)
- Preview functionality for all bank types

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

### Dashboard Enhancements

- **Real-time Statistics Cards**:
  - Current Quiz card - Shows quiz title, question count, links to editor
  - Submissions card - Auto-refreshes every 30s, shows submitted/pending counts
  - Students card - Shows enrolled count, links to management
  - Archives card - Shows total with breakdown (questions/scores/students)
- **Interactive Elements**:
  - All cards clickable for quick navigation
  - Submission counts link to modals showing student lists
  - Archive counts link to respective bank pages
  - Manual refresh button alongside auto-refresh
- **Pending/Submitted Modals**:
  - View list of students who haven't submitted
  - View list of students who have submitted
  - Color-coded themes (orange for pending, green for submitted)

### Students Management

- **Three Format Support**:
  - Simple: `"email@example.com"`
  - Individual: `{ "email": "...", "group": "5CI" }`
  - Group: `{ "group": "5CI", "emails": ["...", "..."] }`
- **Live Preview**: Students grouped by class/section
- **Email Validation**: Visual indicators (✓ valid, ✗ invalid)
- **Bank Management**: Save/load different student lists
- **Collapsible Format Guide**: Help section with examples

### Quiz Title Support

- Quiz titles displayed throughout admin interface
- Slugified titles used for automatic filename generation
- Format: `YYYY-MM-DD_HH-MM_slugified-title.jsonc`
- Scores use prefix: `YYYY-MM-DD_HH-MM_risultati_slugified-title.jsonc`

### File Management

- Custom filename control with intelligent defaults
- Preview functionality for both questions and scores
- Formatted score preview matching detail view
- Automatic `.jsonc` extension handling

### Score Management

- Detailed submission review
- Manual score override capability
- Bulk operations (recalculate, email)
- CSV export
- Visual indicators (✓, ⚠, ❌) for answer correctness

### Email Integration

- Individual result emails
- Bulk email sending
- Customizable subject lines
- Optional detailed breakdowns
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
/admin              → AdminLoginPage
/admin/dashboard    → AdminDashboardPage
/admin/scores       → AdminScoresPage
/admin/questions    → AdminQuestionEditorPage
/admin/students     → AdminStudentsPage
/admin/bank         → AdminBankManagerPage
/admin/scores-bank  → AdminScoresBankPage
/admin/students-bank → AdminStudentsBankPage
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

### Port Already in Use

Vite will automatically try the next available port if 5173 is taken.

### Build Errors

Ensure TypeScript types are correct:

```bash
pnpm type-check
```

### API Connection Issues

The dev server proxies API requests to `http://localhost:5000`. Ensure the backend is running.

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
