import { describe, expect, it } from 'vitest';
import { computeCashFlow, computePreRevenueFinancing, type CashFlowInput } from '../cashflow';
import nativeReports from '../../../data/calibration/hermes1-original.json';
import { computeCapex } from '../capex';
import { resolvePnlAndCashFlow } from '../computePeriod';
import { computeBankInterest } from '../pnl';
import { assertBalanceIdentity, computeBalance } from '../balance';
import { DEFAULT_LEAGUE_CONFIG, makeMacroParams } from '../config';
import type { LeagueConfig } from '../types';

const config: LeagueConfig = DEFAULT_LEAGUE_CONFIG;
const macro = makeMacroParams(3);
const input = (overrides: Partial<CashFlowInput> = {}): CashFlowInput => ({
  openingCash: 19517, openingLoan: 27758, revenue: 23500,
  produced: 500, unitCost: 15.6, marketing: 6500, rnd: 3500,
  capexGross: 1250, depreciation: 1250, firingPenalty: 0,
  storageCost: 138, bankInterest: 716, tax: 890, isBankrupt: false,
  ...overrides,
});

describe('original MECOM pre-revenue financing (default)', () => {
  // Read-only extraction from original Save/HERMES1/HERMES1.S01..S04:
  // little-endian float32, offset 2839, stride 192, slots 3/6/7/8/9.
  // S03 SHA256: 6f3cecd62258956bc39e0c5e2fbd5715abfd9ca8e154ba59bc23a19693cdc277.
  // Rows: productionCost, firingPenalty, signed initial movement, final loan, interest.
  // Monetary inputs here are native integer costs, NOT 2-decimal displayed unit costs.
  const saves = [
    [[8204,0,6420,15451,425],[7560,0,12826,21856,601],[8204,0,4420,13451,370],[7560,0,3836,12866,354],[7280,40,5686,14717,405],[8464,0,30,9060,249],[8204,0,6220,15251,419],[7560,0,35826,44856,1234]],
    [[7700,50,2577,18028,496],[7800,0,5901,27758,763],[7820,50,5242,18694,514],[7612,0,9308,22174,610],[7272,70,6506,21224,584],[10899,0,1882,10943,301],[8130,20,3540,18792,517],[9262,0,19606,64462,2821]],
    [[8221,0,1605,19634,540],[7800,0,-1717,26042,716],[8114,0,15783,34478,948],[7674,0,-531,21643,595],[11161,0,6632,28035,766],[11072,0,-1290,9653,265],[8024,30,7626,26419,726],[9632,0,10559,75022,3877]],
    [[8382,0,-1683,17952,494],[7800,0,-1206,24836,683],[8664,0,13620,48099,1323],[7703,0,-2689,18954,521],[8970,110,8067,36103,993],[7332,340,-6698,2956,81],[8366,0,4517,30936,851],[10948,0,18818,93841,5759]],
  ];

  it('reproduces the supplied report interest values under the original bank settings', () => {
    expect(Math.round(computeBankInterest({ openingLoan: 62817, ...macro }, config))).toBe(2657);
    expect(Math.round(computeBankInterest({ openingLoan: 35407, ...macro }, config))).toBe(974);
  });

  it('matches 32 native initial movements exactly and 31 pre-topup debts within $1', () => {
    const openingCapex = Array.from({ length: 8 }, () => ({ machines: 525, amortFundRemainder: 0 }));
    let movements = 0;
    let debtsWithinDollar = 0;
    for (const period of nativeReports.periods) {
      for (let i = 0; i < 8; i++) {
        const fields = period.fields;
        const capex = computeCapex({ ...openingCapex[i], capexGross: fields['decision.capexGross'][i] }, config);
        openingCapex[i] = { machines: capex.capacityNext, amortFundRemainder: capex.amortFundRemainder };
        if (period.periodIndex === 0) continue;
        const previous = nativeReports.periods[period.periodIndex - 1].fields;
        const [productionCost, firingPenalty, movement, finalLoan, nativeInterest] = saves[period.periodIndex - 1][i];
        const funding = computePreRevenueFinancing(input({
          openingCash: previous.cash[i], openingLoan: previous.loan[i],
          produced: fields.produced[i], unitCost: productionCost / fields.produced[i],
          marketing: fields.marketingExpense[i], rnd: fields.rndExpense[i],
          capexGross: fields['decision.capexGross'][i], depreciation: capex.depreciation, firingPenalty,
        }), macro, config);
        expect(funding.initialLoanMovement).toBeCloseTo(movement, 8);
        movements++;
        const interest = computeBankInterest({ openingLoan: funding.financedLoan, ...macro }, config);
        expect(Math.abs(interest - nativeInterest)).toBeLessThanOrEqual(1);
        if (Math.abs(funding.financedLoan - finalLoan) <= 1) debtsWithinDollar++;
        else {
          expect([period.periodIndex, i + 1]).toEqual([3, 5]);
          expect(finalLoan - funding.financedLoan).toBe(179);
        }
      }
    }
    expect(movements).toBe(32);
    expect(debtsWithinDollar).toBe(31);
  });

  it.each([
    { openingCash: 0, openingLoan: 0, financedLoan: 100, interest: 2.75, finalLoan: 202.75 },
    { openingCash: 1000, openingLoan: 200, financedLoan: -700, interest: -17.5, finalLoan: -617.5 },
  ])('preserves zero-sales balance and signed deposit interest: $openingCash/$openingLoan', (row) => {
    const result = resolvePnlAndCashFlow({
      price: 30, sold: 0, produced: 10, unitCost: 10,
      inventoryOpening: 0, inventoryOpeningUnitCost: 0, inventoryAgedUnits: 0,
      marketing: 0, rnd: 0, depreciation: 100, employeesPrevious: 0, employeesCurrent: 0,
    }, input({ ...row, produced: 10, unitCost: 10, marketing: 0, rnd: 0,
      capexGross: 100, depreciation: 100 }), row.openingLoan, macro, config);
    expect(result.cf.financedLoan).toBe(row.financedLoan);
    expect(result.pnl.bankInterest).toBe(row.interest);
    expect(result.cf.loan).toBe(row.finalLoan);
    expect(result.cf.cash).toBe(0);
    expect(result.cf.unfundedShortfall).toBe(0);
    const balance = computeBalance({
      cash: result.cf.cash, inventoryUnits: 10, inventoryUnitCost: 10,
      capexBookValue: 2000, loan: result.cf.loan, retainedEarningsOpening: 0,
      netProfit: result.pnl.netProfit, capital: row.openingCash + 2000 - row.openingLoan,
    });
    expect(() => assertBalanceIdentity(balance)).not.toThrow();
    expect(balance.totalAssets).toBeCloseTo(balance.totalLiabEquity, 8);
  });

  it('retains unlimited labelOnly funding at both stages', () => {
    const unlimited = { ...config, featureFlags: { ...config.featureFlags, bankruptcyMode: 'labelOnly' as const } };
    const result = computeCashFlow(input({ openingCash: 0, openingLoan: 99000, revenue: 0 }), macro, unlimited);
    expect(result.financedLoan).toBe(116800);
    expect(result.loan).toBe(119794);
    expect(result.topupBorrowing).toBe(2994);
    expect(result.cash).toBe(0);
    expect(result.unfundedShortfall).toBe(0);
  });

  it.each(['none', 'sweep'] as const)('preserves legacy %s cash-flow results', (mode) => {
    const legacy = { ...config, featureFlags: { ...config.featureFlags, loanRepayment: mode } };
    const result = computeCashFlow(input(), macro, legacy);
    expect(result).toEqual({ cashFlow: 2706, cash: 22223, loan: 27758,
      newBorrowing: 0, unfundedShortfall: 0 });
    expect(DEFAULT_LEAGUE_CONFIG.featureFlags.loanRepayment).toBe('preRevenue');
  });

  it('charges interest on the first financed debt, never the later topup (fixed native sold)', () => {
    const result = resolvePnlAndCashFlow({
      price: 80, sold: 27, produced: 570, unitCost: 11161 / 570,
      inventoryOpening: 433, inventoryOpeningUnitCost: (1003 * 18.977861404418945 - 11161) / 433,
      inventoryAgedUnits: 433, marketing: 200, rnd: 150, depreciation: 1140,
      employeesPrevious: 73, employeesCurrent: 106,
    }, input({
      openingCash: 4239, openingLoan: 21224, produced: 570,
      unitCost: 11161 / 570, marketing: 200, rnd: 150, capexGross: 500,
      depreciation: 1140,
    }), 21224, macro, config);
    expect(result.pnl.bankInterest).toBeCloseTo(766.04, 8);
    expect(result.cf.loan).toBeCloseTo(28035.04, 8);
    expect(result.cf.cash).toBe(0);
    expect(Math.abs(result.pnl.bankInterest - 766)).toBeLessThan(1);
    const closingInterest = computeBankInterest({ openingLoan: result.cf.loan, ...macro }, config);
    expect(closingInterest).toBeCloseTo(770.9636, 8);
    expect(Math.abs(closingInterest - 766)).toBeGreaterThan(4);
  });

  it.each([
    { openingLoan: 99000, openingCash: 0, revenue: 0, loan: 100000, cash: -19794, shortfall: 19794 },
    { openingLoan: 99500, openingCash: 17800, revenue: 0, loan: 100000, cash: -2494, shortfall: 2494 },
  ])('caps both financing stages under external management: $openingLoan/$openingCash', (row) => {
    const result = computeCashFlow(input({ ...row, bankInterest: 716, tax: 890 }), macro, config);
    expect(result.loan).toBe(row.loan);
    expect(result.cash).toBe(row.cash);
    expect(result.unfundedShortfall).toBe(row.shortfall);
    expect(result.newBorrowing).toBe(row.loan - row.openingLoan);
  });

  it('funds the end-period zero-cash shortfall separately from initial financing', () => {
    // Native S03 firm 5: initial movement 6632, interest 766, final loan 28035.
    const result = computeCashFlow(input({
      openingCash: 4239, openingLoan: 21224, revenue: 2160,
      produced: 570, unitCost: 11161 / 570, marketing: 200, rnd: 150,
      capexGross: 500, depreciation: 1140, storageCost: 433,
      bankInterest: 766, tax: 0,
    }), macro, config);
    expect(result.cash).toBe(0);
    expect(result.loan).toBe(28035);
    expect(result.newBorrowing).toBe(6811);
    expect(result.initialLoanMovement).toBe(6632);
    expect(result.financedLoan).toBe(27856);
    expect(result.topupBorrowing).toBe(179);
  });

  it('repays from opening cash against the budget before revenue and late charges', () => {
    // HERMES1.S03 firm 2 slots 3/6/7/8/9: 7800/0/-1717/26042/716.
    // Integer save/report precision admits the native $1 carry difference.
    const result = computeCashFlow(input(), macro, config);
    expect(result.loan).toBe(26041);
    expect(Math.abs(result.loan - 26042)).toBeLessThanOrEqual(1);
    expect(result.cash).toBe(20506);
    const richerSales = computeCashFlow(input({ revenue: 99999, tax: 999 }), macro, config);
    expect(richerSales.loan).toBe(result.loan);
  });
});
