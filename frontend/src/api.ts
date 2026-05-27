import { getTeacherToken, getStudentToken, clearTeacherSession } from './lib/session';

const API_BASE = '/api';

// ── shared types ─────────────────────────────────────────────────────────────

export interface OptionObject {
  text: string;
  image?: string;
}

export interface Question {
  id: string;
  type: 'single' | 'multiple' | 'open';
  weight: number;
  text: string;
  question_image?: string;
  options: Array<string | OptionObject>;
}

export type Answer = number | number[] | string | null;

export interface QuizData {
  title?: string;
  questions: Question[];
  warning?: string;
}

export interface DetailedAnswer {
  question_id: string | number;
  type?: 'single' | 'multiple' | 'open';
  question_text: string;
  question_image?: string;
  student_answer: any;
  option_student_image?: string | string[] | null;
  option_correct_image?: string | string[] | null;
  correct_answer: any;
  weight: number;
  points_awarded: number;
  raw_points: number;
  raw_student_answer: any;
  raw_correct_answer: any;
  llm_feedback?: string | null;
  llm_verdict?: string | null;
  llm_status?: 'not_applicable' | 'pending' | 'graded' | 'fallback' | 'error' | null;
  llm_error?: string | null;
  llm_updated_at?: string | null;
  question_snapshot?: Record<string, any> | null;
  manual_override?: boolean;
  original_points_awarded?: number | null;
  option_order?: number[];
}

export interface ScoreEntry {
  id?: number;
  student_id?: number;
  student?: string;           // email (legacy compat)
  student_email?: string;
  student_display_name?: string;
  session_id?: number;
  quiz_id?: string;
  quiz_title?: string;
  answers: DetailedAnswer[];
  raw_points: number;
  max_points: number;
  percent: number;
  timestamp?: string;
  submitted_at?: string;
}

export interface SnapshotMeta {
  id: number;
  title: string;
  slug: string;
  updated_at: string;
  created_at?: string;
  question_count: number;
  single_count?: number;
  multiple_count?: number;
  open_count?: number;
}

export interface SnapshotDetail extends SnapshotMeta {
  content: QuizData;
  images_manifest: ImageMeta[];
}

export interface SessionMeta {
  id: number;
  title: string;
  status: 'draft' | 'active' | 'closed';
  join_code: string | null;
  snapshot_id: number;
  opens_at: string | null;
  closes_at: string | null;
  created_at: string;
  classes: { id: number; name: string }[];
}

export interface ClassMeta {
  id: number;
  name: string;
  academic_year: string;
  student_count: number;
}

export interface ClassroomCourse {
  id: string;
  name: string;
  section: string;
  title: string;
  course_state: string;
}

export interface ClassroomSyncResult {
  courses_synced: number;
  classes_added: number;
  students_synced: number;
  errors: string[];
}

export interface StudentMeta {
  id: number;
  email: string;
  display_name: string;
  status: string;
}

export interface ArchiveMeta {
  id: number;
  title: string;
  archived_at: string;
  source_session_id: number | null;
}

export interface ArchiveDetail extends ArchiveMeta {
  content: ScoreEntry[];
  notes?: string;
}

export interface ImageMeta {
  filename: string;
  size: number;
  mime: string;
  uploaded_at: string;
  url?: string;
}

export interface TeacherMeta {
  id: number;
  email: string;
  display_name: string;
  role: 'teacher' | 'super_admin';
  status: 'active' | 'disabled';
  last_login_at: string | null;
  last_synced_at: string | null;
}

export interface LlmInfoResponse {
  model: string | null;
  enabled?: boolean;
  use_llm?: boolean;
}

export interface LlmJobStatus {
  id: number;
  teacher_id: number;
  session_id: number;
  score_entry_id: number | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  job_type: 'submission' | 'regrade_score' | 'regrade_session';
  total_items: number;
  processed_items: number;
  error: string | null;
  created_at: string | null;
  started_at: string | null;
  finished_at: string | null;
}

// ── core fetch helper ─────────────────────────────────────────────────────────

class ApiError extends Error {
  status: number;
  code?: string;
  quizId?: string;
  isConflict: boolean;

  constructor(message: string, status: number, code?: string, quizId?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.quizId = quizId;
    this.isConflict = status === 409;
  }
}

