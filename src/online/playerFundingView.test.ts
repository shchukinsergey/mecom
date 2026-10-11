import { describe, expect, it } from 'vitest';
import { checkDecisionBudget, type DecisionBudget } from '../engine/decisionBudget';
import type { FirmOpeningState, LeagueConfig, PeriodMacroParams } from '../engine/types';
import { buildFundingView } from './playerFundingView';

const budget = (totalSpending = 100): DecisionBudget => ({
  type: 'entry-budget-check', openingCash: 200, availableCredit: 1000, resourcesAvailable: 1200,
  costOfProduction: totalSpending, marketing: 0, rnd: 0, depreciation: 0, netInvestment: 0,
  totalSpending, remainingBudget: 1200 - totalSpending, overspend: totalSpending > 1200,
});

describe('buildFundingView', () => {
  it.each([
    [300, 'base', 100, 0, 0],
    [900, 'extra', 500, 200, 0],
    [1400, 'shortage', 500, 500, 200],
  ] as const)('classifies spending %s without forecasting final debt', (spending, classification, ordinaryUsed, expressUsed, shortage) => {
    const view = buildFundingView(budget(spending), { loan: 100 }, { loanLimitBase: 600 });
    expect(view).toMatchObject({ classification, ordinaryUsed, expressUsed, shortage, currentDebt: 100 });
    expect(view.fundingNeed).toBe(spending - 200);
    expect(view.coveragePercent).toBeGreaterThanOrEqual(0);
    expect(view.coveragePercent).toBeLessThanOrEqual(100);
  });

  it('keeps existing express debt separate from new funding need', () => {
    const view = buildFundingView(budget(300), { loan: 800 }, { loanLimitBase: 600 });
    expect(view).toMatchObject({ existingOrdinaryDebt: 600, existingExpressDebt: 200, ordinaryRemaining: 0, expressRemaining: 1000, ordinaryUsed: 0, expressUsed: 100, fundingNeed: 100 });
  });

  it('caps the ordinary residual at the native available credit', () => {
    expect(buildFundingView(budget(), { loan: 100 }, { loanLimitBase: 5000 })).toMatchObject({ ordinaryRemaining: 1000, expressRemaining: 0 });
  });

  it('handles negative opening cash without inventing usable cash', () => {
    const native = { ...budget(300), openingCash: -100, resourcesAvailable: 900, remainingBudget: 600 };
    expect(buildFundingView(native, { loan: 100 }, { loanLimitBase: 600 })).toMatchObject({ cashUsed: 0, fundingNeed: 400, ordinaryUsed: 400, openingCash: -100, resourcesAvailable: 900 });
  });

  it('retains signed investment and excludes it from the positive expense diagram', () => {
    const native = { ...budget(100), costOfProduction: 200, netInvestment: -100 };
    const view = buildFundingView(native, { loan: 100 }, { loanLimitBase: 600 });
    expect(view.totalSpending).toBe(100);
    expect(view.positiveExpenseTotal).toBe(200);
    expect(view.expenses.find(expense => expense.key === 'investment')).toMatchObject({ value: -100, percent: 0 });
    expect(view.cashUsed).toBe(100);
    expect(view.cashRelease).toBe(100);
  });

  it('uses native truncated cash and native rounded available credit for fractional inputs', () => {
    const opening = { machines: 10, period0Machines: 10, cash: 100.9, loan: 20.25, amortFundRemainder: 0 } as FirmOpeningState;
    const macro = { loanLimitAbs: 100.75, loanLimitBase: 80 } as PeriodMacroParams;
    const config = { machineCost: 100, machineLifespanPeriods: 10, costK1: 0, costK2: 10, costOptimalCu: 80, costCuUp: 100, costCuDown: 100 } as LeagueConfig;
    const native = checkDecisionBudget(opening, { price: 30, production: 2, marketing: 100.9, rnd: 5.9, capexGross: 120.9 }, macro, config);
    const view = buildFundingView(native, opening, macro);
    expect(native.openingCash).toBe(100);
    expect(native.availableCredit).toBe(81);
    expect(view.openingCash).toBe(100);
    expect(view.availableCredit).toBe(81);
    expect(view.fundingNeed).toBe(native.totalSpending - 100);
    expect(view.ordinaryRemaining).toBe(59.75);
    expect(view.expressRemaining).toBe(21.25);
    expect(view.totalSpending).toBe(native.totalSpending);
    expect(view.remainingBudget).toBe(native.remainingBudget);
  });

  it('avoids NaN bars when net spending is zero or negative', () => {
    for (const spending of [0, -100]) {
      const view = buildFundingView({ ...budget(spending), costOfProduction: 0, netInvestment: spending }, { loan: 100 }, { loanLimitBase: 600 });
      expect(view.classification).toBe('own');
      expect(view.coveragePercent).toBe(0);
      expect(view.fundingSegments.every(segment => segment.percent === 0)).toBe(true);
      expect(view.expenses.every(expense => expense.percent === 0)).toBe(true);
    }
  });

  it('preserves the native entry-budget totals and uses own cash first', () => {
    const native = budget();
    const view = buildFundingView(native, { loan: 100 }, { loanLimitBase: 600 });
    expect(view.classification).toBe('own');
    expect(view.cashUsed).toBe(100);
    expect(view.totalSpending).toBe(native.totalSpending);
    expect(view.resourcesAvailable).toBe(native.resourcesAvailable);
    expect(view.remainingBudget).toBe(native.remainingBudget);
    expect(view.ordinaryRemaining).toBe(500);
    expect(view.expressRemaining).toBe(500);
  });
});
