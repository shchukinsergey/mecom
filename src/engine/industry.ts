/**
 * Отраслевая статистика (раздел 9 источника) и изменения к предыдущему периоду.
 */

import type {
  FirmPeriodResult,
  IndustryPeriodResult,
  LeagueConfig,
  PeriodMacroParams,
} from './types';

function pctDelta(current: number, previous: number | undefined): number | null {
  if (previous === undefined || previous === 0) return null;
  return current / previous - 1;
}

export function computeIndustry(
  firms: FirmPeriodResult[],
  macro: PeriodMacroParams,
  previous: IndustryPeriodResult | undefined,
): IndustryPeriodResult {
  const sum = (pick: (f: FirmPeriodResult) => number) =>
    firms.reduce((s, f) => s + pick(f), 0);

  const totalOrders = sum((f) => f.ordersReceived);
  const totalProduced = sum((f) => f.produced);
  const totalSold = sum((f) => f.sold);
  const totalInventory = sum((f) => f.inventoryEnd);
  const totalCapacity = sum((f) => f.fullCapacity);
  const industryRevenue = sum((f) => f.revenue);
  const totalCapex = sum((f) => f.capexBookValue);
  const totalEmployees = sum((f) => f.employed);
  const productionValue = sum((f) => f.produced * f.unitCost);

  const avgPrice = totalSold > 0 ? industryRevenue / totalSold : 0;
  const avgUnitCost = totalProduced > 0 ? productionValue / totalProduced : 0;
  const industryUtilization = totalCapacity > 0 ? totalProduced / totalCapacity : 0;
  const salesPerEmployee = totalEmployees > 0 ? industryRevenue / totalEmployees : 0;

  // Займы в разбивке по траншам — для блока «Экономика», который виден всем.
  let loanAmountBase = 0;
  let loanAmountExtra = 0;
  for (const f of firms) {
    loanAmountBase += Math.min(f.loan, macro.loanLimitBase);
    loanAmountExtra += Math.max(0, f.loan - macro.loanLimitBase);
  }

  return {
    periodIndex: macro.periodIndex,
    totalOrders,
    totalProduced,
    totalSold,
    totalInventory,
    totalCapacity,
    industryRevenue,
    avgPrice,
    avgUnitCost,
    totalCapex,
    industryUtilization,
    totalEmployees,
    salesPerEmployee,

    bankRateBase: macro.bankRateBase,
    loanAmountBase,
    bankRateExtra: macro.bankRateExtra,
    loanAmountExtra,
    taxRate: macro.taxRate,

    deltas: {
      totalOrders: pctDelta(totalOrders, previous?.totalOrders),
      totalProduced: pctDelta(totalProduced, previous?.totalProduced),
      totalSold: pctDelta(totalSold, previous?.totalSold),
      // «Складировано» в отчёте показано изменением в штуках, а не в процентах.
      totalInventory:
        previous === undefined ? null : totalInventory - previous.totalInventory,
      totalCapacity: pctDelta(totalCapacity, previous?.totalCapacity),
      industryRevenue: pctDelta(industryRevenue, previous?.industryRevenue),
      avgPrice: pctDelta(avgPrice, previous?.avgPrice),
      avgUnitCost: pctDelta(avgUnitCost, previous?.avgUnitCost),
      totalCapex: pctDelta(totalCapex, previous?.totalCapex),
      industryUtilization: pctDelta(industryUtilization, previous?.industryUtilization),
      bankRateBase: pctDelta(macro.bankRateBase, previous?.bankRateBase),
      loanAmountBase: pctDelta(loanAmountBase, previous?.loanAmountBase),
    },
  };
}

/** Native expense stores float32 before signed half-away rounding and after it. */
export function computeFiringPenalty(previous: number, current: number, config: LeagueConfig): number {
  const expense = Math.max(0, previous - current) * config.firingPenaltyPerEmployee;
  if (config.employmentModel === 'legacy') return expense;
  const value = Math.fround(expense);
  return Math.fround(Math.sign(value) * Math.floor(Math.abs(value) + 0.5));
}

/** Native B[5] is current capacity, not the capacity after this period's capex. */
export function computeEmployees(production: number, currentCapacity: number, config: LeagueConfig): number {
  const q = Math.max(0, production);
  if (config.employmentModel === 'legacy') {
    return Math.round(config.baseStaff + q * config.staffPerUnit);
  }
  if (!(currentCapacity > 0) || !(config.staffingSizeDivisor > 0)) {
    throw new RangeError('Native employment requires positive capacity and staffingSizeDivisor.');
  }
  // Multiply before division: avoid premature binary64 rounding at integer boundaries.
  return Math.fround(Math.ceil(q * (100 + Math.ceil(q / config.staffingSizeDivisor)) / currentCapacity));
}