export { ApiError };

type TokenSource = 'teacher' | 'student' | 'none';

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  tokenSource: TokenSource = 'teacher',
): Promise<T> {
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> ?? {}),
  };

  if (!(init.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const token =
    tokenSource === 'teacher' ? getTeacherToken() :
    tokenSource === 'student' ? getStudentToken() :
    null;

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });

  if (!response.ok) {
    let errorMsg = `${response.status} ${response.statusText}`;
    let code: string | undefined;
    let quizId: string | undefined;

    try {
      const body = await response.json();
      errorMsg = body.error || body.description || errorMsg;
      code = body.code;
      quizId = body.quiz_id;
    } catch {
      try { errorMsg = await response.text() || errorMsg; } catch { /* ignore */ }
    }

    if (response.status === 401 && code === 'TOKEN_EXPIRED') {
      if (tokenSource === 'teacher') clearTeacherSession();
    }

    throw new ApiError(errorMsg, response.status, code, quizId);
  }

  try {
    return (await response.json()) as T;
  } catch {
    return undefined as unknown as T;
  }
}

// ── auth ──────────────────────────────────────────────────────────────────────

export interface TeacherLoginResponse {
  token: string;
  teacher_id: number;
  role: 'teacher' | 'super_admin';
  email: string;
  display_name: string;
  must_change_password?: boolean;
  change_token?: string;
}

export async function teacherLogin(email: string, password: string): Promise<TeacherLoginResponse> {
  return apiFetch<TeacherLoginResponse>('/auth/teacher-login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, 'none');
}

export async function teacherGoogleLogin(credential: string): Promise<TeacherLoginResponse> {
  return apiFetch<TeacherLoginResponse>('/auth/teacher-google-login', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  }, 'none');
}

export async function teacherChangePassword(
  old_password: string,
  new_password: string,
  changeToken?: string,
): Promise<TeacherLoginResponse> {
  const headers: Record<string, string> = {};
  if (changeToken) headers['Authorization'] = `Bearer ${changeToken}`;
  return apiFetch<TeacherLoginResponse>('/auth/teacher-change-password', {
    method: 'POST',
    headers,
    body: JSON.stringify({ old_password, new_password }),
  }, changeToken ? 'none' : 'teacher');
}

export interface StudentJoinResponse {
  token: string;
  student_id: number;
  session_id: number;
  session_title: string;
  quiz_id?: string;
}

export async function studentJoin(email: string, join_code: string): Promise<StudentJoinResponse> {
  return apiFetch<StudentJoinResponse>('/auth/student-join', {
    method: 'POST',
    body: JSON.stringify({ email, join_code }),
  }, 'none');
}

export async function getMe(): Promise<{ role: string; display_name: string; teacher_id?: number }> {
  return apiFetch('/auth/me', {}, 'teacher');
}

// ── student / quiz ────────────────────────────────────────────────────────────

export interface SessionInfoResponse {
  title: string;
  question_count: number;
  opens_at: string | null;
  closes_at: string | null;
}

export async function getSessionInfo(): Promise<SessionInfoResponse> {
  return apiFetch<SessionInfoResponse>('/quiz/session-info', {}, 'student');
}

export async function startQuiz(): Promise<{ quiz_id: string }> {
  return apiFetch<{ quiz_id: string }>('/quiz/start', { method: 'POST' }, 'student');
}

export interface ResumeResponse {
  quiz_id: string;
  current_question?: Question;
  current_index: number;
  total_questions: number;
  is_complete: boolean;
}

export async function resumeQuiz(quizId: string): Promise<ResumeResponse> {
  return apiFetch<ResumeResponse>(`/quiz/resume/${quizId}`, {}, 'student');
}

export interface SaveAnswerResponse {
  success: boolean;
  current_index: number;
  total_questions: number;
  is_complete: boolean;
}

export async function saveAnswer(quiz_id: string, answer: Answer): Promise<SaveAnswerResponse> {
  return apiFetch<SaveAnswerResponse>('/quiz/save-answer', {
    method: 'POST',
    body: JSON.stringify({ quiz_id, answer }),
  }, 'student');
}

export interface SubmitResponse {
  raw_points: number;
  max_points: number;
  percent: number;
  status: 'provisional' | 'final';
  llm_pending: boolean;
}

