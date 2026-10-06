export interface PlayerReport { periodIndex: number; report: string; }

export function sortPlayerReports<T extends PlayerReport>(reports: readonly T[]): T[] {
  return [...reports].sort((a, b) => b.periodIndex - a.periodIndex);
}

export function reconcileSelectedReportPeriod(
  selectedPeriod: number | null,
  reports: readonly PlayerReport[],
  previousLatestPeriod: number | null,
): number | null {
  if (reports.length === 0) return null;
  const latestPeriod = Math.max(...reports.map(report => report.periodIndex));
  if (selectedPeriod === null || (previousLatestPeriod !== null && latestPeriod > previousLatestPeriod)) return latestPeriod;
  return reports.some(report => report.periodIndex === selectedPeriod) ? selectedPeriod : latestPeriod;
}

export function getVisiblePlayerReport<T extends PlayerReport>(reports: readonly T[], selectedPeriod: number | null): T | null {
  return reports.find(report => report.periodIndex === selectedPeriod) ?? reports[0] ?? null;
}
