import './main.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { initTheme } from './lib/theme';
import RequireAuth from './components/RequireAuth';

initTheme();

// Student pages
import StartPage from './pages/StartPage';
import QuizPage from './pages/QuizPage';
import FinishPage from './pages/FinishPage';
import ErrorPage from './pages/ErrorPage';

// Teacher auth pages
import TeacherLoginPage from './pages/TeacherLoginPage';
import ChangePasswordPage from './pages/ChangePasswordPage';

// Teacher pages
import TeacherDashboardPage from './pages/TeacherDashboardPage';
import SessionsPage from './pages/SessionsPage';
import SessionScoresPage from './pages/SessionScoresPage';
import SnapshotsListPage from './pages/SnapshotsListPage';
import SnapshotEditorPage from './pages/SnapshotEditorPage';
import SnapshotImagesPage from './pages/SnapshotImagesPage';
import ClassesPage from './pages/ClassesPage';
import ArchivesPage from './pages/ArchivesPage';
import ArchiveDetailPage from './pages/ArchiveDetailPage';
import StudentSnapshotsPage from './pages/StudentSnapshotsPage';

// Super-admin
import SuperAdminPage from './pages/SuperAdminPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

const router = createBrowserRouter([
  // ── student routes ──────────────────────────────────────────────────
  { path: '/', element: <StartPage />, errorElement: <ErrorPage /> },
  { path: '/quiz/:quizId', element: <QuizPage />, errorElement: <ErrorPage /> },
  { path: '/finish', element: <FinishPage />, errorElement: <ErrorPage /> },

  // ── teacher auth ────────────────────────────────────────────────────
  { path: '/teacher/login', element: <TeacherLoginPage />, errorElement: <ErrorPage /> },
  { path: '/teacher/change-password', element: <ChangePasswordPage />, errorElement: <ErrorPage /> },

  // ── teacher pages (auth required) ───────────────────────────────────
  { path: '/teacher', element: <RequireAuth><TeacherDashboardPage /></RequireAuth>, errorElement: <ErrorPage /> },
  { path: '/teacher/sessions', element: <RequireAuth><SessionsPage /></RequireAuth>, errorElement: <ErrorPage /> },
  { path: '/teacher/sessions/:sessionId', element: <RequireAuth><SessionScoresPage /></RequireAuth>, errorElement: <ErrorPage /> },
  { path: '/teacher/snapshots', element: <RequireAuth><SnapshotsListPage /></RequireAuth>, errorElement: <ErrorPage /> },
  { path: '/teacher/snapshots/:id', element: <RequireAuth><SnapshotEditorPage /></RequireAuth>, errorElement: <ErrorPage /> },
  { path: '/teacher/snapshots/:id/images', element: <RequireAuth><SnapshotImagesPage /></RequireAuth>, errorElement: <ErrorPage /> },
  { path: '/teacher/classes', element: <RequireAuth><ClassesPage /></RequireAuth>, errorElement: <ErrorPage /> },
  { path: '/teacher/archives', element: <RequireAuth><ArchivesPage /></RequireAuth>, errorElement: <ErrorPage /> },
  { path: '/teacher/archives/:archiveId', element: <RequireAuth><ArchiveDetailPage /></RequireAuth>, errorElement: <ErrorPage /> },
  { path: '/teacher/student-snapshots', element: <RequireAuth><StudentSnapshotsPage /></RequireAuth>, errorElement: <ErrorPage /> },

  // ── super-admin (auth required) ─────────────────────────────────────
  { path: '/super-admin', element: <RequireAuth><SuperAdminPage /></RequireAuth>, errorElement: <ErrorPage /> },

  // ── legacy admin redirect ────────────────────────────────────────────
  { path: '/admin', element: <Navigate to="/teacher/login" replace /> },
  { path: '/admin/*', element: <Navigate to="/teacher/login" replace /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </React.StrictMode>,
);