export async function submitQuiz(quiz_id: string): Promise<SubmitResponse> {
  return apiFetch<SubmitResponse>('/quiz/submit', {
    method: 'POST',
    body: JSON.stringify({ quiz_id }),
  }, 'student');
}

// ── teacher — snapshots ───────────────────────────────────────────────────────

export async function listSnapshots(): Promise<SnapshotMeta[]> {
  return apiFetch<SnapshotMeta[]>('/teacher/snapshots');
}

export async function createSnapshot(title: string, jsonc: string): Promise<SnapshotMeta> {
  return apiFetch<SnapshotMeta>('/teacher/snapshots', {
    method: 'POST',
    body: JSON.stringify({ title, jsonc }),
  });
}

export async function getSnapshot(id: number): Promise<SnapshotDetail> {
  return apiFetch<SnapshotDetail>(`/teacher/snapshots/${id}`);
}

export async function updateSnapshot(id: number, fields: { title?: string; jsonc?: string }): Promise<SnapshotMeta> {
  return apiFetch<SnapshotMeta>(`/teacher/snapshots/${id}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

export async function deleteSnapshot(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/teacher/snapshots/${id}`, { method: 'DELETE' });
}

export function getSnapshotExportUrl(id: number): string {
  return `${API_BASE}/teacher/snapshots/${id}/export`;
}

export async function renameSnapshot(id: number, title: string): Promise<{ slug: string }> {
  return apiFetch<{ slug: string }>(`/teacher/snapshots/${id}/rename`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

/**
 * Download a file using fetch with the proper Authorization header,
 * then trigger a browser download via a temp blob: URL.
 * Avoids exposing JWTs in query strings.
 */
export async function downloadExport(url: string, filename?: string): Promise<void> {
  const token = getTeacherToken();
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error(`Download fallito: ${response.status}`);
  }
  const blob = await response.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename || 'export.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

// ── teacher — images ──────────────────────────────────────────────────────────

export async function uploadSnapshotImage(snapshotId: number, file: File): Promise<ImageMeta> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<ImageMeta>(`/teacher/snapshots/${snapshotId}/images`, {
    method: 'POST',
    body: formData,
  });
}

export async function listSnapshotImages(snapshotId: number): Promise<ImageMeta[]> {
  return apiFetch<ImageMeta[]>(`/teacher/snapshots/${snapshotId}/images`);
}

export async function deleteSnapshotImage(snapshotId: number, filename: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(
    `/teacher/snapshots/${snapshotId}/images/${encodeURIComponent(filename)}`,
    { method: 'DELETE' },
  );
}

export async function clearSnapshotImages(snapshotId: number): Promise<{ deleted: number }> {
  return apiFetch<{ deleted: number }>(`/teacher/snapshots/${snapshotId}/images/clear`, {
    method: 'POST',
  });
}

// ── teacher — classes ─────────────────────────────────────────────────────────

export async function listClasses(): Promise<ClassMeta[]> {
  return apiFetch<ClassMeta[]>('/teacher/classes');
}

export async function getClassStudents(classId: number): Promise<StudentMeta[]> {
  return apiFetch<StudentMeta[]>(`/teacher/classes/${classId}/students`);
}

export async function listClassroomCourses(): Promise<ClassroomCourse[]> {
  return apiFetch<ClassroomCourse[]>('/teacher/classroom/courses');
}

export async function syncClassroomCourses(course_ids?: string[]): Promise<ClassroomSyncResult> {
  return apiFetch<ClassroomSyncResult>('/teacher/classroom/sync', {
    method: 'POST',
    body: JSON.stringify({ course_ids }),
  });
}

// ── teacher — sessions ────────────────────────────────────────────────────────

export async function listSessions(status?: string): Promise<SessionMeta[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<SessionMeta[]>(`/teacher/sessions${qs}`);
}

export interface CreateSessionPayload {
  snapshot_id: number;
  title?: string;
  class_ids: number[];
  opens_at?: string;
  closes_at?: string;
}

export async function createSession(payload: CreateSessionPayload): Promise<SessionMeta> {
  return apiFetch<SessionMeta>('/teacher/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function activateSession(sessionId: number): Promise<{ join_code: string }> {
  return apiFetch<{ join_code: string }>(`/teacher/sessions/${sessionId}/activate`, {
    method: 'POST',
  });
}

export async function closeSession(sessionId: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/teacher/sessions/${sessionId}/close`, {
    method: 'POST',
  });
}

export async function reopenSession(sessionId: number): Promise<{ join_code: string }> {
  return apiFetch<{ join_code: string }>(`/teacher/sessions/${sessionId}/reopen`, {
    method: 'POST',
  });
}

export async function regenJoinCode(sessionId: number): Promise<{ join_code: string }> {
  return apiFetch<{ join_code: string }>(`/teacher/sessions/${sessionId}/regen-code`, {
    method: 'POST',
  });
}

export async function deleteSession(sessionId: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/teacher/sessions/${sessionId}`, { method: 'DELETE' });
}

// ── teacher — scores ──────────────────────────────────────────────────────────

export async function getSessionScores(sessionId: number): Promise<ScoreEntry[]> {
  return apiFetch<ScoreEntry[]>(`/teacher/sessions/${sessionId}/scores`);
}

export async function recalculateScores(sessionId: number): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>(`/teacher/sessions/${sessionId}/scores/recalculate`, {
    method: 'POST',
  });
}

