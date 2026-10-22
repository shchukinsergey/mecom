import { describe, expect, it } from 'vitest';
import { makeScenarioPlan, SCENARIOS, TRACTORS_SCENARIO_ID } from '../scenarios';
import { configForPeriod } from '../periodConfig';
import { DEFAULT_LEAGUE_CONFIG, makeFirmStart, makeFirmDecision } from '../config';
import { computePeriod, initialOpeningState, nextOpeningState } from '../computePeriod';
import { buildOnlineGameSnapshot } from '../../online/gameSettings';
import { parseLeagueFile, serializeLeague } from '../../state/persistence';

describe('opt-in tractors scenario', () => {
  it('keeps ordinary games unchanged and materializes independent versioned plans', () => {
    const ordinary = buildOnlineGameSnapshot('Ordinary');
    expect(ordinary.league.scenario).toBeUndefined();
    expect(ordinary.league.macroByPeriod.every(m => !m.scenarioRules && !m.scenarioNewsText)).toBe(true);
    const a = makeScenarioPlan(TRACTORS_SCENARIO_ID), b = makeScenarioPlan(TRACTORS_SCENARIO_ID);
    a[1].scenarioRules!.priceWeight = 0;
    expect(b[1].scenarioRules!.priceWeight).toBe(0.65);
    expect(configForPeriod(ordinary.league.config, ordinary.league.macroByPeriod[1])).toBe(ordinary.league.config);
  });

  it('aligns original slots with playable periods 1..8 and converts credit tranches', () => {
    const plan = makeScenarioPlan(TRACTORS_SCENARIO_ID);
    expect(plan).toHaveLength(9);
    expect(plan.map(p => p.periodIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(plan[0].scenarioNewsText).toBe('');
    expect(plan[0].demandOS).toBe(0);
    expect(plan[1].scenarioNewsText).toContain('1 пеpиод');
    expect(plan[8].scenarioNewsText).toContain('8 пеpиод');
    expect(plan[1]).toMatchObject({ loanLimitBase: 20000, loanLimitAbs: 70000, taxRate: 0.18, bankRateBase: 0.1 });
    expect(plan[2].bankRateExtra).toBe(0.99);
    expect(plan[3]).toMatchObject({ loanLimitBase: 50000, loanLimitAbs: 100000, taxRate: 0.05, bankRateBase: 0.05 });
    expect(plan[7]).toMatchObject({ taxRate: 0.25, bankRateBase: 0.15 });
  });

  it('uses period weights in calculation without mutating the base or past rules', () => {
    const snapshot = buildOnlineGameSnapshot('Tractors', undefined, TRACTORS_SCENARIO_ID);
    const l = snapshot.league;
    l.firms = ['a', 'b'].map(id => ({ ...makeFirmStart(2, l.config.machineCost), id, name: id }));
    const opening = initialOpeningState(l);
    const decisions = Object.fromEntries(l.firms.map(f => [f.id, { ...makeFirmDecision(f.id, 2), price: f.id === 'a' ? 25 : 35 }]));
    const macro = l.macroByPeriod[1];
    const before = JSON.stringify(l);
    const input = { periodIndex: 1, config: l.config, macro, firms: l.firms, opening, decisions };
    const result = computePeriod(input);
    const explicit = computePeriod({ ...input, config: configForPeriod(l.config, macro), macro: { ...macro, scenarioRules: undefined } });
    expect(result.firms).toEqual(explicit.firms);
    expect(result.firms.map(f => f.ordersReceived)).not.toEqual(computePeriod({ ...input, macro: { ...macro, scenarioRules: undefined } }).firms.map(f => f.ordersReceived));
    expect(JSON.stringify(l)).toBe(before);
    expect(l.config).toEqual(DEFAULT_LEAGUE_CONFIG);
  });

  it.each(SCENARIOS.map(s => s.id))('%s survives export/import and computes all periods with balanced finite results', (id) => {
    let snapshot = buildOnlineGameSnapshot('Scenario', undefined, id);
    snapshot.league.firms = ['a', 'b'].map(id => ({ ...makeFirmStart(2, 40), id, name: id }));
    snapshot.opening = initialOpeningState(snapshot.league);
    for (let i = 0; i <= snapshot.league.scenario!.playablePeriods; i++) {
      const l = snapshot.league;
      const decisions = Object.fromEntries(l.firms.map(f => [f.id, makeFirmDecision(f.id, 2)]));
      l.decisionsByPeriod[i] = decisions;
      const result = computePeriod({ periodIndex: i, config: l.config, macro: l.macroByPeriod[i], firms: l.firms,
        opening: snapshot.opening, decisions, previousIndustry: l.results.at(-1)?.industry,
        previousNativeIndustryState: l.results.at(-1)?.nativeIndustryState });
      for (const f of result.firms) {
        expect(Number.isFinite(f.rif.total)).toBe(true);
        expect(f.totalAssets).toBeCloseTo(f.totalLiabEquity, 2);
      }
      l.results.push(result);
      snapshot.opening = nextOpeningState(snapshot.opening, result);
      const restored = parseLeagueFile(serializeLeague(snapshot));
      expect(restored).toEqual(snapshot);
      snapshot = restored;
    }
  });

  it('applies the new scenarios economic changes on the intended periods', () => {
    const ipad = makeScenarioPlan('ipad-v1');
    expect(ipad[1]).toMatchObject({ loanLimitBase: 15000, loanLimitAbs: 15000, bankRateBase: 0.2, taxRate: 0.18 });
    expect(ipad[6].scenarioRules?.storageCostPerUnit).toBe(3);
    expect(ipad[7].scenarioRules?.storageCostPerUnit).toBe(1);
    const mobile = makeScenarioPlan('emobile-v1');
    expect(mobile[1]).toMatchObject({ loanLimitBase: 30000, loanLimitAbs: 80000, taxRate: 0.25 });
    expect(mobile[5]).toMatchObject({ taxRate: 0.4, scenarioRules: { storageCostPerUnit: 3 } });
    expect(mobile[6].scenarioRules?.storageCostPerUnit).toBe(5);
    expect(buildOnlineGameSnapshot('iPad', undefined, 'ipad-v1').league.scenario?.title).toContain('iPad');
    expect(buildOnlineGameSnapshot('Mobile', undefined, 'emobile-v1').league.scenario?.title).toContain('Е-мобиль');
  });
});
