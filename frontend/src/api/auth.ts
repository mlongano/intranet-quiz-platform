import { apiFetch } from './client';
import type { StudentJoinResponse, TeacherLoginResponse } from './types';

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

export async function studentJoin(email: string, join_code: string): Promise<StudentJoinResponse> {
  return apiFetch<StudentJoinResponse>('/auth/student-join', {
    method: 'POST',
    body: JSON.stringify({ email, join_code }),
  }, 'none');
}

export async function getMe(): Promise<{ role: string; display_name: string; teacher_id?: number }> {
  return apiFetch('/auth/me', {}, 'teacher');
}
