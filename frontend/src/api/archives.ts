import { API_BASE, apiFetch } from './client';
import type { ArchiveDetail, ArchiveMeta } from './types';

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
