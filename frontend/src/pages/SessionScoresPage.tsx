import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Archive, Mail, Download } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import SubmissionDetailView from '../components/SubmissionDetailView';
import ScoreRow from '../components/scores/ScoreRow';
import ScoreStatsPanel from '../components/scores/ScoreStatsPanel';
import ScoreHistoryPanel from '../components/scores/ScoreHistoryPanel';
import EmailResultsDialog from '../components/scores/EmailResultsDialog';
import QuestionBreakdownView from '../components/scores/QuestionBreakdownView';
import { buildQuestionSummary } from '../lib/questionSummary';
import {
  getSessionScores, recalculateScores, archiveSessionScores, sendAllResultEmails,
  getSession, type ScoreEntry, type ScoreOverride, type ResultEmailOptions, reviewScores,
  regradeOpenScores, getLlmInfo, getLatestSessionLlmJob,
  getScoreHistory, revertChangeSet,
} from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';
import { computeStats } from '../lib/scoreStats';

function SessionScoresPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = Number(sessionId);
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();
  const [reviewScore, setReviewScore] = useState<ScoreEntry | null>(null);
  const [viewBy, setViewBy] = useState<'student' | 'question'>('student');
  const [savingStudent, setSavingStudent] = useState<string | null>(null);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);

  // ── server state ────────────────────────────────────────────────────────────

  const { data: scores, isLoading } = useQuery({
    queryKey: ['session-scores', id],
    queryFn: () => getSessionScores(id),
    enabled: !!id,
  });

  const { data: session } = useQuery({
    queryKey: ['session', id],
    queryFn: () => getSession(id),
    enabled: !!id,
  });

  const { data: llmInfo } = useQuery({
    queryKey: ['llm-info'],
    queryFn: getLlmInfo,
  });
  const llmEnabled = llmInfo?.enabled ?? llmInfo?.use_llm ?? false;

  const { data: latestLlmJob } = useQuery({
    queryKey: ['llm-job-latest', id],
    queryFn: () => getLatestSessionLlmJob(id),
    enabled: !!id,
    refetchInterval: query => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'running' ? 2000 : false;
    },
  });
  const llmJobRunning = latestLlmJob?.status === 'pending' || latestLlmJob?.status === 'running';

  const { data: scoreHistory } = useQuery({
    queryKey: ['score-history', id],
    queryFn: () => getScoreHistory(id),
    enabled: !!id,
  });

  const recalcMutation = useMutation({
    mutationFn: () => recalculateScores(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session-scores', id] }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveSessionScores(id),
    onSuccess: () => navigate('/teacher/archives'),
  });

  const emailMutation = useMutation({
    mutationFn: (options: ResultEmailOptions) => sendAllResultEmails(id, options),
    onSuccess: () => setEmailDialogOpen(false),
  });

  const regradeMutation = useMutation({
    mutationFn: () => regradeOpenScores(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['llm-job-latest', id] });
      queryClient.invalidateQueries({ queryKey: ['session-scores', id] });
    },
  });

  const revertMutation = useMutation({
    mutationFn: (changeSetId: string) => revertChangeSet(id, changeSetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-scores', id] });
      queryClient.invalidateQueries({ queryKey: ['score-history', id] });
    },
  });

  const saveOverrideMutation = useMutation({
    mutationFn: (overrides: ScoreOverride[]) => reviewScores(id, overrides),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-scores', id] });
      setSavingStudent(null);
    },
    onError: () => setSavingStudent(null),
  });

  useEffect(() => {
    if (latestLlmJob?.status === 'completed' || latestLlmJob?.status === 'failed') {
      queryClient.invalidateQueries({ queryKey: ['session-scores', id] });
    }
  }, [id, latestLlmJob?.status, queryClient]);

  // ── derived data ────────────────────────────────────────────────────────────

  const stats = useMemo(() => {
    if (!scores?.length) return null;
    return computeStats(scores.map(s => s.percent));
  }, [scores]);

  const questionSummary = useMemo(() => {
    if (!scores?.length) return [];
    return buildQuestionSummary(scores);
  }, [scores]);

  // ── actions ─────────────────────────────────────────────────────────────────

  const handleExportCSV = () => {
    if (!scores?.length) return;
    const escapeCSV = (field: string | number) => {
      const s = String(field);
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const maxScore = scores[0].max_points;
    const header = ['Timestamp', 'Studente', `Punteggio (max: ${maxScore})`, 'Percentuale'];
    const rows = scores.map(e => [
      escapeCSV(e.submitted_at ?? e.timestamp ?? ''),
      escapeCSV(e.student_email ?? e.student ?? ''),
      escapeCSV(e.raw_points),
      escapeCSV(e.percent),
    ]);
    const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session?.title ?? 'session'}_punteggi.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleSaveOverride = (studentKey: string, questionId: string, points: number) => {
    const scoreEntry = scores?.find(s =>
      (s.student_email ?? s.student ?? s.student_display_name) === studentKey
    );
    setSavingStudent(studentKey);
    saveOverrideMutation.mutate([{
      score_id: scoreEntry?.id ?? 0,
      per_question: { [questionId]: points },
    }]);
  };

  // ── render ──────────────────────────────────────────────────────────────────
  return (
    <>
    <TeacherLayout
      pageTitle={session?.title ?? 'Punteggi'}
      headerActions={
        <div className="flex gap-2">
          <button
            onClick={handleExportCSV}
            disabled={!scores?.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high disabled:opacity-40 transition-colors"
          >
            <Download size={14} />
            Export CSV
          </button>
          <button
            onClick={() => recalcMutation.mutate()}
            disabled={recalcMutation.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={14} />
            Ricalcola
          </button>
          <button
            onClick={() => setEmailDialogOpen(true)}
            disabled={emailMutation.isPending || !scores?.length}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high disabled:opacity-40 transition-colors"
          >
            <Mail size={14} />
            Invia Email
          </button>
          <button
            onClick={() => askConfirm('Archiviare i punteggi di questa sessione?', () => archiveMutation.mutate())}
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

        {stats && <ScoreStatsPanel stats={stats} />}

        {/* Action bar: view toggle + LLM info */}
        <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            {(llmInfo || regradeMutation.isPending) && (
              <>
                <span className="text-sm text-on-surface-variant">LLM regrade:</span>
                <span className="bg-secondary/10 border border-secondary/30 text-secondary text-xs px-2 py-0.5 rounded">
                  {llmInfo?.model ?? '...'}
                </span>
                <span className="text-xs text-on-surface-variant">
                  ({llmEnabled ? 'abilitato' : 'disabilitato'})
                </span>
              </>
            )}
            <button
              onClick={() => regradeMutation.mutate()}
              disabled={regradeMutation.isPending || llmJobRunning}
              className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
                regradeMutation.isPending || llmJobRunning
                  ? 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
                  : 'bg-surface-container-high border border-secondary/30 text-secondary hover:bg-secondary/10'
              }`}
            >
              {regradeMutation.isPending || llmJobRunning ? 'Rivalutazione...' : 'Rivaluta risposte aperte'}
            </button>
          </div>
          <div className="flex gap-1 bg-surface-container-low border border-outline-variant/20 rounded-lg p-1 self-start">
            <button
              onClick={() => setViewBy('student')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                viewBy === 'student' ? 'bg-surface-container-high text-primary' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Per studente
            </button>
            <button
              onClick={() => setViewBy('question')}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                viewBy === 'question' ? 'bg-surface-container-high text-primary' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              Per domanda
            </button>
          </div>
        </div>
      </div>

      {recalcMutation.isSuccess && (
        <div className="mb-4 p-3 bg-primary/10 border border-primary/30 text-primary rounded-lg text-sm">
          Ricalcolo completato. Aggiornati: {(recalcMutation.data as any)?.updated ?? 0} punteggi.
        </div>
      )}

      {regradeMutation.isSuccess && (
        <div className="mb-4 p-3 bg-secondary/10 border border-secondary/30 text-secondary rounded-lg text-sm">
          Rivalutazione messa in coda. Risposte aperte: {regradeMutation.data?.total_items ?? 0}.
        </div>
      )}

      {latestLlmJob && (
        <div className={`mb-4 p-3 rounded-lg text-sm border ${
          latestLlmJob.status === 'failed'
            ? 'bg-error/10 border-error/30 text-error'
            : latestLlmJob.status === 'completed'
              ? 'bg-tertiary/10 border-tertiary/30 text-tertiary'
              : 'bg-secondary/10 border-secondary/30 text-secondary'
        }`}>
          {latestLlmJob.status === 'pending' && 'Rivalutazione in coda.'}
          {latestLlmJob.status === 'running' && `Rivalutazione in corso: ${latestLlmJob.processed_items}/${latestLlmJob.total_items}.`}
          {latestLlmJob.status === 'completed' && `Rivalutazione completata: ${latestLlmJob.processed_items}/${latestLlmJob.total_items}.`}
          {latestLlmJob.status === 'failed' && `Rivalutazione non riuscita: ${latestLlmJob.error ?? 'errore sconosciuto'}`}
        </div>
      )}

      {regradeMutation.isError && (
        <div className="mb-4 p-3 bg-error/10 border border-error/30 text-error rounded-lg text-sm">
          Rivalutazione non riuscita: {String((regradeMutation.error as Error).message)}
        </div>
      )}

      <ScoreHistoryPanel
        history={scoreHistory ?? []}
        onRevert={changeSetId => revertMutation.mutate(changeSetId)}
        reverting={revertMutation.isPending}
        revertSuccess={revertMutation.isSuccess}
        revertError={revertMutation.isError ? String((revertMutation.error as Error).message) : null}
      />

      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}

      {viewBy === 'student' ? (
        <div className="space-y-2">
          {scores?.sort((a, b) => b.percent - a.percent).map((score, i) => (
            <ScoreRow key={score.id ?? i} score={score} onClick={() => setReviewScore(score)} />
          ))}
          {!isLoading && !scores?.length && (
            <p className="text-center py-12 text-on-surface-variant">Nessun punteggio ancora registrato.</p>
          )}
        </div>
      ) : (
        <>
          <QuestionBreakdownView
            questionSummary={questionSummary}
            savingStudent={savingStudent}
            onSaveOverride={handleSaveOverride}
          />
          {!isLoading && questionSummary.length === 0 && scores?.length === 0 && (
            <p className="text-center py-12 text-on-surface-variant">Nessun punteggio ancora registrato.</p>
          )}
        </>
      )}
      {confirmModal}
    </TeacherLayout>

    {emailDialogOpen && (
      <EmailResultsDialog
        defaultSubject={session?.title ? `${session.title} - risultati` : 'Risultati del quiz'}
        recipientCount={scores?.length ?? 0}
        sending={emailMutation.isPending}
        error={emailMutation.isError ? String((emailMutation.error as Error).message) : null}
        sendErrors={emailMutation.data?.errors ?? []}
        onSend={options => emailMutation.mutate(options)}
        onClose={() => setEmailDialogOpen(false)}
      />
    )}

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
