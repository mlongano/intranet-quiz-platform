import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, FileText, Users, Plus, ArrowRight } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import { listSessions, listSnapshots, listClasses } from '../api';
import { getTeacherSession } from '../lib/session';

type AccentColor = 'primary' | 'secondary' | 'tertiary';

function StatCard({ label, value, icon: Icon, accent = 'primary', onClick }: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  accent?: AccentColor;
  onClick?: () => void;
}) {
  const bgClass = accent === 'primary' ? 'bg-primary/10' : accent === 'secondary' ? 'bg-secondary/10' : 'bg-tertiary/10';
  const textClass = accent === 'primary' ? 'text-primary' : accent === 'secondary' ? 'text-secondary' : 'text-tertiary';
  return (
    <div
      onClick={onClick}
      className={`bg-surface-container rounded-xl border-t-2 border-${accent}/40 border border-outline-variant/30 border-t-${accent} p-6 flex items-center gap-4 ${onClick ? 'cursor-pointer hover:bg-surface-container-high transition-colors' : ''}`}
      style={{ borderTopColor: `var(--${accent})`, borderTopWidth: '2px' }}
    >
      <div className={`w-12 h-12 rounded-lg ${bgClass} flex items-center justify-center flex-shrink-0`}>
        <Icon size={22} className={textClass} />
      </div>
      <div>
        <p className="text-2xl font-bold text-on-surface">{value}</p>
        <p className="text-sm text-on-surface-variant">{label}</p>
      </div>
    </div>
  );
}

function TeacherDashboardPage() {
  const navigate = useNavigate();
  const session = getTeacherSession();

  const { data: sessions } = useQuery({ queryKey: ['sessions'], queryFn: () => listSessions() });
  const { data: snapshots } = useQuery({ queryKey: ['snapshots'], queryFn: listSnapshots });
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: listClasses });

  const activeSessions = sessions?.filter(s => s.status === 'active') ?? [];
  const draftSessions = sessions?.filter(s => s.status === 'draft') ?? [];

  return (
    <TeacherLayout pageTitle={`Ciao, ${session?.display_name?.split(' ')[0] ?? 'Docente'}`}>
      <div className="space-y-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="Sessioni attive"
            value={activeSessions.length}
            icon={BarChart3}
            accent="secondary"
            onClick={() => navigate('/teacher/sessions')}
          />
          <StatCard
            label="Quiz (snapshot)"
            value={snapshots?.length ?? '—'}
            icon={FileText}
            accent="primary"
            onClick={() => navigate('/teacher/snapshots')}
          />
          <StatCard
            label="Le mie classi"
            value={classes?.length ?? '—'}
            icon={Users}
            accent="tertiary"
            onClick={() => navigate('/teacher/classes')}
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
