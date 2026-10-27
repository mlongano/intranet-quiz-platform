import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Save, RotateCcw } from 'lucide-react';
import { ScoreEntry, DetailedAnswer, ScoreOverride, reviewScores } from '../api';
import MarkdownContent from './MarkdownContent';

interface Props {
  score: ScoreEntry;
  sessionId: number;
  onClose: () => void;
}

function AnswerRow({
  answer,
  override,
  onChange,
  feedbackDraft,
  onFeedbackChange,
}: {
  answer: DetailedAnswer;
  override: number | undefined;
  onChange: (points: number) => void;
  /** Edited motivation; undefined means unchanged. */
  feedbackDraft: string | undefined;
  onFeedbackChange: (text: string | undefined) => void;
}) {
  const current = override !== undefined ? override : answer.points_awarded;
  const pointsDirty = override !== undefined && override !== answer.points_awarded;
  const isDirty = pointsDirty || feedbackDraft !== undefined;
  const isCorrect = current >= answer.weight;
  const isPartial = current > 0 && !isCorrect;
  const statusLabel = isCorrect ? 'Corretta' : isPartial ? 'Parzialmente corretta' : 'Errata';
  const statusClass = isCorrect
    ? 'border-tertiary/50 bg-tertiary/10 text-tertiary'
    : isPartial
      ? 'border-secondary/50 bg-secondary/10 text-secondary'
      : 'border-error/50 bg-error/10 text-error';
  const studentAnswerClass = isCorrect
    ? 'border-tertiary/40 bg-tertiary/5'
    : isPartial
      ? 'border-secondary/40 bg-secondary/5'
      : 'border-error/40 bg-error/5';
  const questionType = answer.type ?? answer.question_snapshot?.type;
  const typeLabel = questionType === 'single'
    ? 'Scelta singola'
    : questionType === 'multiple'
      ? 'Scelta multipla'
      : questionType === 'open'
        ? 'Risposta aperta'
        : 'Tipo non indicato';
  const llmStatusLabel = answer.llm_status === 'pending'
    ? 'In attesa LLM'
    : answer.llm_status === 'graded'
      ? 'Valutato'
      : answer.llm_status === 'fallback'
        ? 'Fallback parole chiave'
        : answer.llm_status === 'error'
          ? 'Errore LLM'
          : null;

  return (
    <div className={`rounded-lg border p-4 ${isDirty ? 'border-secondary/50 bg-secondary/5' : 'border-outline-variant/30 bg-surface-container'}`}>
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="mb-2">
            <span className="inline-flex rounded-full border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-bold text-primary">
              {typeLabel}
            </span>
          </div>
          <MarkdownContent className="text-sm text-on-surface" compact>
            {answer.question_text}
          </MarkdownContent>
        </div>
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
          {answer.manual_override && answer.original_points_awarded != null && (
            <span className="rounded border border-secondary/40 bg-secondary/10 px-2 py-1 text-xs font-semibold text-secondary">
              Punteggio iniziale: {answer.original_points_awarded}
            </span>
          )}
          {pointsDirty && (
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

      <div className="mb-3">
        <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-bold ${statusClass}`}>
          {statusLabel}
        </span>
        {isDirty && (
          <span className="ml-2 inline-flex rounded-full border border-secondary/50 bg-secondary/10 px-2 py-1 text-xs font-bold text-secondary">
            Modifica manuale non salvata
          </span>
        )}
        {llmStatusLabel && (
          <span className="ml-2 inline-flex rounded-full border border-secondary/50 bg-secondary/10 px-2 py-1 text-xs font-bold text-secondary">
            {llmStatusLabel}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-on-surface-variant mb-1">Risposta studente</p>
          <p className={`min-h-[2rem] rounded border px-2 py-1.5 text-xs text-on-surface ${studentAnswerClass}`}>
            <FormattedAnswer value={answer.student_answer} />
          </p>
          {answer.llm_error && (
            <p className="text-xs text-error mt-1 italic">{answer.llm_error}</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium text-on-surface-variant mb-1">
            {questionType === 'open' ? 'Risposta accettabile' : 'Risposta corretta'}
          </p>
          <p className="min-h-[2rem] rounded border border-tertiary/60 bg-tertiary/10 px-2 py-1.5 text-xs text-on-surface">
            <FormattedAnswer value={answer.correct_answer} />
          </p>
        </div>
      </div>

      <FeedbackEditor answer={answer} isOpen={questionType === 'open'}
        draft={feedbackDraft} onChange={onFeedbackChange} />

      {answer.llm_verdict && (
        <p className="text-xs mt-2">
          <span className="text-on-surface-variant">Verdetto LLM: </span>
          <span className={answer.llm_verdict === 'correct' ? 'text-primary' : answer.llm_verdict === 'partial' ? 'text-secondary' : 'text-error'}>
            {answer.llm_verdict}
          </span>
        </p>
      )}

      {/* Provenance: without it a changed score after a regrade is unexplainable. */}
      {answer.llm_model && (
        <p className="text-xs mt-1 text-on-surface-variant" title={answer.prompt_version ?? undefined}>
          Valutata con <span className="text-secondary">{answer.llm_model}</span>
          {answer.llm_provider ? ` (${answer.llm_provider})` : ''}
          {answer.llm_updated_at ? ` il ${formatEvaluatedAt(answer.llm_updated_at)}` : ''}
        </p>
      )}
    </div>
  );
}

/**
 * The motivation the student reads: the teacher's when written, else the
 * model's. Always open for open questions; on a closed one it is optional.
 */
function FeedbackEditor({ answer, isOpen, draft, onChange }: {
  answer: DetailedAnswer;
  isOpen: boolean;
  draft: string | undefined;
  onChange: (text: string | undefined) => void;
}) {
  const shown = answer.teacher_feedback || answer.llm_feedback || '';
  const value = draft ?? shown;
  const [adding, setAdding] = useState(false);
  if (!isOpen && !shown && draft === undefined && !adding) {
    return (
      <button type="button" onClick={() => setAdding(true)}
        className="mt-3 text-xs text-primary hover:underline">
        Aggiungi una motivazione per lo studente
      </button>
    );
  }
  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={`fb-${answer.question_id}`} className="text-xs font-medium text-on-surface-variant">
          Motivazione per lo studente
          <span className="font-normal">
            {draft !== undefined ? ' · modificata, da salvare'
              : answer.teacher_feedback ? ' · scritta da te'
              : answer.llm_feedback ? ' · del modello' : ''}
          </span>
        </label>
        {answer.teacher_feedback && answer.llm_feedback && draft === undefined && (
          <button type="button" className="text-[11px] text-primary hover:underline"
            title={answer.llm_feedback} onClick={() => onChange('')}>
            Torna a quella del modello
          </button>
        )}
      </div>
      <textarea
        id={`fb-${answer.question_id}`}
        value={value}
        onChange={e => onChange(e.target.value === shown ? undefined : e.target.value)}
        rows={Math.min(6, Math.max(2, Math.ceil(value.length / 90)))}
        maxLength={4000}
        placeholder={answer.llm_status === 'pending'
          ? 'In attesa della valutazione: puoi anche scriverla tu.'
          : 'Spiega allo studente il punteggio.'}
        className="mt-1 w-full rounded border border-outline-variant/30 bg-surface-container-low px-2 py-1.5 text-xs text-on-surface focus:border-primary/50 focus:outline-none"
      />
      {draft === '' && answer.llm_feedback && (
        <p className="text-[11px] text-on-surface-variant">Salvando, torna quella del modello: «{answer.llm_feedback}»</p>
      )}
    </div>
  );
}

function formatEvaluatedAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function FormattedAnswer({ value }: { value: any }) {
  if (value == null || value === '') return <span>—</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span>—</span>;
    return (
      <ul className="space-y-1">
        {value.map((item, index) => (
          <li key={`${String(item)}-${index}`} className="rounded border border-outline-variant/20 bg-surface/60 px-2 py-1">
            <MarkdownContent compact>{String(item)}</MarkdownContent>
          </li>
        ))}
      </ul>
    );
  }
  return <MarkdownContent compact>{String(value)}</MarkdownContent>;
}

function SubmissionDetailView({ score, sessionId, onClose }: Props) {
  const queryClient = useQueryClient();
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({});

  const answers: DetailedAnswer[] = score.answers ?? [];
  const studentName = score.student_name ?? score.student_display_name ?? score.student_email ?? score.student ?? '—';

  const changedPoints = Object.keys(overrides).filter(
    qid => overrides[qid] !== answers.find(a => String(a.question_id) === qid)?.points_awarded
  );
  const dirtyCount = new Set([...changedPoints, ...Object.keys(feedbackDrafts)]).size;

  const computedRaw = answers.reduce((sum, a) => {
    const ov = overrides[String(a.question_id)];
    return sum + (ov !== undefined ? ov : a.points_awarded);
  }, 0);
  const maxPts = score.max_points;
  const computedPct = maxPts > 0 ? (computedRaw / maxPts) * 100 : 0;

  const saveMutation = useMutation({
    mutationFn: () => {
      if (score.id == null) throw new Error('id punteggio mancante');
      // One review for the whole submission: points and motivations together.
      const payload: ScoreOverride = {
        score_id: score.id,
        per_question: Object.fromEntries(changedPoints.map(qid => [qid, overrides[qid]])),
        feedback: feedbackDrafts,
      };
      return reviewScores(sessionId, [payload]);
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
                {changedPoints.length > 0 && <span className="text-secondary ml-1">(modificato)</span>}
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
              key={a.question_id == null ? i : String(a.question_id)}
              answer={a}
              override={overrides[String(a.question_id)]}
              onChange={pts => setOverrides(prev => ({
                ...prev,
                [String(a.question_id)]: Math.max(0, Math.min(pts, a.weight)),
              }))}
              feedbackDraft={feedbackDrafts[String(a.question_id)]}
              onFeedbackChange={text => setFeedbackDrafts(prev => {
                const next = { ...prev };
                if (text === undefined) delete next[String(a.question_id)];
                else next[String(a.question_id)] = text;
                return next;
              })}
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
