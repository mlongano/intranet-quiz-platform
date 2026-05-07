import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Download, ArrowRight, Image } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import { listSnapshots, createSnapshot, deleteSnapshot, getSnapshotExportUrl } from '../api';

function SnapshotsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: listSnapshots,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSnapshot,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snapshots'] }),
    onError: (err: any) => setError(err.message),
  });

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setImporting(true);
    try {
      const text = await file.text();
      const title = file.name.replace(/\.jsonc?$/, '');
      await createSnapshot(title, text);
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
    } catch (err: any) {
      setError(err.message ?? 'Errore durante l\'importazione.');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <TeacherLayout
      pageTitle="Quiz (Snapshot)"
      headerActions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".jsonc,.json"
            onChange={handleFileImport}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <Upload size={16} />
            {importing ? 'Importazione...' : 'Importa JSONC'}
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/40 text-error rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 text-error/60 hover:text-error">✕</button>
        </div>
      )}

      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}

      <div className="space-y-2">
        {snapshots?.map(s => (
          <div
            key={s.id}
            className="bg-surface-container rounded-xl border border-outline-variant/30 p-4 flex items-center justify-between gap-4 flex-wrap"
          >
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-on-surface truncate">{s.title}</h3>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {s.question_count} domande · aggiornato {new Date(s.updated_at).toLocaleDateString('it-IT')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={getSnapshotExportUrl(s.id)}
                download
                className="p-2 text-on-surface-variant hover:text-primary transition-colors"
                title="Esporta JSONC"
              >
                <Download size={16} />
              </a>
              <button
                onClick={() => navigate(`/teacher/snapshots/${s.id}/images`)}
                className="p-2 text-on-surface-variant hover:text-primary transition-colors"
                title="Gestisci immagini"
              >
                <Image size={16} />
              </button>
              <button
                onClick={() => navigate(`/teacher/snapshots/${s.id}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
              >
                Modifica <ArrowRight size={12} />
              </button>
              <button
                onClick={() => {
                  if (confirm(`Eliminare "${s.title}"?`)) deleteMutation.mutate(s.id);
                }}
                disabled={deleteMutation.isPending}
                className="p-2 text-on-surface-variant hover:text-error transition-colors disabled:opacity-40"
                title="Elimina"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        {!isLoading && !snapshots?.length && (
          <div className="text-center py-16 text-on-surface-variant">
            <p className="text-lg mb-2">Nessun quiz importato</p>
            <p className="text-sm">Importa un file JSONC per iniziare.</p>
          </div>
        )}
      </div>
    </TeacherLayout>
  );
}

export default SnapshotsListPage;
