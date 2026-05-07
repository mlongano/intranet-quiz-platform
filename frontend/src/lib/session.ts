/**
 * Client-side session store using sessionStorage (cleared on tab close).
 * No global state library — plain read/write helpers consumed by api.ts and pages.
 */

const TEACHER_KEY = 'qp_teacher';
const STUDENT_KEY = 'qp_student';

export interface TeacherSession {
  token: string;
  teacher_id: number;
  role: 'teacher' | 'super_admin';
  email: string;
  display_name: string;
}

export interface StudentSession {
  token: string;
  student_id: number;
  session_id: number;
  session_title: string;
}

// ── teacher ───────────────────────────────────────────────────────────────────

export function saveTeacherSession(s: TeacherSession): void {
  sessionStorage.setItem(TEACHER_KEY, JSON.stringify(s));
}

export function getTeacherSession(): TeacherSession | null {
  const raw = sessionStorage.getItem(TEACHER_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as TeacherSession; } catch { return null; }
}

export function clearTeacherSession(): void {
  sessionStorage.removeItem(TEACHER_KEY);
}

export function getTeacherToken(): string | null {
  return getTeacherSession()?.token ?? null;
}

export function isTeacherLoggedIn(): boolean {
  return !!getTeacherSession();
}

export function isSuperAdmin(): boolean {
  return getTeacherSession()?.role === 'super_admin';
}

// ── student ───────────────────────────────────────────────────────────────────

export function saveStudentSession(s: StudentSession): void {
  sessionStorage.setItem(STUDENT_KEY, JSON.stringify(s));
}

export function getStudentSession(): StudentSession | null {
  const raw = sessionStorage.getItem(STUDENT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw) as StudentSession; } catch { return null; }
}

export function clearStudentSession(): void {
  sessionStorage.removeItem(STUDENT_KEY);
}

export function getStudentToken(): string | null {
  return getStudentSession()?.token ?? null;
}

export function updateStudentToken(newToken: string): void {
  const s = getStudentSession();
  if (s) saveStudentSession({ ...s, token: newToken });
}
