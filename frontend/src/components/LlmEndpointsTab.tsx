import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  createLlmEndpoint,
  deleteLlmEndpoint,
  listLlmEndpoints,
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
          possono sceglierne uno da questa lista, senza mai indicare un indirizzo:
          è così che l'insieme dei server raggiungibili resta sotto controllo.
        </p>
        <p className="text-sm text-on-surface-variant mt-1">
          Qui si decide solo <em>dove</em> può andare la valutazione. Le chiavi sono
          personali: ogni docente usa la propria, impostata nelle sue impostazioni, e
          viene inviata solo al servizio per cui l'ha salvata. Senza chiave, le sue
          risposte aperte restano da valutare a mano.
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
              <span className="text-on-surface-variant">Modelli ammessi (separati da virgola, almeno uno; il primo è il predefinito)</span>
              <input
                value={form.models} required
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
          Nessun endpoint configurato: la valutazione automatica è disattivata e le
          risposte aperte restano da valutare a mano.
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
                </div>
                {endpoint.models.length > 0 && (
                  <div className="text-xs text-on-surface-variant mt-0.5">
                    Modelli: {endpoint.models.join(', ')}
                  </div>
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
