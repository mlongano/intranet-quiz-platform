import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Archive, Mail, Download } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import SubmissionDetailView from '../components/SubmissionDetailView';
import ScoreRow from '../components/scores/ScoreRow';
import ScoreStatsPanel from '../components/scores/ScoreStatsPanel';
import ScoreHistoryPanel from '../components/scores/ScoreHistoryPanel';
import RegradePanel from '../components/scores/RegradePanel';
import QuestionBreakdownView from '../components/scores/QuestionBreakdownView';
import { buildQuestionSummary } from '../lib/questionSummary';
import {
  getSessionScores, recalculateScores, archiveSessionScores, emailResultsLink,
  getSession, publishResults, unpublishResults, type SessionMeta, type ScoreEntry, type ScoreOverride, reviewScores,
  getLlmInfo, getLatestSessionLlmJob,
  getScoreHistory, getSessionEvents, revertChangeSet, type LlmJobStatus,
} from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';
import { computeStats } from '../lib/scoreStats';

/**
 * Outcome of the latest grading job. Counts are answers (total_items and
 * processed_items share that unit), and a job that left answers ungraded is
 * a warning, not a success: those answers stay pending until retried.
 */
function LlmJobBanner({ job }: { job: LlmJobStatus }) {
  const what = job.job_type === 'submission' ? 'Valutazione' : 'Rivalutazione';
  const missed = Math.max(0, job.total_items - job.processed_items);
  // "N risposte non valutate: q=11: <reason>; ..." → the reasons, for the teacher.
  const reasons = job.error?.replace(/^\d+ risposte non valutate:\s*/, '');
  let tone = 'bg-secondary/10 border-secondary/30 text-secondary';
  let text: React.ReactNode;
  if (job.status === 'pending') text = `${what} in coda.`;
  else if (job.status === 'running') text = `${what} in corso: ${job.processed_items} risposte valutate su ${job.total_items}.`;
  else if (job.status === 'failed') {
    tone = 'bg-error/10 border-error/30 text-error';
    text = `${what} non riuscita: ${job.error ?? 'errore sconosciuto'}`;
  } else if (job.status === 'completed' && (job.error || missed > 0) && job.total_items > 0) {
    tone = 'bg-error/10 border-error/30 text-error';
    text = (
      <>
        {what} terminata con problemi: {job.processed_items} risposte valutate su {job.total_items}
        {missed > 0 && <>, {missed} non {missed === 1 ? 'valutata' : 'valutate'}</>}.
        {reasons && <span className="block mt-1 text-xs opacity-90">Motivo: {reasons}</span>}
        <span className="block mt-1 text-xs opacity-90">
          Le risposte non valutate restano «in attesa»: puoi riprovare con «Rivaluta risposte aperte».
        </span>
      </>
    );
  } else if (job.status === 'completed') {
    tone = 'bg-tertiary/10 border-tertiary/30 text-tertiary';
    text = job.total_items > 0
      ? `${what} completata: ${job.processed_items} ${job.processed_items === 1 ? 'risposta valutata' : 'risposte valutate'}.`
      : 'Nessuna risposta da rivalutare.';
  } else {
    text = `${what} annullata.`;
  }
  return <div className={`mb-4 p-3 rounded-lg text-sm border ${tone}`} role="status">{text}</div>;
}

/**
 * Results to the students: published only for a closed session, after the
 * teacher has reviewed points and motivations; can be withdrawn.
 */
