import { useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Upload, Trash2, Copy, CheckCheck, Trash } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import { listSnapshotImages, uploadSnapshotImage, deleteSnapshotImage, clearSnapshotImages, listSnapshots } from '../api';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy} className="p-1 text-on-surface-variant hover:text-primary transition-colors" title="Copia percorso">
      {copied ? <CheckCheck size={14} className="text-primary" /> : <Copy size={14} />}
    </button>
  );
}

function SnapshotImagesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const snapshotId = Number(id);
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: listSnapshots });
  const snapshot = snapshots?.find(s => s.id === snapshotId);

  const { data: images, isLoading } = useQuery({
    queryKey: ['snapshot-images', snapshotId],
    queryFn: () => listSnapshotImages(snapshotId),
    enabled: !!snapshotId,
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadSnapshotImage(snapshotId, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snapshot-images', snapshotId] }),
    onError: (err: any) => setError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (filename: string) => deleteSnapshotImage(snapshotId, filename),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snapshot-images', snapshotId] }),
    onError: (err: any) => setError(err.message),
  });

  const clearMutation = useMutation({
    mutationFn: () => clearSnapshotImages(snapshotId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['snapshot-images', snapshotId] }),
    onError: (err: any) => setError(err.message),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    setError(null);
    Array.from(files).forEach(file => uploadMutation.mutate(file));
    if (fileRef.current) fileRef.current.value = '';
  };

  const imageUrl = (filename: string) => `/images/${snapshotId}/${filename}`;

  return (
    <TeacherLayout
      pageTitle={snapshot ? `Immagini — ${snapshot.title}` : 'Immagini Quiz'}
      headerActions={
        <div className="flex gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
            multiple
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <Upload size={14} />
            {uploadMutation.isPending ? 'Caricamento...' : 'Carica'}
          </button>
          {images && images.length > 0 && (
            <button
              onClick={() => {
                if (confirm(`Eliminare tutte le ${images.length} immagini?`)) clearMutation.mutate();
              }}
              disabled={clearMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-error/40 text-error rounded-lg hover:bg-error/10 disabled:opacity-40 transition-colors"
            >
              <Trash size={14} />
              Elimina tutte
            </button>
          )}
        </div>
      }
    >
      <div className="mb-6">
        <button
          onClick={() => navigate(`/teacher/snapshots/${snapshotId}`)}
          className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={14} /> Modifica Quiz
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-error/10 border border-error/40 text-error rounded-lg text-sm flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4">✕</button>
        </div>
      )}

      <p className="text-xs text-on-surface-variant mb-4">
        Le immagini vengono servite come <code className="bg-surface-container px-1 rounded">/images/{snapshotId}/{'<filename>'}</code>. Usa questo percorso nel campo <code className="bg-surface-container px-1 rounded">question_image</code> o nelle opzioni del JSONC.
      </p>

      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}

      {images && images.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {images.map(img => (
            <div key={img.filename} className="bg-surface-container rounded-xl border border-outline-variant/30 overflow-hidden group">
              <div className="aspect-square bg-surface flex items-center justify-center overflow-hidden">
                <img
                  src={imageUrl(img.filename)}
                  alt={img.filename}
                  className="w-full h-full object-cover"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
              <div className="p-2">
                <p className="text-xs text-on-surface truncate" title={img.filename}>{img.filename}</p>
                <p className="text-xs text-on-surface-variant">{(img.size / 1024).toFixed(1)} KB</p>
                <div className="flex items-center justify-between mt-1">
                  <CopyButton text={`/images/${snapshotId}/${img.filename}`} />
                  <button
                    onClick={() => {
                      if (confirm(`Eliminare ${img.filename}?`)) deleteMutation.mutate(img.filename);
                    }}
                    disabled={deleteMutation.isPending}
                    className="p-1 text-on-surface-variant hover:text-error transition-colors disabled:opacity-40"
                    title="Elimina"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        !isLoading && (
          <div className="text-center py-16 text-on-surface-variant border-2 border-dashed border-outline-variant/30 rounded-xl">
            <p className="text-lg mb-2">Nessuna immagine</p>
            <p className="text-sm">Clicca "Carica" per aggiungere immagini a questo quiz.</p>
          </div>
        )
      )}
    </TeacherLayout>
  );
}

export default SnapshotImagesPage;
