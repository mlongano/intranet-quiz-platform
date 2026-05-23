import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Image, Download, Eye, EyeOff } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import ImagePicker from '../components/ImagePicker';
import { getSnapshot, updateSnapshot, getSnapshotExportUrl, downloadExport } from '../api';

function SnapshotEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const snapshotId = Number(id);

  const [jsonc, setJsonc] = useState('');
  const [title, setTitle] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { data: snapshot, isLoading } = useQuery({
    queryKey: ['snapshot', snapshotId],
    queryFn: () => getSnapshot(snapshotId),
    enabled: !!snapshotId,
  });

  useEffect(() => {
    if (snapshot) {
      setTitle(snapshot.title);
      setJsonc(JSON.stringify(snapshot.content, null, 2));
      setDirty(false);
    }
  }, [snapshot]);

  const saveMutation = useMutation({
    mutationFn: () => updateSnapshot(snapshotId, {
      title: title.trim() || undefined,
      jsonc: dirty ? jsonc : undefined,
    }),
    onSuccess: () => {
      setSaveError(null);
      setSaveSuccess(true);
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['snapshot', snapshotId] });
      queryClient.invalidateQueries({ queryKey: ['snapshots'] });
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (err: any) => {
      setSaveError(err.message ?? 'Errore nel salvataggio.');
    },
  });

  const questions = (() => {
    try {
      const parsed = JSON.parse(jsonc);
      return Array.isArray(parsed) ? parsed : parsed?.questions ?? [];
    } catch {
      return null;
    }
  })();

  const parseError = jsonc && questions === null ? 'JSON non valido' : null;

  if (isLoading) {
    return (
      <TeacherLayout pageTitle="Modifica Quiz">
        <p className="text-on-surface-variant">Caricamento...</p>
      </TeacherLayout>
    );
  }

  return (
    <>
    <TeacherLayout
      pageTitle={title || 'Modifica Quiz'}
      headerActions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => downloadExport(getSnapshotExportUrl(snapshotId), `${snapshot?.slug || snapshotId}.jsonc`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
          >
            <Download size={14} />
            Esporta
          </button>
          <button
            onClick={() => setShowImagePicker(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
          >
            <Image size={14} />
            Inserisci immagine
          </button>
          <button
            onClick={() => navigate(`/teacher/snapshots/${snapshotId}/images`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
          >
            <Image size={14} />
            Gestisci immagini
          </button>
          <button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || !!parseError}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <Save size={14} />
            {saveMutation.isPending ? 'Salvataggio...' : 'Salva'}
          </button>
        </div>
      }
    >
      <div className="mb-4">
        <button
          onClick={() => navigate('/teacher/snapshots')}
          className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={14} /> Banca Domande
        </button>
      </div>

      {saveSuccess && (
        <div className="mb-4 p-3 bg-primary/10 border border-primary/30 text-primary rounded-lg text-sm">
          Salvato con successo.
        </div>
      )}
      {saveError && (
        <div className="mb-4 p-3 bg-error/10 border border-error/40 text-error rounded-lg text-sm flex justify-between">
          <span>{saveError}</span>
          <button onClick={() => setSaveError(null)} className="ml-4">✕</button>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-on-surface-variant mb-1.5">Titolo</label>
          <input
            type="text"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            className="block w-full max-w-md px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-lg text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-on-surface-variant">
              Contenuto JSONC
              {questions !== null && (
                <span className="ml-2 text-xs text-on-surface-variant/60 font-normal">
                  ({Array.isArray(questions) ? questions.length : 0} domande)
                </span>
              )}
            </label>
            <div className="flex items-center gap-2">
              {parseError && <span className="text-xs text-error">{parseError}</span>}
              <button
                onClick={() => setShowPreview(v => !v)}
                className="flex items-center gap-1 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
              >
                {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
                {showPreview ? 'Nascondi anteprima' : 'Anteprima'}
              </button>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={jsonc}
            onChange={(e) => { setJsonc(e.target.value); setDirty(true); setSaveError(null); }}
            spellCheck={false}
            rows={30}
            className={`block w-full px-4 py-3 bg-surface-container border rounded-lg text-on-surface font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y ${
              parseError ? 'border-error/60' : 'border-outline-variant/50'
            }`}
          />
        </div>

        {showPreview && questions !== null && (
          <div className="bg-surface-container rounded-xl border border-outline-variant/30 p-5">
            <h3 className="font-semibold text-on-surface mb-4">
              Anteprima — {Array.isArray(questions) ? questions.length : 0} domande
            </h3>
            <div className="space-y-4">
              {(Array.isArray(questions) ? questions : []).map((q: any, i: number) => (
                <div key={q.id ?? i} className="border-l-2 border-primary/30 pl-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">
                      {q.type ?? '?'}
                    </span>
                    <span className="text-xs text-on-surface-variant">peso: {q.weight ?? 1}</span>
                  </div>
                  <p className="text-sm text-on-surface">{q.text ?? '(nessun testo)'}</p>
                  {q.options && (
                    <ul className="mt-1 space-y-0.5">
                      {q.options.map((opt: any, j: number) => (
                        <li key={j} className="text-xs text-on-surface-variant pl-2">
                          {j + 1}. {typeof opt === 'string' ? opt : opt.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </TeacherLayout>

    {showImagePicker && (
      <ImagePicker
        snapshotId={snapshotId}
        onClose={() => setShowImagePicker(false)}
        onSelect={(path) => {
          setShowImagePicker(false);
          const ta = textareaRef.current;
          if (!ta) return;
          const start = ta.selectionStart ?? jsonc.length;
          const end = ta.selectionEnd ?? jsonc.length;
          const inserted = jsonc.slice(0, start) + path + jsonc.slice(end);
          setJsonc(inserted);
          setDirty(true);
          setTimeout(() => {
            ta.focus();
            ta.setSelectionRange(start + path.length, start + path.length);
          }, 0);
        }}
      />
    )}
    </>
  );
}

export default SnapshotEditorPage;
