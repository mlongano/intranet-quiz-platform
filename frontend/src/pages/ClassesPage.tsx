import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import { listClasses, getClassStudents } from '../api';

function ClassCard({ cls }: { cls: { id: number; name: string; academic_year: string; student_count: number } }) {
  const [expanded, setExpanded] = useState(false);

  const { data: students, isLoading } = useQuery({
    queryKey: ['class-students', cls.id],
    queryFn: () => getClassStudents(cls.id),
    enabled: expanded,
  });

  return (
    <div className="bg-surface-container rounded-xl border border-outline-variant/30 overflow-hidden">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between p-4 hover:bg-surface-container-high transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Users size={16} className="text-primary" />
          </div>
          <div className="text-left">
            <p className="font-semibold text-on-surface">{cls.name}</p>
            <p className="text-xs text-on-surface-variant">{cls.academic_year} · {cls.student_count} studenti</p>
          </div>
        </div>
        {expanded ? <ChevronDown size={16} className="text-on-surface-variant" /> : <ChevronRight size={16} className="text-on-surface-variant" />}
      </button>

      {expanded && (
        <div className="border-t border-outline-variant/20 px-4 py-3">
          {isLoading && <p className="text-sm text-on-surface-variant py-2">Caricamento...</p>}
          {students && (
            <ul className="space-y-1.5">
              {students.map(s => (
                <li key={s.id} className="flex items-center gap-3 py-1">
                  <div className="w-7 h-7 rounded-full bg-secondary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-secondary">
                      {s.display_name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-on-surface">{s.display_name}</p>
                    <p className="text-xs text-on-surface-variant">{s.email}</p>
                  </div>
                </li>
              ))}
              {!students.length && <p className="text-sm text-on-surface-variant">Nessuno studente.</p>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ClassesPage() {
  const { data: classes, isLoading } = useQuery({
    queryKey: ['classes'],
    queryFn: listClasses,
  });

  return (
    <TeacherLayout pageTitle="Le mie Classi">
      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}
      <div className="space-y-3">
        {classes?.map(c => <ClassCard key={c.id} cls={c} />)}
        {!isLoading && !classes?.length && (
          <div className="text-center py-16 text-on-surface-variant">
            <p>Nessuna classe assegnata. Contatta l'amministratore.</p>
          </div>
        )}
      </div>
    </TeacherLayout>
  );
}

export default ClassesPage;