export interface ScoreOverride {
  score_id: number;
  per_question: Record<string, number>;
}

export async function reviewScores(sessionId: number, overrides: ScoreOverride[]): Promise<{ ok: boolean; updated: number }> {
  return apiFetch<{ ok: boolean; updated: number }>(`/teacher/sessions/${sessionId}/scores/review`, {
    method: 'POST',
    body: JSON.stringify({ overrides }),
  });
}

export async function regradeOpenScores(sessionId: number): Promise<LlmJobStatus> {
  return apiFetch<LlmJobStatus>(`/teacher/sessions/${sessionId}/scores/regrade-open`, {
    method: 'POST',
  });
}

export async function archiveSessionScores(
  sessionId: number,
  title?: string,
  notes?: string,
): Promise<{ archive_id: number }> {
  return apiFetch<{ archive_id: number }>(`/teacher/sessions/${sessionId}/archive`, {
    method: 'POST',
    body: JSON.stringify({ title, notes }),
  });
}

// ── teacher — archives ────────────────────────────────────────────────────────

export async function listArchives(): Promise<ArchiveMeta[]> {
  return apiFetch<ArchiveMeta[]>('/teacher/archives');
}

export async function getArchive(archiveId: number): Promise<ArchiveDetail> {
  return apiFetch<ArchiveDetail>(`/teacher/archives/${archiveId}`);
}

export async function deleteArchive(archiveId: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/teacher/archives/${archiveId}`, { method: 'DELETE' });
}

export async function renameArchive(archiveId: number, title: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/teacher/archives/${archiveId}/rename`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function getArchiveExportUrl(archiveId: number): string {
  return `${API_BASE}/teacher/archives/${archiveId}/export`;
}

// ── teacher — student list snapshots ─────────────────────────────────────────

export interface StudentListSnapshotMeta {
  id: number;
  title: string;
  created_at: string;
}

export interface StudentListSnapshotDetail extends StudentListSnapshotMeta {
  content: { email: string; display_name: string; classes: string[] }[];
}

export async function listStudentSnapshots(): Promise<StudentListSnapshotMeta[]> {
  return apiFetch<StudentListSnapshotMeta[]>('/teacher/student-snapshots');
}

export async function getStudentSnapshot(id: number): Promise<StudentListSnapshotDetail> {
  return apiFetch<StudentListSnapshotDetail>(`/teacher/student-snapshots/${id}`);
}

export async function deleteStudentSnapshot(id: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/teacher/student-snapshots/${id}`, { method: 'DELETE' });
}

export async function renameStudentSnapshot(id: number, title: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/teacher/student-snapshots/${id}/rename`, {
    method: 'POST',
    body: JSON.stringify({ title }),
  });
}

export function getStudentSnapshotExportUrl(id: number): string {
  return `${API_BASE}/teacher/student-snapshots/${id}/export`;
}

// ── teacher — email ───────────────────────────────────────────────────────────

export interface ResultEmailOptions {
  subject?: string;
  include_details: boolean;
  include_feedback: boolean;
}

