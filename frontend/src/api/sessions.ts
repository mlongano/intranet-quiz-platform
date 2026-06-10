import { apiFetch } from './client';
import type { CreateSessionPayload, SessionMeta } from './types';

export async function listSessions(status?: string): Promise<SessionMeta[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<SessionMeta[]>(`/teacher/sessions${qs}`);
}

export async function getSession(sessionId: number): Promise<SessionMeta> {
  return apiFetch<SessionMeta>(`/teacher/sessions/${sessionId}`);
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
