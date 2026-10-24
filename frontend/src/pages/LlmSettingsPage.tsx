import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import TeacherLayout from '../layouts/TeacherLayout';
import {
  clearTeacherLlmKey,
  getTeacherLlmSettings,
  setTeacherLlmKey,
  updateTeacherLlmSettings,
} from '../api';
import type { TeacherLlmSettings } from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';

type AvailableEndpoint = TeacherLlmSettings['available_endpoints'][number];

/**
 * Open answers are graded only with the teacher's own key: there is no shared
 * one. The administrator decides which services are allowed; the teacher
 * picks one and stores a key for it. A key is kept per service and is sent to
 * that service only.
 */
function LlmSettingsPage() {
  const queryClient = useQueryClient();
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['teacher-llm-settings'],
    queryFn: getTeacherLlmSettings,
  });

  const [endpointId, setEndpointId] = useState<string>('');
  const [model, setModel] = useState('');
  // Key drafts live only until they are sent; nothing typed is kept afterwards.
  const [keyDrafts, setKeyDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Server state is the source of truth; mirror it into the form once loaded.
  useEffect(() => {
    if (!settings) return;
    setEndpointId(settings.endpoint_id ? String(settings.endpoint_id) : '');
    setModel(settings.model ?? '');
  }, [settings]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['teacher-llm-settings'] });
    queryClient.invalidateQueries({ queryKey: ['llm-info'] });
  };
  const showError = (e: unknown) => setError(e instanceof Error ? e.message : 'Operazione non riuscita.');
  const dropDraft = (id: number) => setKeyDrafts(d => {
    const next = { ...d };
    delete next[id];
    return next;
  });

  const savePrefs = useMutation({
    mutationFn: () => updateTeacherLlmSettings({
      endpoint_id: endpointId ? Number(endpointId) : null,
      model: model || null,
    }),
    onSuccess: () => { refresh(); setError(null); setNotice('Impostazioni salvate.'); },
    onError: showError,
  });

  const saveKey = useMutation({
    mutationFn: ({ id, apiKey }: { id: number; apiKey: string }) => setTeacherLlmKey(id, apiKey),
    onSuccess: (_data, { id }) => {
      refresh(); dropDraft(id); setError(null);
      setNotice('Chiave salvata. Non sarà più visibile: potrai solo sostituirla o rimuoverla.');
    },
    onError: (e: unknown, { id }) => { dropDraft(id); showError(e); },
  });

  const removeKey = useMutation({
    mutationFn: (id: number) => clearTeacherLlmKey(id),
    onSuccess: () => { refresh(); setError(null); setNotice('Chiave rimossa.'); },
    onError: showError,
  });

  const endpoints = settings?.available_endpoints ?? [];
  const effective = endpoints.find(e => e.id === settings?.effective_endpoint_id);
  // The model list follows the service the choice would apply to.
  const modelTarget: AvailableEndpoint | undefined =
    endpoints.find(e => String(e.id) === endpointId) ?? endpoints.find(e => e.is_default);

  const confirmRemove = (endpoint: AvailableEndpoint) => askConfirm(
    `Rimuovere la tua chiave per "${endpoint.label}"?` +
    (endpoint.id === effective?.id
      ? ' Le risposte aperte dei tuoi studenti resteranno da valutare a mano finché non ne imposti una nuova.'
      : ''),
    () => removeKey.mutate(endpoint.id),
  );

  return (
    <TeacherLayout pageTitle="Valutazione automatica">
      {confirmModal}
      <div className="max-w-2xl space-y-6">
        <p className="text-sm text-on-surface-variant">
          Le domande aperte vengono valutate automaticamente solo con la tua chiave
          personale. I servizi ammessi sono decisi dall'amministratore.
        </p>

        {error && (
          <div className="p-3 bg-error/10 border border-error/30 text-error rounded-lg text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}
        {notice && (
          <div className="p-3 bg-tertiary/10 border border-tertiary/30 text-tertiary rounded-lg text-sm">
            {notice}
            <button onClick={() => setNotice(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-on-surface-variant">Caricamento…</p>
        ) : !settings ? null : endpoints.length === 0 ? (
          <p className="text-sm text-on-surface-variant">
            L'amministratore non ha abilitato alcun servizio di valutazione: le risposte
            aperte restano da valutare a mano.
          </p>
        ) : (
          <>
            {effective && (
              effective.key.configured ? (
                <div className="p-3 bg-tertiary/10 border border-tertiary/30 rounded-lg text-sm text-on-surface">
                  Valutazione automatica attiva su <strong>{effective.label}</strong> con la
                  tua chiave <span className="font-mono text-xs">({effective.key.fingerprint})</span>.
                </div>
              ) : (
                <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-sm text-error">
                  Non hai ancora una chiave per <strong>{effective.label}</strong>: le risposte
                  aperte dei tuoi studenti restano da valutare a mano finché non ne imposti una.
                </div>
              )
            )}

            <section className="space-y-3">
              <h2 className="font-semibold text-on-surface">Servizio e modello</h2>

              <label className="block text-sm">
                <span className="text-on-surface-variant">Servizio</span>
                <select
                  value={endpointId}
                  onChange={e => { setEndpointId(e.target.value); setModel(''); }}
                  className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg"
                >
                  <option value="">Predefinito dell'istituto</option>
                  {endpoints.map(e => (
                    <option key={e.id} value={e.id}>
                      {e.label}{e.is_default ? ' (predefinito)' : ''}
                    </option>
                  ))}
                </select>
              </label>

              {modelTarget && (
                <label className="block text-sm">
                  <span className="text-on-surface-variant">Modello</span>
                  <select
                    value={model}
                    onChange={e => setModel(e.target.value)}
                    className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg"
                  >
                    <option value="">Predefinito ({modelTarget.models[0]})</option>
                    {modelTarget.models.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              )}

              <button
                onClick={() => savePrefs.mutate()}
                disabled={savePrefs.isPending}
                className="px-3 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
              >
                {savePrefs.isPending ? 'Salvataggio…' : 'Salva'}
              </button>
            </section>

            <section className="space-y-3 pt-4 border-t border-outline-variant/30">
              <h2 className="font-semibold text-on-surface">Le tue chiavi</h2>

              {!settings.encryption_available ? (
                <p className="text-sm text-error">
                  Il server non è configurato per conservare le chiavi in modo cifrato
                  (manca <code>CREDENTIAL_ENCRYPTION_KEY</code>). Contatta l'amministratore.
                </p>
              ) : (
                <>
                  <p className="text-xs text-on-surface-variant">
                    Una chiave vale solo per il servizio per cui la salvi e non viene mai
                    inviata altrove. Viene cifrata e non può più essere riletta: potrai
                    solo sostituirla o rimuoverla.
                  </p>
                  {endpoints.map(endpoint => {
                    const draft = keyDrafts[endpoint.id] ?? '';
                    return (
                      <div key={endpoint.id} className="p-3 border border-outline-variant/40 rounded-lg space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-medium text-on-surface">{endpoint.label}</span>
                          {endpoint.id === effective?.id && (
                            <span className="text-xs px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary">
                              in uso
                            </span>
                          )}
                          {endpoint.key.configured ? (
                            <>
                              <span className="text-xs px-2 py-0.5 rounded bg-tertiary/10 border border-tertiary/30 text-tertiary">
                                chiave configurata
                              </span>
                              <span className="text-on-surface-variant font-mono text-xs">
                                impronta {endpoint.key.fingerprint}
                              </span>
                              <button
                                onClick={() => confirmRemove(endpoint)}
                                className="text-xs underline text-error hover:opacity-80"
                              >
                                Rimuovi
                              </button>
                            </>
                          ) : (
                            <span className="text-xs text-on-surface-variant">nessuna chiave</span>
                          )}
                        </div>
                        <form
                          onSubmit={e => {
                            e.preventDefault();
                            saveKey.mutate({ id: endpoint.id, apiKey: draft });
                          }}
                          className="flex flex-wrap gap-2"
                        >
                          <input
                            type="password" value={draft}
                            autoComplete="off" spellCheck={false}
                            onChange={e => setKeyDrafts(d => ({ ...d, [endpoint.id]: e.target.value }))}
                            placeholder={endpoint.key.configured ? 'Sostituisci la chiave' : 'Incolla la tua chiave'}
                            aria-label={`Chiave per ${endpoint.label}`}
                            className="flex-1 min-w-[12rem] px-3 py-1.5 text-sm bg-surface border border-outline-variant/40 rounded-lg font-mono"
                          />
                          <button
                            type="submit"
                            disabled={!draft.trim() || saveKey.isPending}
                            className="px-3 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
                          >
                            Salva chiave
                          </button>
                        </form>
                      </div>
                    );
                  })}
                </>
              )}
            </section>
          </>
        )}
      </div>
    </TeacherLayout>
  );
}

export default LlmSettingsPage;