export async function sendResultEmail(scoreId: number, options?: ResultEmailOptions): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>('/teacher/email/send-result', {
    method: 'POST',
    body: JSON.stringify({ score_id: scoreId, ...options }),
  });
}

export async function sendAllResultEmails(
  sessionId: number,
  options: ResultEmailOptions,
): Promise<{ sent: number; errors: Array<{ email: string; error: string }> }> {
  return apiFetch<{ sent: number; errors: Array<{ email: string; error: string }> }>(`/teacher/sessions/${sessionId}/email/send-all`, {
    method: 'POST',
    body: JSON.stringify(options),
  });
}

// ── teacher — llm ─────────────────────────────────────────────────────────────

export async function getLlmInfo(): Promise<LlmInfoResponse> {
  return apiFetch<LlmInfoResponse>('/teacher/llm-info');
}

export async function getLlmJob(jobId: number): Promise<LlmJobStatus> {
  return apiFetch<LlmJobStatus>(`/teacher/llm-jobs/${jobId}`);
}

export async function getLatestSessionLlmJob(sessionId: number): Promise<LlmJobStatus | null> {
  const result = await apiFetch<LlmJobStatus | { job: null }>(`/teacher/sessions/${sessionId}/llm-jobs/latest`);
  if ('job' in result && result.job === null) return null;
  return result as LlmJobStatus;
}

// ── super-admin ───────────────────────────────────────────────────────────────

export async function listTeachers(): Promise<TeacherMeta[]> {
  return apiFetch<TeacherMeta[]>('/super-admin/teachers');
}

export interface CreateTeacherPayload {
  email: string;
  display_name: string;
  role: 'teacher' | 'super_admin';
}

export interface CreateTeacherResponse extends TeacherMeta {
  temp_password: string;
}

export async function createTeacher(payload: CreateTeacherPayload): Promise<CreateTeacherResponse> {
  return apiFetch<CreateTeacherResponse>('/super-admin/teachers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateTeacher(
  teacherId: number,
  fields: { role?: string; status?: string },
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/super-admin/teachers/${teacherId}`, {
    method: 'PUT',
    body: JSON.stringify(fields),
  });
}

export async function resetTeacherPassword(teacherId: number): Promise<{ temp_password: string }> {
  return apiFetch<{ temp_password: string }>(`/super-admin/teachers/${teacherId}/reset-password`, {
    method: 'POST',
  });
}

export async function listAllStudents(params?: { class_id?: number; query?: string }): Promise<StudentMeta[]> {
  const qs = new URLSearchParams();
  if (params?.class_id) qs.set('class_id', String(params.class_id));
  if (params?.query) qs.set('query', params.query);
  const q = qs.toString();
  return apiFetch<StudentMeta[]>(`/super-admin/students${q ? `?${q}` : ''}`);
}

export async function listAllClasses(): Promise<ClassMeta[]> {
  return apiFetch<ClassMeta[]>('/super-admin/classes');
}

export async function assignTeacherToClass(classId: number, teacherId: number): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/super-admin/classes/${classId}/teachers`, {
    method: 'POST',
    body: JSON.stringify({ teacher_id: teacherId }),
  });
}

export async function triggerSync(): Promise<{ run_id: number }> {
  return apiFetch<{ run_id: number }>('/super-admin/sync', { method: 'POST' });
}

export interface SyncStatus {
  id: number;
  status: 'running' | 'success' | 'error';
  started_at: string;
  finished_at: string | null;
  result: {
    teachers_added?: number;
    students_added?: number;
    classes_added?: number;
    errors?: string[];
  } | null;
}

export async function getSyncStatus(runId: number): Promise<SyncStatus> {
  return apiFetch<SyncStatus>(`/super-admin/sync/${runId}`);
}

export async function getSuperAdminScores(params?: {
  teacher_id?: number;
  session_id?: number;
}): Promise<ScoreEntry[]> {
  const qs = new URLSearchParams();
  if (params?.teacher_id) qs.set('teacher_id', String(params.teacher_id));
  if (params?.session_id) qs.set('session_id', String(params.session_id));
  const q = qs.toString();
  return apiFetch<ScoreEntry[]>(`/super-admin/scores${q ? `?${q}` : ''}`);
}
