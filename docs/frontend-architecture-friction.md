# Frontend Architecture Friction

Vocabulary from `docs/CONTEXT.md`: **module**, **interface**, **depth**, **seam**, **adapter**, **leverage**, **locality**.

---

## Files Retrieved

1. `frontend/src/api.ts` (lines 1-470) — Monolithic API client: types, fetch infra, and ~60 endpoint functions across 7+ domains.
2. `frontend/src/pages/SessionScoresPage.tsx` (lines 1-582) — God component: stats, question breakdown, CSV export, email dialog, score review, LLM polling.
3. `frontend/src/pages/SessionsPage.tsx` (lines 1-284) — Session list + inline CreateSessionModal.
4. `frontend/src/pages/ClassesPage.tsx` (lines 1-224) — Class list + inline ClassroomSyncPanel + inline ClassCard.
5. `frontend/src/pages/ArchivesPage.tsx` (lines 1-83) — Archive list; cleanest page, no friction noted.
6. `frontend/src/lib/scoreStats.ts` (lines 1-84) — Pure statistics: quantile, skewness, kurtosis, outlier detection.
7. `frontend/src/lib/session.ts` (lines 1-81) — SessionStorage read/write for teacher/student JWTs.
8. `frontend/src/lib/useConfirmModal.tsx` (lines 1-51) — Reusable confirm dialog hook.
9. `frontend/src/components/SubmissionDetailView.tsx` (lines 1-247) — Per-student score review modal with per-question overrides.
10. `frontend/src/layouts/TeacherLayout.tsx` (lines 1-230) — Sidebar + header layout.
11. `frontend/src/hooks/useAccessibility.ts` (lines 1-130) — A11y settings persisted to localStorage.
12. `routes/teacher.py` (lines 200-560) — Backend route handlers; notably `/sessions` returns `score_count` (line 280) but the frontend `SessionMeta` type omits it.

---

## Key Code

### api.ts — Flat monolith (no seams between domains)

```typescript
// All 7+ domains share one file:
export async function teacherLogin(...): Promise<TeacherLoginResponse> { ... }  // auth
export async function listSnapshots(...): Promise<SnapshotMeta[]> { ... }      // snapshots
export async function listClasses(...): Promise<ClassMeta[]> { ... }           // classes
export async function listSessions(...): Promise<SessionMeta[]> { ... }        // sessions
export async function getSessionScores(...): Promise<ScoreEntry[]> { ... }     // scores
export async function listArchives(...): Promise<ArchiveMeta[]> { ... }        // archives
export async function listTeachers(...): Promise<TeacherMeta[]> { ... }        // super-admin
// ... ~53 more
```

Every page imports from the same module. `SessionScoresPage` imports 10 functions from `api.ts` (lines 8-10), even though it only needs scores + sessions + LLM.

### SessionScoresPage — Excessive depth (5+ interfaces in one module)

```typescript
// ~580 lines, one component. Responsibilities:
// 1. Statistics (DistributionChart, BoxPlot, StatGrid)         [lines 45-168]
// 2. Question summary builder (buildQuestionSummary)             [lines 176-224]
// 3. Per-student score list                                     [lines 368-376]
// 4. Per-question expanded view with inline overrides            [lines 380-480]
// 5. CSV export (handleExportCSV)                                [lines 268-284]
// 6. Email dialog (inline modal)                                 [lines 486-550]
// 7. LLM job polling (useQuery with refetchInterval)             [lines 206-212]

// Client-side aggregation — no adapter between raw API data and UI:
const stats = useMemo(() => {
  if (!scores?.length) return null;
  return computeStats(scores.map(s => s.percent));   // raw array → stats object
}, [scores]);

const questionSummary = useMemo(() => {
  if (!scores?.length) return [];
  return buildQuestionSummary(scores);               // raw ScoreEntry[] → aggregated questions
}, [scores]);
```

### Inefficient query — Sessions re-fetched for title

```typescript
// In SessionScoresPage.tsx, line 191-192:
const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => listSessions() });
const session = sessions?.find(s => s.id === id);
```

The full session list is fetched (potentially dozens of records) just to extract the `title` for one session. The title could be passed via React Router `location.state`, returned by the scores endpoint, or fetched from a single-session endpoint.

---

## Architecture

The frontend follows a flat directory structure with no domain boundaries:

```
src/
  api.ts          ← monolith: types + fetch + all endpoints
  pages/          ← each page handles its own data fetching, aggregation, and UI
  components/     ← shared presentational components (SubmissionDetailView is the exception)
  lib/            ← utilities (session, stats, confirm modal, theme)
  hooks/          ← single hook (useAccessibility)
  layouts/        ← layout wrappers
```

**Data flow**: Pages → `api.ts` functions → `/api/...` HTTP endpoints → PostgreSQL.

**Key observation**: There is no **adapter** layer between raw API responses and UI needs. Statistics, question summaries, and CSV export are computed inline in page components. The `lib/scoreStats.ts` is a pure utility but isn't composed into a cohesive adapter — it's called ad-hoc in `SessionScoresPage` with raw `useMemo`.

---

## Deepening Candidates

### Candidate 1: Split `api.ts` into domain modules

**Files**: `frontend/src/api.ts` (470 lines)

**Problem**: api.ts is a single module with no domain **seams**. Every page depends on the entire API surface. Adding a new scores endpoint requires editing a 470-line file alongside authentication and super-admin endpoints. Types, fetch infrastructure (`ApiError`, `apiFetch`), and 60+ functions coexist without boundaries. **Locality** is zero — a change to `getSessionScores` sits next to `syncClassroomCourses`.

