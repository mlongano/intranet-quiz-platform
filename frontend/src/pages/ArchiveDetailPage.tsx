import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Download } from 'lucide-react';
import TeacherLayout from '../layouts/TeacherLayout';
import { getArchive, getArchiveExportUrl, ScoreEntry } from '../api';

function ScoreRow({ score }: { score: ScoreEntry }) {
  const pct = score.percent;
  const color = pct >= 60 ? 'text-primary' : pct >= 40 ? 'text-secondary' : 'text-error';
  return (
    <div className="bg-surface-container rounded-lg border border-outline-variant/30 p-4 flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="font-medium text-on-surface truncate">
          {score.student_display_name ?? score.student_email ?? score.student ?? '—'}
        </p>
        <p className="text-xs text-on-surface-variant truncate">
          {score.student_email ?? score.student}
          {score.submitted_at && (
            <span className="ml-2">
              · {new Date(score.submitted_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </p>
      </div>
      <div className="text-right flex-shrink-0">
        <p className={`text-lg font-bold ${color}`}>{pct.toFixed(1)}%</p>
        <p className="text-xs text-on-surface-variant">{score.raw_points.toFixed(1)} / {score.max_points.toFixed(1)}</p>
      </div>
    </div>
  );
}

function ArchiveDetailPage() {
  const { archiveId } = useParams<{ archiveId: string }>();
  const navigate = useNavigate();
  const id = Number(archiveId);

  const { data: archive, isLoading } = useQuery({
    queryKey: ['archive', id],
    queryFn: () => getArchive(id),
    enabled: !!id,
  });

  const scores = archive?.content ?? [];
  const avg = scores.length
    ? scores.reduce((sum, s) => sum + s.percent, 0) / scores.length
    : null;

  return (
    <TeacherLayout pageTitle={archive?.title ?? 'Archivio'}>
      <div className="mb-6 flex items-center justify-between">
        <button
          onClick={() => navigate('/teacher/archives')}
          className="flex items-center gap-2 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <ArrowLeft size={14} /> Archivi
        </button>
        {archive && (
          <a
            href={getArchiveExportUrl(id)}
            download
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-outline-variant/40 text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
          >
            <Download size={14} />
            Esporta
          </a>
        )}
      </div>

      {archive && (
        <div className="bg-surface-container rounded-xl border border-outline-variant/30 p-5 mb-6 inline-flex gap-8">
          <div>
            <p className="text-sm text-on-surface-variant">Partecipanti</p>
            <p className="text-3xl font-bold text-on-surface">{scores.length}</p>
          </div>
          {avg !== null && (
            <div>
              <p className="text-sm text-on-surface-variant">Media</p>
              <p className={`text-3xl font-bold ${avg >= 60 ? 'text-primary' : avg >= 40 ? 'text-secondary' : 'text-error'}`}>
                {avg.toFixed(1)}%
              </p>
            </div>
          )}
          <div>
            <p className="text-sm text-on-surface-variant">Archiviato il</p>
            <p className="text-sm font-medium text-on-surface mt-1">
              {archive.archived_at && new Date(archive.archived_at).toLocaleDateString('it-IT', {
                day: 'numeric', month: 'long', year: 'numeric',
              })}
            </p>
          </div>
        </div>
      )}

      {isLoading && <p className="text-on-surface-variant">Caricamento...</p>}

      <div className="space-y-2">
        {scores
          .slice()
          .sort((a, b) => b.percent - a.percent)
          .map((score, i) => (
            <ScoreRow key={score.id ?? i} score={score} />
          ))}
        {!isLoading && !scores.length && (
          <p className="text-center py-12 text-on-surface-variant">Nessun punteggio in questo archivio.</p>
        )}
      </div>
    </TeacherLayout>
  );
}

export default ArchiveDetailPage;
