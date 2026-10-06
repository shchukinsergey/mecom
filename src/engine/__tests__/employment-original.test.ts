import { expect, it } from 'vitest';
import native from '../../../data/calibration/hermes1-original.json';
import { DEFAULT_LEAGUE_CONFIG, makeFirmDecision, makeFirmStart, makeMacroParams } from '../config';
import { computePeriod, initialOpeningState, nextOpeningState } from '../computePeriod';
import type { League } from '../types';

it('matches native firm-five employment 84→80 and the $40 firing penalty in period one', () => {
  // HERMES1.S00/S01: current result rows start at2819,192-byte stride.
  // Slots10/11 are employees/firing: firm5 has84/0 then80/40; screenshot agrees.
  const firms = native.periods[1].decisions.map((decision, i) => ({
    ...makeFirmStart(8), id: decision.firmId, name: `Firm ${i + 1}`,
  }));
  const opening = initialOpeningState({ firms } as League);
  const period0 = computePeriod({ periodIndex: 0, config: DEFAULT_LEAGUE_CONFIG,
    macro: makeMacroParams(0), firms, opening,
    decisions: Object.fromEntries(firms.map(f => [f.id, makeFirmDecision(f.id, 8)])) });
  const period1 = computePeriod({ periodIndex: 1, config: DEFAULT_LEAGUE_CONFIG,
    macro: makeMacroParams(1), firms, opening: nextOpeningState(opening, period0),
    decisions: Object.fromEntries(native.periods[1].decisions.map(d => [d.firmId, d])) });
  expect(period1.firms[4].firingPenalty).toBe(40);
  expect(period0.firms[4].employed).toBe(84);
  expect(period1.firms[4].employed).toBe(80);
});
