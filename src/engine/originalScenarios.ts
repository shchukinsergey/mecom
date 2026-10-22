import { DEFAULT_LEAGUE_CONFIG, makeFirmDecision, makeFirmStart, makeMacroParams } from './config';
import { computeUnitCost } from './cost';
import { nativeRound } from './demand';
import type { League, LeagueConfig, PeriodMacroParams } from './types';

export interface OriginalScenarioData {
  sourceSha256: string;
  globals: number[];
  periods: { values: number[]; news: string }[];
}

export function originalConfig(g: number[]): LeagueConfig {
  return { ...structuredClone(DEFAULT_LEAGUE_CONFIG), nativeMoneyRounding: true,
    machineCost: g[0], staffingSizeDivisor: g[1], machineLifespanPeriods: 100 / g[2],
    firingPenaltyPerEmployee: g[3], costOptimalCu: g[4], storageCostPerUnit: g[26],
    serviceFee: g[11] / 100, depositRate: g[13] / 100,
    costK2: g[36], costK1: g[37], costCuDown: 10000 / g[38], costCuUp: 10000 / g[39],
    costDenominatorsCustom: true,
    mktgWeight: g[60] / 100, priceWeight: g[61] / 100, rndWeight: g[62] / 100, mktgExponent: g[57],
    nativeDemand: { generalDemandSensitivity: g[48], demandScale: g[49],
      rndModifierSensitivity: g[50], rndScale: g[51], marketingScale: g[52],
      marketingIntercept: g[53], marketingModifierSensitivity: g[54],
      marketingThreshold: g[55], marketingExcessSlope: g[56], initialLeagueRnd: g[34],
      priceExponent: g[58], firmMarketingThreshold: g[80], firmMarketingExcessSlope: g[81],
      firmRndThreshold: g[82], firmRndExcessSlope: g[83], priceCutoff: g[84] },
  };
}

/** Global initialization values are distinct from the first playable period. */
export function originalPlan(data: OriginalScenarioData): PeriodMacroParams[] {
  const g = data.globals;
  const globalPeriod = [g[26], ...g.slice(8, 15), ...g.slice(64, 67), ...g.slice(60, 63),
    g[3], ...g.slice(36, 40), 0, 0, 0, 0, 0, ...g.slice(40, 46), g[84], 0,
    ...g.slice(74, 78), g[78], 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  return [{ values: globalPeriod, news: '' }, ...data.periods].map(({ values: v, news }, periodIndex) => ({
    ...makeMacroParams(periodIndex),
    loanLimitBase: v[1], loanLimitAbs: v[1] + v[2], bankRateBase: v[3] / 100,
    bankRateExtra: v[5] / 100, taxRate: v[7] / 100,
    demandOS: v[8], demandVM: v[9], demandVN: v[10],
    rifWeightRetainedProfit: v[24], rifWeightDemandPotential: v[25], rifWeightSupplyPotential: v[26],
    rifWeightEfficiency: v[27], rifWeightMarketShare: v[28], rifWeightGrowth: v[29],
    scenarioNewsText: news,
    scenarioRules: { storageCostPerUnit: v[0], firingPenaltyPerEmployee: v[14],
      mktgWeight: v[11] / 100, priceWeight: v[12] / 100, rndWeight: v[13] / 100,
      priceMin: v[36], priceMax: v[32], marketingMax: v[33], capexMax: v[34], rndMax: v[35],
      priceCutoff: v[30], config: { serviceFee: v[4] / 100, depositRate: v[6] / 100,
        costK2: v[15], costK1: v[16], costCuDown: 10000 / v[17], costCuUp: 10000 / v[18] } },
  }));
}

type StartingLeague = Pick<League, 'scenario' | 'config'>;

/** Native initialization rounds the industry R&D seed to a multiple of N. */
export function normalizeScenarioStart(league: StartingLeague, count: number): void {
  const g = league.scenario?.original?.globals;
  if (!g || count < 1) return;
  const k = Math.ceil(count / 8);
  league.config = { ...league.config, nativeDemand: { ...league.config.nativeDemand,
    initialLeagueRnd: nativeRound(g[34] * k / count) * count / k } };
}

export function scenarioFirmStart(league: StartingLeague, count: number) {
  const g = league.scenario?.original?.globals;
  if (!g) return makeFirmStart(count, league.config.machineCost);
  const k = Math.ceil(count / 8), machines = nativeRound(g[25] * k / count);
  const production = nativeRound(machines * g[31] / 100);
  const unitCost = computeUnitCost({ capacityBase: machines, capacityCurrent: machines, production }, league.config);
  const marketing = nativeRound(g[32] * k / count), rnd = nativeRound(g[34] * k / count);
  const depreciation = nativeRound(machines * g[0] * g[2] / 100);
  const gross = nativeRound(g[33] * k / count + machines * g[0] * g[2] / 100);
  const cashAndLoan = nativeRound(production * unitCost + marketing + rnd + gross - depreciation);
  const inventory = nativeRound(g[27] * k / count), inventoryUnitCost = g[36] + g[37];
  return { ...makeFirmStart(count, g[0]), initialMachines: machines,
    initialCash: cashAndLoan, initialLoan: cashAndLoan,
    initialInventory: inventory, initialInventoryUnitCost: inventoryUnitCost,
    initialCapital: machines * g[0] + inventory * inventoryUnitCost };
}

export function scenarioFirmDecision(league: StartingLeague, id: string, count: number) {
  const g = league.scenario?.original?.globals;
  if (!g) return makeFirmDecision(id, count);
  const k = Math.ceil(count / 8), machines = nativeRound(g[25] * k / count);
  return { firmId: id, price: g[30], production: nativeRound(machines * g[31] / 100),
    marketing: nativeRound(g[32] * k / count), rnd: nativeRound(g[34] * k / count),
    capexGross: nativeRound(g[33] * k / count + machines * g[0] * g[2] / 100) };
}
