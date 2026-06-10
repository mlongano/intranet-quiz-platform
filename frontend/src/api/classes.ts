import { apiFetch } from './client';
import type { ClassMeta, ClassroomCourse, ClassroomSyncResult, StudentMeta } from './types';

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
