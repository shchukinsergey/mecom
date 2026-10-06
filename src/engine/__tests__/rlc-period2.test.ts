/**
 * Регрессия на реальный отчёт фирмы «RLC» за 2-й период (раздел 0 источника,
 * скриншот с mecom.modam.ru). Дополнительные нативные эталоны HERMES1/TEST2
 * хранятся в data/calibration; этот тест остаётся независимой регрессией.
 *
 * Часть входного состояния в отчёте не видна и восстановлена из тождества
 * баланса на начало периода:
 *   cash₀ + склад₀ + капвложения₀ = заём₀ + накопл.прибыль₀ + капитал
 *   cash₀ + 0 + (873×40 + 30)     = 80002 + (−1753 − 16389) + 21000
 *   cash₀ = 82860 − 34950 = 47910
 * Остаток в амортфонде 30 восстановлен из капвложений: 48153 − 1203×40 = 33,
 * из которых 3 — остаток текущего периода (13203 − 330×40).
 *
 * Для P&L допуск ±3 $ из-за округлённой себестоимости в отчёте. Амортизация
 * теперь проверяется точно: round((873×40 + 30)×5%) = $1 748; остаток = $33.
 */

import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAGUE_CONFIG, makeMacroParams } from '../config';
import { computeCapex } from '../capex';
import { computePnl, computeBankInterest } from '../pnl';
import { computeCashFlow } from '../cashflow';
import { assertBalanceIdentity, computeBalance } from '../balance';
import type { LeagueConfig, PeriodMacroParams } from '../types';

// ── Входные данные из отчёта ────────────────────────────────────────────────
const MACHINES_OPENING = 873;
const AMORT_FUND_OPENING = 30;
const CASH_OPENING = 47910;
const LOAN_OPENING = 80002;
const RETAINED_OPENING = -18142; // −1753 − 16389
const CAPITAL = 21000;

const PRODUCTION = 698;
const SOLD = 698;
const UNIT_COST = 17.61; // из отчёта: формулу себестоимости проверить не на чем
const REVENUE = 67706;
const MARKETING = 7890;
const RND = 14524;
const CAPEX_GROSS = 14951;

const config: LeagueConfig = {
  ...DEFAULT_LEAGUE_CONFIG,
  // Этот архивный RLC эталон был снят до режима preRevenue.
  featureFlags: { ...DEFAULT_LEAGUE_CONFIG.featureFlags, loanRepayment: 'none' },
  // Ставки конкретной партии RLC — из блока «Экономика» отчёта.
  serviceFee: 0.01,
};

const macro: PeriodMacroParams = {
  ...makeMacroParams(2),
  taxRate: 0.32,
  bankRateBase: 0.2,
  bankRateExtra: 0.8,
  loanLimitBase: 60000,
  loanLimitAbs: 100000,
};

const TOL = 3;

