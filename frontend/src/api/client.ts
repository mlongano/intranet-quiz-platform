import { getTeacherToken, getStudentToken, clearTeacherSession } from '../lib/session';

export const API_BASE = '/api';

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

export type TokenSource = 'teacher' | 'student' | 'none';

export async function apiFetch<T>(
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
