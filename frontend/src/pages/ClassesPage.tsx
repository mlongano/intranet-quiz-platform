import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RefreshCw, Users } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import {
  getClassStudents,
  listClasses,
  listClassroomCourses,
  syncClassroomCourses,
  type ClassroomCourse,
} from '../api';

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

function ClassroomSyncPanel() {
  const queryClient = useQueryClient();
  const [selectedCourseIds, setSelectedCourseIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const coursesQuery = useQuery({
    queryKey: ['classroom-courses'],
    queryFn: listClassroomCourses,
    enabled: false,
  });

  const syncMutation = useMutation({
    mutationFn: () => syncClassroomCourses(selectedCourseIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] });
      setError(null);
    },
    onError: (err: any) => {
      setError(err.message ?? 'Sincronizzazione Google Classroom non riuscita.');
    },
  });

  const courses = coursesQuery.data ?? [];
  const allSelected = courses.length > 0 && selectedCourseIds.length === courses.length;

  const toggleCourse = (course: ClassroomCourse) => {
    setSelectedCourseIds(current => (
      current.includes(course.id)
        ? current.filter(id => id !== course.id)
        : [...current, course.id]
    ));
  };

  const toggleAll = () => {
    setSelectedCourseIds(allSelected ? [] : courses.map(course => course.id));
  };

  return (
    <div className="mb-6 rounded-xl border border-tertiary/30 bg-tertiary/5 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-on-surface">Google Classroom</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Importa le classi e gli studenti dai corsi Classroom del tuo account docente.
          </p>
        </div>
        <button
          type="button"
          onClick={() => coursesQuery.refetch()}
          disabled={coursesQuery.isFetching}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-tertiary/40 px-3 py-2 text-sm font-semibold text-tertiary hover:bg-tertiary/10 disabled:opacity-50"
        >
          <RefreshCw size={14} className={coursesQuery.isFetching ? 'animate-spin' : ''} />
          {coursesQuery.isFetching ? 'Caricamento...' : 'Carica corsi'}
        </button>
      </div>

      {coursesQuery.isError && (
        <p className="mt-3 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          Impossibile caricare i corsi Classroom: {String((coursesQuery.error as Error).message)}
        </p>
      )}

      {courses.length > 0 && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={toggleAll}
              className="text-sm font-medium text-tertiary hover:underline"
            >
              {allSelected ? 'Deseleziona tutti' : 'Seleziona tutti'}
            </button>
            <button
              type="button"
              onClick={() => syncMutation.mutate()}
              disabled={selectedCourseIds.length === 0 || syncMutation.isPending}
              className="rounded-lg bg-tertiary px-3 py-2 text-sm font-bold text-on-tertiary hover:bg-tertiary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncMutation.isPending ? 'Sincronizzazione...' : 'Sincronizza selezionati'}
            </button>
          </div>

          <div className="space-y-2">
            {courses.map(course => (
              <label
                key={course.id}
                className="flex cursor-pointer items-start gap-3 rounded-lg border border-outline-variant/20 bg-surface-container p-3 hover:bg-surface-container-high"
              >
                <input
                  type="checkbox"
                  checked={selectedCourseIds.includes(course.id)}
                  onChange={() => toggleCourse(course)}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-semibold text-on-surface">{course.title}</span>
                  <span className="block text-xs text-on-surface-variant">{course.course_state}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {syncMutation.data && (
        <div className="mt-3 rounded-lg border border-tertiary/30 bg-tertiary/10 p-3 text-sm text-tertiary">
          Corsi sincronizzati: {syncMutation.data.courses_synced}. Studenti sincronizzati: {syncMutation.data.students_synced}.
          {syncMutation.data.errors.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {syncMutation.data.errors.map(message => <li key={message}>{message}</li>)}
            </ul>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </p>
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
      <ClassroomSyncPanel />
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
