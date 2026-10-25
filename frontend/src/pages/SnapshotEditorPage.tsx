import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ChevronDown, ChevronRight, Download, Image, Save } from 'lucide-react';

import TeacherLayout from '../layouts/TeacherLayout';
import ImagePicker from '../components/ImagePicker';
import QuestionDisplay from '../components/QuestionDisplay';
import {
  createSnapshot, downloadExport, getSnapshot, getSnapshotExportUrl, updateSnapshot,
  type Question,
} from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';
import {
  NEW_QUIZ_TEMPLATE, checkQuizJsonc, correctIndices, setAllWeights,
} from '../lib/quizJsonc';

const JsonSafeField = lazy(() => import('../components/JsonSafeField'));

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const SAVE_KEYS = IS_MAC ? '⌘S' : 'Ctrl+S';
const TYPE_LABEL: Record<string, string> = {
  single: 'risposta singola', multiple: 'risposta multipla', open: 'risposta aperta',
};

type Status =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: Date }
  | { kind: 'error'; text: string };

/**
 * Quiz editor: JSONC text with a live preview beside it.
 *
 * The text is checked as strictly as the server parses it (lib/quizJsonc), so
 * what the editor accepts is what saving accepts. Saving — button or Ctrl/⌘+S —
 * never rewrites the text, so the cursor stays put and comments survive while
 * editing; the server keeps only the content, so comments are gone on reopen.
 *
 * "/teacher/snapshots/new" opens the commented template; the quiz is created on
 * the first save and the address switches to it without reloading the text.
 */
