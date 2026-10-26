import { apiFetch } from './client';

export interface MyResultItem {
  session_id: number;
  title: string;
  teacher: string;
  submitted_at: string | null;
  published: boolean;
  percent?: number;
  raw_points?: number;
  max_points?: number;
}

export interface MyResultQuestion {
  question_id: string;
  type: 'single' | 'multiple' | 'open';
  text: string;
  question_image?: string | null;
  options: string[];
  your_answer: string | string[] | null;
  points: number | null;        // null while an open answer is being graded
  max_points: number;
  pending: boolean;
  motivation: string | null;
  correct_answer?: string | string[] | null;   // only if the teacher chose to show it
}

export interface MyResultDetail {
  session_id: number;
  title: string;
  teacher: string;
  submitted_at: string | null;
  raw_points: number;
  max_points: number;
  percent: number;
  questions: MyResultQuestion[];
}

export async function studentGoogleLogin(credential: string): Promise<{ token: string; email: string; display_name: string }> {
  return apiFetch('/auth/student-google-login', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  }, 'none');
}

export async function getMyResults(): Promise<MyResultItem[]> {
  return apiFetch<MyResultItem[]>('/student/results', {}, 'results');
}

export async function getMyResult(sessionId: number): Promise<MyResultDetail> {
  return apiFetch<MyResultDetail>(`/student/results/${sessionId}`, {}, 'results');
}
