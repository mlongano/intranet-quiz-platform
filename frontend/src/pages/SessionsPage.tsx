import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Square, RefreshCw, Trash2, ArrowRight, Copy, CheckCheck } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import {
  listSessions, listSnapshots, listClasses, createSession, activateSession,
  closeSession, reopenSession, regenJoinCode, deleteSession, SessionMeta, CreateSessionPayload,
} from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';

function JoinCodeBadge({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-2xl font-bold tracking-[0.3em] text-primary select-all">{code}</span>
      <button onClick={copy} className="text-on-surface-variant hover:text-primary transition-colors" title="Copia codice">
        {copied ? <CheckCheck size={16} className="text-primary" /> : <Copy size={16} />}
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: SessionMeta['status'] }) {
  const map = {
    active: 'bg-tertiary/10 text-tertiary border-tertiary/30',
    draft: 'bg-secondary/10 text-secondary border-secondary/30',
    closed: 'bg-outline-variant/20 text-on-surface-variant border-outline-variant/30',
  };
  const label = { active: 'Attiva', draft: 'Bozza', closed: 'Chiusa' };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border ${map[status]}`}>
      {label[status]}
    </span>
  );
}

function CreateSessionModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: listSnapshots });
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: listClasses });

  const [snapshotId, setSnapshotId] = useState('');
  const [title, setTitle] = useState('');
  const [selectedClasses, setSelectedClasses] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateSessionPayload) => createSession(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
    },
    onError: (err: any) => setError(err.message),
  });

  const toggleClass = (id: number) => {
    setSelectedClasses(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleCreate = () => {
    setError(null);
    if (!snapshotId) { setError('Seleziona un quiz.'); return; }
    if (selectedClasses.length === 0) { setError('Seleziona almeno una classe.'); return; }
    const snap = snapshots?.find(s => s.id === Number(snapshotId));
    createMutation.mutate({
      snapshot_id: Number(snapshotId),
      title: title.trim() || snap?.title || 'Quiz',
      class_ids: selectedClasses,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-container rounded-2xl border border-outline-variant/30 p-8 w-full max-w-md">
        <h2 className="text-xl font-bold text-on-surface mb-6">Nuova sessione</h2>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1.5">Quiz</label>
            <select
              value={snapshotId}
              onChange={(e) => setSnapshotId(e.target.value)}
              className="block w-full px-3 py-2.5 bg-surface border border-outline-variant/50 rounded-lg text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            >
              <option value="">-- Seleziona un quiz --</option>
              {snapshots?.map(s => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-1.5">Titolo sessione (opzionale)</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Es: Verifica 2° Quadrimestre"
              className="block w-full px-3 py-2.5 bg-surface border border-outline-variant/50 rounded-lg text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-on-surface-variant mb-2">Classi</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {classes?.map(c => (
                <label key={c.id} className="flex items-center gap-3 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={selectedClasses.includes(c.id)}
                    onChange={() => toggleClass(c.id)}
                    className="rounded border-outline-variant/50"
                  />
                  <span className="text-sm text-on-surface group-hover:text-primary transition-colors">
                    {c.name} <span className="text-on-surface-variant text-xs">({c.student_count} studenti)</span>
                  </span>
                </label>
              ))}
              {!classes?.length && <p className="text-sm text-on-surface-variant">Nessuna classe disponibile.</p>}
            </div>
          </div>

          {error && <p className="text-error text-sm">{error}</p>}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-outline-variant/50 text-on-surface rounded-lg text-sm hover:bg-surface-container-high transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={handleCreate}
            disabled={createMutation.isPending}
            className="flex-1 px-4 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {createMutation.isPending ? 'Creazione...' : 'Crea'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SessionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => listSessions(),
  });

  const activateMutation = useMutation({
    mutationFn: activateSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err: any) => setActionError(err.message),
  });

  const closeMutation = useMutation({
    mutationFn: closeSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err: any) => setActionError(err.message),
  });

  const reopenMutation = useMutation({
    mutationFn: reopenSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err: any) => setActionError(err.message),
  });

  const regenMutation = useMutation({
    mutationFn: regenJoinCode,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err: any) => setActionError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (err: any) => setActionError(err.message),
  });

  const isPending = activateMutation.isPending || closeMutation.isPending || reopenMutation.isPending || regenMutation.isPending || deleteMutation.isPending;

  const activeSessions = sessions?.filter(s => s.status === 'active') ?? [];
  const draftSessions = sessions?.filter(s => s.status === 'draft') ?? [];
  const closedSessions = sessions?.filter(s => s.status === 'closed') ?? [];

  return (
    <TeacherLayout
      pageTitle="Sessioni Quiz"
      headerActions={
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} />
          Nuova sessione
        </button>
      }
    >
      {showCreate && <CreateSessionModal onClose={() => setShowCreate(false)} />}

      {actionError && (
        <div className="mb-4 p-3 bg-error/10 border border-error/40 text-error rounded-lg text-sm flex items-center justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="text-error/60 hover:text-error ml-4">✕</button>
        </div>
      )}

      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}

      <div className="space-y-8">
        {activeSessions.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-on-surface mb-3">Attive</h2>
            <div className="space-y-3">
              {activeSessions.map(s => (
                <div key={s.id} className="bg-surface-container rounded-xl border border-tertiary/20 p-5">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                      <div className="flex items-center gap-3 mb-1">
                        <StatusBadge status={s.status} />
                        <h3 className="font-semibold text-on-surface">{s.title}</h3>
                      </div>
                      {s.classes.length > 0 && (
                        <p className="text-xs text-on-surface-variant">{s.classes.map(c => c.name).join(', ')}</p>
                      )}
                      {s.join_code && (
                        <div className="mt-3">
                          <p className="text-xs text-on-surface-variant mb-1">Codice di accesso:</p>
                          <JoinCodeBadge code={s.join_code} />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => navigate(`/teacher/sessions/${s.id}`)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
                      >
                        Punteggi <ArrowRight size={12} />
                      </button>
                      <button
                        onClick={() => regenMutation.mutate(s.id)}
                        disabled={isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high disabled:opacity-40 transition-colors"
                        title="Rigenera codice"
                      >
                        <RefreshCw size={12} />
                        Rigenera
                      </button>
                      <button
                        onClick={() => closeMutation.mutate(s.id)}
                        disabled={isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-error/40 text-error rounded-lg hover:bg-error/10 disabled:opacity-40 transition-colors"
                      >
                        <Square size={12} />
                        Chiudi
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {draftSessions.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-on-surface mb-3">In bozza</h2>
            <div className="space-y-2">
              {draftSessions.map(s => (
                <div key={s.id} className="bg-surface-container rounded-xl border border-outline-variant/30 p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div>
                    <div className="flex items-center gap-3 mb-0.5">
                      <StatusBadge status={s.status} />
                      <h3 className="font-medium text-on-surface">{s.title}</h3>
                    </div>
                    {s.classes.length > 0 && (
                      <p className="text-xs text-on-surface-variant">{s.classes.map(c => c.name).join(', ')}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/teacher/sessions/${s.id}`)}
                      className="px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
                    >
                      Dettaglio
                    </button>
                    <button
                      onClick={() => activateMutation.mutate(s.id)}
                      disabled={isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    >
                      <Play size={12} />
                      Avvia
                    </button>
                    <button
                                            onClick={() => askConfirm(`Eliminare "${s.title}"?`, () => deleteMutation.mutate(s.id))}
                      disabled={isPending}
                      className="p-1.5 text-on-surface-variant hover:text-error transition-colors disabled:opacity-40"
                      title="Elimina"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {closedSessions.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-on-surface mb-3">Chiuse</h2>
            <div className="space-y-2">
              {closedSessions.map(s => (
                <div key={s.id} className="bg-surface-container rounded-xl border border-outline-variant/30 p-4 flex items-center justify-between gap-4 flex-wrap opacity-70">
                  <div>
                    <div className="flex items-center gap-3 mb-0.5">
                      <StatusBadge status={s.status} />
                      <h3 className="font-medium text-on-surface">{s.title}</h3>
                    </div>
                    {s.classes.length > 0 && (
                      <p className="text-xs text-on-surface-variant">{s.classes.map(c => c.name).join(', ')}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/teacher/sessions/${s.id}`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
                    >
                      Punteggi <ArrowRight size={12} />
                    </button>
                    <button
                      onClick={() => reopenMutation.mutate(s.id)}
                      disabled={isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
                    >
                      <Play size={12} />
                      Riapri
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {!isLoading && !sessions?.length && (
          <div className="text-center py-16 text-on-surface-variant">
            <p className="text-lg mb-2">Nessuna sessione</p>
            <p className="text-sm">Crea una sessione per iniziare un quiz con le tue classi.</p>
          </div>
        )}
      </div>
      {confirmModal}
    </TeacherLayout>
  );
}

export default SessionsPage;
