import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Plus, ToggleLeft, ToggleRight, KeyRound } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import {
  listTeachers, createTeacher, updateTeacher, resetTeacherPassword,
  triggerSync, getSyncStatus, SyncStatus, getRetention, type RetentionCounts,
} from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';
import LlmEndpointsTab from '../components/LlmEndpointsTab';

function TeachersTab() {
  const queryClient = useQueryClient();
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();
  const { data: teachers, isLoading } = useQuery({ queryKey: ['sa-teachers'], queryFn: listTeachers });
  const [message, setMessage] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'teacher' | 'super_admin'>('teacher');
  const [createResult, setCreateResult] = useState<{ temp_password: string } | null>(null);

  const createMutation = useMutation({
    mutationFn: () => createTeacher({ email, display_name: displayName, role }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['sa-teachers'] });
      setCreateResult({ temp_password: data.temp_password });
      setEmail(''); setDisplayName('');
    },
  });

  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      updateTeacher(id, { status: status === 'active' ? 'disabled' : 'active' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sa-teachers'] }),
  });

  const resetPw = useMutation({
    mutationFn: (id: number) => resetTeacherPassword(id),
    onSuccess: (data) => {
      // Show password in a non-dismissible inline notification
      const msg = `Nuova password temporanea: ${data.temp_password}`;
      setMessage(msg);
      setTimeout(() => setMessage(null), 15000);
    },
  });

  return (
    <div className="space-y-6">
      {message && (
        <div className="p-3 bg-tertiary/10 border border-tertiary/30 text-tertiary rounded-lg text-sm">
          {message}
          <button onClick={() => setMessage(null)} className="ml-3 text-tertiary/60 hover:text-tertiary">✕</button>
        </div>
      )}
      <div className="flex justify-between items-center">
        <h2 className="font-semibold text-on-surface">Docenti</h2>
        <button
          onClick={() => setShowCreate(v => !v)}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Plus size={14} /> Aggiungi
        </button>
      </div>

      {showCreate && (
        <div className="bg-surface-container rounded-xl border border-outline-variant/30 p-5 space-y-3">
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" className="block w-full px-3 py-2 bg-surface border border-outline-variant/50 rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="Nome visualizzato" className="block w-full px-3 py-2 bg-surface border border-outline-variant/50 rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <select value={role} onChange={e => setRole(e.target.value as any)} className="block w-full px-3 py-2 bg-surface border border-outline-variant/50 rounded-lg text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40">
            <option value="teacher">Docente</option>
            <option value="super_admin">Super Admin</option>
          </select>
          <button onClick={() => createMutation.mutate()} disabled={createMutation.isPending} className="w-full py-2 bg-primary text-on-primary text-sm rounded-lg hover:bg-primary/90 disabled:opacity-40">
            {createMutation.isPending ? 'Creazione...' : 'Crea docente'}
          </button>
          {createResult && (
            <div className="p-3 bg-primary/10 border border-primary/30 rounded-lg text-sm">
              <p className="font-medium text-primary">Password temporanea (comunicala al docente):</p>
              <p className="font-mono mt-1 text-on-surface select-all">{createResult.temp_password}</p>
            </div>
          )}
        </div>
      )}

      {isLoading && <p className="text-on-surface-variant text-sm">Caricamento...</p>}
      <div className="space-y-2">
        {teachers?.map(t => (
          <div key={t.id} className="bg-surface-container rounded-lg border border-outline-variant/30 p-4 flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="font-medium text-on-surface">{t.display_name}</p>
              <p className="text-xs text-on-surface-variant">{t.email} · {t.role}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggleStatus.mutate({ id: t.id, status: t.status })}
                disabled={toggleStatus.isPending}
                className="p-1.5 text-on-surface-variant hover:text-primary transition-colors"
                title={t.status === 'active' ? 'Disabilita' : 'Abilita'}
              >
                {t.status === 'active' ? <ToggleRight size={18} className="text-primary" /> : <ToggleLeft size={18} />}
              </button>
              <button
                                  onClick={() => askConfirm(`Resettare la password di ${t.display_name}?`, () => resetPw.mutate(t.id))}
                disabled={resetPw.isPending}
                className="p-1.5 text-on-surface-variant hover:text-secondary transition-colors"
                title="Reset password"
              >
                <KeyRound size={16} />
              </button>
            </div>
          </div>
        ))}
      </div>
      {confirmModal}
    </div>
  );
}