function PublishPanel({ session, pendingAnswers }: { session: SessionMeta; pendingAnswers: number }) {
  const queryClient = useQueryClient();
  const [showCorrect, setShowCorrect] = useState(false);
  const [showAcceptable, setShowAcceptable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const published = !!session.results_published_at;
  const done = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ['session', session.id] });
    queryClient.invalidateQueries({ queryKey: ['session-events', session.id] });
  };
  const publish = useMutation({ mutationFn: () => publishResults(session.id, showCorrect, showAcceptable), onSuccess: done, onError: (e: Error) => setError(e.message) });
  const withdraw = useMutation({ mutationFn: () => unpublishResults(session.id), onSuccess: done, onError: (e: Error) => setError(e.message) });
  const busy = publish.isPending || withdraw.isPending;

  return (
    <section className={`mb-4 rounded-xl border p-4 ${published ? 'border-tertiary/30 bg-tertiary/5' : 'border-outline-variant/25 bg-surface-container'}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-on-surface">Risultati agli studenti</h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {published
              ? <>Pubblicati il {new Date(session.results_published_at!).toLocaleString('it-IT')}
                  {session.results_show_correct ? ', con le risposte corrette delle domande chiuse' : ', senza le risposte corrette'}
                  {session.results_show_acceptable ? ' e con la risposta accettabile delle aperte' : ''}.
                  {' '}Gli studenti li vedono nella pagina <span className="font-mono">/risultati</span>; le tue modifiche successive si vedono subito.
                  {session.results_emailed_at
                    ? ` Link inviato via email il ${new Date(session.results_emailed_at).toLocaleString('it-IT')} a ${session.results_emailed_count} studenti.`
                    : ' Con «Invia email» mandi a ciascuno il link.'}</>
              : session.status === 'closed'
                ? 'Non ancora pubblicati: gli studenti vedono solo di aver consegnato. Rivedi punteggi e motivazioni, poi pubblica. Per le domande aperte lo studente vede domanda, risposta, punti e motivazione.'
                : 'Si possono pubblicare dopo aver chiuso la sessione.'}
          </p>
          {!published && session.status === 'closed' && pendingAnswers > 0 && (
            <p className="text-xs text-secondary mt-1">
              {pendingAnswers} {pendingAnswers === 1 ? 'risposta aperta è' : 'risposte aperte sono'} ancora in valutazione: gli studenti le vedrebbero «in valutazione».
            </p>
          )}
          {error && <p className="text-xs text-error mt-1">{error}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {published ? (
            <button onClick={() => withdraw.mutate()} disabled={busy}
              className="px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high disabled:opacity-40">
              Ritira
            </button>
          ) : session.status === 'closed' && (
            <>
              <label className="flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer">
                <input type="checkbox" checked={showCorrect} onChange={e => setShowCorrect(e.target.checked)} />
                mostra le risposte corrette delle domande chiuse
              </label>
              <label className="flex items-center gap-2 text-xs text-on-surface-variant cursor-pointer"
                title="Il testo della risposta accettabile com'è scritto nel quiz: togli eventuali note per la correzione prima di mostrarlo.">
                <input type="checkbox" checked={showAcceptable} onChange={e => setShowAcceptable(e.target.checked)} />
                mostra la risposta accettabile delle aperte
              </label>
              <button onClick={() => publish.mutate()} disabled={busy}
                className="px-3 py-1.5 text-sm bg-secondary text-on-secondary font-medium rounded-lg hover:bg-secondary/90 disabled:opacity-40">
                Pubblica i risultati
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function SessionScoresPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = Number(sessionId);
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();
  const [reviewScore, setReviewScore] = useState<ScoreEntry | null>(null);
  const [viewBy, setViewBy] = useState<'student' | 'question'>('student');
  const [savingStudent, setSavingStudent] = useState<string | null>(null);
  const [queuedJob, setQueuedJob] = useState<LlmJobStatus | null>(null);

  // ── server state ────────────────────────────────────────────────────────────

  const { data: scores, isLoading } = useQuery({
    queryKey: ['session-scores', id],
    queryFn: () => getSessionScores(id),
    enabled: !!id,
  });

  const pendingAnswers = (scores ?? []).reduce((n, entry) =>
    n + (entry.answers ?? []).filter(a => a.type === 'open' && a.llm_status === 'pending').length, 0);
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
  const { data: sessionEvents } = useQuery({
    queryKey: ['session-events', id],
    queryFn: () => getSessionEvents(id),
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
    mutationFn: () => emailResultsLink(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session', id] });
      queryClient.invalidateQueries({ queryKey: ['session-events', id] });
    },
  });
  const published = !!session?.results_published_at;

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

  const handleSaveOverride = (
    studentKey: string, questionId: string, change: { points?: number; feedback?: string },
  ) => {
    const scoreEntry = scores?.find(s =>
      (s.student_email ?? s.student ?? s.student_display_name) === studentKey
    );
    setSavingStudent(studentKey);
    saveOverrideMutation.mutate([{
      score_id: scoreEntry?.id ?? 0,
      ...(change.points !== undefined && { per_question: { [questionId]: change.points } }),
      ...(change.feedback !== undefined && { feedback: { [questionId]: change.feedback } }),
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
            onClick={() => askConfirm(
              `Mandare a ${scores?.length ?? 0} studenti, dal tuo indirizzo Gmail, il link ai loro risultati? L'email contiene solo il titolo e il link: punti e risposte si vedono sulla pagina, dopo l'accesso con l'account della scuola.`,
              () => emailMutation.mutate(), { confirmLabel: 'Invia' })}
            disabled={emailMutation.isPending || !scores?.length || !published}
            title={published ? 'Manda a ogni studente il link ai suoi risultati' : 'Pubblica prima i risultati'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high disabled:opacity-40 transition-colors"
          >
            <Mail size={14} />
            {emailMutation.isPending ? 'Invio...' : 'Invia email'}
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

        {session && <PublishPanel session={session} pendingAnswers={pendingAnswers} />}

        {emailMutation.isError && (
          <p className="mb-4 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">{(emailMutation.error as Error).message}</p>
        )}
        {emailMutation.data && (
          <div className="mb-4 rounded-lg border border-tertiary/30 bg-tertiary/10 p-3 text-sm text-tertiary">
            Link inviato a {emailMutation.data.sent} {emailMutation.data.sent === 1 ? 'studente' : 'studenti'}.
            {emailMutation.data.errors.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-error">
                {emailMutation.data.errors.map(e => <li key={e.email}>{e.email}: {e.error}</li>)}
              </ul>
            )}
          </div>
        )}

        {session?.data_kept_until && (
          <p className="mb-4 text-xs text-on-surface-variant">
            Conservazione dei dati: risposte e punteggi degli studenti di questa sessione restano fino al{' '}
            {new Date(`${session.data_kept_until}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })},
            poi vengono cancellati. Se ti serve una copia, esporta il CSV.
          </p>
        )}

        {/* Action bar: view toggle + LLM info */}
        <div className="flex flex-col gap-3 mb-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            {llmInfo && (
              <>
                <span className="text-sm text-on-surface-variant">LLM regrade:</span>
                <span className="bg-secondary/10 border border-secondary/30 text-secondary text-xs px-2 py-0.5 rounded">
                  {llmInfo?.model ?? '...'}
                  {llmInfo?.endpoint ? ` (${llmInfo.endpoint})` : ''}
                </span>
                {llmInfo.endpoint && !llmInfo.key_configured ? (
                  // Grading uses only the teacher's own key: say why it is off
                  // and where to fix it, rather than a bare "disabled".
                  <button
                    onClick={() => navigate('/teacher/llm-settings')}
                    className="text-xs text-error underline hover:opacity-80"
                  >
                    manca la tua chiave: impostala
                  </button>
                ) : (
                  <span className="text-xs text-on-surface-variant">
                    ({llmEnabled ? 'abilitato' : 'disabilitato'})
                  </span>
                )}
              </>
            )}
            <RegradePanel
              sessionId={id}
              disabled={llmJobRunning}
              onQueued={(job) => setQueuedJob(job)}
            />
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

      {queuedJob && (
        <div className="mb-4 p-3 bg-secondary/10 border border-secondary/30 text-secondary rounded-lg text-sm">
          Rivalutazione messa in coda. Risposte da valutare: {queuedJob.total_items}.
        </div>
      )}

      {latestLlmJob && <LlmJobBanner job={latestLlmJob} />}

      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}

      {viewBy === 'student' ? (
        <div className="space-y-2">
          {!!scores?.length && (
            <p className="text-xs text-on-surface-variant">
              Apri uno studente per rivedere punti e motivazioni domanda per domanda; «Per domanda» mostra una domanda per tutti gli studenti.
            </p>
          )}
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

      <ScoreHistoryPanel
        history={scoreHistory ?? []}
        events={sessionEvents ?? []}
        onRevert={changeSetId => revertMutation.mutate(changeSetId)}
        reverting={revertMutation.isPending}
        revertSuccess={revertMutation.isSuccess}
        revertError={revertMutation.isError ? String((revertMutation.error as Error).message) : null}
      />
      {confirmModal}
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
