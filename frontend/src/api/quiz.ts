import { apiFetch } from './client';
import type {
  Answer,
  ResumeResponse,
  SaveAnswerResponse,
  SessionInfoResponse,
  SubmitResponse,
} from './types';

export async function getSessionInfo(): Promise<SessionInfoResponse> {
  return apiFetch<SessionInfoResponse>('/quiz/session-info', {}, 'student');
}

export async function startQuiz(): Promise<{ quiz_id: string }> {
  return apiFetch<{ quiz_id: string }>('/quiz/start', { method: 'POST' }, 'student');
}

export async function resumeQuiz(quizId: string): Promise<ResumeResponse> {
  return apiFetch<ResumeResponse>(`/quiz/resume/${quizId}`, {}, 'student');
}

export async function saveAnswer(quiz_id: string, answer: Answer): Promise<SaveAnswerResponse> {
  return apiFetch<SaveAnswerResponse>('/quiz/save-answer', {
    method: 'POST',
    body: JSON.stringify({ quiz_id, answer }),
  }, 'student');
}

export async function submitQuiz(quiz_id: string): Promise<SubmitResponse> {
  return apiFetch<SubmitResponse>('/quiz/submit', {
    method: 'POST',
    body: JSON.stringify({ quiz_id }),
  }, 'student');
}
