import { expect, it } from 'vitest';
import tractors from './fixtures/tractors-original-start.json';
import mobile from './fixtures/emobile-original-start.json';
import { buildOnlineGameSnapshot } from '../../online/gameSettings';
import { scenarioFirmStart, scenarioFirmDecision } from '../originalScenarios';
import { SCENARIOS, makeScenarioPlan, scenarioMetadata } from '../scenarios';
import { playablePeriodCount } from '../../online/gameSettings';

it.each(SCENARIOS)('$id uses the verified original duration without changing earlier versions', (scenario) => {
  const duration = scenario.id === 'ipad-v3' ? 9 : 8;
  const previous = scenario.id.replace('-v3', '-v2') as 'tractors-v2' | 'ipad-v2' | 'emobile-v2';
  const snapshot = buildOnlineGameSnapshot('Current', undefined, scenario.id);
  expect(playablePeriodCount(snapshot.league)).toBe(duration);
  expect(makeScenarioPlan(scenario.id)).toHaveLength(duration + 1);
  expect(makeScenarioPlan(scenario.id).slice(0, 9)).toEqual(makeScenarioPlan(previous));
  expect(scenario.data.completionNews).toMatch(new RegExp(`(?:№?${duration}|${duration} ПЕРИОД)`));
  expect(scenario.data.completionNews).toContain('БЫЛ ПОСЛЕДНИМ');
  expect(scenarioMetadata(previous)).toMatchObject({ version: 2, playablePeriods: 8 });
  expect(playablePeriodCount(buildOnlineGameSnapshot('Ordinary').league)).toBe(8);
  if (duration === 9) {
    expect(snapshot.league.macroByPeriod[9].scenarioNewsText).toContain('Принеси Ipad');
    expect(snapshot.league.scenario!.original!.periods[8]).toEqual(scenario.data.periods[8].values);
  }
});
import { computePeriod, initialOpeningState, nextOpeningState } from '../computePeriod';
import { parseLeagueFile, serializeLeague } from '../../state/persistence';
import { configForPeriod } from '../periodConfig';

it.each([['tractors-v2', tractors], ['emobile-v2', mobile]] as const)('%s reproduces the native eight-firm initial report', (id, fixture) => {
  const { league } = buildOnlineGameSnapshot('Native', undefined, id);
  league.firms = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: String(i), ...scenarioFirmStart(league, 8) }));
  const decisions = Object.fromEntries(league.firms.map(f => [f.id, scenarioFirmDecision(league, f.id, 8)]));
  const result = computePeriod({ periodIndex: 0, config: league.config, macro: league.macroByPeriod[0], firms: league.firms,
    opening: initialOpeningState(league), decisions });
  const slots = fixture.firmSlots;
  for (const f of result.firms) {
    expect([f.fullCapacity, f.produced, f.unitCost, f.employed, f.bankInterest, f.ordersReceived, f.sold,
      f.inventoryEnd, f.revenue, f.cogs, f.grossProfit, f.profitBeforeTax, f.tax, f.netProfit,
      f.retainedEarnings, f.cash, f.rndCumulative, f.rif.total, f.capital]).toEqual(
      [0, 1, 2, 5, 9, 10, 11, 13, 15, 16, 17, 19, 20, 21, 22, 23, 24, 25, 47].map(i => slots[i]));
  }
});

it('uses the original inventory, cutoff, deposit rate and initial weights', () => {
  const ipad = buildOnlineGameSnapshot('iPad', undefined, 'ipad-v2').league;
  expect(scenarioFirmStart(ipad, 8)).toMatchObject({ initialInventory: 300, initialInventoryUnitCost: 18, initialCapital: 26400 });
  expect(scenarioFirmStart(ipad, 9).initialInventory).toBe(533);
  expect(ipad.config.depositRate).toBe(0.08);
  expect(makeScenarioPlan('tractors-v2')[0].scenarioRules?.priceWeight).toBe(0.7);
  expect(makeScenarioPlan('tractors-v2')[1].scenarioRules?.priceWeight).toBe(0.65);
  const emobile = buildOnlineGameSnapshot('Mobile', undefined, 'emobile-v2').league;
  expect(emobile.config.nativeDemand.priceCutoff).toBe(60);
  expect(configForPeriod(emobile.config, emobile.macroByPeriod[3]).nativeDemand.priceCutoff).toBe(60);
  expect(buildOnlineGameSnapshot('Old', undefined, 'ipad-v1').league.config.nativeMoneyRounding).toBeUndefined();
  expect(makeScenarioPlan('ipad-v1')[0].scenarioRules?.config).toBeUndefined();
});

it.each(SCENARIOS.flatMap(s => [2, 5, 8, 9, 12].map(count => [s.id, count] as const)))('%s with %s firms retains its source and balances through all periods', (id, count) => {
  let snapshot = buildOnlineGameSnapshot('Original', undefined, id);
  const l = snapshot.league;
  l.firms = Array.from({ length: count }, (_, i) => ({ id: String(i), name: String(i), ...scenarioFirmStart(l, count) }));
  snapshot.opening = initialOpeningState(l);
  const source = structuredClone(l.scenario!.original);
  for (let i = 0; i <= snapshot.league.scenario!.playablePeriods; i++) {
    const league = snapshot.league;
    const decisions = Object.fromEntries(league.firms.map(f => [f.id, {
      ...scenarioFirmDecision(league, f.id, count),
      production: Math.min(snapshot.opening[f.id].machines, scenarioFirmDecision(league, f.id, count).production),
    }]));
    const result = computePeriod({ periodIndex: i, config: league.config, macro: league.macroByPeriod[i], firms: league.firms,
      opening: snapshot.opening, decisions, previousIndustry: league.results.at(-1)?.industry,
      previousNativeIndustryState: league.results.at(-1)?.nativeIndustryState });
    for (const f of result.firms) expect(f.totalAssets).toBeCloseTo(f.totalLiabEquity, 4);
    league.results.push(result);
    snapshot.opening = nextOpeningState(snapshot.opening, result);
    snapshot = parseLeagueFile(serializeLeague(snapshot));
    expect(snapshot.league.scenario!.original).toEqual(source);
  }
});
