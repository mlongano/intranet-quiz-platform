import { useState } from 'react';
import { type ScoreChangeSet, type SessionEvent } from '../../api';

const REASON_LABELS: Record<string, string> = {
  submission: 'Consegna',
  llm_grade: 'Valutazione LLM',
  llm_regrade: 'Rivalutazione LLM',
  manual_review: 'Revisione manuale',
  recalculate: 'Ricalcolo',
  revert: 'Ripristino',
};

function eventText(e: SessionEvent): { title: string; detail: string } {
  if (e.kind === 'results_emailed') {
    const sent = e.details.sent ?? 0;
    const failed = e.details.failed ?? [];
    return {
      title: 'Link ai risultati inviato via email',
      detail: `a ${sent} ${sent === 1 ? 'studente' : 'studenti'}`
        + (failed.length ? ` · non inviato a ${failed.join(', ')}` : ''),
    };
  }
  if (e.kind === 'results_published') {
    const extras = [e.details.show_correct && 'risposte corrette delle chiuse',
      e.details.show_acceptable && 'risposta accettabile delle aperte'].filter(Boolean);
    return { title: 'Risultati pubblicati', detail: extras.length ? `con ${extras.join(' e ')}` : 'senza risposte corrette' };
  }
  return { title: 'Pubblicazione ritirata', detail: e.details.because === 'reopened' ? 'per la riapertura della sessione' : '' };
}

interface Props {
  history: ScoreChangeSet[];
  /** Not score changes: shown in the same timeline, never revertible. */
  events?: SessionEvent[];
  onRevert: (changeSetId: string) => void;
  reverting: boolean;
  revertSuccess: boolean;
  revertError: string | null;
}

/** Entries shown before «Mostra tutte»: the latest are the ones acted upon. */
const COLLAPSED_COUNT = 5;

/** List of score change sets with one-click revert (Cronologia modifiche). */
function ScoreHistoryPanel({ history, events = [], onRevert, reverting, revertSuccess, revertError }: Props) {
  const [expanded, setExpanded] = useState(false);
  if (history.length === 0 && events.length === 0) return null;
  const timeline = [
    ...history.map(cs => ({ at: cs.created_at, cs, ev: null as SessionEvent | null })),
    ...events.map(ev => ({ at: ev.created_at, cs: null as ScoreChangeSet | null, ev })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const hidden = expanded ? 0 : Math.max(0, timeline.length - COLLAPSED_COUNT);
  return (
    <div className="mt-6 bg-surface-container border border-outline-variant/30 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-on-surface mb-3">Cronologia modifiche</h3>
      <div className="space-y-2">
        {timeline.slice(0, timeline.length - hidden).map(({ cs, ev }) => {
          if (ev) {
            const { title, detail } = eventText(ev);
            return (
              <div key={`ev-${ev.id}`} className="rounded-lg border border-outline-variant/20 bg-surface px-3 py-2">
                <p className="text-sm text-on-surface truncate">
                  <span className="font-medium">{title}</span>
                  {ev.actor_name && <span className="text-on-surface-variant"> da {ev.actor_name}</span>}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {detail}{detail ? ' · ' : ''}{new Date(ev.created_at).toLocaleString('it-IT')}
                </p>
              </div>
            );
          }
          if (!cs) return null;
          const isReverted = !!cs.reverted_change_id;
          // System change sets carry no teacher name; the submission entry is
          // the baseline of the audit chain and cannot be undone.
          const actorLabel = cs.actor_name ?? (cs.actor_type === 'system' ? 'Sistema' : null);
          const canRevert = !isReverted && cs.reason !== 'submission';
          return (
            <div key={cs.id} className="flex items-center justify-between gap-3 rounded-lg border border-outline-variant/20 bg-surface px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-on-surface truncate">
                  <span className="font-medium">{REASON_LABELS[cs.reason] ?? cs.reason}</span>
                  {actorLabel && <span className="text-on-surface-variant"> da {actorLabel}</span>}
                </p>
                <p className="text-xs text-on-surface-variant">
                  {cs.changed_answers} risposte modificate ·{' '}
                  {new Date(cs.created_at).toLocaleString('it-IT')}
                  {isReverted && ' · ripristinato'}
                </p>
              </div>
              {canRevert && (
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
      {timeline.length > COLLAPSED_COUNT && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-3 text-xs font-medium text-on-surface-variant hover:text-secondary transition-colors"
        >
          {expanded ? 'Mostra solo le più recenti' : `Mostra tutte (altre ${hidden})`}
        </button>
      )}
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
