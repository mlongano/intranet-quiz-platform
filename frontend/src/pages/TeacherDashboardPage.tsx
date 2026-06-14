import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, BarChart3, FileText, RefreshCw, Users, Plus, ArrowRight } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import { listArchives, listSessions, listSnapshots, listClasses } from '../api';
import { getTeacherSession } from '../lib/session';

type AccentColor = 'primary' | 'secondary' | 'tertiary' | 'muted';

const accentClasses: Record<AccentColor, { bar: string; glow: string; text: string }> = {
  primary: { bar: 'bg-primary', glow: 'shadow-neon-cyan', text: 'text-primary' },
  secondary: { bar: 'bg-secondary', glow: 'shadow-neon-magenta', text: 'text-secondary' },
  tertiary: { bar: 'bg-tertiary', glow: 'shadow-neon-green', text: 'text-tertiary' },
  muted: { bar: 'bg-primary-dim/70', glow: 'shadow-neon-cyan', text: 'text-on-surface-variant' },
};

function StatCard({ label, value, meta, detail, icon: Icon, accent = 'primary', onClick }: {
  label: string;
  value: number | string;
  meta: string;
  detail?: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent?: AccentColor;
  onClick?: () => void;
}) {
  const classes = accentClasses[accent];
  const valueClass = typeof value === 'string' && value.length > 14 ? 'text-2xl leading-tight' : 'text-4xl';

  return (
    <div
      onClick={onClick}
      className={`group relative min-h-44 overflow-hidden rounded-xl border border-outline-variant/25 bg-surface-container p-7 transition-all duration-300 ${classes.glow} ${onClick ? 'cursor-pointer hover:-translate-y-0.5 hover:bg-surface-container-high' : ''}`}
    >
      <div className={`absolute left-0 top-0 h-1 w-full ${classes.bar}`} />
      <p className="mb-5 text-xs font-bold uppercase tracking-[0.22em] text-on-surface-variant">{label}</p>
      <p className={`${valueClass} font-headline font-bold text-on-surface`}>{value}</p>
      <p className={`mt-3 text-sm font-medium ${classes.text}`}>{meta}</p>
      {detail && <p className="mt-1 text-sm text-on-surface-variant">{detail}</p>}
      <Icon
        size={108}
        aria-hidden="true"
        className="absolute -bottom-7 -right-5 text-on-surface opacity-[0.04] transition-opacity duration-300 group-hover:opacity-[0.09]"
      />
    </div>
  );
}

function TeacherDashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = getTeacherSession();

  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => listSessions() });
  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: listSnapshots });
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: listClasses });
  const { data: archives } = useQuery({ queryKey: ['archives'], queryFn: listArchives });

  const activeSessions = sessions?.filter(s => s.status === 'active') ?? [];
  const draftSessions = sessions?.filter(s => s.status === 'draft') ?? [];
  const currentSession = activeSessions[0] ?? draftSessions[0];
  const totalSubmissions = sessions?.reduce((sum, item) => sum + (item.score_count ?? 0), 0) ?? 0;
  const totalStudents = classes?.reduce((sum, item) => sum + item.student_count, 0) ?? 0;

  const refreshDashboard = () => {
    queryClient.invalidateQueries({ queryKey: ['sessions'] });
    queryClient.invalidateQueries({ queryKey: ['snapshots'] });
    queryClient.invalidateQueries({ queryKey: ['classes'] });
    queryClient.invalidateQueries({ queryKey: ['archives'] });
  };

  return (
    <TeacherLayout pageTitle={`Ciao, ${session?.display_name?.split(' ')[0] ?? 'Docente'}`}>
      <div className="space-y-8">
        <div className="flex flex-col gap-3 rounded-xl border border-outline-variant/10 bg-surface-container-low p-4 shadow-neon-cyan sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 rounded-full bg-tertiary/10 px-3 py-1">
              <span className="h-2 w-2 animate-pulse rounded-full bg-tertiary" />
              <span className="text-sm font-bold text-tertiary">Sessioni attive: {activeSessions.length}</span>
            </div>
            <span className="text-sm text-on-surface-variant">{draftSessions.length} bozze pronte</span>
          </div>
          <button
            type="button"
            onClick={refreshDashboard}
            className="flex items-center gap-2 text-sm font-semibold text-primary transition-colors hover:text-on-surface"
          >
            <RefreshCw size={15} />
            Aggiorna ora
          </button>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Quiz corrente"
            value={currentSession?.title ?? 'Nessuno'}
            meta={currentSession ? `${activeSessions.length} sessioni attive` : 'Crea una nuova sessione'}
            detail={currentSession?.join_code ? `Codice: ${currentSession.join_code}` : undefined}
            icon={FileText}
            accent="primary"
            onClick={() => navigate(currentSession ? `/teacher/sessions/${currentSession.id}` : '/teacher/sessions')}
          />
          <StatCard
            label="Consegne"
            value={totalSubmissions}
            meta="consegne registrate"
            detail={`${activeSessions.length} sessioni attive`}
            icon={BarChart3}
            accent="secondary"
            onClick={() => navigate('/teacher/sessions')}
          />
          <StatCard
            label="Studenti"
            value={totalStudents || (classes ? 0 : '—')}
            meta={`${classes?.length ?? 0} classi sincronizzate`}
            detail="studenti iscritti"
            icon={Users}
            accent="tertiary"
            onClick={() => navigate('/teacher/classes')}
          />
          <StatCard
            label="Archivio"
            value={archives?.length ?? '—'}
            meta="punteggi archiviati"
            detail={`${snapshots?.length ?? 0} quiz salvati`}
            icon={Archive}
            accent="muted"
            onClick={() => navigate('/teacher/archives')}
          />
        </div>

        {activeSessions.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-on-surface mb-3">Sessioni attive</h2>
            <div className="space-y-2">
              {activeSessions.map(s => (
                <div
                  key={s.id}
                  onClick={() => navigate(`/teacher/sessions/${s.id}`)}
                  className="bg-surface-container rounded-lg border border-outline-variant/30 p-4 flex items-center justify-between cursor-pointer hover:bg-surface-container-high transition-colors"
                >
                  <div>
                    <p className="font-medium text-on-surface">{s.title}</p>
                    <p className="text-sm text-on-surface-variant mt-0.5">
                      Codice: <span className="font-mono font-bold text-primary tracking-wider">{s.join_code}</span>
                      {s.classes.length > 0 && (
                        <span className="ml-3">{s.classes.map(c => c.name).join(', ')}</span>
                      )}
                    </p>
                  </div>
                  <ArrowRight size={16} className="text-on-surface-variant flex-shrink-0" />
                </div>
              ))}
            </div>
          </section>
        )}

        {draftSessions.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-on-surface mb-3">Sessioni in bozza</h2>
            <div className="space-y-2">
              {draftSessions.slice(0, 3).map(s => (
                <div
                  key={s.id}
                  onClick={() => navigate(`/teacher/sessions/${s.id}`)}
                  className="bg-surface-container rounded-lg border border-outline-variant/30 p-4 flex items-center justify-between cursor-pointer hover:bg-surface-container-high transition-colors"
                >
                  <p className="font-medium text-on-surface">{s.title}</p>
                  <ArrowRight size={16} className="text-on-surface-variant flex-shrink-0" />
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <h2 className="text-lg font-semibold text-on-surface mb-3">Azioni rapide</h2>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => navigate('/teacher/sessions')}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Plus size={16} />
              Nuova sessione
            </button>
            <button
              onClick={() => navigate('/teacher/snapshots')}
              className="flex items-center gap-2 px-4 py-2 bg-surface-container border border-outline-variant/40 text-on-surface rounded-lg text-sm font-medium hover:bg-surface-container-high transition-colors"
            >
              <FileText size={16} />
              Importa quiz
            </button>
          </div>
        </section>
      </div>
    </TeacherLayout>
  );
}

export default TeacherDashboardPage;
