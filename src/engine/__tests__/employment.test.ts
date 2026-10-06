import { describe, expect, it } from 'vitest';
import corpus from '../../../data/calibration/native-employment.json';
import { computeEmployees } from '../industry';
import { computePnl } from '../pnl';
import { DEFAULT_LEAGUE_CONFIG as defaults, makeFirmStart, makeFirmDecision, makeMacroParams } from '../config';
import { computePeriod, initialOpeningState, nextOpeningState } from '../computePeriod';
import { estimateFunds } from '../../ui/fundsPreview';
import type { League } from '../types';

const pnlInput = { price: 0, sold: 0, produced: 0, unitCost: 0, inventoryOpening: 0,
  inventoryOpeningUnitCost: 0, inventoryAgedUnits: 0, marketing: 0, rnd: 0,
  depreciation: 0, employeesPrevious: 1, employeesCurrent: 0, bankInterest: 0 };

describe('native employment SAVE corpus', () => {
  it('retains all 505 exact rows and source hashes', () => {
    expect(corpus.cases).toHaveLength(505);
    expect(new Set(corpus.cases.map(c => c.saveSha256)).size).toBe(91);
  });
  it.each(corpus.cases)('$save period $period firm $firm', row => {
    const config = { ...defaults, staffingSizeDivisor: row.sizeParameter,
      firingPenaltyPerEmployee: row.penaltyRate };
    const employed = computeEmployees(row.production, row.previousCapacity, config);
    expect(employed).toBe(row.nativeEmployees);
    expect(computePnl({ ...pnlInput, employeesPrevious: row.previousEmployees,
      employeesCurrent: employed }, makeMacroParams(row.period), config).firingPenalty).toBe(row.nativeFiring);
  });
});

it('uses both ceilings, supports zero, and rejects invalid native divisors/capacity', () => {
  expect(computeEmployees(100, 525, defaults)).toBe(20);
  expect(computeEmployees(101, 525, defaults)).toBe(20);
  expect(computeEmployees(101, 101, defaults)).toBe(102);
  expect(computeEmployees(400, 525, defaults)).toBe(80);
  expect(computeEmployees(0, 525, defaults)).toBe(0);
  expect(computeEmployees(100, 100, { ...defaults, staffingSizeDivisor: 50 })).toBe(102);
  expect(() => computeEmployees(0, 0, defaults)).toThrow(RangeError);
  expect(() => computeEmployees(0, 525, { ...defaults, staffingSizeDivisor: 0 })).toThrow(RangeError);
  expect(computeEmployees(400, 0, { ...defaults, employmentModel: 'legacy', baseStaff: 3, staffPerUnit: 0.2 })).toBe(83);
});

it('rounds native dismissal expense after float32 conversion; legacy stays linear', () => {
  for (const rate of [0.5, 0.49999999]) {
    expect(computePnl(pnlInput, makeMacroParams(1), { ...defaults, firingPenaltyPerEmployee: rate }).firingPenalty).toBe(1);
  }
  expect(computePnl(pnlInput, makeMacroParams(1), { ...defaults,
    employmentModel: 'legacy', firingPenaltyPerEmployee: 0.5 }).firingPenalty).toBe(0.5);
});

it('preview diagnostic uses current capacity and native firing rounding without deducting the charge', () => {
  const firm = { ...makeFirmStart(8), id: 'f', name: 'F' };
  const state = initialOpeningState({ firms: [firm] } as League).f;
  const decision = { ...makeFirmDecision('f', 8), production: 400, capexGross: 4000 };
  expect(estimateFunds({ ...state, employees: 84 }, decision, makeMacroParams(1), defaults).firingPenalty).toBe(40);
  expect(estimateFunds({ ...state, employees: 81 }, decision, makeMacroParams(1),
    { ...defaults, firingPenaltyPerEmployee: 0.49999999 }).firingPenalty).toBe(1);
  const employed = estimateFunds({ ...state, employees: 0 }, decision, makeMacroParams(1), defaults);
  const layoffs = estimateFunds({ ...state, employees: 84 }, decision, makeMacroParams(1), defaults);
  expect(layoffs.outflow).toBe(employed.outflow);
  expect(layoffs.remaining).toBe(employed.remaining);
});

it('initial N5 has 86 employees; capacity growth causes layoffs at unchanged production next period', () => {
  const firms = Array.from({ length: 5 }, (_, i) => ({ ...makeFirmStart(5), id: `f${i}`, name: `F${i}` }));
  const opening = initialOpeningState({ firms } as League);
  const decisions = Object.fromEntries(firms.map(f => [f.id, makeFirmDecision(f.id, 5)]));
  const initial = computePeriod({ periodIndex: 0, config: defaults, macro: makeMacroParams(0), firms, opening, decisions });
  expect(initial.firms[0].employed).toBe(86);
  const invest = Object.fromEntries(firms.map(f => [f.id, { ...decisions[f.id], capexGross: 4000 }]));
  const grown = computePeriod({ periodIndex: 1, config: defaults, macro: makeMacroParams(1), firms,
    opening: nextOpeningState(opening, initial), decisions: invest });
  expect(grown.firms[0].employed).toBe(86);
  const next = computePeriod({ periodIndex: 2, config: defaults, macro: makeMacroParams(2), firms,
    opening: nextOpeningState(nextOpeningState(opening, initial), grown), decisions });
  expect(next.firms[0].produced).toBe(grown.firms[0].produced);
  expect(next.firms[0].employed).toBeLessThan(grown.firms[0].employed);
  expect(next.firms[0].firingPenalty).toBe((grown.firms[0].employed - next.firms[0].employed) * 10);
});
