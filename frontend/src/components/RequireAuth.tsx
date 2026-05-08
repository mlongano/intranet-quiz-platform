import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { getTeacherSession } from '../lib/session';

/**
 * Route guard: redirects to /teacher/login if no teacher session exists.
 * Wrap protected routes with <RequireAuth>...</RequireAuth>.
 */
export default function RequireAuth({ children }: { children: ReactNode }) {
  if (!getTeacherSession()) {
    return <Navigate to="/teacher/login" replace />;
  }
  return <>{children}</>;
}
