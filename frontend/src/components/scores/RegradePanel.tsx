import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import { getRegradePreview, getTeacherLlmSettings, regradeOpenScores } from '../../api';
import type { LlmJobStatus, RegradeOptions } from '../../api';

interface Props {
  sessionId: number;
  disabled?: boolean;
  onQueued: (job: LlmJobStatus) => void;
}

/**
 * Regrading can lower a student's score, so nothing here happens on one click:
 * the teacher sees how many evaluations would be replaced before confirming,
 * and overwriting their own manual corrections needs a second, explicit step.
 */
export function RegradePanel({ sessionId, disabled, onQueued }: Props) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'pending_only' | 'all'>('pending_only');
  const [force, setForce] = useState(false);
  const [model, setModel] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: preview } = useQuery({
    queryKey: ['regrade-preview', sessionId],
    queryFn: () => getRegradePreview(sessionId),
    enabled: open,
  });
  const { data: settings } = useQuery({
    queryKey: ['teacher-llm-settings'],
    queryFn: getTeacherLlmSettings,
    enabled: open,
  });

  // Default to the model that produced the current evaluations, so a plain
  // "regrade" reproduces them rather than silently switching model.
  useEffect(() => {
    if (preview?.models_in_use?.length && !model) setModel(preview.models_in_use[0]);
  }, [preview, model]);

  const regrade = useMutation({
    mutationFn: (options: RegradeOptions) => regradeOpenScores(sessionId, options),
    onSuccess: (job) => {
      setOpen(false); setConfirming(false); setForce(false); setError(null);
      onQueued(job);
    },
    onError: (e: unknown) => {
      setConfirming(false);
      setError(e instanceof Error ? e.message : 'Rivalutazione non riuscita.');
    },
  });

  const affected = !preview
    ? 0
    : scope === 'pending_only'
      ? preview.pending
      : preview.pending + preview.graded;
  const overwritten = preview && scope === 'all' ? preview.graded : 0;
  const manualAffected = force && preview ? preview.manual_override : 0;
  const needsConfirmation = overwritten > 0 || manualAffected > 0;

  const submit = () => {
    if (needsConfirmation && !confirming) { setConfirming(true); return; }
    regrade.mutate({ scope, force_override_manual: force, model: model || null });
  };

  const modelOptions = Array.from(new Set([
    ...(preview?.models_in_use ?? []),
    ...(settings?.available_endpoints.flatMap(e => e.models) ?? []),
    ...(settings?.model ? [settings.model] : []),
  ]));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="px-3 py-1.5 text-sm border border-secondary/40 text-secondary rounded-lg hover:bg-secondary/10 disabled:opacity-50 transition-colors"
      >
        Rivaluta risposte aperte…
      </button>
    );
  }

  return (
    <div className="p-4 border border-secondary/30 rounded-lg bg-surface-container/40 space-y-3 w-full">
      <div className="flex justify-between items-center">
        <h3 className="font-medium text-on-surface">Rivaluta risposte aperte</h3>
        <button
          onClick={() => { setOpen(false); setConfirming(false); setError(null); }}
          className="text-on-surface-variant hover:text-on-surface"
        >
          ✕
        </button>
      </div>

      {error && (
        <div className="p-2 bg-error/10 border border-error/30 text-error rounded text-sm">{error}</div>
      )}

      {preview && (
        <p className="text-sm text-on-surface-variant">
          Non valutate: <strong>{preview.pending}</strong> ·
          {' '}già valutate: <strong>{preview.graded}</strong> ·
          {' '}corrette a mano: <strong>{preview.manual_override}</strong>
        </p>
      )}

      <div className="space-y-2 text-sm">
        <label className="flex items-start gap-2">
          <input
            type="radio" name="scope" checked={scope === 'pending_only'}
            onChange={() => { setScope('pending_only'); setConfirming(false); }}
            className="mt-1"
          />
          <span>
            Solo le risposte non ancora valutate
            <span className="block text-xs text-on-surface-variant">
              Riprova quelle rimaste in sospeso. Non tocca nessun punteggio esistente.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio" name="scope" checked={scope === 'all'}
            onChange={() => { setScope('all'); setConfirming(false); }}
            className="mt-1"
          />
          <span>
            Anche quelle già valutate
            <span className="block text-xs text-on-surface-variant">
              I punteggi possono cambiare, anche in diminuzione.
            </span>
          </span>
        </label>

        {preview && preview.manual_override > 0 && (
          <label className="flex items-start gap-2 pt-1">
            <input
              type="checkbox" checked={force}
              onChange={e => { setForce(e.target.checked); setConfirming(false); }}
              className="mt-1"
            />
            <span>
              Sovrascrivi anche le mie correzioni manuali ({preview.manual_override})
              <span className="block text-xs text-on-surface-variant">
                Di norma le valutazioni fatte a mano sono protette.
              </span>
            </span>
          </label>
        )}
      </div>

      {modelOptions.length > 0 && (
        <label className="block text-sm">
          <span className="text-on-surface-variant">Modello</span>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg"
          >
            <option value="">Il mio predefinito</option>
            {modelOptions.map(m => (
              <option key={m} value={m}>
                {m}{preview?.models_in_use?.[0] === m ? ' (usato finora)' : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {confirming && (
        <div className="p-3 bg-error/10 border border-error/30 rounded text-sm text-error space-y-1">
          <p className="font-medium">Confermi la rivalutazione?</p>
          {overwritten > 0 && (
            <p>
              {overwritten} valutazioni già assegnate verranno rifatte: i punteggi
              possono cambiare, anche in diminuzione.
            </p>
          )}
          {manualAffected > 0 && (
            <p>{manualAffected} correzioni manuali verranno sovrascritte.</p>
          )}
          <p className="text-xs">
            Ogni modifica resta annullabile dallo storico dei punteggi.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={submit}
          disabled={regrade.isPending || affected + manualAffected === 0}
          className={`px-3 py-1.5 text-sm rounded-lg disabled:opacity-50 transition-colors ${
            confirming
              ? 'bg-error text-on-error hover:bg-error/90'
              : 'bg-secondary text-on-secondary hover:bg-secondary/90'
          }`}
        >
          {regrade.isPending
            ? 'Invio…'
            : confirming
              ? 'Sì, rivaluta'
              : `Rivaluta ${affected + manualAffected} risposte`}
        </button>
        {confirming && (
          <button
            onClick={() => setConfirming(false)}
            className="px-3 py-1.5 text-sm border border-outline-variant/40 rounded-lg hover:bg-surface-container"
          >
            Annulla
          </button>
        )}
        {affected + manualAffected === 0 && preview && (
          <span className="text-xs text-on-surface-variant">Nulla da rivalutare.</span>
        )}
      </div>
    </div>
  );
}

export default RegradePanel;
