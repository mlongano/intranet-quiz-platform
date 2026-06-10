import { apiFetch } from './client';
import type {
  LlmInfoResponse,
  LlmJobStatus,
  ResultEmailOptions,
  ScoreChangeSet,
  ScoreEntry,
  ScoreOverride,
} from './types';

export async function getSessionScores(sessionId: number): Promise<ScoreEntry[]> {
  return apiFetch<ScoreEntry[]>(`/teacher/sessions/${sessionId}/scores`);
}

export async function recalculateScores(sessionId: number): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>(`/teacher/sessions/${sessionId}/scores/recalculate`, {
    method: 'POST',
  });
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

export async function getScoreHistory(sessionId: number): Promise<ScoreChangeSet[]> {
  return apiFetch<ScoreChangeSet[]>(`/teacher/sessions/${sessionId}/score-history`);
}

export async function revertChangeSet(
  sessionId: number,
  changeSetId: string,
): Promise<{ ok: boolean; revert_change_set_id: string }> {
  return apiFetch<{ ok: boolean; revert_change_set_id: string }>(
    `/teacher/sessions/${sessionId}/score-history/${changeSetId}/revert`,
    { method: 'POST' },
  );
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

// ── result emails ────────────────────────────────────────────────────────────

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

// ── llm grading status ───────────────────────────────────────────────────────

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
