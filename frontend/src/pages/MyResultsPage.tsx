import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Clock, Hourglass, LogOut, XCircle } from 'lucide-react';

import { ApiError, getMyResult, getMyResults, studentGoogleLogin } from '../api';
import type { MyResultItem, MyResultQuestion } from '../api';
import GoogleSignInButton from '../components/GoogleSignInButton';
import MarkdownContent from '../components/MarkdownContent';
import ThemeToggle from '../components/ThemeToggle';
import { clearResultsSession, getResultsSession, saveResultsSession } from '../lib/session';

const dateTime = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '';

const LOGIN_ERRORS: Record<string, string> = {
  STUDENT_NOT_PROVISIONED: "Questo account non risulta tra gli studenti dell'istituto.",
  INVALID_GOOGLE_DOMAIN: "Usa l'account Google della scuola (@marconirovereto.it).",
  ACCOUNT_DISABLED: 'Il tuo account è disattivato: rivolgiti alla segreteria.',
};

function Shell({ children, onLogout }: { children: React.ReactNode; onLogout?: () => void }) {
  const account = getResultsSession();
  return (
    <main className="min-h-dvh bg-surface text-on-surface">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 pt-6 pb-2">
        <Link to="/risultati" className="text-lg font-headline font-bold text-primary">I miei risultati</Link>
        <div className="flex items-center gap-2">
          {account && onLogout && (
            <button onClick={onLogout} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-on-surface-variant hover:text-on-surface" title={account.email}>
              <LogOut size={14} /> Esci
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>
      <div className="mx-auto max-w-3xl px-4 pb-12">{children}</div>
    </main>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const login = useMutation({
    mutationFn: studentGoogleLogin,
    onSuccess: (data) => { saveResultsSession(data); onDone(); },
    onError: (err: unknown) => {
      const code = err instanceof ApiError ? err.message : '';
      setError(LOGIN_ERRORS[code] ?? 'Accesso non riuscito. Riprova.');
    },
  });
  const onCredential = useCallback((c: string) => { setError(null); login.mutate(c); }, [login]);
  return (
    <div className="mt-10 rounded-2xl border border-outline-variant/30 bg-surface-container p-8 text-center">
      <h1 className="text-xl font-bold mb-2">Accedi per vedere i tuoi risultati</h1>
      <p className="text-sm text-on-surface-variant mb-6">
        Usa l'account Google della scuola. Vedrai le verifiche che hai consegnato e, quando il docente li pubblica,
        punteggi e motivazioni domanda per domanda.
      </p>
      <GoogleSignInButton onCredential={onCredential} onError={setError} />
      {login.isPending && <p className="mt-3 text-xs text-on-surface-variant">Verifica dell'account…</p>}
      {error && <p className="mt-3 text-sm text-error">{error}</p>}
    </div>
  );
}

function ResultList({ items }: { items: MyResultItem[] }) {
  if (!items.length) {
    return <p className="mt-8 text-center text-on-surface-variant">Non hai ancora consegnato verifiche.</p>;
  }
  return (
    <ul className="mt-4 space-y-3">
      {items.map(item => (
        <li key={item.session_id}>
          {item.published ? (
            <Link to={`/risultati/${item.session_id}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-container p-4 hover:bg-surface-container-high transition-colors">
              <div className="min-w-0">
                <p className="font-semibold truncate">{item.title}</p>
                <p className="text-xs text-on-surface-variant">{item.teacher} · consegnata il {dateTime(item.submitted_at)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-2xl font-headline font-bold text-secondary">{Math.round(item.percent ?? 0)}%</p>
                <p className="text-xs text-on-surface-variant">{item.raw_points} / {item.max_points} punti</p>
              </div>
            </Link>
          ) : (
            <div className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/20 bg-surface-container/60 p-4">
              <div className="min-w-0">
                <p className="font-semibold truncate">{item.title}</p>
                <p className="text-xs text-on-surface-variant">{item.teacher} · consegnata il {dateTime(item.submitted_at)}</p>
              </div>
              <p className="flex items-center gap-1.5 text-xs text-on-surface-variant shrink-0"><Clock size={14} /> risultati non ancora pubblicati</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function AnswerText({ value }: { value: string | string[] | null | undefined }) {
  if (value == null || (Array.isArray(value) && !value.length) || value === '') {
    return <span className="italic text-on-surface-variant">nessuna risposta</span>;
  }
  if (Array.isArray(value)) return <ul className="list-disc pl-5">{value.map((v, i) => <li key={i}><MarkdownContent compact>{v}</MarkdownContent></li>)}</ul>;
  return <MarkdownContent compact>{value}</MarkdownContent>;
}

function QuestionCard({ q, n }: { q: MyResultQuestion; n: number }) {
  const full = q.points !== null && q.points >= q.max_points;
  const none = q.points !== null && q.points === 0;
  const Icon = q.pending ? Hourglass : full ? CheckCircle2 : none ? XCircle : CheckCircle2;
  const tone = q.pending ? 'text-on-surface-variant' : full ? 'text-tertiary' : none ? 'text-error' : 'text-secondary';
  return (
    <article className="rounded-xl border border-outline-variant/30 bg-surface-container p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-wider text-on-surface-variant mb-1">Domanda {n}</p>
          <MarkdownContent>{q.text}</MarkdownContent>
          {q.question_image && <img src={q.question_image} alt="" className="question-image mt-2" />}
        </div>
        <p className={`flex items-center gap-1 shrink-0 font-headline font-bold ${tone}`}>
          <Icon size={18} />
          {q.pending ? <span className="text-sm font-normal">in valutazione</span> : <>{q.points} / {q.max_points}</>}
        </p>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-on-surface-variant mb-1">La tua risposta</p>
          <div className="rounded-lg border border-outline-variant/25 bg-surface-container-low px-3 py-2 text-sm"><AnswerText value={q.your_answer} /></div>
        </div>
        {q.acceptable_answer && (
          <div>
            <p className="text-xs font-medium text-on-surface-variant mb-1">Risposta accettabile</p>
            <div className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm"><AnswerText value={q.acceptable_answer} /></div>
          </div>
        )}
        {'correct_answer' in q && (
          <div>
            <p className="text-xs font-medium text-on-surface-variant mb-1">
              Risposta corretta
            </p>
            <div className="rounded-lg border border-tertiary/30 bg-tertiary/5 px-3 py-2 text-sm"><AnswerText value={q.correct_answer} /></div>
          </div>
        )}
      </div>

      {q.motivation && (
        <div className="mt-3 rounded-lg border-l-4 border-secondary bg-secondary/5 px-3 py-2">
          <p className="text-xs font-medium text-secondary mb-0.5">Motivazione</p>
          <MarkdownContent compact>{q.motivation}</MarkdownContent>
        </div>
      )}
      {q.pending && (
        <p className="mt-3 text-xs text-on-surface-variant">Questa risposta è ancora in valutazione: il punteggio totale può salire.</p>
      )}
    </article>
  );
}

function ResultDetail({ sessionId }: { sessionId: number }) {
  const { data, isLoading, error } = useQuery({ queryKey: ['my-result', sessionId], queryFn: () => getMyResult(sessionId), retry: false });
  if (isLoading) return <p className="mt-8 text-on-surface-variant">Caricamento…</p>;
  if (error || !data) {
    return (
      <div className="mt-8">
        <p className="text-on-surface-variant">Questi risultati non sono disponibili: forse il docente non li ha ancora pubblicati.</p>
        <Link to="/risultati" className="mt-3 inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft size={14} /> Tutte le verifiche</Link>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-4">
      <Link to="/risultati" className="inline-flex items-center gap-1 text-sm text-primary"><ArrowLeft size={14} /> Tutte le verifiche</Link>
      <section className="rounded-xl border border-secondary/30 bg-surface-container p-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">{data.title}</h1>
          <p className="text-sm text-on-surface-variant">{data.teacher} · consegnata il {dateTime(data.submitted_at)}</p>
        </div>
        <div className="text-right">
          <p className="text-4xl font-headline font-bold text-secondary">{Math.round(data.percent)}%</p>
          <p className="text-sm text-on-surface-variant">{data.raw_points} / {data.max_points} punti</p>
        </div>
      </section>
      {data.questions.map((q, i) => <QuestionCard key={q.question_id} q={q} n={i + 1} />)}
    </div>
  );
}

function MyResultsPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(() => !!getResultsSession());
  const { data: items, isLoading, error } = useQuery({
    queryKey: ['my-results'], queryFn: getMyResults, enabled: signedIn && !sessionId, retry: false,
  });
  const logout = () => { clearResultsSession(); setSignedIn(false); navigate('/risultati'); };

  // An expired token (apiFetch already dropped it): ask to sign in again.
  const expired = signedIn && error instanceof ApiError && error.status === 401;
  useEffect(() => { if (expired) setSignedIn(false); }, [expired]);

  if (!signedIn) return <Shell><Login onDone={() => setSignedIn(true)} /></Shell>;
  return (
    <Shell onLogout={logout}>
      {sessionId
        ? <ResultDetail sessionId={Number(sessionId)} />
        : isLoading ? <p className="mt-8 text-on-surface-variant">Caricamento…</p>
        : <ResultList items={items ?? []} />}
    </Shell>
  );
}

export default MyResultsPage;