describe('Регрессия: отчёт фирмы RLC за 2-й период', () => {
  const capex = computeCapex(
    {
      machines: MACHINES_OPENING,
      capexGross: CAPEX_GROSS,
      amortFundRemainder: AMORT_FUND_OPENING,
    },
    config,
  );

  // Заём за период не меняется (newBorrowing = 0, см. ниже), поэтому входящий
  // и закрывающий остаток совпадают — процент можно посчитать один раз, без
  // итерации (та в этом случае сошлась бы за первый же шаг).
  const openingBankInterest = computeBankInterest(
    {
      openingLoan: LOAN_OPENING,
      loanLimitBase: macro.loanLimitBase,
      bankRateBase: macro.bankRateBase,
      bankRateExtra: macro.bankRateExtra,
    },
    config,
  );

  const pnl = computePnl(
    {
      price: REVENUE / SOLD,
      sold: SOLD,
      produced: PRODUCTION,
      unitCost: UNIT_COST,
      inventoryOpening: 0,
      inventoryOpeningUnitCost: 0,
      inventoryAgedUnits: 0,
      marketing: MARKETING,
      rnd: RND,
      depreciation: capex.depreciation,
      employeesPrevious: 0,
      employeesCurrent: 0,
      bankInterest: openingBankInterest,
    },
    macro,
    config,
  );

  const cf = computeCashFlow(
    {
      openingCash: CASH_OPENING,
      openingLoan: LOAN_OPENING,
      revenue: pnl.revenue,
      produced: PRODUCTION,
      unitCost: UNIT_COST,
      marketing: MARKETING,
      rnd: RND,
      capexGross: CAPEX_GROSS,
      firingPenalty: pnl.firingPenalty,
      storageCost: pnl.storageCost,
      bankInterest: pnl.bankInterest,
      tax: pnl.tax,
      isBankrupt: false,
    },
    macro,
    config,
  );

  const balance = computeBalance({
    cash: cf.cash,
    inventoryUnits: 0,
    inventoryUnitCost: pnl.inventoryUnitCostEnd,
    capexBookValue: capex.capexBookValue,
    loan: cf.loan,
    retainedEarningsOpening: RETAINED_OPENING,
    netProfit: pnl.netProfit,
    capital: CAPITAL,
  });

  it('амортизация полной балансовой стоимости совпадает с отчётом: $1748', () => {
    expect(capex.depreciation).toBe(1748);
  });

  it('инвестиции-брутто = амортизация + доп. вложения', () => {
    expect(capex.capexAdditions).toBe(13200); // 330 станков × $40
    expect(Math.abs(capex.depreciation + 13203 - CAPEX_GROSS)).toBeLessThanOrEqual(TOL);
  });

  it('мощность следующего периода = 1203 станка', () => {
    expect(capex.capacityNext).toBe(1203);
    expect(capex.newMachines).toBe(330);
  });

  it('остаток в амортфонде накапливается: 30 + 3 = 33', () => {
    expect(capex.amortFundRemainder).toBe(33); // 14951 − 1748 + 30 − 13200
  });

  it('СЕБЕСТ = продано × себестоимость (склад пуст)', () => {
    expect(Math.abs(pnl.cogs - 12293)).toBeLessThanOrEqual(TOL);
  });

  it('валовый доход = выручка − СЕБЕСТ', () => {
    expect(Math.abs(pnl.grossProfit - 55413)).toBeLessThanOrEqual(TOL);
  });

  it('банковский процент считается по траншам, а не плоской ставкой', () => {
    // 60000 × (20%+1%)/4 + 20002 × 80%/4 = 3150 + 4000,4
    expect(Math.abs(pnl.bankInterest - 7150)).toBeLessThanOrEqual(TOL);

    // Плоские 20% из упрощённого конспекта дали бы совсем другое число.
    const flat = computeBankInterest(
      {
        openingLoan: LOAN_OPENING,
        loanLimitBase: macro.loanLimitBase,
        bankRateBase: macro.bankRateBase,
        bankRateExtra: macro.bankRateExtra,
      },
      { ...config, featureFlags: { ...config.featureFlags, bankInterestFormula: 'flatLoanRate' } },
    );
    expect(Math.abs(flat - 7150)).toBeGreaterThan(1000);
  });

  it('прибыль до налога, налог 32% и чистая прибыль', () => {
    expect(Math.abs(pnl.profitBeforeTax - 24101)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(pnl.tax - 7712)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(pnl.netProfit - 16389)).toBeLessThanOrEqual(TOL);
  });

  it('наличные на конец периода = $51 096', () => {
    expect(Math.abs(cf.cash - 51096)).toBeLessThanOrEqual(TOL);
    expect(cf.newBorrowing).toBe(0); // заём за период не изменился
    expect(cf.loan).toBe(LOAN_OPENING);
  });

  it('капвложения в балансе = $48 153', () => {
    expect(Math.abs(capex.capexBookValue - 48153)).toBeLessThanOrEqual(TOL);
  });

  it('суммарный актив = пассив + капитал = $99 249', () => {
    expect(Math.abs(balance.totalAssets - 99249)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(balance.totalLiabEquity - 99249)).toBeLessThanOrEqual(TOL);
    expect(Math.abs(balance.retainedEarnings - -1753)).toBeLessThanOrEqual(TOL);
    expect(() => assertBalanceIdentity(balance, 0.01)).not.toThrow();
  });

  it('использование мощности = 698/873 = 80.0%, а не 698/1203', () => {
    const utilization = PRODUCTION / MACHINES_OPENING;
    expect(utilization * 100).toBeCloseTo(80.0, 1);
    expect((PRODUCTION / capex.capacityNext) * 100).toBeCloseTo(58.0, 0);
  });
});
