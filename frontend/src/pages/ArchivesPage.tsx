import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Download, Trash2 } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import { listArchives, deleteArchive, getArchiveExportUrl } from '../api';

function ArchivesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: archives, isLoading } = useQuery({
    queryKey: ['archives'],
    queryFn: listArchives,
  });

  const deleteMutation = useMutation({
    mutationFn: deleteArchive,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['archives'] }),
  });

  return (
    <TeacherLayout pageTitle="Archivi Punteggi">
      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}
      <div className="space-y-2">
        {archives?.map(a => (
          <div
            key={a.id}
            className="bg-surface-container rounded-xl border border-outline-variant/30 p-4 flex items-center justify-between gap-4 flex-wrap"
          >
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-on-surface truncate">{a.title}</h3>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {new Date(a.archived_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={getArchiveExportUrl(a.id)}
                download
                className="p-2 text-on-surface-variant hover:text-primary transition-colors"
                title="Scarica"
              >
                <Download size={16} />
              </a>
              <button
                onClick={() => navigate(`/teacher/archives/${a.id}`)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
              >
                Apri <ArrowRight size={12} />
              </button>
              <button
                onClick={() => {
                  if (confirm(`Eliminare "${a.title}"?`)) deleteMutation.mutate(a.id);
                }}
                disabled={deleteMutation.isPending}
                className="p-2 text-on-surface-variant hover:text-error transition-colors disabled:opacity-40"
                title="Elimina"
              >
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}
        {!isLoading && !archives?.length && (
          <div className="text-center py-16 text-on-surface-variant">
            <p>Nessun archivio. Archivia una sessione per conservarne i punteggi.</p>
          </div>
        )}
      </div>
    </TeacherLayout>
  );
}

export default ArchivesPage;