function SyncTab() {
  const [runId, setRunId] = useState<number | null>(null);
  const [pollInterval, setPollInterval] = useState(0);

  const triggerMutation = useMutation({
    mutationFn: triggerSync,
    onSuccess: (data) => {
      setRunId(data.run_id);
      setPollInterval(2000);
    },
  });

  const { data: syncStatus } = useQuery<SyncStatus>({
    queryKey: ['sync-status', runId],
    queryFn: () => getSyncStatus(runId!),
    enabled: !!runId,
    refetchInterval: pollInterval || false,
  });

  useEffect(() => {
    if (syncStatus?.status && syncStatus.status !== 'running') setPollInterval(0);
  }, [syncStatus?.status]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-semibold text-on-surface mb-1">Sincronizzazione Google Workspace</h2>
        <p className="text-sm text-on-surface-variant">
          Aggiorna docenti, studenti e classi dal tuo dominio Google. Richiede connessione internet.
        </p>
      </div>

      <button
        onClick={() => triggerMutation.mutate()}
        disabled={triggerMutation.isPending || syncStatus?.status === 'running'}
        className="flex items-center gap-2 px-4 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
      >
        <RefreshCw size={16} className={triggerMutation.isPending || syncStatus?.status === 'running' ? 'animate-spin' : ''} />
        {syncStatus?.status === 'running' ? 'Sincronizzazione...' : 'Avvia Sync'}
      </button>

      {syncStatus && (
        <div className={`p-4 rounded-lg border text-sm ${
          syncStatus.status === 'success' ? 'bg-primary/10 border-primary/30 text-primary' :
          syncStatus.status === 'error' ? 'bg-error/10 border-error/30 text-error' :
          'bg-surface-container border-outline-variant/30 text-on-surface-variant'
        }`}>
          <p className="font-medium capitalize">{syncStatus.status}</p>
          {syncStatus.result && (
            <ul className="mt-2 space-y-0.5 text-xs">
              {syncStatus.result.teachers_added !== undefined && <li>Docenti aggiunti: {syncStatus.result.teachers_added}</li>}
              {syncStatus.result.students_added !== undefined && <li>Studenti aggiunti: {syncStatus.result.students_added}</li>}
              {syncStatus.result.classes_added !== undefined && <li>Classi aggiunte: {syncStatus.result.classes_added}</li>}
              {syncStatus.result.errors?.map((e, i) => <li key={i} className="text-error">⚠ {e}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });

function countsText(c: RetentionCounts): string {
  const parts = [
    [c.sessions, 'sessioni'], [c.archives, 'archivi di punteggi'], [c.student_lists, 'elenchi studenti salvati'],
    [c.classes, 'classi'], [c.students, 'studenti usciti dalla scuola'],
  ].filter(([n]) => (n as number) > 0).map(([n, label]) => `${n} ${label}`);
  return parts.length ? parts.join(', ') : 'niente';
}

/** Data retention (GDPR): what goes, when, and what went. Counts only. */
function RetentionTab() {
  const { data, isLoading, isError, error } = useQuery({ queryKey: ['sa-retention'], queryFn: getRetention });
  if (isLoading) return <p className="text-on-surface-variant">Caricamento...</p>;
  if (isError || !data) return <p className="text-error text-sm">{String((error as Error)?.message ?? 'Errore')}</p>;
  const modeText = {
    apply: 'Attiva: i dati scaduti vengono cancellati automaticamente (controllo ogni 6 ore).',
    report: 'Solo calcolo: niente viene cancellato finché non si imposta DATA_RETENTION=apply.',
    off: 'Disattivata (DATA_RETENTION=off).',
  }[data.mode];
  return (
    <div className="space-y-4 max-w-2xl">
      <p className="text-sm text-on-surface-variant">
        I dati degli studenti di una sessione (risposte, punteggi, motivazioni, cronologia, risultati pubblicati, archivi
        copiati da essa) si conservano fino al 31 dicembre successivo alla fine dell'anno scolastico, poi si cancellano.
        Le domande dei quiz restano. Con loro vanno le classi di quell'anno non più usate e gli studenti usciti dalla
        scuola senza più dati. Le copie di sicurezza scadono dopo 30 giorni.
      </p>
      <div className={`rounded-lg border p-3 text-sm ${data.mode === 'apply' ? 'border-tertiary/30 bg-tertiary/5 text-on-surface' : 'border-secondary/30 bg-secondary/5 text-on-surface'}`}>
        {modeText}
      </div>
      <div className="rounded-lg border border-outline-variant/30 bg-surface-container p-3 text-sm">
        <p className="font-medium text-on-surface">Da cancellare adesso</p>
        <p className="text-on-surface-variant">{countsText(data.due)}</p>
      </div>
      <div className="rounded-lg border border-outline-variant/30 bg-surface-container p-3 text-sm">
        <p className="font-medium text-on-surface">Prossime scadenze</p>
        {data.upcoming.length === 0 ? <p className="text-on-surface-variant">Nessuna.</p> : (
          <ul className="mt-1 space-y-0.5 text-on-surface-variant">
            {data.upcoming.map(u => (
              <li key={u.date}>Conservati fino al {fmtDay(u.date)}: {u.sessions} {u.sessions === 1 ? 'sessione' : 'sessioni'}{u.archives ? `, ${u.archives} ${u.archives === 1 ? 'archivio' : 'archivi'}` : ''}</li>
            ))}
          </ul>
        )}
      </div>
      {data.last_run && (
        <p className="text-xs text-on-surface-variant">
          Ultima cancellazione: {new Date(data.last_run.ran_at).toLocaleString('it-IT')} — {countsText(data.last_run.deleted)}.
        </p>
      )}
    </div>
  );
}

const TAB_LABELS = {
  teachers: 'Docenti',
  sync: 'Sincronizzazione',
  llm: 'Endpoint LLM',
  retention: 'Conservazione dati',
} as const;

function SuperAdminPage() {
  const [tab, setTab] = useState<keyof typeof TAB_LABELS>('teachers');

  return (
    <TeacherLayout pageTitle="Amministrazione">
      <div className="flex gap-2 mb-6 border-b border-outline-variant/30">
        {(Object.keys(TAB_LABELS) as Array<keyof typeof TAB_LABELS>).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === 'teachers' && <TeachersTab />}
      {tab === 'sync' && <SyncTab />}
      {tab === 'llm' && <LlmEndpointsTab />}
      {tab === 'retention' && <RetentionTab />}
    </TeacherLayout>
  );
}

export default SuperAdminPage;
