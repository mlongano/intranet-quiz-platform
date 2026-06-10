import { API_BASE, apiFetch } from './client';
import type { ImageMeta, SnapshotDetail, SnapshotMeta } from './types';

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

// ── snapshot images ──────────────────────────────────────────────────────────

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
