import tractors from './scenarios/tractors.json';
import ipad from './scenarios/ipad.json';
import emobile from './scenarios/emobile.json';
import originalTractors from './scenarios/tractors-v2.json';
import originalIpad from './scenarios/ipad-v2.json';
import originalEmobile from './scenarios/emobile-v2.json';
import { originalPlan, type OriginalScenarioData } from './originalScenarios';
import { makeMacroParams } from './config';
import type { PeriodMacroParams } from './types';

export const TRACTORS_SCENARIO_ID = 'tractors-v1' as const;
const LEGACY_SCENARIOS = [
  { id: TRACTORS_SCENARIO_ID, title: 'Тракторы · 8 периодов',
    description: 'Модернизация отрасли: господдержка, дешёвые кредиты и смена рыночных условий.', data: tractors },
  { id: 'ipad-v1', title: 'iPad · 8 периодов',
    description: 'Бум продаж планшетов, проблемы с качеством и выход на экспортный рынок.', data: ipad },
  { id: 'emobile-v1', title: 'Е-мобиль · 8 периодов',
    description: 'Запуск нового автомобиля, рост спроса, повышение налогов и отзыв продукции.', data: emobile },
] as const;
export const SCENARIOS = [
  { id: 'tractors-v2', title: 'Тракторы · 8 периодов', description: LEGACY_SCENARIOS[0].description, data: originalTractors },
  { id: 'ipad-v2', title: 'iPad · 8 периодов', description: LEGACY_SCENARIOS[1].description, data: originalIpad },
  { id: 'emobile-v2', title: 'Е-мобиль · 8 периодов', description: LEGACY_SCENARIOS[2].description, data: originalEmobile },
] as const;
export type ScenarioId = typeof SCENARIOS[number]['id'] | typeof LEGACY_SCENARIOS[number]['id'];

export function originalScenario(id: ScenarioId): OriginalScenarioData | undefined {
  return SCENARIOS.find(s => s.id === id)?.data;
}

export function isScenarioId(value: unknown): value is ScenarioId {
  return [...SCENARIOS, ...LEGACY_SCENARIOS].some(scenario => scenario.id === value);
}

export function scenarioMetadata(id: ScenarioId) {
  const scenario = [...SCENARIOS, ...LEGACY_SCENARIOS].find(entry => entry.id === id);
  if (!scenario) throw new Error('Неизвестный сценарий');
  const original = originalScenario(id);
  return { id, title: scenario.title, version: original ? 2 : 1, playablePeriods: 8,
    ...(original ? { original: { sha256: original.sourceSha256, globals: [...original.globals],
      periods: original.periods.map(p => [...p.values]) } } : {}) };
}

/** Materialize the plan once, on creation. Saved games never look up a live template. */
export function makeScenarioPlan(id: ScenarioId): PeriodMacroParams[] {
  const original = originalScenario(id);
  if (original) return originalPlan(original);
  const scenario = LEGACY_SCENARIOS.find(entry => entry.id === id);
  if (!scenario) throw new Error('Неизвестный сценарий');
  const periods = scenario.data.periods.map((row, i): PeriodMacroParams => {
    const [mktgWeight, priceWeight, rndWeight] = row.marketWeightsCandidate.map(n => n / 100);
    const [demandOS, demandVM, demandVN] = row.demandControlsCandidate;
    const [rifWeightRetainedProfit, rifWeightDemandPotential, rifWeightSupplyPotential,
      rifWeightEfficiency, rifWeightMarketShare, rifWeightGrowth] = row.rifWeightsCandidate;
    return { ...makeMacroParams(i + 1), demandOS, demandVM, demandVN,
      bankRateBase: row.bankRateBasePercent / 100, bankRateExtra: row.bankRateExtraPercent / 100,
      loanLimitBase: row.loanBase,
      // Adapt the original additional line to the engine's absolute ceiling.
      loanLimitAbs: row.loanBase + row.loanExtra,
      taxRate: row.taxPercent / 100, rifWeightRetainedProfit, rifWeightDemandPotential,
      rifWeightSupplyPotential, rifWeightEfficiency, rifWeightMarketShare, rifWeightGrowth,
      scenarioNewsText: row.news,
      scenarioRules: { mktgWeight, priceWeight, rndWeight,
        storageCostPerUnit: row.storageCost, firingPenaltyPerEmployee: row.firingPenalty,
        priceMin: 10, priceMax: 200 },
    };
  });
  // Period zero initializes firms using the current game's established starting
  // states, with neutral demand. Original playable slot 0 belongs to period 1.
  const initial = { ...structuredClone(periods[0]), periodIndex: 0,
    demandOS: 0, demandVM: 0, demandVN: 0, scenarioNewsText: '' };
  return [initial, ...periods];
}
