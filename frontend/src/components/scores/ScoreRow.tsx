import { ChevronRight } from 'lucide-react';
import { type ScoreEntry } from '../../api';

interface Props {
  score: ScoreEntry;
  onClick: () => void;
}

function ScoreRow({ score, onClick }: Props) {
  const pct = score.percent;
  const color = pct >= 60 ? 'text-primary' : pct >= 40 ? 'text-secondary' : 'text-error';
  const hasPending = (score.grading_complete === false)
    || (score.answers?.some(a => a.type === 'open' && a.llm_status === 'pending') ?? false);
  const pendingWeight = score.pending_open_weight
    ?? (score.answers?.filter(a => a.type === 'open' && a.llm_status === 'pending')
        .reduce((s, a) => s + (a.weight || 0), 0) ?? 0);
  const pendingCount = score.pending_open_count
    ?? (score.answers?.filter(a => a.type === 'open' && a.llm_status === 'pending').length ?? 0);
  return (
    <button
      onClick={onClick}
      className="w-full bg-surface-container rounded-lg border border-outline-variant/30 p-4 flex items-center justify-between gap-4 hover:bg-surface-container-high transition-colors text-left"
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium text-on-surface truncate">{score.student_display_name ?? score.student_email ?? score.student ?? '—'}</p>
        <p className="text-xs text-on-surface-variant truncate">{score.student_email ?? score.student}</p>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-right">
          <p className={`text-lg font-bold ${color}`}>{pct.toFixed(1)}%</p>
          <p className="text-xs text-on-surface-variant">{score.raw_points.toFixed(1)} / {score.max_points.toFixed(1)}</p>
          {hasPending && (
            <p className="text-[11px] font-semibold text-secondary leading-tight">
              provvisorio{pendingCount > 0 ? ` — ${pendingCount} risposte (${pendingWeight} pt)` : ''}
            </p>
          )}
        </div>
        <ChevronRight size={16} className="text-on-surface-variant" />
      </div>
    </button>
  );
}

export default ScoreRow;
