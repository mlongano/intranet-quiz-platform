/**
 * Pure statistics helpers for score analysis.
 * Extracted from local-quizzies AdminScoresBankReviewPage.
 */

export function quantile(sortedValues: number[], q: number) {
  if (sortedValues.length === 0) return 0;
  const pos = (sortedValues.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sortedValues[base + 1] !== undefined
    ? sortedValues[base] + rest * (sortedValues[base + 1] - sortedValues[base])
    : sortedValues[base];
}

export function roundStat(value: number, digits = 2) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

export interface ScoreStats {
  totalStudents: number;
  completedStudents: number;
  values: number[];
  avgScore: number;
  median: number;
  q1: number;
  q3: number;
  iqr: number;
  skewness: number;
  kurtosis: number;
  outlierCount: number;
  outliers: number[];
}

export function computeStats(percents: number[]): ScoreStats | null {
  const values = percents.filter(v => Number.isFinite(v));
  if (values.length === 0) return null;

  const totalStudents = percents.length;
  const completedStudents = percents.filter(p => p > 0).length;
  const sorted = [...values].sort((a, b) => a - b);
  const avgScore = values.reduce((sum, v) => sum + v, 0) / values.length;
  const median = quantile(sorted, 0.5);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;
  const outliers = values.filter(v => v < lowerFence || v > upperFence);

  // Bias-corrected skewness
  const n = values.length;
  const m2 = values.reduce((sum, v) => sum + (v - avgScore) ** 2, 0) / n;
  const m3 = values.reduce((sum, v) => sum + (v - avgScore) ** 3, 0) / n;
  const m4 = values.reduce((sum, v) => sum + (v - avgScore) ** 4, 0) / n;
  const rawSkewness = m2 > 0 ? m3 / (m2 ** 1.5) : 0;
  const rawKurtosis = m2 > 0 ? m4 / (m2 ** 2) - 3 : 0;
  const skewness = n > 2 ? Math.sqrt(n * (n - 1)) / (n - 2) * rawSkewness : 0;
  const kurtosis = n > 3 ? ((n - 1) / ((n - 2) * (n - 3))) * ((n + 1) * rawKurtosis + 6) : 0;

  return {
    totalStudents,
    completedStudents,
    values,
    avgScore: roundStat(avgScore, 1),
    median: roundStat(median, 1),
    q1: roundStat(q1, 1),
    q3: roundStat(q3, 1),
    iqr: roundStat(iqr, 1),
    skewness: roundStat(skewness, 2),
    kurtosis: roundStat(kurtosis, 2),
    outlierCount: outliers.length,
    outliers: outliers.map(v => roundStat(v, 1)),
  };
}
