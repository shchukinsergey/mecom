import type { PeriodResults } from '../src/engine/types.ts';
import type { PublicHistoryPeriod } from '../src/online/roomTypes.ts';

/** Project only metrics already published in the public industry report. */
export function buildPublicHistory(results: PeriodResults[]): PublicHistoryPeriod[] {
  return results.map(period => ({
    periodIndex: period.periodIndex,
    firms: period.firms.map(firm => ({
      firmId: firm.firmId,
      firmName: firm.firmName,
      ...(firm.nativeBankruptcy ? { excluded: true as const } : {}),
      rif: firm.rif.total,
      netProfit: firm.netProfit,
      marketShareSold: firm.marketShareSold,
      revenue: firm.revenue,
      retainedEarnings: firm.retainedEarnings,
    })),
  })).sort((a, b) => a.periodIndex - b.periodIndex);
}
