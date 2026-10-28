import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, Trash2 } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import MarkdownContent from '../components/MarkdownContent';
import { deleteHistory, getHistory, listHistory, type HistoryQuestion } from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';

const optionText = (o: string | { text?: string }) => (typeof o === 'string' ? o : o?.text ?? '');

function QuestionStats({ q, index }: { q: HistoryQuestion; index: number }) {
  const total = q.option_counts?.reduce((a, b) => a + b, 0) ?? 0;
  const correct = q.question.correct;
  const isCorrect = (i: number) => (Array.isArray(correct) ? correct.includes(i) : correct === i);
  return (
    <div className="rounded-xl border border-outline-variant/25 bg-surface-container p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-semibold text-on-surface-variant">Domanda {index + 1} · {q.type === 'open' ? 'aperta' : q.type === 'single' ? 'scelta singola' : 'scelta multipla'}</p>
        <p className="text-xs text-on-surface-variant">
          {q.answers} risposte · media {q.average_points ?? '—'}/{q.max_points ?? '—'} · punteggio pieno {q.full_marks}
          {q.teacher_reviewed > 0 && ` · ${q.teacher_reviewed} riviste dal docente`}
        </p>
      </div>
      <MarkdownContent className="mt-1 text-sm text-on-surface" compact>{q.question.text ?? ''}</MarkdownContent>
      {q.option_counts && (
        <ul className="mt-2 space-y-1">
          {(q.question.options ?? []).map((o, i) => {
            const n = q.option_counts![i] ?? 0;
            const pct = total ? Math.round((n / total) * 100) : 0;
            return (
              <li key={i} className="text-xs">
                <div className="flex justify-between gap-2">
                  <span className={isCorrect(i) ? 'font-semibold text-tertiary' : 'text-on-surface'}>{optionText(o)}{isCorrect(i) ? ' ✓' : ''}</span>
                  <span className="text-on-surface-variant">{n} ({pct}%)</span>
                </div>
                <div className="mt-0.5 h-1.5 rounded bg-surface-container-high">
                  <div className={`h-1.5 rounded ${isCorrect(i) ? 'bg-tertiary' : 'bg-on-surface-variant/50'}`} style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HistoryDetailView({ id }: { id: number }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { ask, modal } = useConfirmModal();
  const { data, isLoading } = useQuery({ queryKey: ['history', id], queryFn: () => getHistory(id) });
  const [exporting, setExporting] = useState(false);
  const remove = useMutation({
    mutationFn: () => deleteHistory(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['history'] }); navigate('/teacher/history'); },
  });

  const exportJson = async () => {
    setExporting(true);
    try {
      const full = await getHistory(id, true);
      const blob = new Blob([JSON.stringify(full, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `storico-${full.school_year}-${full.title.replace(/[^\w-]+/g, '_')}.json`;
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } finally { setExporting(false); }
  };

  return (
    <TeacherLayout pageTitle={data?.title ?? 'Storico'}>
      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}
      {data && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <p className="text-sm text-on-surface-variant">
              {data.school_year}{data.grade ? ` · classe ${data.grade}ª` : ''} · {data.submissions} consegne
            </p>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={exportJson} disabled={exporting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 px-3 py-1.5 text-sm text-primary hover:bg-primary/10 disabled:opacity-50">
                <Download size={14} /> {exporting ? 'Esportazione...' : 'Esporta con le risposte (JSON)'}
              </button>
              <button type="button" onClick={() => ask('Eliminare questo storico? Non si può recuperare.', () => remove.mutate(), { confirmLabel: 'Elimina' })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant/40 px-3 py-1.5 text-sm text-on-surface-variant hover:bg-error/10 hover:text-error">
                <Trash2 size={14} /> Elimina
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {data.questions.map((q, i) => <QuestionStats key={q.question_key + i} q={q} index={i} />)}
          </div>
        </>
      )}
      {modal}
    </TeacherLayout>
  );
}

function HistoryPage() {
  const { historyId } = useParams();
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({ queryKey: ['history'], queryFn: listHistory, enabled: !historyId });
  if (historyId) return <HistoryDetailView id={Number(historyId)} />;
  return (
    <TeacherLayout pageTitle="Storico anonimo">
      <p className="mb-4 max-w-3xl text-sm text-on-surface-variant">
        Quando scade la conservazione dei dati di una sessione, prima della cancellazione ne resta qui una copia anonima:
        le domande, come hanno risposto gli studenti e con quali punti e motivazioni, senza nomi, date o classi e
        senza legami tra le risposte della stessa persona. Le sessioni con meno di 5 consegne non vengono copiate.
      </p>
      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}
      <div className="space-y-2">
        {data?.map(h => (
          <button key={h.id} type="button" onClick={() => navigate(`/teacher/history/${h.id}`)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-outline-variant/25 bg-surface-container p-4 text-left hover:bg-surface-container-high">
            <div className="min-w-0">
              <p className="font-semibold text-on-surface truncate">{h.title}</p>
              <p className="text-xs text-on-surface-variant">
                {h.school_year}{h.grade ? ` · classe ${h.grade}ª` : ''} · {h.submissions} consegne · {h.questions} domande
              </p>
            </div>
            <ChevronRight size={16} className="text-on-surface-variant" />
          </button>
        ))}
        {!isLoading && !data?.length && (
          <p className="py-12 text-center text-on-surface-variant">Ancora vuoto: si riempie quando scadono i dati delle prime sessioni.</p>
        )}
      </div>
    </TeacherLayout>
  );
}

export default HistoryPage;
