import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { resumeQuiz, saveAnswer, submitQuiz, studentJoin, Question, Answer, ApiError } from '../api';
import { updateStudentToken } from '../lib/session';
import {
  clearLocal, purgeOldLocal, restoreDraft, useAnswerDraft, type DraftStatus,
} from '../lib/answerDraft';
import QuestionDisplay from '../components/QuestionDisplay';
import ThemeToggle from '../components/ThemeToggle';
import AccessibilityPanel from '../components/AccessibilityPanel';

function ReJoinModal({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    try {
      const data = await studentJoin(
        email.trim().toLowerCase(),
        joinCode.trim().toUpperCase(),
      );
      updateStudentToken(data.token);
      onSuccess();
    } catch (err: any) {
      if (err?.isConflict) {
        setError('Hai già consegnato questo quiz.');
      } else {
        setError(err.message ?? 'Codice non valido o sessione scaduta.');
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-container rounded-2xl border border-outline-variant/30 p-8 w-full max-w-sm">
        <h2 className="text-xl font-bold text-on-surface mb-2">Sessione scaduta</h2>
        <p className="text-sm text-on-surface-variant mb-6">
          Reinserisci il codice di accesso per continuare da dove eri rimasto.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email istituzionale"
            required
            className="block w-full px-4 py-3 bg-surface border border-outline-variant/50 rounded-lg text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="Codice (es. ABCD12)"
            required
            maxLength={6}
            className="block w-full px-4 py-3 bg-surface border border-outline-variant/50 rounded-lg text-on-surface placeholder-on-surface-variant/50 font-mono tracking-widest uppercase focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
          {error && <p className="text-error text-sm">{error}</p>}
          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-primary text-on-primary font-semibold py-3 rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPending ? 'Accesso...' : 'Riprendi Quiz'}
          </button>
        </form>
      </div>
    </div>
  );
}

function DraftStatusLine({ status }: { status: DraftStatus }) {
  const time = (d: Date) => d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const [text, tone] =
    status.kind === 'saving' ? ['Salvataggio della bozza…', 'text-on-surface-variant'] :
    status.kind === 'saved' ? [`Bozza salvata alle ${time(status.at)}`, 'text-tertiary'] :
    status.kind === 'offline' ? ['Connessione assente: la bozza è conservata su questo computer e verrà inviata appena possibile', 'text-secondary'] :
    status.kind === 'stopped' ? [`Bozza non salvata sul server: ${status.message}. Il testo resta su questo computer.`, 'text-error'] :
    ['La risposta viene salvata automaticamente mentre scrivi', 'text-on-surface-variant'];
  return <p className={`mt-2 text-xs ${tone}`} role="status" aria-live="polite">{text}</p>;
}

function QuizPage() {
  const { quizId } = useParams<{ quizId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [currentAnswer, setCurrentAnswer] = useState<Answer>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showReJoin, setShowReJoin] = useState(false);
  // Set when the teacher closes the session mid-quiz: no further answers are
  // accepted, but the student can still hand in what they answered.
  const [sessionClosed, setSessionClosed] = useState(false);

  const {
    data: quizData,
    isLoading,
    error: queryError,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['quiz', quizId],
    queryFn: () => {
      if (!quizId) throw new Error('Quiz ID mancante.');
      return resumeQuiz(quizId);
    },
    enabled: !!quizId,
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (
      isError &&
      queryError instanceof ApiError &&
      queryError.code === 'TOKEN_EXPIRED'
    ) {
      setShowReJoin(true);
    }
  }, [isError, queryError]);

  const currentIndexForDraft = quizData?.current_index ?? 0;
  const isOpenQuestion = !quizData?.is_complete && quizData?.current_question?.type === 'open';
  const draft = useAnswerDraft(quizId, currentIndexForDraft, isOpenQuestion);
  const { reset: resetDraft } = draft;

  useEffect(() => { purgeOldLocal(); }, []);

  // When a question opens, bring back what was being written for it: an
  // unsent copy in this browser first, otherwise the server's draft. Only
  // once per question: a later refetch must not overwrite the typing.
  const restoredFor = useRef<string | null>(null);
  useEffect(() => {
    if (!quizId || !quizData) return;
    const slot = `${quizId}:${quizData.current_index}:${quizData.is_complete}`;
    if (restoredFor.current === slot) return;
    restoredFor.current = slot;
    setLocalError(null);
    if (!quizData.is_complete && quizData.current_question?.type === 'open') {
      const restored = restoreDraft(quizId, quizData.current_index, quizData.draft);
      setCurrentAnswer(restored.text || null);
      resetDraft(restored.text, restored.unsent);
    } else {
      setCurrentAnswer(null);
    }
  }, [quizId, quizData, resetDraft]);

  const handleAnswerChange = (answer: Answer) => {
    setCurrentAnswer(answer);
    if (isOpenQuestion && typeof answer === 'string') draft.edited(answer);
  };

  const saveAnswerMutation = useMutation({
    mutationFn: ({ answer }: { answer: Answer; index: number }) => {
      if (!quizId) throw new Error('Quiz ID mancante.');
      return saveAnswer(quizId, answer);
    },
    onSuccess: (_result, { index }) => {
      if (quizId) clearLocal(quizId, index);
      setCurrentAnswer(null);
      queryClient.invalidateQueries({ queryKey: ['quiz', quizId] });
      refetch();
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.code === 'TOKEN_EXPIRED') {
        setShowReJoin(true);
      } else if (err instanceof ApiError && err.code === 'SESSION_CLOSED') {
        setSessionClosed(true);
        setLocalError('La sessione è stata chiusa dall’insegnante.');
      } else {
        setLocalError(`Errore nel salvataggio: ${err.message}`);
      }
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => {
      if (!quizId) throw new Error('Quiz ID mancante.');
      return submitQuiz(quizId);
    },
    onSuccess: (result) => {
      if (quizId) clearLocal(quizId);
      queryClient.invalidateQueries({ queryKey: ['quiz', quizId] });
      navigate('/finish', { state: { submitResult: result } });
    },
    onError: (err: any) => {
      if (err instanceof ApiError && err.code === 'TOKEN_EXPIRED') {
        setShowReJoin(true);
      } else if (err instanceof ApiError && err.code === 'SESSION_CLOSED') {
        setLocalError(err.message);
      } else if (err instanceof ApiError && err.isConflict) {
        setLocalError('Hai già consegnato questo quiz.');
      } else {
        setLocalError(`Errore nella consegna: ${err.message ?? 'errore sconosciuto'}`);
      }
    },
  });

  const currentQuestion: Question | undefined = quizData?.current_question;
  const currentIndex = quizData?.current_index ?? 0;
  const totalQuestions = quizData?.total_questions ?? 0;
  const isComplete = quizData?.is_complete ?? false;

  const isCurrentAnswered = (() => {
    if (currentAnswer === undefined || currentAnswer === null) return false;
    if (currentQuestion?.type === 'open') return (currentAnswer as string).trim() !== '';
    if (currentQuestion?.type === 'multiple') return (currentAnswer as number[]).length > 0;
    return true;
  })();

  const handleNext = () => {
    setLocalError(null);
    if (!isCurrentAnswered) { setLocalError('Rispondi alla domanda prima di continuare.'); return; }
    saveAnswerMutation.mutate({ answer: currentAnswer, index: currentIndex });
  };

  const handleSubmit = async () => {
    setLocalError(null);
    // After a close, the open answer being written is handed in as a draft:
    // make sure the server has its latest words first.
    await draft.flush();
    submitMutation.mutate();
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-on-surface-variant">Caricamento...</div>;
  }

  if (isError && !(queryError instanceof ApiError && queryError.code === 'TOKEN_EXPIRED')) {
    return (
      <div className="min-h-screen bg-surface flex items-center justify-center p-4">
        <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-8 max-w-md w-full text-center">
          <h2 className="text-xl font-bold text-on-surface mb-2">Errore</h2>
          <p className="text-on-surface-variant text-sm mb-6">{(queryError as any)?.message ?? 'Impossibile caricare il quiz.'}</p>
          <button onClick={() => navigate('/')} className="px-6 py-2 bg-primary text-on-primary rounded-lg font-medium">
            Torna alla Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {showReJoin && (
        <ReJoinModal onSuccess={() => { setShowReJoin(false); refetch(); }} />
      )}
      <main onContextMenu={(e) => e.preventDefault()} className="w-dvw h-dvh">
        <div className="fixed top-4 right-4 z-40 flex items-center gap-2">
          <AccessibilityPanel />
          <ThemeToggle />
        </div>
        <div className={`container mx-auto p-4 ${isOpenQuestion ? 'max-w-6xl' : 'max-w-3xl'} quiz-no-select`}>

          {isComplete || sessionClosed ? (
            <div className="min-h-screen flex items-center justify-center">
              <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-8 max-w-md w-full text-center">
                <h2 className="text-2xl font-bold text-on-surface mb-4">
                  {sessionClosed ? 'Sessione chiusa' : 'Quiz Completato!'}
                </h2>
                <p className="text-on-surface-variant mb-6">
                  {sessionClosed
                    ? 'L’insegnante ha chiuso la sessione. Puoi comunque consegnare le risposte già date.'
                    : 'Hai risposto a tutte le domande. Clicca per consegnare.'}
                </p>
                {localError && <p className="text-error text-sm mb-4">{localError}</p>}
                <button
                  onClick={handleSubmit}
                  disabled={submitMutation.isPending}
                  className="px-6 py-2 bg-tertiary text-on-tertiary font-semibold rounded-lg hover:bg-tertiary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {submitMutation.isPending ? 'Consegna in corso...' : 'Consegna il Quiz'}
                </button>
              </div>
            </div>
          ) : !quizData || !currentQuestion ? (
            <div className="text-error p-4">Dati del quiz mancanti o non validi.</div>
          ) : (
            <>
              {/* Room for the fixed accessibility and theme buttons: beside them on wide screens, below them on phones. */}
              <div className="flex justify-between items-center mb-4 pt-16 sm:pt-4 sm:pr-32">
                <h2 className="text-lg font-semibold text-on-surface">Quiz</h2>
                <span className="text-sm text-on-surface-variant">
                  Domanda {currentIndex + 1} / {totalQuestions}
                </span>
              </div>

              {localError && (
                <div className="mb-4 p-3 bg-error/10 border border-error/40 text-error rounded-lg text-sm">
                  {localError}
                </div>
              )}

              <div className="bg-surface-container p-6 rounded-lg border border-outline-variant/30 select-none">
                <QuestionDisplay
                  question={currentQuestion}
                  currentAnswer={currentAnswer}
                  onAnswerChange={handleAnswerChange}
                  disableCopy={true}
                />
                {isOpenQuestion && <DraftStatusLine status={draft.status} />}
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={handleNext}
                  disabled={!isCurrentAnswered || saveAnswerMutation.isPending}
                  className="bg-tertiary text-on-tertiary font-semibold rounded-md px-6 py-2 hover:bg-tertiary/90 focus:outline-none focus:ring-2 focus:ring-tertiary/50 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saveAnswerMutation.isPending ? 'Salvataggio...' : 'Avanti'}
                </button>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

export default QuizPage;
