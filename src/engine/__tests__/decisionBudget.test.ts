import { describe, expect, it } from 'vitest';
import { checkDecisionBudget } from '../decisionBudget';
import type { FirmDecision, FirmOpeningState, LeagueConfig, PeriodMacroParams } from '../types';

const opening = {
  period0Machines: 10, machines: 10, cash: 100, loan: 20, amortFundRemainder: 0,
} as FirmOpeningState;
const decision = {
  production: 2, marketing: 10, rnd: 5, capexGross: 20,
} as FirmDecision;
const macro = { loanLimitAbs: 100 } as PeriodMacroParams;
const config = {
  machineCost: 100, machineLifespanPeriods: 10,
  costK1: 0, costK2: 10, costOptimalCu: 80, costCuUp: 100, costCuDown: 100,
} as LeagueConfig;

describe('checkDecisionBudget', () => {
  it('checks entry spending against cash and remaining absolute credit', () => {
    const result = checkDecisionBudget(opening, decision, macro, config);
    expect(result).toMatchObject({
      type: 'entry-budget-check', openingCash: 100, availableCredit: 80,
      resourcesAvailable: 180, costOfProduction: 92,
      marketing: 10, rnd: 5, depreciation: 100, netInvestment: -80,
      totalSpending: 27, remainingBudget: 153, overspend: false,
    });
  });

  it('does not make available credit negative when opening loan exceeds limit', () => {
    const result = checkDecisionBudget({ ...opening, loan: 120 }, decision, macro, config);
    expect(result.resourcesAvailable).toBe(100);
    expect(result.availableCredit).toBe(0);
  });

  it('marks overspend only when total spending exceeds resources', () => {
    const result = checkDecisionBudget(opening, { ...decision, marketing: 200 } as FirmDecision, macro, config);
    expect(result.overspend).toBe(true);
    expect(result.remainingBudget).toBeLessThan(0);
  });
});
