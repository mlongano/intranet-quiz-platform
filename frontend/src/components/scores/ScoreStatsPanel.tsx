import { type ScoreStats } from '../../lib/scoreStats';

function DistributionChart({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const bins = Array.from({ length: 10 }, (_, i) => ({ start: i * 10, end: (i + 1) * 10, count: 0 }));
  values.forEach(value => {
    const idx = Math.min(9, Math.max(0, Math.floor(value / 10)));
    bins[idx].count += 1;
  });
  const maxCount = Math.max(...bins.map(b => b.count), 1);

  return (
    <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-4">
      <div className="text-sm font-semibold text-on-surface mb-3">Distribuzione punteggi</div>
      <div className="flex items-end gap-1 h-28">
        {bins.map(bin => (
          <div key={bin.start} className="flex-1 h-full flex flex-col items-center gap-1">
            <div className="w-full flex-1 flex items-end">
              <div
                className="w-full rounded-t bg-primary/70 border border-primary/30 min-h-1"
                style={{ height: `${(bin.count / maxCount) * 100}%` }}
                title={`${bin.start}-${bin.end}%: ${bin.count}`}
              />
            </div>
            <span className="text-[10px] text-on-surface-variant">{bin.start}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BoxPlot({ values }: { values: number[] }) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const q1 = (() => { const p = (sorted.length - 1) * 0.25; const b = Math.floor(p); return sorted[b] + (p - b) * ((sorted[b + 1] ?? sorted[b]) - sorted[b]); })();
  const median = (() => { const p = (sorted.length - 1) * 0.5; const b = Math.floor(p); return sorted[b] + (p - b) * ((sorted[b + 1] ?? sorted[b]) - sorted[b]); })();
  const q3 = (() => { const p = (sorted.length - 1) * 0.75; const b = Math.floor(p); return sorted[b] + (p - b) * ((sorted[b + 1] ?? sorted[b]) - sorted[b]); })();
  const max = sorted[sorted.length - 1];
  const pct = (v: number) => `${Math.max(0, Math.min(100, v))}%`;

  return (
    <div className="bg-surface-container border border-outline-variant/20 rounded-xl p-4">
      <div className="text-sm font-semibold text-on-surface mb-3">Box plot</div>
      <div className="relative h-12">
        <div className="absolute top-1/2 left-0 right-0 h-px bg-outline-variant/60" />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-on-surface-variant" style={{ left: pct(min) }} title={`Min ${min.toFixed(1)}%`} />
        <div className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-on-surface-variant" style={{ left: pct(max) }} title={`Max ${max.toFixed(1)}%`} />
        <div
          className="absolute top-1/2 h-7 -translate-y-1/2 rounded border border-secondary/50 bg-secondary/10"
          style={{ left: pct(q1), width: pct(q3 - q1) }}
          title={`IQR ${q1.toFixed(1)}%-${q3.toFixed(1)}%`}
        />
        <div className="absolute top-1/2 h-8 w-0.5 -translate-y-1/2 bg-secondary" style={{ left: pct(median) }} title={`Mediana ${median.toFixed(1)}%`} />
      </div>
      <div className="flex justify-between text-[10px] text-on-surface-variant mt-1">
        <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
      </div>
    </div>
  );
}

function StatGrid({ stats }: { stats: ScoreStats }) {
  const items: { label: string; value: string | number; color?: string }[] = [
    { label: 'Studenti', value: stats.totalStudents },
    { label: 'Completati', value: stats.completedStudents },
    { label: 'Media', value: `${stats.avgScore}%`, color: 'text-primary' },
    { label: 'Mediana', value: `${stats.median}%`, color: 'text-primary' },
    { label: 'IQR', value: stats.iqr, color: 'text-secondary' },
    { label: 'Asimmetria', value: stats.skewness, color: 'text-secondary' },
    { label: 'Curtosi', value: stats.kurtosis, color: 'text-secondary' },
    { label: 'Outlier', value: stats.outlierCount, color: stats.outlierCount > 0 ? 'text-secondary' : 'text-tertiary' },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 p-4 bg-surface-container-low border border-outline-variant/20 rounded-xl">
      {items.map(item => (
        <div key={item.label} className="text-center">
          <div className={`text-2xl font-bold ${item.color ?? 'text-on-surface'}`}>{item.value}</div>
          <div className="text-sm text-on-surface-variant">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

/** Summary stats + distribution histogram + box plot for a session's scores. */
function ScoreStatsPanel({ stats }: { stats: ScoreStats }) {
  return (
    <div className="mb-6 space-y-4">
      <StatGrid stats={stats} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DistributionChart values={stats.values} />
        <BoxPlot values={stats.values} />
      </div>
    </div>
  );
}

export default ScoreStatsPanel;
