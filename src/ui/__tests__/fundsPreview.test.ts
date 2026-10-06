/** Native entry-budget invariants. Edge cases are arithmetic transcription, not observed screens. */
import { describe, expect, it } from 'vitest';
import { estimateFunds, fundsLevel } from '../fundsPreview';
import { computeCashFlow } from '../../engine/cashflow';
import { computeUnitCost } from '../../engine/cost';
import { DEFAULT_LEAGUE_CONFIG, makeMacroParams } from '../../engine/config';
import type { FirmDecision, FirmOpeningState } from '../../engine/types';

const config = DEFAULT_LEAGUE_CONFIG;
const macro = { ...makeMacroParams(1), loanLimitBase: 60000, loanLimitAbs: 100000 };

function opening(overrides: Partial<FirmOpeningState> = {}): FirmOpeningState {
  return {
    firmId: 'f1',
    machines: 525,
    period0Machines: 525,
    cash: 9030,
    loan: 9030,
    retainedEarnings: 0,
    capital: 21000,
    inventory: 0,
    inventoryUnitCost: 0,
    inventoryAgedUnits: 0,
    amortFundRemainder: 0,
    employees: 420,
    rndCumulative: 420,
    rndDecayStock: 0,
    retainedEarningsBase: 0,
    productionPrevious: 0,
    sharePrevious: 0,
    isBankrupt: false,
    ...overrides,
  };
}

function decision(overrides: Partial<FirmDecision> = {}): FirmDecision {
  return { firmId: 'f1', price: 35, production: 420, marketing: 2000, capexGross: 1050, rnd: 500, ...overrides };
}

it('reproduces HERMES1 firm8 entering p2 native decision dialog (not settled cashflow)', () => {
  const p = estimateFunds(opening({ machines: 1100, period0Machines: 525, cash: 8216,
    loan: 44856, employees: 84 }), decision({ production: 420, marketing: 15000,
    capexGross: 24050, rnd: 1000 }), macro, config);
  expect(p.costOfProduction).toBe(14402);
  expect(p).toMatchObject({ availableCredit: 55144, totalFunds: 63360,
    depreciation: 2200, netInvestment: 21850, outflow: 52252,
    remaining: 11108, cashRemaining: 0, creditRemaining: 11108 });
});

