/** Сборка отчётов для экспорта. */

import type { FirmPeriodResult, LeagueConfig, PeriodResults } from '../engine/types';
import { renderFirmReport } from './firmReport';
import { renderIndustryReport } from './industryReport';

export { renderFirmReport, wrapText, FIRM_REPORT_WIDTH } from './firmReport';
export {
  renderIndustryReport,
  renderIndustryStats,
  renderComparisonTable,
  INDUSTRY_REPORT_WIDTH,
} from './industryReport';
export {
  renderMasterReport,
  renderMasterTable,
  renderRankings,
  MASTER_REPORT_WIDTH,
} from './masterReport';
export * from './format';

/**
 * Полный экспорт для одной фирмы: её приватный отчёт плюс публичный отраслевой
 * блок под ним — как в оригинале. Это дефолтный вариант рассылки.
 */
export function renderFirmExport(
  firm: FirmPeriodResult,
  period: PeriodResults,
  config: LeagueConfig,
  leagueName: string,
  includeIndustry = true,
): string {
  const parts = [renderFirmReport(firm, period, config, leagueName)];
  if (includeIndustry) parts.push('', renderIndustryReport(period, leagueName));
  return parts.join('\n');
}
