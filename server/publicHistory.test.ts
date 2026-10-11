import { expect, test } from 'vitest';
import { makeFirmDecision, makeFirmStart, makeMacroParams, DEFAULT_LEAGUE_CONFIG } from '../src/engine/config.ts';
import { computePeriod, initialOpeningState } from '../src/engine/computePeriod.ts';
import type { League } from '../src/engine/types.ts';
import { buildPublicHistory } from './publicHistory.ts';

function computedPeriod(periodIndex: number) {
  const firms = ['active', 'removed'].map(id => ({ id, name: `Saved ${id}`, ...makeFirmStart(2, DEFAULT_LEAGUE_CONFIG.machineCost) }));
  const league: League = {
    id: 'history', name: 'History', createdAt: '2026-01-01', config: structuredClone(DEFAULT_LEAGUE_CONFIG),
    firms, macroByPeriod: [], decisionsByPeriod: [], confirmedByPeriod: [], results: [],
  };
  return computePeriod({
    periodIndex, config: league.config, macro: makeMacroParams(periodIndex), firms,
    opening: initialOpeningState(league),
    decisions: Object.fromEntries(firms.map(firm => [firm.id, makeFirmDecision(firm.id, 2)])),
  });
}

test('projects exactly the public industry metrics for every saved firm', () => {
  const period = computedPeriod(0);
  const before = structuredClone(period);
  const history = buildPublicHistory([period]);
  expect(history).toEqual([{
    periodIndex: 0,
    firms: period.firms.map(firm => ({
      firmId: firm.firmId, firmName: firm.firmName, rif: firm.rif.total,
      netProfit: firm.netProfit, marketShareSold: firm.marketShareSold,
      revenue: firm.revenue, retainedEarnings: firm.retainedEarnings,
    })),
  }]);
  expect(history[0].firms.map(firm => firm.firmId)).toEqual(['active', 'removed']);
  expect(period).toEqual(before);
  expect(history[0].firms[0]).not.toBe(period.firms[0]);
});

test('includes all completed periods starting at zero sorted without changing input', () => {
  const results = [computedPeriod(3), computedPeriod(0), computedPeriod(2), computedPeriod(1)];
  const before = structuredClone(results);
  Object.freeze(results);
  const history = buildPublicHistory(results);
  expect(history.map(period => period.periodIndex)).toEqual([0, 1, 2, 3]);
  expect(history.every(period => period.firms.length === 2)).toBe(true);
  expect(results).toEqual(before);
});

test('returns empty history when no periods have been computed', () => {
  expect(buildPublicHistory([])).toEqual([]);
});
