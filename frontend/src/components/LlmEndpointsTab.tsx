import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  clearLlmEndpointKey,
  createLlmEndpoint,
  deleteLlmEndpoint,
  listLlmEndpoints,
  setLlmEndpointKey,
  updateLlmEndpoint,
} from '../api';
import type { LlmEndpoint, LlmEndpointPayload } from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';

const PROTOCOLS = ['openai', 'anthropic', 'deepseek'] as const;

const EMPTY_FORM = {
  slug: '',
  label: '',
  protocol: 'openai' as LlmEndpoint['protocol'],
  base_url: '',
  requires_key: true,
  models: '',
  enabled: true,
  is_default: false,
  notes: '',
};

type FormState = typeof EMPTY_FORM;

function toPayload(form: FormState): LlmEndpointPayload {
  return {
    slug: form.slug.trim(),
    label: form.label.trim(),
    protocol: form.protocol,
    base_url: form.base_url.trim() || null,
    requires_key: form.requires_key,
    models: form.models.split(',').map(m => m.trim()).filter(Boolean),
    enabled: form.enabled,
    is_default: form.is_default,
    notes: form.notes.trim() || null,
  };
}

function toForm(endpoint: LlmEndpoint): FormState {
  return {
    slug: endpoint.slug,
    label: endpoint.label,
    protocol: endpoint.protocol,
    base_url: endpoint.base_url ?? '',
    requires_key: endpoint.requires_key,
    models: (endpoint.models ?? []).join(', '),
    enabled: endpoint.enabled,
    is_default: endpoint.is_default,
    notes: endpoint.notes ?? '',
  };
}

