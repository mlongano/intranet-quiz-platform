import { apiFetch } from './client';

/** One quiz in the anonymous history: what outlived its session's data. */
export interface HistoryQuiz {
  id: number;
  title: string;
  school_year: string;
  /** Year of course 1-5, when unambiguous. */
  grade: number | null;
  submissions: number;
  archived_at: string;
  questions: number;
}

export interface HistoryAnswerRow {
  answer: unknown;
  points: number | null;
  max_points: number;
  motivation: string | null;
  teacher_reviewed: boolean;
  model_points: number | null;
  llm_model: string | null;
  prompt_version: string | null;
}

export interface HistoryQuestion {
  question_key: string;
  type: string;
  question: { text?: string; options?: (string | { text?: string })[]; correct?: unknown; acceptable?: string; weight?: number };
  answers: number;
  average_points: number | null;
  max_points: number | null;
  full_marks: number;
  teacher_reviewed: number;
  option_counts?: number[];
  rows?: HistoryAnswerRow[];
}

export interface HistoryDetail extends Omit<HistoryQuiz, 'questions'> {
  questions: HistoryQuestion[];
}

export async function listHistory(): Promise<HistoryQuiz[]> {
  return apiFetch<HistoryQuiz[]>('/teacher/history');
}

export async function getHistory(id: number, withAnswers = false): Promise<HistoryDetail> {
  return apiFetch<HistoryDetail>(`/teacher/history/${id}${withAnswers ? '?answers=1' : ''}`);
}

export async function deleteHistory(id: number) {
  return apiFetch<{ ok: boolean }>(`/teacher/history/${id}`, { method: 'DELETE' });
}
