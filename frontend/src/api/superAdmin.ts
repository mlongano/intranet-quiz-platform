import { apiFetch } from './client';
import type {
  ClassMeta,
  CreateTeacherPayload,
  CreateTeacherResponse,
  ScoreEntry,
  StudentMeta,
  SyncStatus,
  TeacherMeta,
} from './types';

export async function listTeachers(): Promise<TeacherMeta[]> {
  return apiFetch<TeacherMeta[]>('/super-admin/teachers');
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
