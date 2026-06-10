import { useState } from 'react';
import MarkdownContent from '../MarkdownContent';
import { type QuestionSummary } from '../../lib/questionSummary';

function FormattedSummary({ value }: { value: any }) {
  if (value == null || value === '') return <span>—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>—</span>;
    return (
      <ul className="space-y-1">
        {value.map((item, index) => (
          <li key={`${String(item)}-${index}`}>
            <MarkdownContent compact>{String(item)}</MarkdownContent>
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    return <MarkdownContent compact>{JSON.stringify(value)}</MarkdownContent>;
  }
  return <MarkdownContent compact>{String(value)}</MarkdownContent>;
}

interface Props {
  questionSummary: QuestionSummary[];
  savingStudent: string | null;
  onSaveOverride: (studentKey: string, questionId: string, points: number) => void;
}

/** Per-question accordion: aggregate stats + inline per-student point overrides. */
function QuestionBreakdownView({ questionSummary, savingStudent, onSaveOverride }: Props) {
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [questionOverrides, setQuestionOverrides] = useState<Record<string, number>>({});

  const handleOverrideChange = (studentKey: string, newPoints: string, maxPoints: number) => {
    const pts = newPoints === '' ? undefined : parseFloat(newPoints);
    setQuestionOverrides(prev => {
      const next = { ...prev };
      if (pts === undefined || isNaN(pts)) delete next[studentKey];
      else next[studentKey] = Math.max(0, Math.min(pts, maxPoints));
      return next;
    });
  };

  const handleSave = (studentKey: string, questionId: string) => {
    const newPoints = questionOverrides[studentKey];
    if (newPoints === undefined) return;
    onSaveOverride(studentKey, questionId, newPoints);
    setQuestionOverrides(prev => { const next = { ...prev }; delete next[studentKey]; return next; });
  };

  return (
    <div className="space-y-4">
      {questionSummary.map(q => {
        const isExpanded = expandedQuestionId === q.questionId;
        return (
          <div key={q.questionId} className="bg-surface-container border border-outline-variant/20 rounded-xl overflow-hidden max-w-full">
            <div
              className="p-4 cursor-pointer hover:bg-surface-container-high transition-colors"
              onClick={() => {
                setExpandedQuestionId(isExpanded ? null : q.questionId);
                setQuestionOverrides({});
              }}
            >
              <div className="flex justify-between items-start">
                <div className="flex-1 min-w-0">
                  <div className="mb-1 text-on-surface">
                    <div className="text-sm font-semibold text-on-surface-variant">Q{q.questionId}</div>
                    <MarkdownContent className="text-sm font-medium text-on-surface" compact>
                      {q.questionText}
                    </MarkdownContent>
                  </div>
                  <div className="text-sm text-on-surface-variant">
                    Media: {q.avgPoints.toFixed(1)}/{q.weight} · Corrette: {q.correctCount}/{q.totalAnswers} · Tipo: {q.type}
                  </div>
                </div>
                <span className="text-on-surface-variant text-xl ml-4 flex-shrink-0">
                  {isExpanded ? '▼' : '▶'}
                </span>
              </div>
            </div>

            {isExpanded && (
              <div className="border-t border-outline-variant/20 bg-surface-container-low p-4">
                <div className="text-sm font-medium mb-3 text-on-surface">
                  Modifica punteggi ({q.totalAnswers} studenti):
                </div>
                <div className="space-y-2 max-h-[60vh] overflow-y-auto">
                  {q.studentAnswers.map(({ student, email, answer }) => {
                    const studentKey = email ?? student;
                    const currentPoints = answer?.points_awarded ?? 0;
                    const maxPoints = answer?.weight ?? q.weight;
                    const hasOverride = questionOverrides[studentKey] !== undefined;
                    const displayPoints = hasOverride ? questionOverrides[studentKey] : currentPoints;
                    const isSaving = savingStudent === studentKey;
                    const isCorrect = currentPoints === maxPoints;
                    const isPartial = currentPoints > 0 && !isCorrect;

                    const answerStr = answer?.student_answer ?? 'N/D';
                    const correctStr = answer?.correct_answer ?? 'N/D';
                    const llmStatusLabel = answer?.llm_status === 'pending'
                      ? 'In attesa LLM'
                      : answer?.llm_status === 'graded'
                        ? 'Valutato'
                        : answer?.llm_status === 'fallback'
                          ? 'Fallback parole chiave'
                          : answer?.llm_status === 'error'
                            ? 'Errore LLM'
                            : null;

                    return (
                      <div key={studentKey} className="bg-surface-container border border-outline-variant/20 rounded-lg p-3">
                        {/* Top row: student name + score controls */}
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="font-medium text-sm text-on-surface truncate">{student}</span>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <input
                              type="number"
                              min={0}
                              max={maxPoints}
                              step={0.5}
                              value={displayPoints}
                              onChange={e => handleOverrideChange(studentKey, e.target.value, maxPoints)}
                              className="bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none rounded w-16 text-center text-sm"
                            />
                            <span className="text-sm text-on-surface-variant">/ {maxPoints}</span>
                            {answer?.manual_override && (
                              <span className="text-[11px] text-secondary">(override)</span>
                            )}
                            <button
                              onClick={() => handleSave(studentKey, q.questionId)}
                              disabled={!hasOverride || isSaving}
                              className={`px-2.5 py-1 text-xs rounded transition-colors ${
                                hasOverride && !isSaving
                                  ? 'bg-primary text-on-primary font-bold'
                                  : 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
                              }`}
                            >
                              {isSaving ? '...' : 'Salva'}
                            </button>
                            <span className={`text-sm flex-shrink-0 ${
                              isCorrect ? 'text-tertiary' : isPartial ? 'text-secondary' : 'text-error'
                            }`}>
                              {isCorrect ? '✓' : isPartial ? '⚠' : '✗'}
                            </span>
                          </div>
                        </div>

                        {/* Answer details */}
                        {answer && (
                          <div className="space-y-1.5">
                            <div className="text-xs text-on-surface-variant">
                              <span className="font-medium">Risposta: </span>
                              <div className="mt-1 rounded border border-outline-variant/20 bg-surface-container-low px-2 py-1">
                                <FormattedSummary value={answerStr} />
                              </div>
                            </div>
                            <div className={`text-xs p-1.5 rounded border ${
                              isCorrect
                                ? 'bg-tertiary/10 border-tertiary/30 text-tertiary'
                                : isPartial
                                  ? 'bg-secondary/10 border-secondary/30 text-secondary'
                                  : 'bg-error/10 border-error/30 text-error'
                            }`}>
                              <span className="font-medium">Corretta: </span>
                              <FormattedSummary value={correctStr} />
                            </div>
                            {q.type === 'open' && (llmStatusLabel || answer.llm_verdict || answer.llm_feedback || answer.llm_error) && (
                              <div className="p-1.5 bg-secondary/5 rounded border border-secondary/20 text-xs">
                                {llmStatusLabel && (
                                  <span className="bg-secondary/10 border border-secondary/30 text-secondary text-xs px-1.5 py-0.5 rounded uppercase font-bold tracking-wider mr-2">
                                    {llmStatusLabel}
                                  </span>
                                )}
                                {answer.llm_verdict && (
                                  <span className="bg-secondary/10 border border-secondary/30 text-secondary text-xs px-1.5 py-0.5 rounded uppercase font-bold tracking-wider mr-2">
                                    {answer.llm_verdict}
                                  </span>
                                )}
                                {answer.llm_feedback && (
                                  <span className="text-secondary italic">{answer.llm_feedback}</span>
                                )}
                                {answer.llm_error && (
                                  <span className="text-error italic">{answer.llm_error}</span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default QuestionBreakdownView;
