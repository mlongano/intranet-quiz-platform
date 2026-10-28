import { apiFetch } from './client';
import type { ClassMeta, ClassMembersReport, ClassroomCourse, ClassroomSyncResult, StudentMeta } from './types';

/** The teacher's classes; archived ones too with includeArchived. */
export async function listClasses(includeArchived = false): Promise<ClassMeta[]> {
  return apiFetch<ClassMeta[]>(`/teacher/classes${includeArchived ? '?archived=1' : ''}`);
}

export async function createClass(body: { name: string; academic_year: string; emails: string[] }) {
  return apiFetch<ClassMembersReport & { id: number }>('/teacher/classes', {
    method: 'POST', body: JSON.stringify(body),
  });
}

export async function updateClass(classId: number, changes: { name?: string; archived?: boolean }) {
  return apiFetch<{ ok: boolean }>(`/teacher/classes/${classId}`, {
    method: 'PATCH', body: JSON.stringify(changes),
  });
}

export async function deleteClass(classId: number) {
  return apiFetch<{ deleted: boolean }>(`/teacher/classes/${classId}`, { method: 'DELETE' });
}

export async function addClassStudents(classId: number, emails: string[]) {
  return apiFetch<ClassMembersReport>(`/teacher/classes/${classId}/students`, {
    method: 'POST', body: JSON.stringify({ emails }),
  });
}

export async function removeClassStudent(classId: number, studentId: number) {
  return apiFetch<{ ok: boolean }>(`/teacher/classes/${classId}/students/${studentId}`, { method: 'DELETE' });
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
