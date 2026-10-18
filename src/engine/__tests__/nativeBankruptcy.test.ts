import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAGUE_CONFIG, makeFirmStart, makeMacroParams } from '../config';
import { computePeriod, initialOpeningState, nextOpeningState } from '../computePeriod';
import { declareNativeBankruptcyOpening } from '../nativeBankruptcy';
import type { League, FirmOpeningState } from '../types';
import { computeCashFlow } from '../cashflow';
import { computeDemand } from '../demand';

function setup(n = 2) {
  const config = structuredClone(DEFAULT_LEAGUE_CONFIG);
  const firms = Array.from({ length: n }, (_, i) => ({ ...makeFirmStart(n), id: String(i), name: `Firm ${i}` }));
  const opening = initialOpeningState({ firms } as League);
  const decisions = Object.fromEntries(firms.map(f => [f.id, { firmId: f.id, price: 30, production: 400, marketing: 100, rnd: 100, capexGross: 1000 }]));
  return { config, firms, opening, decisions, macro: makeMacroParams(1), periodIndex: 1 };
}

describe('explicit native liquidation', () => {
  it('caps surviving supply-potential RIF at twice its weight with one of three original slots active', () => {
    const input = setup(3);
    for (const id of ['0', '1']) input.opening[id] = declareNativeBankruptcyOpening(input.opening[id], input.config, 1);
    const result = computePeriod(input);
    expect(result.firms[2].rif.supplyPotential).toBe(2 * input.macro.rifWeightSupplyPotential);
  });
  it('keeps original N=9 scale after 9→8, active-only price/marketing and retired historical R&D', () => {
    const input = setup(9);
    input.opening['0'].rndCumulative = 900;
    input.opening['0'].demandPotentialCumulative = 1800;
    input.opening['0'].productionCumulative = 90000;
    input.opening['0'] = declareNativeBankruptcyOpening(input.opening['0'], input.config, 1);
    const demandInputs = input.firms.map(f => ({ firmId: f.id, price: f.id === '0' ? 0 : 30,
      production: f.id === '0' ? 0 : 400, marketing: f.id === '0' ? 0 : 100,
      rnd: f.id === '0' ? 0 : 100, rndCumulativeBefore: 0, rndDecayStockBefore: 0,
      excluded: f.id === '0' }));
    const demand = computeDemand(demandInputs, input.config, input.macro, { rndCumulativeBefore: 900 });
    expect(demand.breakdown.shares['0'].total).toBe(0);
    expect(demand.breakdown.shares['1'].price).toBe(0.125);
    // The original accumulates eight float32 denominator terms; the ratio is
    // not exactly 1/8 after those stores. Do not widen a tolerance to hide it.
    const score = Math.pow(100 / 30, Math.fround(input.config.mktgExponent));
    const denominator = Array.from({ length: 8 }).reduce<number>(sum => Math.fround(sum + score), 0);
    expect(demand.breakdown.shares['1'].marketing).toBe(Math.fround(score / denominator));
    expect(demand.breakdown.shares['1'].rnd).toBe(Math.fround(100 / 1700));
    const result = computePeriod(input);
    expect(result.nativeIndustryState).toEqual({ rndCumulative: 1700, marketingCumulative: 1700 });
    expect(result.firms[1].ordersReceived).toBe(demand.ordersByFirm['1']);
    expect(result.firms[1].rif.demandPotential).toBe(Math.round(10 * 200 / (3400 / 9)));
    expect(result.firms[1].rif.supplyPotential).toBe(Math.round(10 * 400 / (3200 / 9)));
    expect(result.firms[1].rif.marketShareScore).toBe(Math.round(10 * 9 / 8));
    const restarted = JSON.parse(JSON.stringify(result));
    const nextInput = { ...input, periodIndex: 2, macro: makeMacroParams(2), opening: nextOpeningState(input.opening, restarted) };
    const fallback = computePeriod(nextInput);
    const explicit = computePeriod({ ...nextInput, previousNativeIndustryState: restarted.nativeIndustryState });
    expect(fallback.nativeIndustryState).toEqual({ rndCumulative: 2500, marketingCumulative: 2500 });
    expect(explicit.firms).toEqual(fallback.firms);
    expect(explicit.nativeIndustryState).toEqual(fallback.nativeIndustryState);
    const authoritative = computePeriod({ ...nextInput,
      previousNativeIndustryState: { rndCumulative: 7000, marketingCumulative: 8000 } });
    expect(authoritative.nativeIndustryState).toEqual({ rndCumulative: 7800, marketingCumulative: 8800 });
  });
  it('ignores declared decisions, retains full slots and persists zero state through JSON and the next period', () => {
    const input = setup(9);
    input.opening['0'] = declareNativeBankruptcyOpening(input.opening['0'], input.config, 1);
    const result = computePeriod(input);
    expect(result.firms).toHaveLength(9);
    const out = result.firms[0];
    expect(out.nativeBankruptcy).toEqual(input.opening['0'].nativeBankruptcy);
    expect(out.decision).toEqual({ firmId: '0', price: 0, production: 0, marketing: 0, rnd: 0, capexGross: 0 });
    for (const [key, value] of Object.entries(out)) {
      if (typeof value === 'number' && key !== 'periodIndex') expect(value, key).toBe(0);
    }
    expect(out.rif.total).toBe(0);
    const restarted = JSON.parse(JSON.stringify(result));
    const opening = nextOpeningState(input.opening, restarted);
    expect(opening['0']).toEqual(input.opening['0']);
    const next = computePeriod({ ...input, periodIndex: 2, opening,
      previousNativeIndustryState: restarted.nativeIndustryState });
    expect(next.firms[0].nativeBankruptcy).toEqual(out.nativeBankruptcy);
    expect(next.firms[0].netProfit).toBe(0);
  });

  it('continues negative equity and ignores a legacy sticky flag without a declaration', () => {
    const input = setup();
    input.opening['0'].retainedEarnings = -1e6;
    input.opening['0'].loan += 1e6;
    input.opening['0'].isBankrupt = true;
    input.macro.loanLimitAbs = 1;
    input.decisions['0'].marketing = 1e6;
    const r = computePeriod(input).firms[0];
    expect(r.produced).toBe(400);
    expect(r.loan).toBeGreaterThan(1);
    expect(r.cash).toBeGreaterThanOrEqual(0);
    expect(r.isBankrupt).toBe(false);
    expect(r.nativeBankruptcy).toBeUndefined();
  });

  it('rejects all-out leagues as an unsupported safety guard, not a verified native outcome', () => {
    const input = setup();
    for (const f of input.firms) input.opening[f.id] = declareNativeBankruptcyOpening(input.opening[f.id], input.config, 1);
    expect(() => computePeriod(input)).toThrowError(/all.*out.*unsupported/i);
  });
  it('defaults new games to native, with uncapped initial and late financing', () => {
    const { config, macro } = setup();
    expect(config.featureFlags.bankruptcyMode).toBe('native');
    macro.loanLimitAbs = 10;
    for (const repayment of ['preRevenue', 'none', 'sweep'] as const) {
      config.featureFlags.loanRepayment = repayment;
      const cf = computeCashFlow({ openingCash: 0, openingLoan: 10, revenue: 0,
        produced: 10, unitCost: 10, marketing: 30, rnd: 20, capexGross: 40,
        depreciation: 0, firingPenalty: 0, storageCost: 50, bankInterest: 10, tax: 0,
        isBankrupt: false }, macro, config);
      expect(cf.cash).toBe(0);
      expect(cf.loan).toBe(260);
      expect(cf.unfundedShortfall).toBe(0);
    }
  });
  it('snapshots pooled inventory and pre-clear history, clears economic fields, and is immutable/idempotent', () => {
    const { opening, config } = setup();
    const before: FirmOpeningState = { ...opening['0'], cash: 100, loan: 900, capital: 500,
      machines: 10, inventory: 20, inventoryUnitCost: 7, amortFundRemainder: 19,
      rndCumulative: 123, demandPotentialCumulative: 456 };
    const original = structuredClone(before);
    const out = declareNativeBankruptcyOpening(before, config, 3);
    // R4 is the full book value, including the retained amortization remainder.
    expect(out.nativeBankruptcy).toEqual({ periodIndex: 3, assets: 659, bankLoss: 241,
      shareholderLoss: 500, rndCumulative: 123, demandPotentialCumulative: 456 });
    expect(out.period0Machines).toBe(before.period0Machines);
    for (const [key, value] of Object.entries(out)) {
      if (typeof value === 'number' && key !== 'period0Machines') expect(value, key).toBe(0);
    }
    expect(out.isBankrupt).toBe(true);
    expect(before).toEqual(original);
    expect(declareNativeBankruptcyOpening(JSON.parse(JSON.stringify(out)), config, 8)).toEqual(out);
  });
});
