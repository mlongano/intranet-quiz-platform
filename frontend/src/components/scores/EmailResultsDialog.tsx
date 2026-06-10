import { useState } from 'react';
import { type ResultEmailOptions } from '../../api';

interface Props {
  defaultSubject: string;
  recipientCount: number;
  sending: boolean;
  error: string | null;
  sendErrors: Array<{ email: string; error: string }>;
  onSend: (options: ResultEmailOptions) => void;
  onClose: () => void;
}

/**
 * Modal for sending session results via email.
 * Mount only when open — subject/checkbox state resets on each mount.
 */
function EmailResultsDialog({ defaultSubject, recipientCount, sending, error, sendErrors, onSend, onClose }: Props) {
  const [subject, setSubject] = useState(defaultSubject);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [includeFeedback, setIncludeFeedback] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/70 p-4">
      <div className="w-full max-w-lg rounded-xl border border-outline-variant/30 bg-surface-container p-6 shadow-xl">
        <h2 className="text-xl font-bold text-on-surface">Inviare i risultati via email?</h2>
        <p className="mt-2 text-sm text-on-surface-variant">
          Verrà inviata una email a {recipientCount} studenti con i risultati di questa sessione.
        </p>

        <label className="mt-5 block text-sm font-medium text-on-surface">
          Oggetto email
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            className="mt-2 w-full rounded-lg border border-outline-variant/40 bg-surface px-3 py-2 text-sm text-on-surface focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>

        <div className="mt-5 space-y-3">
          <label className="flex items-start gap-3 text-sm text-on-surface">
            <input
              type="checkbox"
              checked={includeDetails}
              onChange={e => setIncludeDetails(e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Includi dettaglio domande</span>
              <span className="block text-on-surface-variant">Mostra risposte date, risposte corrette e punteggio per domanda.</span>
            </span>
          </label>

          <label className="flex items-start gap-3 text-sm text-on-surface">
            <input
              type="checkbox"
              checked={includeFeedback}
              onChange={e => setIncludeFeedback(e.target.checked)}
              disabled={!includeDetails}
              className="mt-1"
            />
            <span>
              <span className="block font-medium">Includi feedback dettagliato LLM</span>
              <span className="block text-on-surface-variant">Aggiunge verdetto e feedback automatico per le risposte aperte.</span>
            </span>
          </label>
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
            Invio email non riuscito: {error}
          </p>
        )}

        {sendErrors.length > 0 && (
          <div className="mt-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
            <p className="font-semibold">Alcune email non sono state inviate.</p>
            <ul className="mt-2 list-disc pl-5">
              {sendErrors.map(item => (
                <li key={`${item.email}-${item.error}`}>{item.email}: {item.error}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="rounded-lg border border-outline-variant/40 px-4 py-2 text-sm font-semibold text-on-surface hover:bg-surface-container-high disabled:opacity-50"
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => onSend({
              subject: subject.trim() || undefined,
              include_details: includeDetails,
              include_feedback: includeFeedback,
            })}
            disabled={sending || !subject.trim()}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Invio...' : 'Conferma invio'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default EmailResultsDialog;