describe('native entry-budget arithmetic (synthetic branch checks)', () => {
  it.each([[-1000, -3200], [0, -2200], [2200, 0]])('credits depreciation with gross capex %s', (capexGross, netInvestment) => {
    const p = estimateFunds(opening({ machines: 1100 }), decision({ production: 0,
      marketing: 0, rnd: 0, capexGross }), macro, config);
    expect(p.depreciation).toBe(2200);
    expect(p.netInvestment).toBe(netInvestment);
    expect(p.outflow).toBe(netInvestment);
  });

  it('truncates each signed expense before summation, including negative net investment', () => {
    const p = estimateFunds(opening({ cash: 100.75 }), decision({ production: 0,
      marketing: 1.9, rnd: 2.9, capexGross: 1049.1 }), macro, config);
    expect(p).toMatchObject({ marketing: 1, rnd: 2, netInvestment: 0,
      outflow: 3, totalFunds: 91070, cashRemaining: 97, creditRemaining: 90970, remaining: 91067 });
    const charge = estimateFunds(opening(), decision({ production: 0, marketing: 0,
      rnd: 0, capexGross: 1050.9 }), macro, config);
    expect(charge.netInvestment).toBe(0);
  });

  it.each([[99999.5, 1], [100000.5, -1], [100000.49999999, -1]])('rounds f32 credit half away from zero for debt %s', (loan, availableCredit) => {
    const p = estimateFunds(opening({ loan }), decision({ production: 0, marketing: 0,
      rnd: 0, capexGross: 1050 }), macro, config);
    expect(p.availableCredit).toBe(availableCredit);
  });

  it('native signed integer conversion produces zero, never JavaScript negative zero', () => {
    const p = estimateFunds(opening({ cash: 0.5, loan: 100000 }), decision({ production: 0,
      marketing: 1, rnd: 0, capexGross: 1050 }), macro, config);
    expect(p.creditRemaining).toBe(0);
    expect(p.remaining).toBe(0);
    const deficit = estimateFunds(opening({ cash: -0.5, loan: 100000 }), decision({ production: 0,
      marketing: 0, rnd: 0, capexGross: 1050 }), macro, config);
    expect(deficit.totalFunds).toBe(0);
  });

  it('keeps negative over-limit credit and spends cash first', () => {
    const p = estimateFunds(opening({ cash: 500, loan: 120000 }), decision({ production: 0,
      marketing: 100, rnd: 0, capexGross: 1050 }), macro, config);
    expect(p).toMatchObject({ availableCredit: -20000, totalFunds: -19500,
      cashRemaining: 400, creditRemaining: -20000, remaining: -19600 });
  });

  it.each([[1000, 0, 50000], [1250, 0, 49750], [500, 500, 50000]])('cash-first split with outflow %s', (marketing, cashRemaining, creditRemaining) => {
    const p = estimateFunds(opening({ cash: 1000, loan: 50000 }), decision({ production: 0,
      marketing, rnd: 0, capexGross: 1050 }), macro, config);
    expect(p.cashRemaining).toBe(cashRemaining);
    expect(p.creditRemaining).toBe(creditRemaining);
    expect(p.remaining).toBe(cashRemaining + creditRemaining);
  });

  it('rounds depreciation after f32 conversion, including amortization remainder', () => {
    const p = estimateFunds(opening({ amortFundRemainder: 9.9999998 }),
      decision({ production: 0, marketing: 0, rnd: 0, capexGross: 1051 }), macro, config);
    expect(p.depreciation).toBe(1051);
    expect(p.netInvestment).toBe(0);
  });

  it('does not deduct firing/storage/interest, which still create a settled zero-revenue shortfall', () => {
    const state = opening({ cash: 0, loan: 100000, inventoryAgedUnits: 10, employees: 84 });
    const d = decision({ production: 0, marketing: 0, rnd: 0, capexGross: 1050 });
    const p = estimateFunds(state, d, macro, config);
    expect(p).toMatchObject({ firingPenalty: 840, storageCost: 10, outflow: 0, remaining: 0 });
    expect(p.bankInterest).toBeGreaterThan(0);
    const cf = computeCashFlow({ openingCash: 0, openingLoan: state.loan, revenue: 0,
      produced: 0, unitCost: 0, marketing: 0, rnd: 0, capexGross: d.capexGross,
      firingPenalty: p.firingPenalty, storageCost: p.storageCost, bankInterest: p.bankInterest,
      tax: 0, isBankrupt: false }, macro, config);
    expect(cf.unfundedShortfall).toBeGreaterThan(0);
  });

  it('retains explicitly custom denominators and uses raw rather than cent-rounded unit cost', () => {
    const state = opening({ machines: 1100 });
    const d = decision({ production: 400 });
    const custom = { ...config, costCuUp: 147, costCuDown: 73.5 };
    const raw = computeUnitCost({ capacityBase: 525, capacityCurrent: 1100, production: 400 }, custom);
    const p = estimateFunds(state, d, macro, custom);
    expect(p.costOfProduction).toBe(Math.trunc(raw * 400));
    expect(p.costOfProduction).not.toBe(Math.trunc(Math.round(raw * 100) / 100 * 400));
    expect(config.costCuUp).toBe(10000 / 69);
    expect(config.costCuDown).toBe(10000 / 138);
    expect(computeUnitCost({ capacityBase: 525, capacityCurrent: 525, production: 525 }, config)).toBeCloseTo(20.76, 12);
  });
});

describe('fundsLevel — пороги подсветки', () => {
  it('отрицательный остаток — всегда negative', () => {
    const preview = estimateFunds(opening({ cash: 0, loan: 99000 }), decision({ capexGross: 20000 }), macro, config);
    expect(preview.remaining).toBeLessThan(0);
    expect(fundsLevel(preview)).toBe('negative');
  });

  it('остаток меньше 15% от суммарных средств — low', () => {
    const preview = estimateFunds(opening(), decision({ marketing: 0, rnd: 0, capexGross: 1050, production: 0 }), macro, config);
    // Подгонка не нужна: просто проверяем сам порог на синтетических числах.
    const synthetic = { ...preview, totalFunds: 1000, remaining: 100 };
    expect(fundsLevel(synthetic)).toBe('low');
  });

  it('остаток от 15% и выше — ok', () => {
    const preview = estimateFunds(opening(), decision(), macro, config);
    const synthetic = { ...preview, totalFunds: 1000, remaining: 150 };
    expect(fundsLevel(synthetic)).toBe('ok');
  });
});
