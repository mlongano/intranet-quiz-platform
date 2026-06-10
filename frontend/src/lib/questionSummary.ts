import type { DetailedAnswer, ScoreEntry } from '../api';

export interface QuestionSummary {
  questionId: string;
  questionText: string;
  type: string;
  weight: number;
  correctCount: number;
  avgPoints: number;
  totalAnswers: number;
  studentAnswers: { student: string; email?: string; answer: DetailedAnswer | undefined }[];
}

export function buildQuestionSummary(scores: ScoreEntry[]): QuestionSummary[] {
  const questionMap = new Map<string, { text: string; type: string; weight: number }>();

  // Use embedded question_snapshot from scores
  scores.forEach(entry => {
    entry.answers?.forEach(a => {
      const qid = String(a.question_id);
      if (!questionMap.has(qid) && a.question_snapshot) {
        questionMap.set(qid, {
          text: a.question_snapshot.text ?? a.question_text,
          type: a.question_snapshot.type ?? 'unknown',
          weight: a.question_snapshot.weight ?? a.weight,
        });
      }
      if (!questionMap.has(qid)) {
        questionMap.set(qid, {
          text: a.question_text,
          type: 'unknown',
          weight: a.weight,
        });
      }
    });
  });

  return Array.from(questionMap.entries()).map(([qid, q]) => {
    const answers = scores.map(entry => ({
      student: entry.student_display_name ?? entry.student ?? entry.student_email ?? '—',
      email: entry.student_email ?? entry.student,
      answer: entry.answers?.find(a => String(a.question_id) === qid),
    }));

    const correctCount = answers.filter(a => a.answer && a.answer.points_awarded === a.answer.weight).length;
    const avgPoints = answers.reduce((sum, a) => sum + (a.answer?.points_awarded ?? 0), 0) / answers.length;

    return {
      questionId: qid,
      questionText: q.text,
      type: q.type,
      weight: q.weight,
      correctCount,
      avgPoints,
      totalAnswers: answers.length,
      studentAnswers: answers,
    };
  });
}
