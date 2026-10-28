import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, Pencil, Plus, RefreshCw, Trash2, Users, X } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import {
  addClassStudents,
  createClass,
  deleteClass,
  getClassStudents,
  listClasses,
  listClassroomCourses,
  removeClassStudent,
  syncClassroomCourses,
  updateClass,
  type ClassMembersReport,
  type ClassMeta,
  type ClassroomCourse,
} from '../api';
import { useConfirmModal } from '../lib/useConfirmModal';

/** The Italian school year in progress, September to August: "2026-2027". */
function currentAcademicYear(now = new Date()): string {
  const y = now.getFullYear();
  return now.getMonth() >= 8 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

/** Addresses pasted in any form: one per line, or separated by commas, semicolons or spaces. */
function parseEmails(text: string): string[] {
  return text.split(/[\s,;]+/).map(e => e.trim()).filter(Boolean);
}

const KIND_LABEL: Record<string, string> = {
  classroom: 'Google Classroom',
  workspace: 'Gruppo Google',
  manual: 'creata a mano',
};

function MembersReport({ report }: { report: ClassMembersReport }) {
  return (
    <div className="mt-2 text-xs">
      <p className="text-tertiary">Aggiunti: {report.added}.</p>
      {report.unknown.length > 0 && (
        <p className="text-error mt-0.5">
          Non trovati tra gli studenti della scuola (controlla l'indirizzo): {report.unknown.join(', ')}
        </p>
      )}
      {report.disabled.length > 0 && (
        <p className="text-secondary mt-0.5">Non più iscritti alla scuola, non aggiunti: {report.disabled.join(', ')}</p>
      )}
    </div>
  );
}

function NewClassForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const year = currentAcademicYear();
  const nextYear = currentAcademicYear(new Date(new Date().getFullYear() + 1, new Date().getMonth(), 1));
  const [name, setName] = useState('');
  const [academicYear, setAcademicYear] = useState(year);
  const [emails, setEmails] = useState('');
  const create = useMutation({
    mutationFn: () => createClass({ name, academic_year: academicYear, emails: parseEmails(emails) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['classes'] }),
  });

  return (
    <div className="mb-6 rounded-xl border border-tertiary/30 bg-surface-container p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-on-surface">Nuova classe</h2>
        <button type="button" onClick={onDone} className="p-1 text-on-surface-variant hover:text-on-surface" title="Chiudi">
          <X size={16} />
        </button>
      </div>
      <p className="mt-1 text-xs text-on-surface-variant">
        Per un gruppo che non esiste in Classroom (recupero, test, gruppi di lavoro). Gli studenti si scelgono tra quelli della scuola, per email.
      </p>
      {!create.data ? (
        <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex-1 text-xs font-medium text-on-surface-variant">
              Nome
              <input value={name} onChange={e => setName(e.target.value)} maxLength={120} required
                className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface focus:border-tertiary/50 focus:outline-none" />
            </label>
            <label className="text-xs font-medium text-on-surface-variant">
              Anno scolastico
              <select value={academicYear} onChange={e => setAcademicYear(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface">
                <option value={year}>{year}</option>
                <option value={nextYear}>{nextYear}</option>
              </select>
            </label>
          </div>
          <label className="block text-xs font-medium text-on-surface-variant">
            Studenti (email, una per riga o separate da virgole; si possono aggiungere anche dopo)
            <textarea value={emails} onChange={e => setEmails(e.target.value)} rows={4}
              placeholder="mario.rossi@marconirovereto.it"
              className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm font-mono text-on-surface focus:border-tertiary/50 focus:outline-none" />
          </label>
          {create.isError && <p className="text-xs text-error">{(create.error as Error).message}</p>}
          <button type="submit" disabled={!name.trim() || create.isPending}
            className="rounded-lg bg-tertiary px-3 py-2 text-sm font-bold text-on-tertiary hover:bg-tertiary/90 disabled:opacity-50">
            {create.isPending ? 'Creazione...' : 'Crea classe'}
          </button>
        </form>
      ) : (
        <div className="mt-3">
          <p className="text-sm text-on-surface">Classe «{name}» creata.</p>
          <MembersReport report={create.data} />
          <button type="button" onClick={onDone} className="mt-3 text-sm font-medium text-tertiary hover:underline">Fatto</button>
        </div>
      )}
    </div>
  );
}

function ClassCard({ cls, askConfirm }: {
  cls: ClassMeta;
  askConfirm: (message: string, onConfirm: () => void, options?: { confirmLabel?: string }) => void;
}) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(cls.name);
  const [emails, setEmails] = useState('');
  const [error, setError] = useState<string | null>(null);
  const manual = (cls.kind ?? 'manual') === 'manual';

  const { data: students, isLoading } = useQuery({
    queryKey: ['class-students', cls.id],
    queryFn: () => getClassStudents(cls.id),
    enabled: expanded,
  });

  const refresh = () => {
    setError(null);
    queryClient.invalidateQueries({ queryKey: ['classes'] });
    queryClient.invalidateQueries({ queryKey: ['class-students', cls.id] });
  };
  const onError = (err: Error) => setError(err.message);
  const rename = useMutation({ mutationFn: () => updateClass(cls.id, { name: newName }),
    onSuccess: () => { setRenaming(false); refresh(); }, onError });
  const archive = useMutation({ mutationFn: (archived: boolean) => updateClass(cls.id, { archived }),
    onSuccess: refresh, onError });
  const remove = useMutation({ mutationFn: () => deleteClass(cls.id), onSuccess: refresh, onError });
  const add = useMutation({ mutationFn: () => addClassStudents(cls.id, parseEmails(emails)),
    onSuccess: () => { setEmails(''); refresh(); }, onError });
  const drop = useMutation({ mutationFn: (studentId: number) => removeClassStudent(cls.id, studentId),
    onSuccess: refresh, onError });

  return (
    <div className={`bg-surface-container rounded-xl border overflow-hidden ${cls.archived ? 'border-outline-variant/20 opacity-75' : 'border-outline-variant/30'}`}>
      <div className="flex items-center justify-between gap-2 p-4">
        <button onClick={() => setExpanded(v => !v)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="w-9 h-9 flex-shrink-0 rounded-lg bg-tertiary/10 flex items-center justify-center">
            <Users size={16} className="text-tertiary" />
          </div>
          <div className="min-w-0">
            {renaming ? null : <p className="font-semibold text-on-surface truncate">{cls.name}</p>}
            <p className="text-xs text-on-surface-variant">
              {cls.academic_year} · {cls.student_count} {cls.student_count === 1 ? 'studente' : 'studenti'} · {KIND_LABEL[cls.kind ?? 'manual']}
              {cls.archived && <span className="ml-1 text-secondary">· archiviata</span>}
            </p>
          </div>
        </button>
        {renaming && (
          <form className="flex flex-1 items-center gap-2" onSubmit={e => { e.preventDefault(); rename.mutate(); }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} maxLength={120}
              className="min-w-0 flex-1 rounded-lg border border-outline-variant/30 bg-surface-container-low px-2 py-1 text-sm text-on-surface" />
            <button type="submit" disabled={!newName.trim() || rename.isPending} className="text-xs font-medium text-tertiary hover:underline">Salva</button>
            <button type="button" onClick={() => { setRenaming(false); setNewName(cls.name); }} className="text-xs text-on-surface-variant hover:underline">Annulla</button>
          </form>
        )}
        <div className="flex flex-shrink-0 items-center gap-1">
          {!renaming && (
            <button type="button" onClick={() => setRenaming(true)} title="Rinomina"
              className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">
              <Pencil size={14} />
            </button>
          )}
          <button type="button" onClick={() => archive.mutate(!cls.archived)} disabled={archive.isPending}
            title={cls.archived ? 'Ripristina' : 'Archivia: sparisce dagli elenchi, la storia resta'}
            className="p-2 rounded-lg text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface">
            {cls.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          </button>
          {!cls.used_in_sessions && (
            <button type="button" title="Elimina"
              onClick={() => askConfirm(`Eliminare la classe «${cls.name}»? Non è usata in nessuna sessione; gli studenti restano nella scuola.`,
                () => remove.mutate(), { confirmLabel: 'Elimina' })}
              className="p-2 rounded-lg text-on-surface-variant hover:bg-error/10 hover:text-error">
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={() => setExpanded(v => !v)} className="p-2 text-on-surface-variant" title={expanded ? 'Chiudi' : 'Apri'}>
            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>
      </div>
      {error && <p className="px-4 pb-3 text-xs text-error">{error}</p>}
      {rename.isPending && <p className="px-4 pb-3 text-xs text-on-surface-variant">Salvataggio...</p>}

      {expanded && (
        <div className="border-t border-outline-variant/20 px-4 py-3">
          {!manual && (
            <p className="mb-2 text-xs text-on-surface-variant">
              Gli studenti vengono da {KIND_LABEL[cls.kind!]}: si cambiano lì e si sincronizzano.
            </p>
          )}
          {isLoading && <p className="text-sm text-on-surface-variant py-2">Caricamento...</p>}
          {students && (
            <ul className="space-y-1.5">
              {students.map(s => (
                <li key={s.id} className="flex items-center gap-3 py-1">
                  <div className="w-7 h-7 rounded-full bg-tertiary/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-xs font-medium text-tertiary">{s.display_name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${s.status === 'active' ? 'text-on-surface' : 'text-on-surface-variant line-through'}`}>{s.display_name}</p>
                    <p className="text-xs text-on-surface-variant truncate">
                      {s.email}
                      {s.status !== 'active' && <span className="ml-1 text-secondary">· non più iscritto alla scuola</span>}
                    </p>
                  </div>
                  {manual && (
                    <button type="button" title="Togli dalla classe" onClick={() => drop.mutate(s.id)} disabled={drop.isPending}
                      className="p-1.5 rounded text-on-surface-variant hover:bg-error/10 hover:text-error">
                      <X size={14} />
                    </button>
                  )}
                </li>
              ))}
              {!students.length && <p className="text-sm text-on-surface-variant">Nessuno studente.</p>}
            </ul>
          )}
          {manual && (
            <form className="mt-3" onSubmit={e => { e.preventDefault(); add.mutate(); }}>
              <label className="block text-xs font-medium text-on-surface-variant">
                Aggiungi studenti (email, una per riga o separate da virgole)
                <textarea value={emails} onChange={e => setEmails(e.target.value)} rows={2}
                  className="mt-1 w-full rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm font-mono text-on-surface focus:border-tertiary/50 focus:outline-none" />
              </label>
              <button type="submit" disabled={!emails.trim() || add.isPending}
                className="mt-1 rounded-lg border border-tertiary/40 px-3 py-1.5 text-xs font-semibold text-tertiary hover:bg-tertiary/10 disabled:opacity-50">
                {add.isPending ? 'Aggiunta...' : 'Aggiungi'}
              </button>
              {add.data && <MembersReport report={add.data} />}
            </form>
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
  const year = currentAcademicYear();
  const [creating, setCreating] = useState(false);
  const [yearFilter, setYearFilter] = useState<string>(year);
  const [showArchived, setShowArchived] = useState(false);
  const { ask: askConfirm, modal: confirmModal } = useConfirmModal();
  const { data: classes, isLoading } = useQuery({
    queryKey: ['classes', 'all'],
    queryFn: () => listClasses(true),
  });

  const years = useMemo(() => Array.from(new Set([year, ...(classes ?? []).map(c => c.academic_year)])).sort().reverse(), [classes, year]);
  const shown = (classes ?? []).filter(c => (yearFilter === 'all' || c.academic_year === yearFilter) && (showArchived || !c.archived));
  const hiddenArchived = (classes ?? []).filter(c => c.archived && (yearFilter === 'all' || c.academic_year === yearFilter)).length;

  return (
    <TeacherLayout pageTitle="Le mie Classi">
      <ClassroomSyncPanel />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select value={yearFilter} onChange={e => setYearFilter(e.target.value)} aria-label="Anno scolastico"
          className="rounded-lg border border-outline-variant/30 bg-surface-container-low px-3 py-2 text-sm text-on-surface">
          {years.map(y => <option key={y} value={y}>{y}{y === year ? ' (in corso)' : ''}</option>)}
          <option value="all">Tutti gli anni</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-on-surface-variant">
          <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
          mostra archiviate{hiddenArchived > 0 && !showArchived ? ` (${hiddenArchived})` : ''}
        </label>
        {!creating && (
          <button type="button" onClick={() => setCreating(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-tertiary px-3 py-2 text-sm font-bold text-on-tertiary hover:bg-tertiary/90">
            <Plus size={14} /> Nuova classe
          </button>
        )}
      </div>
      {creating && <NewClassForm onDone={() => setCreating(false)} />}
      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}
      <div className="space-y-3">
        {shown.map(c => <ClassCard key={c.id} cls={c} askConfirm={askConfirm} />)}
        {!isLoading && !shown.length && (
          <div className="text-center py-16 text-on-surface-variant">
            <p>{classes?.length ? 'Nessuna classe per questo anno.' : 'Nessuna classe: sincronizzane una da Classroom o creane una.'}</p>
          </div>
        )}
      </div>
      {confirmModal}
    </TeacherLayout>
  );
}

export default ClassesPage;
