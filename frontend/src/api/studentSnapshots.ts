import { API_BASE, apiFetch } from './client';
import type { StudentListSnapshotDetail, StudentListSnapshotMeta } from './types';

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
