import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Play, Square, RefreshCw, Trash2, ArrowRight, Copy, CheckCheck, Pencil } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import {
  listSessions, listSnapshots, listClasses, createSession, activateSession, getSession, updateSession,
  closeSession, reopenSession, regenJoinCode, deleteSession, SessionMeta,
} from '../api';
import { formatSchedule, fromLocalInput, toLocalInput } from '../lib/localDateTime';
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

const field = 'block w-full px-3 py-2.5 bg-surface border border-outline-variant/50 rounded-lg text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-50 disabled:cursor-not-allowed';

/** Create a session, or edit one (sessionId) within what its status allows. */
function SessionFormModal({ sessionId, onClose }: { sessionId?: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const editing = sessionId !== undefined;
  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: listSnapshots });
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: () => listClasses() });
  const { data: session } = useQuery({
    queryKey: ['session', sessionId],
    queryFn: () => getSession(sessionId as number),
    enabled: editing,
    // Never fill the form from a cached copy: what may be edited changes as
    // students join, and a stale answer would offer what the server refuses.
    gcTime: 0,
    refetchOnMount: 'always',
  });

  const [snapshotId, setSnapshotId] = useState('');
  const [title, setTitle] = useState('');
  const [selectedClasses, setSelectedClasses] = useState<number[]>([]);
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Fill the form once the session arrives; never again, or a refetch would
  // undo what the teacher is changing.
  const filled = useRef(false);
  useEffect(() => {
    if (!session || filled.current) return;
    filled.current = true;
    setSnapshotId(String(session.snapshot_id ?? ''));
    setTitle(session.title);
    setSelectedClasses(session.classes.map(c => c.id));
    setOpensAt(toLocalInput(session.opens_at));
    setClosesAt(toLocalInput(session.closes_at));
  }, [session]);

  const status = session?.status ?? 'draft';
  const closed = editing && status === 'closed';
  const quizLocked = editing && session?.edit?.quiz === false;
  const lockedClasses = session?.edit?.locked_class_ids ?? [];

  const saveMutation = useMutation({
    mutationFn: () => {
      const snap = snapshots?.find(s => s.id === Number(snapshotId));
      const common = {
        title: title.trim() || snap?.title || 'Quiz',
        snapshot_id: Number(snapshotId),
        class_ids: selectedClasses,
        opens_at: fromLocalInput(opensAt),
        closes_at: fromLocalInput(closesAt),
      };
      if (editing) return updateSession(sessionId, common);
      return createSession({
        ...common,
        opens_at: common.opens_at ?? undefined,
        closes_at: common.closes_at ?? undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      if (editing) queryClient.invalidateQueries({ queryKey: ['session', sessionId] });
      onClose();
    },
    onError: (err: any) => setError(err.message),
  });

  const toggleClass = (id: number) => {
    setSelectedClasses(prev =>
      prev.includes(id) ? prev.filter(c => c !== id) : [...prev, id]
    );
  };

  const handleSave = () => {
    setError(null);
    if (!snapshotId) { setError('Seleziona un quiz.'); return; }
    if (selectedClasses.length === 0) { setError('Seleziona almeno una classe.'); return; }
    if (opensAt && closesAt && fromLocalInput(closesAt)! <= fromLocalInput(opensAt)!) {
      setError("La chiusura deve venire dopo l'apertura."); return;
    }
    saveMutation.mutate();
  };

  const loading = editing && !session;
  // Only the teacher's own classes are listed; a session class is kept visible
  // even if it is no longer among them.
  const classOptions = [
    ...(classes ?? []),
    ...(session?.classes ?? []).filter(c => !classes?.some(k => k.id === c.id))
      .map(c => ({ ...c, student_count: undefined as number | undefined })),
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-container rounded-2xl border border-outline-variant/30 p-8 w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <h2 className="text-xl font-bold text-on-surface mb-2">{editing ? 'Modifica sessione' : 'Nuova sessione'}</h2>
        {closed && (
          <p className="text-sm text-on-surface-variant mb-4">
            La sessione è chiusa: si può cambiare solo il titolo. Quiz, classi e orari restano quelli dei risultati.
          </p>
        )}
        {editing && status === 'active' && (
          <p className="text-sm text-on-surface-variant mb-4">
            Sessione attiva: le modifiche valgono subito per gli studenti.
          </p>
        )}

        {loading ? <p className="text-on-surface-variant text-sm">Caricamento...</p> : (
        <div className="space-y-4 mt-4">
          <div>
            <label htmlFor="sf-quiz" className="block text-sm font-medium text-on-surface-variant mb-1.5">Quiz</label>
            <select id="sf-quiz" value={snapshotId} onChange={(e) => setSnapshotId(e.target.value)}
              disabled={closed || quizLocked} className={field}>
              <option value="">-- Seleziona un quiz --</option>
              {snapshots?.map(s => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
            {quizLocked && !closed && (
              <p className="text-xs text-on-surface-variant mt-1">
                Non si può cambiare: qualche studente ha già iniziato questo quiz.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="sf-title" className="block text-sm font-medium text-on-surface-variant mb-1.5">
              Titolo sessione{editing ? '' : ' (opzionale)'}
            </label>
            <input id="sf-title" type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Es: Verifica 2° Quadrimestre" className={field} />
          </div>

          <div>
            <span className="block text-sm font-medium text-on-surface-variant mb-2">Classi</span>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {classOptions.map(c => {
                const locked = lockedClasses.includes(c.id) && selectedClasses.includes(c.id);
                return (
                  <label key={c.id} className={`flex items-center gap-3 group ${closed || locked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                    <input
                      type="checkbox"
                      checked={selectedClasses.includes(c.id)}
                      onChange={() => toggleClass(c.id)}
                      disabled={closed || locked}
                      className="rounded border-outline-variant/50"
                    />
                    <span className="text-sm text-on-surface group-hover:text-primary transition-colors">
                      {c.name}
                      {c.student_count !== undefined && <span className="text-on-surface-variant text-xs"> ({c.student_count} studenti)</span>}
                      {locked && !closed && <span className="text-on-surface-variant text-xs"> · studenti già entrati</span>}
                    </span>
                  </label>
                );
              })}
              {!classOptions.length && <p className="text-sm text-on-surface-variant">Nessuna classe disponibile.</p>}
            </div>
          </div>

          <fieldset disabled={closed} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <legend className="text-sm font-medium text-on-surface-variant mb-1.5">Programmazione (opzionale)</legend>
            <div>
              <label htmlFor="sf-opens" className="block text-xs text-on-surface-variant mb-1">Ingresso dalle</label>
              <input id="sf-opens" type="datetime-local" value={opensAt} onChange={(e) => setOpensAt(e.target.value)} className={field} />
            </div>
            <div>
              <label htmlFor="sf-closes" className="block text-xs text-on-surface-variant mb-1">Chiusura alle</label>
              <input id="sf-closes" type="datetime-local" value={closesAt} onChange={(e) => setClosesAt(e.target.value)} className={field} />
            </div>
            <p className="sm:col-span-2 text-xs text-on-surface-variant">
              Gli studenti possono entrare con il codice solo in questo intervallo, a sessione avviata.
              Chi è già dentro alla chiusura ha ancora un'ora per finire e consegnare.
              {editing && status === 'active' && ' Se prolunghi la chiusura, a chi è già dentro potrebbe essere chiesto di reinserire il codice: le risposte non si perdono.'}
            </p>
          </fieldset>

          {error && <p className="text-error text-sm">{error}</p>}
        </div>
        )}

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-outline-variant/50 text-on-surface rounded-lg text-sm hover:bg-surface-container-high transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={handleSave}
            disabled={saveMutation.isPending || loading}
            className="flex-1 px-4 py-2.5 bg-primary text-on-primary rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saveMutation.isPending ? 'Salvataggio...' : editing ? 'Salva' : 'Crea'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The schedule, when there is one, under the classes on a session card. */
function ScheduleLine({ s }: { s: SessionMeta }) {
  if (!s.opens_at && !s.closes_at) return null;
  const parts = [
    s.opens_at && `ingresso dalle ${formatSchedule(s.opens_at)}`,
    s.closes_at && `chiusura alle ${formatSchedule(s.closes_at)}`,
  ].filter(Boolean);
  return <p className="text-xs text-on-surface-variant mt-0.5">{parts.join(' · ')}</p>;
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
      title="Modifica sessione"
    >
      <Pencil size={12} />
      Modifica
    </button>
  );
}

function SessionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
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
      {showCreate && <SessionFormModal onClose={() => setShowCreate(false)} />}
      {editingId !== null && <SessionFormModal key={editingId} sessionId={editingId} onClose={() => setEditingId(null)} />}

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
                      <ScheduleLine s={s} />
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
                      <EditButton onClick={() => setEditingId(s.id)} />
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
                    <ScheduleLine s={s} />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/teacher/sessions/${s.id}`)}
                      className="px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
                    >
                      Dettaglio
                    </button>
                    <EditButton onClick={() => setEditingId(s.id)} />
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
                    <ScheduleLine s={s} />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => navigate(`/teacher/sessions/${s.id}`)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
                    >
                      Punteggi <ArrowRight size={12} />
                    </button>
                    <EditButton onClick={() => setEditingId(s.id)} />
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