export function LlmEndpointsTab() {
  const queryClient = useQueryClient();
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();
  const { data: endpoints, isLoading } = useQuery({
    queryKey: ['sa-llm-endpoints'],
    queryFn: listLlmEndpoints,
  });

  const [editingId, setEditingId] = useState<number | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['sa-llm-endpoints'] });
  const closeForm = () => { setEditingId(null); setForm(EMPTY_FORM); setError(null); };
  const showError = (e: unknown) => setError(e instanceof Error ? e.message : 'Operazione non riuscita.');

  const saveMutation = useMutation({
    mutationFn: () =>
      editingId === 'new'
        ? createLlmEndpoint(toPayload(form))
        : updateLlmEndpoint(editingId as number, toPayload(form)),
    onSuccess: () => { refresh(); closeForm(); },
    onError: showError,
  });

  const toggleMutation = useMutation({
    mutationFn: (endpoint: LlmEndpoint) =>
      updateLlmEndpoint(endpoint.id, { enabled: !endpoint.enabled }),
    onSuccess: refresh,
    onError: showError,
  });

  const setDefaultMutation = useMutation({
    mutationFn: (endpoint: LlmEndpoint) =>
      updateLlmEndpoint(endpoint.id, { is_default: true }),
    onSuccess: refresh,
    onError: showError,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => deleteLlmEndpoint(id),
    onSuccess: refresh,
    onError: showError,
  });

  // The key field is write-only: what is typed is sent once and then dropped
  // from state; the list only ever shows a fingerprint.
  const [keyEditingId, setKeyEditingId] = useState<number | null>(null);
  const [keyDraft, setKeyDraft] = useState('');
  const closeKeyForm = () => { setKeyEditingId(null); setKeyDraft(''); };

  const setKeyMutation = useMutation({
    mutationFn: ({ id, apiKey }: { id: number; apiKey: string }) => setLlmEndpointKey(id, apiKey),
    onSuccess: () => { refresh(); closeKeyForm(); },
    onError: (e: unknown) => { setKeyDraft(''); showError(e); },
  });

  const clearKeyMutation = useMutation({
    mutationFn: (id: number) => clearLlmEndpointKey(id),
    onSuccess: refresh,
    onError: showError,
  });

  const confirmClearKey = (endpoint: LlmEndpoint) => {
    askConfirm(
      `Rimuovere la chiave API di "${endpoint.label}"?` +
      (endpoint.requires_key
        ? ' Le valutazioni su questo endpoint resteranno in attesa finché non ne imposti una nuova.'
        : ''),
      () => clearKeyMutation.mutate(endpoint.id),
    );
  };

  const startEdit = (endpoint: LlmEndpoint) => {
    setEditingId(endpoint.id);
    setForm(toForm(endpoint));
    setError(null);
  };

  const confirmDelete = (endpoint: LlmEndpoint) => {
    askConfirm(
      `Eliminare definitivamente "${endpoint.label}"? ` +
      'Per ritirare un endpoint già usato è preferibile disattivarlo, ' +
      'così resta leggibile nello storico delle valutazioni.',
      () => deleteMutation.mutate(endpoint.id),
    );
  };

  return (
    <div className="space-y-6">
      {confirmModal}

      <div>
        <div className="flex justify-between items-center">
          <h2 className="font-semibold text-on-surface">Endpoint LLM</h2>
          <button
            onClick={() => { setEditingId('new'); setForm(EMPTY_FORM); setError(null); }}
            className="px-3 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 transition-colors"
          >
            + Nuovo endpoint
          </button>
        </div>
        <p className="text-sm text-on-surface-variant mt-1">
          Elenco dei servizi che la valutazione automatica può contattare. I docenti
          potranno sceglierne uno da questa lista, senza mai indicare un indirizzo:
          è così che l'insieme dei server raggiungibili resta sotto controllo.
        </p>
        <p className="text-sm text-on-surface-variant mt-1">
          Ogni chiave viene inviata solo al servizio per cui è stata impostata. La
          chiave condivisa del file <span className="font-mono">.env</span> vale
          soltanto per il servizio ufficiale del provider: un endpoint con un proprio
          indirizzo che richiede una chiave deve averne una qui.
        </p>
      </div>

      {error && (
        <div className="p-3 bg-error/10 border border-error/30 text-error rounded-lg text-sm">
          {error}
          <button onClick={() => setError(null)} className="ml-3 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {editingId !== null && (
        <form
          onSubmit={e => { e.preventDefault(); saveMutation.mutate(); }}
          className="p-4 border border-outline-variant/40 rounded-lg space-y-3 bg-surface-container/40"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="text-on-surface-variant">Nome visualizzato</span>
              <input
                value={form.label} required
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="Server scuola (vLLM)"
                className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg"
              />
            </label>
            <label className="text-sm">
              <span className="text-on-surface-variant">Identificatore</span>
              <input
                value={form.slug} required
                onChange={e => setForm({ ...form, slug: e.target.value })}
                placeholder="lan-vllm"
                className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg font-mono"
              />
            </label>
            <label className="text-sm">
              <span className="text-on-surface-variant">Protocollo</span>
              <select
                value={form.protocol}
                onChange={e => setForm({ ...form, protocol: e.target.value as LlmEndpoint['protocol'] })}
                className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg"
              >
                {PROTOCOLS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-on-surface-variant">Indirizzo (vuoto = servizio ufficiale)</span>
              <input
                value={form.base_url}
                onChange={e => setForm({ ...form, base_url: e.target.value })}
                placeholder="http://10.0.0.5:8000/v1"
                className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg font-mono"
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="text-on-surface-variant">Modelli ammessi (separati da virgola, vuoto = qualsiasi; il primo è il predefinito)</span>
              <input
                value={form.models}
                onChange={e => setForm({ ...form, models: e.target.value })}
                placeholder="qwen2.5:14b, llama3.3:70b"
                className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg font-mono"
              />
            </label>
            <label className="text-sm md:col-span-2">
              <span className="text-on-surface-variant">Note</span>
              <input
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                className="mt-1 w-full px-3 py-2 bg-surface border border-outline-variant/40 rounded-lg"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox" checked={form.requires_key}
                onChange={e => setForm({ ...form, requires_key: e.target.checked })}
              />
              Richiede una chiave API
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox" checked={form.enabled}
                onChange={e => setForm({ ...form, enabled: e.target.checked })}
              />
              Attivo
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox" checked={form.is_default}
                onChange={e => setForm({ ...form, is_default: e.target.checked })}
              />
              Predefinito
            </label>
          </div>

          <div className="flex gap-2">
            <button
              type="submit" disabled={saveMutation.isPending}
              className="px-3 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Salvataggio…' : 'Salva'}
            </button>
            <button
              type="button" onClick={closeForm}
              className="px-3 py-1.5 text-sm border border-outline-variant/40 rounded-lg hover:bg-surface-container"
            >
              Annulla
            </button>
          </div>
        </form>
      )}

      {isLoading ? (
        <p className="text-sm text-on-surface-variant">Caricamento…</p>
      ) : !endpoints?.length ? (
        <p className="text-sm text-on-surface-variant">
          Nessun endpoint configurato: la valutazione usa le variabili d'ambiente.
        </p>
      ) : (
        <div className="space-y-2">
          {endpoints.map(endpoint => (
            <div
              key={endpoint.id}
              className={`p-3 border rounded-lg flex flex-wrap items-center gap-3 ${
                endpoint.enabled
                  ? 'border-outline-variant/40'
                  : 'border-outline-variant/20 opacity-60'
              }`}
            >
              <div className="flex-1 min-w-[14rem]">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-on-surface">{endpoint.label}</span>
                  {endpoint.is_default && (
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 border border-primary/30 text-primary">
                      predefinito
                    </span>
                  )}
                  {!endpoint.enabled && (
                    <span className="text-xs px-2 py-0.5 rounded bg-surface-container text-on-surface-variant">
                      disattivato
                    </span>
                  )}
                </div>
                <div className="text-xs text-on-surface-variant font-mono mt-0.5">
                  {endpoint.protocol}
                  {endpoint.base_url ? ` · ${endpoint.base_url}` : ' · servizio ufficiale'}
                  {endpoint.requires_key ? ' · chiave richiesta' : ' · senza chiave'}
                </div>
                {endpoint.models.length > 0 && (
                  <div className="text-xs text-on-surface-variant mt-0.5">
                    Modelli: {endpoint.models.join(', ')}
                  </div>
                )}
                <div className="text-xs mt-1 flex flex-wrap items-center gap-2">
                  {endpoint.api_key.configured ? (
                    <span className="text-on-surface-variant">
                      Chiave API: configurata
                      <span className="font-mono"> ({endpoint.api_key.fingerprint})</span>
                    </span>
                  ) : endpoint.requires_key && endpoint.base_url ? (
                    <span className="text-error">
                      Chiave API mancante: le valutazioni resteranno in attesa
                    </span>
                  ) : (
                    <span className="text-on-surface-variant">Chiave API: non configurata</span>
                  )}
                  {keyEditingId !== endpoint.id && (
                    <button
                      onClick={() => { setKeyEditingId(endpoint.id); setKeyDraft(''); setError(null); }}
                      className="underline text-primary hover:opacity-80"
                    >
                      {endpoint.api_key.configured ? 'Sostituisci' : 'Imposta'}
                    </button>
                  )}
                  {endpoint.api_key.configured && keyEditingId !== endpoint.id && (
                    <button
                      onClick={() => confirmClearKey(endpoint)}
                      className="underline text-error hover:opacity-80"
                    >
                      Rimuovi
                    </button>
                  )}
                </div>
                {keyEditingId === endpoint.id && (
                  <form
                    onSubmit={e => {
                      e.preventDefault();
                      setKeyMutation.mutate({ id: endpoint.id, apiKey: keyDraft });
                    }}
                    className="mt-2 flex flex-wrap gap-2 items-center"
                  >
                    <input
                      type="password" value={keyDraft} required autoFocus
                      autoComplete="off" spellCheck={false}
                      onChange={e => setKeyDraft(e.target.value)}
                      placeholder="Chiave API"
                      aria-label={`Chiave API per ${endpoint.label}`}
                      className="flex-1 min-w-[12rem] px-3 py-1.5 text-sm bg-surface border border-outline-variant/40 rounded-lg font-mono"
                    />
                    <button
                      type="submit" disabled={setKeyMutation.isPending || !keyDraft.trim()}
                      className="px-3 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-50"
                    >
                      {setKeyMutation.isPending ? 'Salvataggio…' : 'Salva chiave'}
                    </button>
                    <button
                      type="button" onClick={closeKeyForm}
                      className="px-3 py-1.5 text-sm border border-outline-variant/40 rounded-lg hover:bg-surface-container"
                    >
                      Annulla
                    </button>
                  </form>
                )}
              </div>

              <div className="flex gap-2 text-sm">
                {!endpoint.is_default && endpoint.enabled && (
                  <button
                    onClick={() => setDefaultMutation.mutate(endpoint)}
                    className="px-2 py-1 border border-outline-variant/40 rounded hover:bg-surface-container"
                  >
                    Rendi predefinito
                  </button>
                )}
                <button
                  onClick={() => toggleMutation.mutate(endpoint)}
                  className="px-2 py-1 border border-outline-variant/40 rounded hover:bg-surface-container"
                >
                  {endpoint.enabled ? 'Disattiva' : 'Attiva'}
                </button>
                <button
                  onClick={() => startEdit(endpoint)}
                  className="px-2 py-1 border border-outline-variant/40 rounded hover:bg-surface-container"
                >
                  Modifica
                </button>
                <button
                  onClick={() => confirmDelete(endpoint)}
                  className="px-2 py-1 border border-error/30 text-error rounded hover:bg-error/10"
                >
                  Elimina
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LlmEndpointsTab;