**Solution**: Split into per-domain modules with a shared core:
```
src/api/
  core.ts          ← ApiError, apiFetch, TokenSource type
  types.ts         ← shared interfaces (ScoreEntry, DetailedAnswer, etc.)
  auth.ts          ← teacherLogin, studentJoin, getMe
  snapshots.ts     ← listSnapshots, createSnapshot, getSnapshot, etc.
  sessions.ts      ← listSessions, createSession, activateSession, etc.
  scores.ts        ← getSessionScores, recalculateScores, reviewScores, etc.
  archives.ts      ← listArchives, getArchive, deleteArchive, etc.
  classes.ts       ← listClasses, getClassStudents, etc.
  super-admin.ts   ← listTeachers, createTeacher, etc.
  index.ts         ← re-export barrel
```

Each page imports only its domain:
```typescript
// SessionScoresPage — before: 10 imports from api.ts
// SessionScoresPage — after:
import { getSessionScores, recalculateScores, reviewScores, regradeOpenScores } from '../api/scores';
import { listSessions } from '../api/sessions';
```

**Benefits**: **Locality** — scores-related code is ~80 lines, not buried in a 470-line file. **Seam** — each domain module is a unit that can be tested, replaced, or code-split independently. **Leverage** — new pages only depend on what they use; tree-shaking improves.

---

### Candidate 2: Extract adapter layer + sub-components from SessionScoresPage

**Files**: `frontend/src/pages/SessionScoresPage.tsx` (582 lines), `frontend/src/lib/scoreStats.ts`, `frontend/src/components/SubmissionDetailView.tsx`

**Problem**: SessionScoresPage has excessive **depth** — 5+ distinct interfaces (per-student list, per-question breakdown with overrides, statistics dashboard, CSV export, email dialog) crammed in one component. The `buildQuestionSummary` function (lines 176-224) is an inline adapter — it transforms raw `ScoreEntry[]` → `QuestionSummary[]` but has no **module** of its own. The per-question override logic (lines 380-480) duplicates the override pattern already implemented in `SubmissionDetailView.tsx`. The statistics widgets (`DistributionChart`, `BoxPlot`, `StatGrid`) embed `computeStats` calls directly — there's no **adapter** that transforms the raw API data into a view-ready shape.

**Solution**: Extract three modules + an adapter:

```
src/features/scores/
  ScoreAdapter.ts            ← ScoreEntry[] → ScoreView { stats, questionSummaries, studentList, csvRows }
  ScoreStatistics.tsx        ← StatGrid, DistributionChart, BoxPlot (consumes ScoreView.stats)
  QuestionBreakdown.tsx      ← "Per domanda" expanded view with overrides (consumes ScoreView.questionSummaries)
  EmailDialog.tsx            ← Email modal (self-contained)
  types.ts                   ← ScoreView, QuestionSummaryView interfaces
```

The page becomes a thin orchestrator:
```typescript
function SessionScoresPage() {
  const { sessionId } = useParams();
  const view = useSessionScoreView(sessionId);  // hook wrapping useQuery + adapter
  // renders: <ScoreStatistics stats={view.stats} /> | <QuestionBreakdown ... /> | <EmailDialog />
}
```

**Benefits**: **Locality** — each extracted piece has a single responsibility at a defined **depth**. The adapter (`ScoreAdapter.ts`) is the single **seam** between API data and UI — all transformations happen there, not in JSX. The `SubmissionDetailView` override pattern and the inline per-question override can be unified through shared `useScoreOverride` hook. Each sub-component is independently testable.

---

### Candidate 3: Push session metadata into navigation state (eliminate redundant queries)

**Files**: `frontend/src/pages/SessionsPage.tsx` (lines 186-192), `frontend/src/pages/SessionScoresPage.tsx` (lines 191-192)

**Problem**: `SessionScoresPage` fetches the full list of sessions (`listSessions()`) just to extract `session.title` for the page header. This is an unnecessary **interface** coupling — the scores page shouldn't depend on the session list endpoint. The `SessionMeta` type returned by `listSessions` is a different shape than what the scores page needs (title + status only). Additionally, the backend already sends `score_count` in the session list response (line 280 of `routes/teacher.py`), but the frontend `SessionMeta` interface discards it — lost **leverage** from the backend.

**Solution**: Three incremental steps:

1. **Add `score_count` to `SessionMeta`** — the backend sends it; the frontend drops it. Surface it so `SessionsPage` can show "12 punteggi" without navigating.
2. **Pass session title via React Router state**:
   ```typescript
   // SessionsPage — navigate with state:
   navigate(`/teacher/sessions/${s.id}`, { state: { title: s.title } });
   
   // SessionScoresPage — read from state:
   const { state } = useLocation();
   const pageTitle = (state as { title?: string })?.title ?? 'Punteggi';
   ```
3. **Optional — add `GET /teacher/sessions/:id` endpoint** for single-session metadata, if session title is the only needed field.

**Benefits**: **Leverage** — the backend's existing `score_count` field is used. Query elimination reduces network requests and cache churn. **Locality** — the scores page no longer imports or queries the session list endpoint. The **interface** between the two pages narrows to just the ID + optional title.

---

## Start Here

**`frontend/src/api.ts`** — The monolith. Understanding its shape and what every page imports from it is the prerequisite to all three candidates. Then read **`frontend/src/pages/SessionScoresPage.tsx`** to see the downstream consequences of the flat API design (10 imports, inline aggregation, redundant queries).
