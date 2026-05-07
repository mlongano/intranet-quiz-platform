import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Archive, Mail, ChevronRight } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import SubmissionDetailView from '../components/SubmissionDetailView';
import {
  getSessionScores, recalculateScores, archiveSessionScores, sendAllResultEmails,
  listSessions, ScoreEntry,
} from '../api';

function ScoreRow({ score, onClick }: { score: ScoreEntry; onClick: () => void }) {
  const pct = score.percent;
  const color = pct >= 60 ? 'text-primary' : pct >= 40 ? 'text-secondary' : 'text-error';
  return (
    <button
      onClick={onClick}
      className="w-full bg-surface-container rounded-lg border border-outline-variant/30 p-4 flex items-center justify-between gap-4 hover:bg-surface-container-high transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium text-on-surface truncate">{score.student_display_name ?? score.student_email ?? score.student ?? '—'}</p>
        <p className="text-xs text-on-surface-variant truncate">{score.student_email ?? score.student}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <p className={`text-lg font-bold ${color}`}>{pct.toFixed(1)}%</p>
          <p className="text-xs text-on-surface-variant">{score.raw_points.toFixed(1)} / {score.max_points.toFixed(1)}</p>
        </div>
        <ChevronRight size={16} className="text-on-surface-variant" />
      </div>
    </button>
  );
}

function SessionScoresPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = Number(sessionId);
  const [reviewScore, setReviewScore] = useState<ScoreEntry | null>(null);

  const { data: scores, isLoading } = useQuery({
    queryKey: ['session-scores', id],
    queryFn: () => getSessionScores(id),
    enabled: !!id,
  });

  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => listSessions() });
  const session = sessions?.find(s => s.id === id);

  const recalcMutation = useMutation({
    mutationFn: () => recalculateScores(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session-scores', id] }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveSessionScores(id),
    onSuccess: () => navigate('/teacher/archives'),
  });

  const emailMutation = useMutation({
    mutationFn: () => sendAllResultEmails(id),
  });

  const avg = scores?.length
    ? scores.reduce((sum, s) => sum + s.percent, 0) / scores.length
    : null;

  return (
    <>
    <TeacherLayout
      pageTitle={session?.title ?? 'Punteggi'}
      headerActions={
        <div className="flex gap-2">
          <button
            onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={14} />
            Ricalcola
          </button>
          <button
            onClick={() => emailMutation.mutate()}
            disabled={emailMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high disabled:opacity-40 transition-colors"
          >
            <Mail size={14} />
            Invia Email
          </button>
          <button
            onClick={() => {
              if (confirm('Archiviare i punteggi di questa sessione?')) archiveMutation.mutate();
            }}
            disabled={archiveMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <Archive size={14} />
            Archivia
          </button>
        </div>
      }
    >
      <div className="mb-6">
        <button
          onClick={() => navigate('/teacher/sessions')}
          className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors mb-4"
        >
          <ArrowLeft size={14} /> Sessioni
        </button>

        {avg !== null && (
          <div className="bg-surface-container rounded-xl border border-outline-variant/30 p-6 inline-flex gap-8 mb-6">
            <div>
              <p className="text-sm text-on-surface-variant">Partecipanti</p>
              <p className="text-3xl font-bold text-on-surface">{scores?.length}</p>
            </div>
            <div>
              <p className="text-sm text-on-surface-variant">Media</p>
              <p className={`text-3xl font-bold ${avg >= 60 ? 'text-primary' : avg >= 40 ? 'text-secondary' : 'text-error'}`}>
                {avg.toFixed(1)}%
              </p>
            </div>
          </div>
        )}
      </div>

      {recalcMutation.isSuccess && (
        <div className="mb-4 p-3 bg-primary/10 border border-primary/30 text-primary rounded-lg text-sm">
          Ricalcolo completato. Aggiornati: {(recalcMutation.data as any)?.updated ?? 0} punteggi.
        </div>
      )}

      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}

      <div className="space-y-2">
        {scores?.sort((a, b) => b.percent - a.percent).map((score, i) => (
          <ScoreRow key={score.id ?? i} score={score} onClick={() => setReviewScore(score)} />
        ))}
        {!isLoading && !scores?.length && (
          <p className="text-center py-12 text-on-surface-variant">Nessun punteggio ancora registrato.</p>
        )}
      </div>
    </TeacherLayout>

    {reviewScore && (
      <SubmissionDetailView
        score={reviewScore}
        sessionId={id}
        onClose={() => setReviewScore(null)}
      />
    )}
    </>
  );
}

export default SessionScoresPage;
