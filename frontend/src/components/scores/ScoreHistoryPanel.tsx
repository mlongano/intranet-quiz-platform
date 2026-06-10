import { type ScoreChangeSet } from '../../api';

const REASON_LABELS: Record<string, string> = {
  submission: 'Consegna',
  llm_grade: 'Valutazione LLM',
  llm_regrade: 'Rivalutazione LLM',
  manual_review: 'Revisione manuale',
  recalculate: 'Ricalcolo',
  revert: 'Ripristino',
};

interface Props {
  history: ScoreChangeSet[];
  onRevert: (changeSetId: string) => void;
  reverting: boolean;
  revertSuccess: boolean;
  revertError: string | null;
}

/** List of score change sets with one-click revert (Cronologia modifiche). */
function ScoreHistoryPanel({ history, onRevert, reverting, revertSuccess, revertError }: Props) {
  if (history.length === 0) return null;
  return (
    <div className="mb-6 bg-surface-container border border-outline-variant/30 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-on-surface mb-3">Cronologia modifiche</h3>
      <div className="space-y-2">
        {history.map(cs => {
          const isReverted = !!cs.reverted_change_id;
          return (
            <div key={cs.id} className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/20 bg-surface px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-on-surface truncate">
                  <span className="font-medium">{REASON_LABELS[cs.reason] ?? cs.reason}</span>
                  {cs.actor_name && <span className="text-on-surface-variant"> da {cs.actor_name}</span>}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {cs.changed_answers} risposte modificate ·{' '}
                  {new Date(cs.created_at).toLocaleString('it-IT')}
                  {isReverted && ' · ripristinato'}
                </p>
              </div>
              {!isReverted && (
                <button
                  onClick={() => {
                    if (window.confirm(`Ripristinare questa modifica? Le ${cs.changed_answers} risposte torneranno al valore precedente.`)) {
                      onRevert(cs.id);
                    }
                  }}
                  disabled={reverting}
                  className="flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-md bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:bg-secondary/10 hover:border-secondary/30 hover:text-secondary disabled:opacity-40 transition-colors"
                >
                  {reverting ? '...' : 'Ripristina'}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {revertSuccess && (
        <p className="mt-2 text-xs text-tertiary">Ripristino completato.</p>
      )}
      {revertError && (
        <p className="mt-2 text-xs text-error">{revertError}</p>
      )}
    </div>
  );
}

export default ScoreHistoryPanel;
