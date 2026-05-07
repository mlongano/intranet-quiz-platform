import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Download, Trash2, Pencil } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import {
  listStudentSnapshots, getStudentSnapshot, deleteStudentSnapshot,
  renameStudentSnapshot, getStudentSnapshotExportUrl, StudentListSnapshotDetail,
} from '../api';

function SnapshotCard({ snap }: { snap: { id: number; title: string; created_at: string } }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [newTitle, setNewTitle] = useState(snap.title);

  const { data: detail, isLoading } = useQuery<StudentListSnapshotDetail>({
    queryKey: ['student-snapshot', snap.id],
    queryFn: () => getStudentSnapshot(snap.id),
    enabled: expanded,
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteStudentSnapshot(snap.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['student-snapshots'] }),
  });

  const renameMutation = useMutation({
    mutationFn: () => renameStudentSnapshot(snap.id, newTitle),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-snapshots'] });
      setEditingTitle(false);
    },
  });

  return (
    <div className="bg-surface-container rounded-xl border border-outline-variant/30 overflow-hidden">
      <div className="flex items-center justify-between p-4 gap-4">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-3 flex-1 min-w-0 hover:text-primary transition-colors text-left"
        >
          {expanded ? <ChevronDown size={16} className="flex-shrink-0" /> : <ChevronRight size={16} className="flex-shrink-0" />}
          <div className="min-w-0">
            {editingTitle ? (
              <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') renameMutation.mutate();
                    if (e.key === 'Escape') setEditingTitle(false);
                  }}
                  autoFocus
                  className="px-2 py-0.5 bg-surface border border-outline-variant/50 rounded text-sm text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40"
                />
                <button
                  onClick={() => renameMutation.mutate()}
                  disabled={renameMutation.isPending}
                  className="text-xs px-2 py-0.5 bg-primary text-on-primary rounded hover:bg-primary/90 disabled:opacity-40"
                >
                  OK
                </button>
              </div>
            ) : (
              <>
                <p className="font-medium text-on-surface truncate">{snap.title}</p>
                <p className="text-xs text-on-surface-variant">
                  {new Date(snap.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </>
            )}
          </div>
        </button>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setEditingTitle(v => !v)}
            className="p-1.5 text-on-surface-variant hover:text-primary transition-colors"
            title="Rinomina"
          >
            <Pencil size={14} />
          </button>
          <a
            href={getStudentSnapshotExportUrl(snap.id)}
            download
            className="p-1.5 text-on-surface-variant hover:text-primary transition-colors"
            title="Esporta"
          >
            <Download size={14} />
          </a>
          <button
            onClick={() => {
              if (confirm(`Eliminare "${snap.title}"?`)) deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
            className="p-1.5 text-on-surface-variant hover:text-error transition-colors disabled:opacity-40"
            title="Elimina"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-outline-variant/20 px-4 py-3">
          {isLoading && <p className="text-sm text-on-surface-variant py-2">Caricamento...</p>}
          {detail && (
            <div className="space-y-1.5">
              {detail.content.map((s, i) => (
                <div key={i} className="flex items-center gap-3 py-1">
                  <div className="w-7 h-7 rounded-full bg-secondary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-secondary">
                      {(s.display_name || s.email).charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-on-surface">{s.display_name || s.email}</p>
                    <p className="text-xs text-on-surface-variant">
                      {s.email}
                      {s.classes?.length > 0 && <span className="ml-2">· {s.classes.join(', ')}</span>}
                    </p>
                  </div>
                </div>
              ))}
              {!detail.content.length && <p className="text-sm text-on-surface-variant">Nessuno studente.</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StudentSnapshotsPage() {
  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['student-snapshots'],
    queryFn: listStudentSnapshots,
  });

  return (
    <TeacherLayout pageTitle="Archivi Studenti">
      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}
      <div className="space-y-3">
        {snapshots?.map(s => <SnapshotCard key={s.id} snap={s} />)}
        {!isLoading && !snapshots?.length && (
          <div className="text-center py-16 text-on-surface-variant">
            <p>Nessun archivio studenti. Gli archivi vengono creati automaticamente durante la sincronizzazione.</p>
          </div>
        )}
      </div>
    </TeacherLayout>
  );
}

export default StudentSnapshotsPage;