function SnapshotEditorPage() {
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const snapshotId = isNew ? null : Number(id);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { ask, modal: confirmModal } = useConfirmModal();

  const [jsonc, setJsonc] = useState('');
  const [title, setTitle] = useState('');
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [showTools, setShowTools] = useState(false);
  const [weight, setWeight] = useState('1');
  const [showImagePicker, setShowImagePicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Which quiz the text belongs to: the text is loaded once per quiz and never
  // replaced by a refetch, or saving would move the cursor and drop comments.
  const loadedFor = useRef<number | 'new' | null>(null);
  // Edits counted so a save that finishes while typing does not mark clean.
  const edits = useRef(0);
  const dirtyRef = useRef(false);
  const markDirty = useCallback((value: boolean) => { dirtyRef.current = value; setDirty(value); }, []);
  // Set just before the address changes from /new to the created quiz: that
  // navigation must never be blocked, even with edits typed during the save.
  const ownNavigation = useRef(false);

  const { data: snapshot, isLoading } = useQuery({
    queryKey: ['snapshot', snapshotId],
    queryFn: () => getSnapshot(snapshotId as number),
    enabled: snapshotId !== null,
  });

  useEffect(() => {
    if (isNew && loadedFor.current === null) {
      loadedFor.current = 'new';
      setTitle('Nuovo quiz');
      setJsonc(NEW_QUIZ_TEMPLATE);
      markDirty(false);
    } else if (snapshot && loadedFor.current !== snapshot.id) {
      loadedFor.current = snapshot.id;
      setTitle(snapshot.title);
      setJsonc(JSON.stringify(snapshot.content, null, 2));
      markDirty(false);
    }
  }, [isNew, snapshot, markDirty]);

  const check = useMemo(() => checkQuizJsonc(jsonc), [jsonc]);
  // Keep the last valid preview on screen while the text is momentarily broken.
  const [lastValid, setLastValid] = useState<Array<Record<string, any>>>([]);
  useEffect(() => { if (check.questions) setLastValid(check.questions); }, [check]);
  const previewQuestions = check.questions ?? lastValid;

  const saveMutation = useMutation({
    mutationFn: async ({ text, name }: { text: string; name: string }) =>
      snapshotId === null
        ? createSnapshot(name || 'Nuovo quiz', text)
        : updateSnapshot(snapshotId, { title: name || undefined, jsonc: text }),
  });

  const save = useCallback(() => {
    if (saveMutation.isPending) return;
    if (check.errors.length) {
      const first = check.errors[0];
      setStatus({
        kind: 'error',
        text: `Non salvato: ${check.errors.length === 1 ? 'un errore' : `${check.errors.length} errori`}`
          + ` (riga ${first.line}, colonna ${first.column}: ${first.message})`,
      });
      return;
    }
    const savedAt = edits.current;
    setStatus({ kind: 'saving' });
    saveMutation.mutate({ text: jsonc, name: title.trim() }, {
      onSuccess: (meta) => {
        if (edits.current === savedAt) markDirty(false);
        setStatus({ kind: 'saved', at: new Date() });
        queryClient.invalidateQueries({ queryKey: ['snapshots'] });
        if (snapshotId === null) {
          // Same page component: the text stays as typed, only the address changes.
          loadedFor.current = meta.id;
          ownNavigation.current = true;
          Promise.resolve(navigate(`/teacher/snapshots/${meta.id}`, { replace: true }))
            .finally(() => { ownNavigation.current = false; });
        } else {
          queryClient.invalidateQueries({ queryKey: ['snapshot', snapshotId] });
        }
      },
      onError: (err: unknown) => {
        setStatus({ kind: 'error', text: `Non salvato: ${err instanceof Error ? err.message : 'errore del server'}` });
      },
    });
  }, [check, jsonc, title, snapshotId, saveMutation, navigate, queryClient, markDirty]);

  // Ctrl/⌘+S saves without leaving the text: no focus change, no cursor move.
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; }, [save]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Unsaved changes: warn on leaving the page, inside the app or out of it.
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    !ownNavigation.current && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state === 'blocked') {
      ask('Ci sono modifiche non salvate: uscendo andranno perse.',
        () => blocker.proceed(),
        { onCancel: () => blocker.reset(), confirmLabel: 'Esci senza salvare' });
    }
  }, [blocker, ask]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyRef.current) e.preventDefault(); };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const edit = (text: string) => {
    edits.current += 1;
    setJsonc(text);
    markDirty(true);
    if (status.kind !== 'saving') setStatus({ kind: 'idle' });
  };

  const goTo = (offset: number) => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.setSelectionRange(offset, offset);
  };

  const applyWeights = () => {
    const w = Number(weight);
    if (!Number.isFinite(w) || w <= 0) return;
    const out = setAllWeights(jsonc, w);
    if (out !== jsonc) edit(out);
  };

  // Not after creating a quiz: the text is already here, and swapping the
  // editor for a spinner while the new address loads would drop the cursor.
  if (!isNew && isLoading && loadedFor.current === null) {
    return (
      <TeacherLayout pageTitle="Modifica quiz">
        <p className="text-on-surface-variant">Caricamento...</p>
      </TeacherLayout>
    );
  }

  const button = 'flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors';

  return (
    <>
      {confirmModal}
      <TeacherLayout
        pageTitle={title || 'Modifica quiz'}
        headerActions={
          <div className="flex items-center gap-2">
            {snapshotId !== null && (
              <>
                <button onClick={() => downloadExport(getSnapshotExportUrl(snapshotId), `${snapshot?.slug || snapshotId}.jsonc`)} className={button}>
                  <Download size={14} /> Esporta
                </button>
                <button onClick={() => setShowImagePicker(true)} className={button}>
                  <Image size={14} /> Inserisci immagine
                </button>
                <button onClick={() => navigate(`/teacher/snapshots/${snapshotId}/images`)} className={button}>
                  <Image size={14} /> Gestisci immagini
                </button>
              </>
            )}
            <button
              onClick={save}
              disabled={saveMutation.isPending}
              title={`Salva (${SAVE_KEYS})`}
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
            >
              <Save size={14} />
              {saveMutation.isPending ? 'Salvataggio...' : isNew ? 'Crea quiz' : 'Salva'}
              <span className="text-xs opacity-70">{SAVE_KEYS}</span>
            </button>
          </div>
        }
      >
        <button
          onClick={() => navigate('/teacher/snapshots')}
          className="mb-4 flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={14} /> Banca domande
        </button>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* ── editor ─────────────────────────────────────────────────── */}
          <div className="space-y-3 min-w-0">
            <label className="block">
              <span className="block text-sm font-medium text-on-surface-variant mb-1.5">Titolo</span>
              <input
                type="text"
                value={title}
                onChange={(e) => { edits.current += 1; setTitle(e.target.value); markDirty(true); }}
                className="block w-full px-3 py-2 bg-surface-container border border-outline-variant/50 rounded-lg text-on-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </label>

            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-on-surface-variant">
                Contenuto JSONC
                {check.questions && (
                  <span className="ml-2 text-xs font-normal text-on-surface-variant/60">
                    {check.questions.length} domande
                  </span>
                )}
              </span>
              <StatusLine status={status} dirty={dirty} />
            </div>

            <textarea
              ref={textareaRef}
              value={jsonc}
              onChange={(e) => edit(e.target.value)}
              spellCheck={false}
              aria-label="Contenuto JSONC del quiz"
              className={`block w-full h-[65vh] px-4 py-3 bg-surface-container border rounded-lg text-on-surface font-mono text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-primary/40 resize-y ${
                check.errors.length ? 'border-error/60' : 'border-outline-variant/50'
              }`}
            />

            {check.errors.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-error/30 bg-error/5 p-3 text-sm">
                {check.errors.map((err, i) => (
                  <li key={i}>
                    <button onClick={() => goTo(err.offset)} className="text-left text-error hover:underline">
                      Riga {err.line}, colonna {err.column}: {err.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="rounded-lg border border-outline-variant/30">
              <button
                onClick={() => setShowTools(v => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface"
              >
                {showTools ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                Strumenti
              </button>
              {showTools && (
                <div className="space-y-4 border-t border-outline-variant/30 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <label htmlFor="all-weights" className="text-on-surface-variant">Imposta il peso di tutte le domande a</label>
                    <input
                      id="all-weights" type="number" min="1" step="1" value={weight}
                      onChange={(e) => setWeight(e.target.value)}
                      className="w-20 rounded-lg border border-outline-variant/40 bg-surface-container px-2 py-1 text-on-surface"
                    />
                    <button
                      onClick={applyWeights}
                      disabled={!check.questions}
                      className="rounded-lg border border-secondary/40 px-3 py-1 text-secondary hover:bg-secondary/10 disabled:opacity-40"
                    >
                      Applica
                    </button>
                    {!check.questions && <span className="text-xs text-on-surface-variant">(prima correggi gli errori)</span>}
                  </div>
                  <Suspense fallback={<p className="text-sm text-on-surface-variant">Caricamento...</p>}>
                    <JsonSafeField />
                  </Suspense>
                </div>
              )}
            </div>
          </div>

          {/* ── anteprima ─────────────────────────────────────────────── */}
          <div className="min-w-0 lg:sticky lg:top-4 lg:max-h-[85vh] lg:overflow-y-auto rounded-xl border border-outline-variant/30 bg-surface-container p-4">
            <h3 className="mb-1 font-semibold text-on-surface">
              Anteprima — {previewQuestions.length} domande
            </h3>
            <p className="mb-4 text-xs text-on-surface-variant">
              Come la vedranno gli studenti; le risposte corrette sono evidenziate.
              {!check.questions && previewQuestions.length > 0 && ' Testo con errori: anteprima dell’ultima versione valida.'}
            </p>
            <div className="space-y-6">
              {previewQuestions.map((q, i) => (
                <div key={`${q.id}-${i}`} className="border-l-2 border-primary/30 pl-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-semibold text-on-surface">{i + 1}.</span>
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{TYPE_LABEL[q.type] ?? q.type}</span>
                    <span className="text-on-surface-variant">peso {q.weight ?? 1}</span>
                    <span className="text-on-surface-variant/60">id {String(q.id)}</span>
                  </div>
                  <QuestionDisplay
                    question={{ ...q, id: String(q.id), weight: q.weight ?? 1, options: q.options ?? [] } as Question}
                    currentAnswer={null}
                    onAnswerChange={() => {}}
                    readOnly
                    highlightIndices={correctIndices(q)}
                  />
                  {q.type === 'open' && (
                    <div className="mt-2 rounded-lg border border-tertiary/30 bg-tertiary/5 p-2 text-xs">
                      <span className="font-medium text-tertiary">Risposta accettabile: </span>
                      <span className="text-on-surface whitespace-pre-wrap">
                        {q.acceptable ? String(q.acceptable) : '— nessuna: la valutazione automatica non avrà un riferimento'}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </TeacherLayout>

      {showImagePicker && snapshotId !== null && (
        <ImagePicker
          snapshotId={snapshotId}
          onClose={() => setShowImagePicker(false)}
          onSelect={(path) => {
            setShowImagePicker(false);
            const ta = textareaRef.current;
            if (!ta) return;
            const start = ta.selectionStart ?? jsonc.length;
            const end = ta.selectionEnd ?? jsonc.length;
            edit(jsonc.slice(0, start) + path + jsonc.slice(end));
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

function StatusLine({ status, dirty }: { status: Status; dirty: boolean }) {
  if (status.kind === 'saving') return <span className="text-xs text-on-surface-variant">Salvataggio...</span>;
  if (status.kind === 'error') return <span className="text-xs text-error" role="alert">{status.text}</span>;
  if (dirty) return <span className="text-xs text-secondary">Modifiche non salvate</span>;
  if (status.kind === 'saved') {
    return (
      <span className="text-xs text-tertiary">
        Salvato alle {status.at.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
    );
  }
  return null;
}

export default SnapshotEditorPage;
