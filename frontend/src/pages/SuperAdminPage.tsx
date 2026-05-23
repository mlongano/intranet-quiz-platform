import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Plus, ToggleLeft, ToggleRight, KeyRound } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import {
  listTeachers, createTeacher, updateTeacher, resetTeacherPassword,
  triggerSync, getSyncStatus, SyncStatus,
} from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';

function TeachersTab() {
  const queryClient = useQueryClient();
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();
  const { data: teachers, isLoading } = useQuery({ queryKey: ['sa-teachers'], queryFn: listTeachers });

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
    onSuccess: (data) => alert(`Nuova password temporanea: ${data.temp_password}`),
  });

  return (
    <div className="space-y-6">
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
    if (syncStatus && syncStatus.status !== 'running') setPollInterval(0);
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

function SuperAdminPage() {
  const [tab, setTab] = useState<'teachers' | 'sync'>('teachers');

  return (
    <TeacherLayout pageTitle="Amministrazione">
      <div className="flex gap-2 mb-6 border-b border-outline-variant/30">
        {(['teachers', 'sync'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {t === 'teachers' ? 'Docenti' : 'Sincronizzazione'}
          </button>
        ))}
      </div>
      {tab === 'teachers' && <TeachersTab />}
      {tab === 'sync' && <SyncTab />}
      {confirmModal}
    </TeacherLayout>
  );
}

export default SuperAdminPage;
