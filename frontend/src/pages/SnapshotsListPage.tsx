import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, Download, ArrowRight, Image, Eye, EyeOff } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import QuestionDisplay from '../components/QuestionDisplay';
import {
  listSnapshots, getSnapshot, createSnapshot, deleteSnapshot,
  getSnapshotExportUrl, type Question, type SnapshotMeta,
} from '../api';

function getHighlightIndices(q: Question): number[] {
  const question = q as Question & { correct?: number | number[] };
  if (question.type === 'single') {
    return typeof question.correct === 'number' && question.correct >= 0 ? [question.correct] : [];
  }
  if (question.type === 'multiple') {
    return Array.isArray(question.correct)
      ? question.correct.filter((n) => Number.isInteger(n) && n >= 0)
      : [];
  }
  return [];
}

function formatLabel(s: SnapshotMeta) {
  const date = new Date(s.created_at ?? s.updated_at);
  const dateStr = date.toISOString().slice(0, 10); // YYYY-MM-DD
  const parts = [
    s.single_count != null && `${s.single_count} singole`,
    s.multiple_count != null && `${s.multiple_count} multiple`,
    s.open_count != null && `${s.open_count} aperte`,
  ].filter(Boolean).join(' - ');
  return { dateStr, meta: parts, name: s.title };
}

function SnapshotsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [previewingId, setPreviewingId] = useState<number | null>(null);

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['snapshots'],
    queryFn: listSnapshots,
  });

  const { data: previewData, isLoading: isPreviewLoading } = useQuery({
    queryKey: ['snapshot', previewingId],
    queryFn: () => getSnapshot(previewingId!),
    enabled: !!previewingId,
    staleTime: Infinity,
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

  const togglePreview = (id: number) => {
    setPreviewingId(prev => prev === id ? null : id);
  };

  return (
    <TeacherLayout
      pageTitle="Banca Domande"
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

      <div className="space-y-1">
        {snapshots?.map(s => {
          const label = formatLabel(s);
          return (
            <div key={s.id} className="bg-surface-container hover:bg-surface-container-high border-b border-outline-variant/10 rounded-lg p-4 mb-2 last:mb-0">
              {/* ── header row ── */}
              <div className="flex justify-between items-center mb-2">
                <div className="flex min-w-0 flex-col">
                  <span className="text-xs font-mono text-primary/90">
                    {label.dateStr}
                    <span className="text-on-surface-variant/50 mx-2">·</span>
                    <span className="text-on-surface-variant/60">{label.meta}</span>
                  </span>
                  <span className="text-sm font-medium text-on-surface truncate">{label.name}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => togglePreview(s.id)}
                    className="bg-surface-container-high border border-outline-variant/30 text-on-surface-variant hover:text-on-surface py-1 px-3 rounded text-sm transition-colors"
                    title={previewingId === s.id ? 'Nascondi anteprima' : 'Anteprima'}
                  >
                    {previewingId === s.id ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
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

              {/* ── preview ── */}
              {previewingId === s.id && (
                <div className="bg-surface-container-low border border-outline-variant/20 rounded-lg p-4 mt-2">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-on-surface text-sm">Anteprima (risposte corrette evidenziate)</h3>
                    <span className="text-xs text-on-surface-variant">Verde = risposta corretta</span>
                  </div>
                  {isPreviewLoading && <p className="text-on-surface-variant text-sm">Caricamento anteprima...</p>}
                  {previewData && previewData.content?.questions?.length > 0 ? (
                    <div className="space-y-6">
                      {previewData.content.questions.map((q, idx) => (
                        <div key={q.id ?? idx} className="p-4 rounded-lg bg-surface-container border border-outline-variant/20">
                          <div className="mb-2 text-sm text-on-surface-variant">ID: {String(q.id)}</div>
                          <QuestionDisplay
                            question={q}
                            currentAnswer={null}
                            onAnswerChange={() => {}}
                            readOnly
                            highlightIndices={getHighlightIndices(q)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : previewData && (
                    <p className="text-on-surface-variant text-sm">Nessuna domanda in questo snapshot.</p>
                  )}
                </div>
              )}
            </div>
          );
        })}

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
