import { describe, expect, it } from 'vitest';
import native from '../../../data/calibration/hermes1-original.json';
import { DEFAULT_LEAGUE_CONFIG, makeFirmStart, makeMacroParams } from '../config';
import { computeRif } from '../rif';
import { computePeriod, initialOpeningState, nextOpeningState } from '../computePeriod';
import type { League } from '../types';

const weights = { retainedProfit: 50, demandPotential: 10, supplyPotential: 10, efficiency80: 10, marketShare: 10, growth: 10 };
const base = { retainedEarnings: 1704, retainedEarningsBase: 1704, period: 1, marketing: 1470, rnd: 0, avgMarketingRndPlusCarry: 1470, production: 420, productionPrevious: 0, avgProductionPlusPrevious: 420, utilizationPercent: 80, sold: 420, industrySold: 3360, sharePrevious: 12.5, firmCount: 8, isFirstPeriod: false, weights };

describe('Original HERMES1 RIF', () => {
  it('caps market share at twice its period weight', () => {
    expect(computeRif({ ...base, sold: 2500 }, DEFAULT_LEAGUE_CONFIG).marketShareScore).toBe(20);
  });
  it('caps share growth at twice its period weight', () => {
    expect(computeRif({ ...base, sharePrevious: 0.1 }, DEFAULT_LEAGUE_CONFIG).growthScore).toBe(20);
  });
  it('matches native demand and supply potentials when all preceding periods are retained', () => {
    const demand = Array<number>(8).fill(0), production = Array<number>(8).fill(0);
    for (const period of native.periods) {
      const f = period.fields;
      for (let i = 0; i < 8; i++) {
        demand[i] += f.marketingExpense[i] + f.rndExpense[i];
        production[i] += f.produced[i];
      }
      for (let i = 0; i < 8; i++) {
        const rif = computeRif({ ...base, marketing: demand[i], production: production[i], avgMarketingRndPlusCarry: demand.reduce((a,b)=>a+b,0)/8, avgProductionPlusPrevious: production.reduce((a,b)=>a+b,0)/8 }, DEFAULT_LEAGUE_CONFIG);
        expect(rif.demandPotential).toBe(f['rif.demandPotential'][i]);
        expect(rif.supplyPotential).toBe(f['rif.supplyPotential'][i]);
      }
    }
  });
  it('carries full history through the engine and through old results without cumulative fields', () => {
    const firms = Array.from({length: 8}, (_, i) => ({...makeFirmStart(8), id: native.periods[0].decisions[i].firmId, name: `Фирма ${i+1}`}));
    const league: League = { id:'test',name:'test',createdAt:'',config:DEFAULT_LEAGUE_CONFIG,firms,macroByPeriod:[],decisionsByPeriod:[],confirmedByPeriod:[],results:[] };
    let opening = initialOpeningState(league);
    let totalDemand = 0, totalProduction = 0;
    for (const period of native.periods) {
      const decisions = Object.fromEntries(period.decisions.map(d=>[d.firmId,d]));
      const result = computePeriod({ periodIndex: period.periodIndex, config: league.config, macro:makeMacroParams(period.periodIndex),firms,opening,decisions });
      const first = result.firms[0];
      totalDemand += first.marketingExpense + first.rndExpense;
      totalProduction += first.produced;
      expect(first).toHaveProperty('demandPotentialCumulative', totalDemand);
      expect(first).toHaveProperty('productionCumulative', totalProduction);
      // Legacy snapshots have no newly added counters: replaying saved results must restore them.
      const legacy = structuredClone(result);
      for (const firm of legacy.firms) {
        Reflect.deleteProperty(firm, 'demandPotentialCumulative');
        Reflect.deleteProperty(firm, 'productionCumulative');
      }
      opening = nextOpeningState(opening, legacy);
      expect(opening[first.firmId]).toHaveProperty('demandPotentialCumulative', totalDemand);
      expect(opening[first.firmId]).toHaveProperty('productionCumulative', totalProduction);
    }
  });
});
