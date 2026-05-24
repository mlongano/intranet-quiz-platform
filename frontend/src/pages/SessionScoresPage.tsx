import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Archive, Mail, ChevronRight, Download } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import SubmissionDetailView from '../components/SubmissionDetailView';
import {
  getSessionScores, recalculateScores, archiveSessionScores, sendAllResultEmails,
  listSessions, type DetailedAnswer, ScoreEntry, ScoreOverride, reviewScores,
  regradeOpenScores, getLlmInfo,
} from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';
import { computeStats, type ScoreStats } from '../lib/scoreStats';

// ── Score row (kept from original) ────────────────────────────────────────────

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

// ── Statistics charts ─────────────────────────────────────────────────────────

function DistributionChart({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const bins = Array.from({ length: 10 }, (_, i) => ({ start: i * 10, end: (i + 1) * 10, count: 0 }));
  values.forEach(value => {
    const idx = Math.min(9, Math.max(0, Math.floor(value / 10)));
    bins[idx].count += 1;
  });
  const maxCount = Math.max(...bins.map(b => b.count), 1);

  return (
    <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-4">
      <div className="text-sm font-semibold text-on-surface mb-3">Distribuzione punteggi</div>
      <div className="flex items-end gap-1 h-28">
        {bins.map(bin => (
          <div key={bin.start} className="flex-1 h-full flex flex-col items-center gap-1">
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t bg-primary/70 border border-primary/30 min-h-1"
                style={{ height: `${(bin.count / maxCount) * 100}%` }}
                title={`${bin.start}-${bin.end}%: ${bin.count}`}
              />
            </div>
            <span className="text-[10px] text-on-surface-variant">{bin.start}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoxPlot({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const q1 = (() => { const p = (sorted.length - 1) * 0.25; const b = Math.floor(p); return sorted[b] + (p - b) * ((sorted[b + 1] ?? sorted[b]) - sorted[b]); })();
  const median = (() => { const p = (sorted.length - 1) * 0.5; const b = Math.floor(p); return sorted[b] + (p - b) * ((sorted[b + 1] ?? sorted[b]) - sorted[b]); })();
  const q3 = (() => { const p = (sorted.length - 1) * 0.75; const b = Math.floor(p); return sorted[b] + (p - b) * ((sorted[b + 1] ?? sorted[b]) - sorted[b]); })();
  const max = sorted[sorted.length - 1];
  const pct = (v: number) => `${Math.max(0, Math.min(100, v))}%`;

  return (
    <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-4">
      <div className="text-sm font-semibold text-on-surface mb-3">Box plot</div>
      <div className="relative h-12">
        <div className="absolute top-1/2 left-0 right-0 h-px bg-outline-variant/60" />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-on-surface-variant" style={{ left: pct(min) }} title={`Min ${min.toFixed(1)}%`} />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-on-surface-variant" style={{ left: pct(max) }} title={`Max ${max.toFixed(1)}%`} />
        <div
          className="absolute top-1/2 h-7 -translate-y-1/2 rounded border border-secondary/50 bg-secondary/10"
          style={{ left: pct(q1), width: pct(q3 - q1) }}
          title={`IQR ${q1.toFixed(1)}%-${q3.toFixed(1)}%`}
        />
        <div className="absolute top-1/2 h-8 w-0.5 -translate-y-1/2 bg-secondary" style={{ left: pct(median) }} title={`Mediana ${median.toFixed(1)}%`} />
      </div>
      <div className="flex justify-between text-[10px] text-on-surface-variant mt-1">
        <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
      </div>
    </div>
  );
}

function StatGrid({ stats }: { stats: ScoreStats }) {
  const items: { label: string; value: string | number; color?: string }[] = [
    { label: 'Studenti', value: stats.totalStudents },
    { label: 'Completati', value: stats.completedStudents },
    { label: 'Media', value: `${stats.avgScore}%`, color: 'text-primary' },
    { label: 'Mediana', value: `${stats.median}%`, color: 'text-primary' },
    { label: 'IQR', value: stats.iqr, color: 'text-secondary' },
    { label: 'Asimmetria', value: stats.skewness, color: 'text-secondary' },
    { label: 'Curtosi', value: stats.kurtosis, color: 'text-secondary' },
    { label: 'Outlier', value: stats.outlierCount, color: stats.outlierCount > 0 ? 'text-secondary' : 'text-tertiary' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 p-4 bg-surface-container-low border border-outline-variant/20 rounded-xl">
      {items.map(item => (
        <div key={item.label} className="text-center">
          <div className={`text-2xl font-bold ${item.color ?? 'text-on-surface'}`}>{item.value}</div>
          <div className="text-sm text-on-surface-variant">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ── Question view helpers ─────────────────────────────────────────────────────

interface QuestionSummary {
  questionId: string;
  questionText: string;
  type: string;
  weight: number;
  correctCount: number;
  avgPoints: number;
  totalAnswers: number;
  studentAnswers: { student: string; email?: string; answer: DetailedAnswer | undefined }[];
}

function buildQuestionSummary(scores: ScoreEntry[]): QuestionSummary[] {
  const questionMap = new Map<string, { text: string; type: string; weight: number }>();

  // Use embedded question_snapshot from scores
  scores.forEach(entry => {
    entry.answers?.forEach(a => {
      const qid = String(a.question_id);
      if (!questionMap.has(qid) && a.question_snapshot) {
        questionMap.set(qid, {
          text: a.question_snapshot.text ?? a.question_text,
          type: a.question_snapshot.type ?? 'unknown',
          weight: a.question_snapshot.weight ?? a.weight,
        });
      }
      if (!questionMap.has(qid)) {
        questionMap.set(qid, {
          text: a.question_text,
          type: 'unknown',
          weight: a.weight,
        });
      }
    });
  });

  return Array.from(questionMap.entries()).map(([qid, q]) => {
    const answers = scores.map(entry => ({
      student: entry.student_display_name ?? entry.student ?? entry.student_email ?? '—',
      email: entry.student_email ?? entry.student,
      answer: entry.answers?.find(a => String(a.question_id) === qid),
    }));

    const correctCount = answers.filter(a => a.answer && a.answer.points_awarded === a.answer.weight).length;
    const avgPoints = answers.reduce((sum, a) => sum + (a.answer?.points_awarded ?? 0), 0) / answers.length;

    return {
      questionId: qid,
      questionText: q.text,
      type: q.type,
      weight: q.weight,
      correctCount,
      avgPoints,
      totalAnswers: answers.length,
      studentAnswers: answers,
    };
  });
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SessionScoresPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = Number(sessionId);
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();
  const [reviewScore, setReviewScore] = useState<ScoreEntry | null>(null);
  const [viewBy, setViewBy] = useState<'student' | 'question'>('student');
  const [expandedQuestionId, setExpandedQuestionId] = useState<string | null>(null);
  const [questionOverrides, setQuestionOverrides] = useState<Record<string, number>>({});
  const [savingStudent, setSavingStudent] = useState<string | null>(null);

  const { data: scores, isLoading } = useQuery({
    queryKey: ['session-scores', id],
    queryFn: () => getSessionScores(id),
    enabled: !!id,
  });

  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => listSessions() });
  const session = sessions?.find(s => s.id === id);

  const { data: llmInfo } = useQuery({
    queryKey: ['llm-info'],
    queryFn: getLlmInfo,
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
    mutationFn: () => sendAllResultEmails(id),
  });

  const regradeMutation = useMutation({
    mutationFn: () => regradeOpenScores(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['session-scores', id] }),
  });

  const saveOverrideMutation = useMutation({
    mutationFn: (overrides: ScoreOverride[]) => reviewScores(id, overrides),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-scores', id] });
      setSavingStudent(null);
    },
    onError: () => setSavingStudent(null),
  });

  // ── Statistics ──────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!scores?.length) return null;
    return computeStats(scores.map(s => s.percent));
  }, [scores]);

  // ── Question summary ────────────────────────────────────────────────────────
  const questionSummary = useMemo(() => {
    if (!scores?.length) return [];
    return buildQuestionSummary(scores);
  }, [scores]);

  // ── CSV export ──────────────────────────────────────────────────────────────
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

  // ── Override helpers ────────────────────────────────────────────────────────
  const handleOverrideChange = (studentEmail: string, newPoints: string, maxPoints: number) => {
    const pts = newPoints === '' ? undefined : parseFloat(newPoints);
    setQuestionOverrides(prev => {
      const next = { ...prev };
      if (pts === undefined || isNaN(pts)) delete next[studentEmail];
      else next[studentEmail] = Math.max(0, Math.min(pts, maxPoints));
      return next;
    });
  };

  const handleSaveOverride = (studentEmail: string, questionId: string) => {
    const newPoints = questionOverrides[studentEmail];
    if (newPoints === undefined) return;

    const scoreEntry = scores?.find(s =>
      (s.student_email ?? s.student ?? s.student_display_name) === studentEmail
    );

    setSavingStudent(studentEmail);
    saveOverrideMutation.mutate([{
      score_id: scoreEntry?.id ?? 0,
      per_question: { [questionId]: newPoints },
    }]);

    setQuestionOverrides(prev => { const next = { ...prev }; delete next[studentEmail]; return next; });
  };

  // ── Render ──────────────────────────────────────────────────────────────────
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
            onClick={() => emailMutation.mutate()}
            disabled={emailMutation.isPending}
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

        {/* Statistics */}
        {stats && (
          <div className="mb-6 space-y-4">
            <StatGrid stats={stats} />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <DistributionChart values={stats.values} />
              <BoxPlot values={stats.values} />
            </div>
          </div>
        )}

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
                  ({llmInfo?.enabled ? 'abilitato' : 'disabilitato'})
                </span>
              </>
            )}
            <button
              onClick={() => regradeMutation.mutate()}
              disabled={regradeMutation.isPending}
              className={`px-4 py-2 rounded-md text-sm font-bold transition-colors ${
                regradeMutation.isPending
                  ? 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
                  : 'bg-surface-container-high border border-secondary/30 text-secondary hover:bg-secondary/10'
              }`}
            >
              {regradeMutation.isPending ? 'Ricalcolo...' : 'Rivaluta risposte aperte'}
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
          Rivalutazione completata. Aggiornati: {(regradeMutation.data as any)?.updated ?? 0} punteggi.
        </div>
      )}

      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}

      {viewBy === 'student' ? (
        /* ── By Student ────────────────────────────────────────────────────── */
        <div className="space-y-2">
          {scores?.sort((a, b) => b.percent - a.percent).map((score, i) => (
            <ScoreRow key={score.id ?? i} score={score} onClick={() => setReviewScore(score)} />
          ))}
          {!isLoading && !scores?.length && (
            <p className="text-center py-12 text-on-surface-variant">Nessun punteggio ancora registrato.</p>
          )}
        </div>
      ) : (
        /* ── By Question ───────────────────────────────────────────────────── */
        <div className="space-y-4">
          {questionSummary.map(q => {
            const isExpanded = expandedQuestionId === q.questionId;
            return (
              <div key={q.questionId} className="bg-surface-container border border-outline-variant/20 rounded-xl overflow-hidden">
                <div
                  className="p-4 cursor-pointer hover:bg-surface-container-high transition-colors"
                  onClick={() => {
                    setExpandedQuestionId(isExpanded ? null : q.questionId);
                    setQuestionOverrides({});
                  }}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium mb-1 text-on-surface truncate">
                        Q{q.questionId}: {q.questionText}
                      </div>
                      <div className="text-sm text-on-surface-variant">
                        Media: {q.avgPoints.toFixed(1)}/{q.weight} · Corrette: {q.correctCount}/{q.totalAnswers} · Tipo: {q.type}
                      </div>
                    </div>
                    <span className="text-on-surface-variant text-xl ml-4 flex-shrink-0">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-outline-variant/20 bg-surface-container-low p-4">
                    <div className="text-sm font-medium mb-3 text-on-surface">
                      Modifica punteggi ({q.totalAnswers} studenti):
                    </div>
                    <div className="space-y-3 max-h-96 overflow-y-auto">
                      {q.studentAnswers.map(({ student, email, answer }) => {
                        const currentPoints = answer?.points_awarded ?? 0;
                        const maxPoints = answer?.weight ?? q.weight;
                        const hasOverride = questionOverrides[email ?? student] !== undefined;
                        const displayPoints = hasOverride ? questionOverrides[email ?? student] : currentPoints;
                        const isSaving = savingStudent === (email ?? student);
                        const isCorrect = currentPoints === maxPoints;
                        const isPartial = currentPoints > 0 && !isCorrect;

                        return (
                          <div key={email ?? student} className="bg-surface-container border border-outline-variant/20 rounded-lg p-3">
                            <div className="flex flex-col md:flex-row md:items-center gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm text-on-surface truncate">{student}</div>
                                {answer && (
                                  <>
                                    <div className="text-xs text-on-surface-variant mt-1">
                                      <span className="font-medium">Risposta: </span>
                                      <span className="font-mono bg-surface-container-low px-1 rounded">
                                        {JSON.stringify(answer.student_answer ?? 'N/D')}
                                      </span>
                                    </div>
                                    <div className={`text-xs mt-1 p-2 rounded border ${
                                      isCorrect
                                        ? 'bg-tertiary/10 border-tertiary/30 text-tertiary'
                                        : isPartial
                                          ? 'bg-secondary/10 border-secondary/30 text-secondary'
                                          : 'bg-error/10 border-error/30 text-error'
                                    }`}>
                                      <span className="font-medium">Corretta: </span>
                                      <span className="font-mono">
                                        {JSON.stringify(answer.correct_answer ?? 'N/D')}
                                      </span>
                                    </div>
                                    {q.type === 'open' && (answer.llm_verdict || answer.llm_feedback) && (
                                      <div className="mt-2 p-2 bg-secondary/5 rounded border border-secondary/20 text-xs">
                                        <div className="font-semibold text-secondary mb-1">Valutazione LLM</div>
                                        {answer.llm_verdict && (
                                          <div className="mb-1">
                                            <span className="font-medium">Verdetto:</span>{' '}
                                            <span className="bg-secondary/10 border border-secondary/30 text-secondary text-xs px-2 py-0.5 rounded uppercase font-bold tracking-wider">
                                              {answer.llm_verdict}
                                            </span>
                                          </div>
                                        )}
                                        {answer.llm_feedback && (
                                          <div>
                                            <span className="font-medium text-secondary">Feedback:</span>{' '}
                                            <span className="text-secondary italic">{answer.llm_feedback}</span>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>

                              <div className="flex items-center gap-2 flex-shrink-0">
                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-1">
                                    <input
                                      type="number"
                                      min={0}
                                      max={maxPoints}
                                      step={0.5}
                                      value={displayPoints}
                                      onChange={e => handleOverrideChange(email ?? student, e.target.value, maxPoints)}
                                      className="bg-surface-container-low border border-outline-variant/30 text-on-surface focus:border-primary/50 focus:outline-none rounded w-16 text-center text-sm"
                                    />
                                    <span className="text-sm text-on-surface-variant">/ {maxPoints}</span>
                                  </div>
                                  {answer?.manual_override && (
                                    <div className="text-[11px] text-secondary leading-tight">
                                      Override manuale
                                    </div>
                                  )}
                                </div>

                                <button
                                  onClick={() => handleSaveOverride(email ?? student, q.questionId)}
                                  disabled={!hasOverride || isSaving}
                                  className={`px-3 py-1 text-sm rounded transition-colors ${
                                    hasOverride && !isSaving
                                      ? 'bg-primary text-on-primary font-bold'
                                      : 'bg-surface-container-high text-on-surface-variant cursor-not-allowed'
                                  }`}
                                >
                                  {isSaving ? '...' : 'Salva'}
                                </button>

                                <span className={`text-lg flex-shrink-0 ${
                                  isCorrect ? 'text-tertiary' : isPartial ? 'text-secondary' : 'text-error'
                                }`}>
                                  {isCorrect ? '✓' : isPartial ? '⚠' : '✗'}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {!isLoading && questionSummary.length === 0 && scores?.length === 0 && (
            <p className="text-center py-12 text-on-surface-variant">Nessun punteggio ancora registrato.</p>
          )}
        </div>
      )}
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
