import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import TeacherLayout from '../layouts/TeacherLayout';
import {
  clearTeacherLlmKey,
  getTeacherLlmSettings,
  setTeacherLlmKey,
  updateTeacherLlmSettings,
} from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';

function LlmSettingsPage() {
  const queryClient = useQueryClient();
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['teacher-llm-settings'],
    queryFn: getTeacherLlmSettings,
  });

  const [endpointId, setEndpointId] = useState<string>('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Server state is the source of truth; mirror it into the form once loaded.
  useEffect(() => {
    if (!settings) return;
    setEndpointId(settings.endpoint_id ? String(settings.endpoint_id) : '');
    setModel(settings.model ?? '');
  }, [settings]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['teacher-llm-settings'] });
  const showError = (e: unknown) => setError(e instanceof Error ? e.message : 'Operazione non riuscita.');

  const savePrefs = useMutation({
    mutationFn: () => updateTeacherLlmSettings({
      endpoint_id: endpointId ? Number(endpointId) : null,
      model: model.trim() || null,
    }),
    onSuccess: () => { refresh(); setError(null); setNotice('Impostazioni salvate.'); },
    onError: showError,
  });

  const saveKey = useMutation({
    mutationFn: () => setTeacherLlmKey(apiKey),
    onSuccess: () => {
      refresh(); setApiKey(''); setError(null);
      setNotice('Chiave salvata. Non sarà più visibile: potrai solo sostituirla.');
    },
    onError: showError,
  });

  const removeKey = useMutation({
    mutationFn: clearTeacherLlmKey,
    onSuccess: () => { refresh(); setError(null); setNotice('Chiave rimossa.'); },
    onError: showError,
  });

  const selected = settings?.available_endpoints.find(e => String(e.id) === endpointId);

  return (
    <TeacherLayout pageTitle="Valutazione automatica">
      {confirmModal}
      <div className="max-w-2xl space-y-6">
        <p className="text-sm text-on-surface-variant">
          Da qui scegli con quale servizio vengono valutate le tue domande aperte.
          Gli endpoint disponibili sono definiti dall'amministratore.
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
        ) : !settings ? null : (
          <>
            <section className="space-y-3">
              <h2 className="font-semibold text-on-surface">Servizio e modello</h2>

              {settings.available_endpoints.length === 0 ? (
                <p className="text-sm text-on-surface-variant">
                  L'amministratore non ha ancora configurato alcun endpoint: viene usata
                  la configurazione generale dell'istituto.
                </p>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="text-on-surface-variant">Servizio</span>
                    <select
                      value={endpointId}
                      onChange={e => setEndpointId(e.target.value)}
                      className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg"
                    >
                      <option value="">Predefinito dell'istituto</option>
                      {settings.available_endpoints.map(e => (
                        <option key={e.id} value={e.id}>
                          {e.label}{e.is_default ? ' (predefinito)' : ''}
                          {e.requires_key ? '' : ' — senza chiave'}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block text-sm">
                    <span className="text-on-surface-variant">Modello</span>
                    {selected && selected.models.length > 0 ? (
                      <select
                        value={model}
                        onChange={e => setModel(e.target.value)}
                        className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg"
                      >
                        <option value="">Predefinito</option>
                        {selected.models.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    ) : (
                      <input
                        value={model}
                        onChange={e => setModel(e.target.value)}
                        placeholder="gpt-4o-mini"
                        className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg font-mono"
                      />
                    )}
                  </label>

                  <button
                    onClick={() => savePrefs.mutate()}
                    disabled={savePrefs.isPending}
                    className="px-3 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    {savePrefs.isPending ? 'Salvataggio…' : 'Salva'}
                  </button>
                </>
              )}
            </section>

            <section className="space-y-3 pt-4 border-t border-outline-variant/30">
              <h2 className="font-semibold text-on-surface">Chiave API</h2>

              {!settings.encryption_available ? (
                <p className="text-sm text-error">
                  Il server non è configurato per conservare le chiavi in modo cifrato
                  (manca <code>CREDENTIAL_ENCRYPTION_KEY</code>). Contatta l'amministratore.
                </p>
              ) : (
                <>
                  {settings.key.configured ? (
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="px-2 py-1 rounded bg-tertiary/10 border border-tertiary/30 text-tertiary">
                        Chiave configurata
                      </span>
                      <span className="text-on-surface-variant font-mono text-xs">
                        impronta {settings.key.fingerprint}
                      </span>
                      <button
                        onClick={() => askConfirm(
                          'Rimuovere la tua chiave API? Le tue valutazioni useranno ' +
                          "la configurazione generale dell'istituto, se disponibile.",
                          () => removeKey.mutate(),
                        )}
                        className="px-2 py-1 border border-error/30 text-error rounded hover:bg-error/10"
                      >
                        Rimuovi
                      </button>
                    </div>
                  ) : (
                    <p className="text-sm text-on-surface-variant">
                      Nessuna chiave personale: vengono usate le credenziali dell'istituto.
                    </p>
                  )}

                  <label className="block text-sm">
                    <span className="text-on-surface-variant">
                      {settings.key.configured ? 'Sostituisci la chiave' : 'Incolla la tua chiave API'}
                    </span>
                    <input
                      type="password"
                      value={apiKey}
                      autoComplete="off"
                      onChange={e => setApiKey(e.target.value)}
                      placeholder="sk-…"
                      className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg font-mono"
                    />
                  </label>
                  <p className="text-xs text-on-surface-variant">
                    La chiave viene cifrata prima di essere salvata e non può più essere
                    riletta: potrai solo sostituirla o rimuoverla.
                  </p>
                  <button
                    onClick={() => saveKey.mutate()}
                    disabled={!apiKey.trim() || saveKey.isPending}
                    className="px-3 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
                  >
                    {saveKey.isPending ? 'Salvataggio…' : 'Salva chiave'}
                  </button>
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
