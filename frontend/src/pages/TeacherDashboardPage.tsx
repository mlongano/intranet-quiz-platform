import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Archive, ArrowRight, CheckCircle2, Clock, FileText, Hourglass, PenLine, Plus, UserX, Users,
} from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import { getLive, listArchives, listClasses, listSessions, listSnapshots } from '../api';
import type { LiveSession, LiveStudent } from '../api';
import { getTeacherSession } from '../lib/session';

const REFRESH_MS = 10_000;
const IDLE_MS = 5 * 60_000;     // no answer nor autosave for this long: worth a look

function ago(iso: string | null, now: number): string {
  if (!iso) return '';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} s fa`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min fa` : `${Math.floor(m / 60)} h ${m % 60} min fa`;
}

function until(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const m = Math.round((new Date(iso).getTime() - now) / 60000);
  const at = new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  if (m < 0) return `ingresso chiuso alle ${at}`;
  return m < 60 ? `chiude alle ${at} (tra ${m} min)` : `chiude alle ${at}`;
}

const time = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '';

function ProgressBar({ counts }: { counts: LiveSession['counts'] }) {
  const total = Math.max(counts.expected, 1);
  const seg = (n: number, cls: string, label: string) => n > 0 && (
    <div className={cls} style={{ width: `${(n / total) * 100}%` }} title={`${label}: ${n}`} />
  );
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-outline-variant/25"
      role="img" aria-label={`${counts.submitted} consegnati, ${counts.in_progress} in corso, ${counts.not_started} non entrati su ${counts.expected}`}>
      {seg(counts.submitted, 'bg-tertiary', 'Consegnato')}
      {seg(counts.in_progress, 'bg-primary', 'In corso')}
    </div>
  );
}

function StudentRow({ st, questions, now }: { st: LiveStudent; questions: number; now: number }) {
  const classes = st.classes.join(', ');
  let detail: React.ReactNode = null;
  let tone = 'text-on-surface-variant';
  if (st.state === 'in_progress') {
    const idle = st.last_activity && now - new Date(st.last_activity).getTime() > IDLE_MS;
    if ((st.answered ?? 0) >= questions) {
      detail = 'ha risposto a tutto, deve ancora consegnare';
      tone = 'text-secondary';
    } else {
      detail = (
        <>
          domanda {(st.answered ?? 0) + 1}/{questions}
          {st.writing && <span className="inline-flex items-center gap-0.5 ml-1.5"><PenLine size={11} /> scrive</span>}
          {' · '}
          <span className={idle ? 'text-secondary' : ''}>{idle ? 'fermo da ' : 'attivo '}{ago(st.last_activity, now).replace(' fa', '')}</span>
        </>
      );
    }
  } else if (st.state === 'submitted') {
    detail = (
      <>
        alle {time(st.submitted_at)}
        {st.percent !== null && <> · {Math.round(st.percent)}%</>}
        {/* Open answers not graded yet count 0: the percentage can only rise. */}
        {st.grading_pending && <span className="ml-1.5 text-secondary">· provvisorio, risposte aperte in valutazione</span>}
      </>
    );
  }
  return (
    <li className="py-1.5 border-b border-outline-variant/15 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm text-on-surface truncate" title={st.email}>{st.name}</span>
        {classes && <span className="text-[11px] text-on-surface-variant shrink-0">{classes}</span>}
      </div>
      {detail && <p className={`text-xs ${tone}`}>{detail}</p>}
    </li>
  );
}

function StudentColumn({ title, icon: Icon, tone, students, questions, now, empty }: {
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  tone: string;
  students: LiveStudent[];
  questions: number;
  now: number;
  empty: string;
}) {
  return (
    <div className="min-w-0">
      <h4 className={`flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider mb-1 ${tone}`}>
        <Icon size={14} /> {title} <span className="font-normal">({students.length})</span>
      </h4>
      {students.length
        ? <ul className="max-h-72 overflow-y-auto pr-1">{students.map(st => <StudentRow key={st.id} st={st} questions={questions} now={now} />)}</ul>
        : <p className="text-xs text-on-surface-variant py-1.5">{empty}</p>}
    </div>
  );
}

