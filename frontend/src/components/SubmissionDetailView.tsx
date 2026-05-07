import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Save, RotateCcw } from 'lucide-react';
import { ScoreEntry, DetailedAnswer, ScoreOverride, reviewScores } from '../api';

interface Props {
  score: ScoreEntry;
  sessionId: number;
  onClose: () => void;
}

function AnswerRow({
  answer,
  override,
  onChange,
}: {
  answer: DetailedAnswer;
  override: number | undefined;
  onChange: (points: number) => void;
}) {
  const current = override !== undefined ? override : answer.points_awarded;
  const isDirty = override !== undefined && override !== answer.points_awarded;

  return (
    <div className={`rounded-lg border p-4 ${isDirty ? 'border-secondary/50 bg-secondary/5' : 'border-outline-variant/30 bg-surface-container'}`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <p className="text-sm text-on-surface flex-1">{answer.question_text}</p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <input
            type="number"
            min={0}
            max={answer.weight}
            step={0.5}
            value={current}
            onChange={e => onChange(Number(e.target.value))}
            className="w-20 px-2 py-1 text-sm text-center bg-surface border border-outline-variant/50 rounded-lg text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <span className="text-sm text-on-surface-variant">/ {answer.weight}</span>
          {isDirty && (
            <button
              onClick={() => onChange(answer.points_awarded)}
              className="text-on-surface-variant hover:text-on-surface transition-colors"
              title="Ripristina"
            >
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs font-medium text-on-surface-variant mb-1">Risposta studente</p>
          <p className="text-xs text-on-surface bg-surface rounded px-2 py-1.5 min-h-[2rem]">
            {formatAnswer(answer.student_answer)}
          </p>
          {answer.llm_feedback && (
            <p className="text-xs text-secondary mt-1 italic">{answer.llm_feedback}</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-on-surface-variant mb-1">Risposta corretta</p>
          <p className="text-xs text-on-surface bg-surface rounded px-2 py-1.5 min-h-[2rem]">
            {formatAnswer(answer.correct_answer)}
          </p>
        </div>
      </div>

      {answer.llm_verdict && (
        <p className="text-xs mt-2">
          <span className="text-on-surface-variant">Verdetto LLM: </span>
          <span className={answer.llm_verdict === 'correct' ? 'text-primary' : answer.llm_verdict === 'partial' ? 'text-secondary' : 'text-error'}>
            {answer.llm_verdict}
          </span>
        </p>
      )}
    </div>
  );
}

function formatAnswer(value: any): string {
  if (value == null) return '—';
  if (typeof value === 'string') return value || '—';
  if (Array.isArray(value)) return value.join(', ') || '—';
  return String(value);
}

function SubmissionDetailView({ score, sessionId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, number>>({});

  const answers: DetailedAnswer[] = score.answers ?? [];
  const studentName = score.student_display_name ?? score.student_email ?? score.student ?? '—';
  const studentId = score.student_id;

  const dirtyCount = Object.keys(overrides).filter(
    qid => overrides[qid] !== answers.find(a => String(a.question_id) === qid)?.points_awarded
  ).length;

  const computedRaw = answers.reduce((sum, a) => {
    const ov = overrides[String(a.question_id)];
    return sum + (ov !== undefined ? ov : a.points_awarded);
  }, 0);
  const maxPts = score.max_points;
  const computedPct = maxPts > 0 ? (computedRaw / maxPts) * 100 : 0;

  const saveMutation = useMutation({
    mutationFn: () => {
      if (studentId == null) throw new Error('student_id mancante nel punteggio');
      const payload: ScoreOverride[] = answers
        .filter(a => {
          const ov = overrides[String(a.question_id)];
          return ov !== undefined && ov !== a.points_awarded;
        })
        .map(a => ({
          student_id: studentId,
          question_id: a.question_id,
          points: overrides[String(a.question_id)],
        }));
      return reviewScores(sessionId, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-scores', sessionId] });
      onClose();
    },
  });

  const pctColor = computedPct >= 60 ? 'text-primary' : computedPct >= 40 ? 'text-secondary' : 'text-error';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm overflow-y-auto py-8 px-4">
      <div className="bg-surface rounded-2xl border border-outline-variant/30 shadow-2xl w-full max-w-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-outline-variant/20">
          <div>
            <h2 className="text-lg font-semibold text-on-surface">{studentName}</h2>
            <p className="text-sm text-on-surface-variant">{score.student_email ?? score.student}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <p className={`text-2xl font-bold ${pctColor}`}>{computedPct.toFixed(1)}%</p>
              <p className="text-xs text-on-surface-variant">
                {computedRaw.toFixed(1)} / {maxPts.toFixed(1)}
                {dirtyCount > 0 && <span className="text-secondary ml-1">(modificato)</span>}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-on-surface-variant hover:text-on-surface transition-colors rounded-lg hover:bg-surface-container"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Answers */}
        <div className="p-6 space-y-3 max-h-[60vh] overflow-y-auto">
          {answers.length === 0 && (
            <p className="text-center text-on-surface-variant py-8">Nessun dettaglio disponibile.</p>
          )}
          {answers.map((a, i) => (
            <AnswerRow
              key={String(a.question_id) ?? i}
              answer={a}
              override={overrides[String(a.question_id)]}
              onChange={pts => setOverrides(prev => ({
                ...prev,
                [String(a.question_id)]: Math.max(0, Math.min(pts, a.weight)),
              }))}
            />
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-outline-variant/20">
          <p className="text-sm text-on-surface-variant">
            {dirtyCount > 0
              ? `${dirtyCount} domanda${dirtyCount !== 1 ? 'e' : ''} modificata`
              : 'Nessuna modifica'}
          </p>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={dirtyCount === 0 || saveMutation.isPending}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              <Save size={14} />
              {saveMutation.isPending ? 'Salvataggio...' : 'Salva modifiche'}
            </button>
          </div>
        </div>

        {saveMutation.isError && (
          <div className="px-6 pb-4 text-sm text-error">
            {(saveMutation.error as any)?.message ?? 'Errore nel salvataggio.'}
          </div>
        )}
      </div>
    </div>
  );
}

export default SubmissionDetailView;
