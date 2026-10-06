import { computeUnitCost } from './cost';
import type { FirmDecision, FirmOpeningState, LeagueConfig, PeriodMacroParams } from './types';

/** Entry-budget diagnostic only; this is not a cash-flow or profit forecast. */
export interface DecisionBudget {
  type: 'entry-budget-check';
  openingCash: number;
  availableCredit: number;
  resourcesAvailable: number;
  costOfProduction: number;
  marketing: number;
  rnd: number;
  depreciation: number;
  netInvestment: number;
  totalSpending: number;
  remainingBudget: number;
  overspend: boolean;
}

/** Checks the native decision-entry budget, not final liquidity or profit. */
export function checkDecisionBudget(
  opening: FirmOpeningState,
  decision: Pick<FirmDecision, 'price' | 'production' | 'marketing' | 'capexGross' | 'rnd'>,
  macro: PeriodMacroParams,
  config: LeagueConfig,
): DecisionBudget {
  const production = Math.max(0, decision.production);
  const unitCost = computeUnitCost({
    capacityBase: opening.period0Machines,
    capacityCurrent: opening.machines,
    production,
  }, config);
  const costOfProduction = -Math.trunc(-production * unitCost) || 0;
  const marketing = -Math.trunc(-decision.marketing) || 0;
  const rnd = -Math.trunc(-decision.rnd) || 0;
  const bookValue = opening.machines * config.machineCost + opening.amortFundRemainder;
  const depreciation = nativeRound(bookValue / config.machineLifespanPeriods);
  const netInvestment = -Math.trunc(depreciation - decision.capexGross) || 0;
  const availableCredit = Math.max(0, nativeRound(macro.loanLimitAbs - opening.loan));
  const openingCash = Math.trunc(opening.cash) || 0;
  const resourcesAvailable = openingCash + availableCredit;
  const totalSpending = costOfProduction + marketing + rnd + netInvestment;
  const remainingBudget = resourcesAvailable - totalSpending;

  return {
    type: 'entry-budget-check',
    openingCash,
    availableCredit,
    resourcesAvailable,
    costOfProduction,
    marketing,
    rnd,
    depreciation,
    netInvestment,
    totalSpending,
    remainingBudget,
    overspend: totalSpending > resourcesAvailable,
  };
}

/** Native helper takes an f32 argument, then rounds half away from zero. */
function nativeRound(value: number): number {
  const stored = Math.fround(value);
  return Math.sign(stored) * Math.floor(Math.abs(stored) + 0.5) || 0;
}