function LiveSessionCard({ s, now }: { s: LiveSession; now: number }) {
  const navigate = useNavigate();
  const allClasses = [...new Set(s.students.flatMap(st => st.classes))].sort();
  const [classFilter, setClassFilter] = useState<string | null>(null);
  const shown = classFilter ? s.students.filter(st => st.classes.includes(classFilter)) : s.students;

  // Working students first by how far they got; the stuck ones stand out by tone.
  const inProgress = shown.filter(st => st.state === 'in_progress')
    .sort((a, b) => (b.answered ?? 0) - (a.answered ?? 0) || a.name.localeCompare(b.name));
  const notStarted = shown.filter(st => st.state === 'not_started');
  const submitted = shown.filter(st => st.state === 'submitted')
    .sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? ''));
  const missing = s.counts.expected - s.counts.submitted;
  const closing = until(s.closes_at, now);

  return (
    <article className="rounded-xl border border-tertiary/25 bg-surface-container p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-on-surface">{s.title}</h3>
          <p className="text-sm text-on-surface-variant mt-0.5">
            {allClasses.join(', ')}
            {closing && <span className="ml-2 inline-flex items-center gap-1"><Clock size={13} />{closing}</span>}
          </p>
        </div>
        <div className="flex items-center gap-4">
          {s.join_code && (
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wider text-on-surface-variant">Codice</p>
              <p className="font-mono text-2xl font-bold tracking-[0.25em] text-primary">{s.join_code}</p>
            </div>
          )}
          <button
            onClick={() => navigate(`/teacher/sessions/${s.id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
          >
            Punteggi <ArrowRight size={12} />
          </button>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1.5">
          <p className="text-sm text-on-surface">
            <span className="text-2xl font-headline font-bold text-tertiary">{s.counts.submitted}</span>
            <span className="text-on-surface-variant"> / {s.counts.expected} consegnati</span>
            {missing > 0
              ? <span className="ml-3 text-on-surface-variant">mancano <strong className="text-on-surface">{missing}</strong>: {s.counts.in_progress} in corso, {s.counts.not_started} non entrati</span>
              : s.counts.expected > 0 && <span className="ml-3 text-tertiary font-medium">tutti hanno consegnato</span>}
          </p>
          {allClasses.length > 1 && (
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filtra per classe">
              {[null, ...allClasses].map(c => (
                <button key={c ?? 'tutte'} onClick={() => setClassFilter(c)}
                  className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${classFilter === c ? 'border-tertiary/60 bg-tertiary/10 text-tertiary' : 'border-outline-variant/40 text-on-surface-variant hover:text-on-surface'}`}>
                  {c ?? 'Tutte'}
                </button>
              ))}
            </div>
          )}
        </div>
        <ProgressBar counts={s.counts} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-3">
        <StudentColumn title="In corso" icon={Hourglass} tone="text-primary" students={inProgress}
          questions={s.question_count} now={now} empty="Nessuno sta rispondendo." />
        <StudentColumn title="Non entrati" icon={UserX} tone="text-on-surface-variant" students={notStarted}
          questions={s.question_count} now={now} empty="Sono entrati tutti." />
        <StudentColumn title="Consegnato" icon={CheckCircle2} tone="text-tertiary" students={submitted}
          questions={s.question_count} now={now} empty="Ancora nessuna consegna." />
      </div>
    </article>
  );
}

function Total({ icon: Icon, value, label, onClick }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: number | string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-3 rounded-lg border border-outline-variant/25 bg-surface-container px-4 py-3 text-left hover:bg-surface-container-high transition-colors">
      <Icon size={18} className="text-on-surface-variant" />
      <span className="text-lg font-headline font-bold text-on-surface">{value}</span>
      <span className="text-sm text-on-surface-variant">{label}</span>
    </button>
  );
}

function TeacherDashboardPage() {
  const navigate = useNavigate();
  const session = getTeacherSession();

  // The live view refreshes itself, and pauses while the tab is in the background.
  const { data: live, dataUpdatedAt, isLoading } = useQuery({
    queryKey: ['live'],
    queryFn: getLive,
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
  });
  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => listSessions() });
  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: listSnapshots });
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: () => listClasses() });
  const { data: archives } = useQuery({ queryKey: ['archives'], queryFn: listArchives });

  const active = live?.sessions ?? [];
  const drafts = sessions?.filter(s => s.status === 'draft') ?? [];
  const totalStudents = classes?.reduce((sum, c) => sum + c.student_count, 0) ?? 0;
  const now = dataUpdatedAt || 0;

  return (
    <TeacherLayout pageTitle={`Ciao, ${session?.display_name?.split(' ')[0] ?? 'Docente'}`}>
      <div className="space-y-8">
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-on-surface">
              <span className={`h-2.5 w-2.5 rounded-full ${active.length ? 'bg-tertiary animate-pulse' : 'bg-outline-variant'}`} />
              Adesso
            </h2>
            {dataUpdatedAt > 0 && (
              <span className="text-xs text-on-surface-variant" role="status" aria-live="off">
                si aggiorna da sola · ultimo aggiornamento alle {new Date(dataUpdatedAt).toLocaleTimeString('it-IT')}
              </span>
            )}
          </div>

          {isLoading && <p className="text-on-surface-variant text-sm">Caricamento...</p>}

          {!isLoading && active.length === 0 && (
            <div className="rounded-xl border border-outline-variant/25 bg-surface-container p-6">
              <p className="text-on-surface font-medium">Nessuna sessione attiva.</p>
              <p className="text-sm text-on-surface-variant mt-1">
                Quando ne avvii una, qui vedi chi ha consegnato, chi sta rispondendo e chi non è ancora entrato.
              </p>
              <div className="flex flex-wrap gap-2 mt-4">
                <button onClick={() => navigate('/teacher/sessions')}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                  <Plus size={16} /> {drafts.length ? 'Vai alle sessioni' : 'Nuova sessione'}
                </button>
                {drafts.slice(0, 3).map(d => (
                  <button key={d.id} onClick={() => navigate('/teacher/sessions')}
                    className="px-3 py-2 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors">
                    Bozza pronta: {d.title}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-5">
            {active.map(s => <LiveSessionCard key={s.id} s={s} now={now} />)}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-on-surface-variant mb-2">In totale</h2>
          <div className="flex flex-wrap gap-3">
            <Total icon={FileText} value={snapshots?.length ?? '—'} label="quiz salvati" onClick={() => navigate('/teacher/snapshots')} />
            <Total icon={Users} value={classes ? totalStudents : '—'} label={`studenti in ${classes?.length ?? 0} classi`} onClick={() => navigate('/teacher/classes')} />
            <Total icon={Clock} value={drafts.length} label="sessioni in bozza" onClick={() => navigate('/teacher/sessions')} />
            <Total icon={Archive} value={archives?.length ?? '—'} label="archivi di punteggi" onClick={() => navigate('/teacher/archives')} />
          </div>
        </section>
      </div>
    </TeacherLayout>
  );
}

export default TeacherDashboardPage;
