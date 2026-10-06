/**
 * Дефолтная конфигурация лиги.
 *
 * Здесь собраны ВСЕ «магические числа» движка. Источник (mekom-rules-and-formulas.md)
 * прямо предупреждает, что часть из них — настройки конкретной партии, а не
 * универсальные константы движка, поэтому в формулах их быть не должно.
 */

import type {
  FeatureFlags,
  Firm,
  FirmDecision,
  LeagueConfig,
  PeriodMacroParams,
} from './types';

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
  bankInterestFormula: 'official',
  bankruptcyMode: 'externalManagement',
  loanRepayment: 'preRevenue',
};

/**
 * Архивная таблица ценовой привлекательности. Только demandModel='legacy';
 * стандартный нативный расчёт использует обратную кубическую степень цены.
 */
export const DEFAULT_PRICE_F_TABLE: [number, number][] = [
  // TEST2_10_50 и TEST2_15_45: независимые оценки при прежних весах и λ.
  [10, 10.2662],
  [15, 4.7634],
  [20, 2.9643],
  [25, 1.6103],
  [30, 1.0],
  [35, 0.6707],
  [40, 0.4843],
  [45, 0.3094],
  [50, 0.2007],
  [55, 0.136],
  [60, 0.1022],
  [70, 0.0369],
  [100, -0.0326],
];

export const DEFAULT_LEAGUE_CONFIG: LeagueConfig = {
  demandModel: 'native',
  nativeDemand: {
    demandScale: 500,
    generalDemandSensitivity: 0.05,
    marketingScale: 5.726,
    marketingIntercept: 0.327,
    marketingModifierSensitivity: 0.0335,
    marketingThreshold: 16800,
    marketingExcessSlope: 0.25,
    rndScale: 1,
    rndModifierSensitivity: 0.1,
    initialLeagueRnd: 3360,
    priceExponent: -3,
    firmMarketingThreshold: 100000,
    firmMarketingExcessSlope: 0.25,
    firmRndThreshold: 100000,
    firmRndExcessSlope: 0.25,
    priceCutoff: 40,
  },
  machineCost: 40,
  machineLifespanPeriods: 20,

  priceWeight: 0.7,
  mktgWeight: 0.15,
  rndWeight: 0.15,
  mktgExponent: 1.5,

  priceLambda: 0.2076,
  priceFTable: DEFAULT_PRICE_F_TABLE,
  priceLowExtrapolation: true,

  demandCoeffLow: 60850,
  demandExpLow: 0.85,
  demandCoeffHigh: 1668820,
  demandExpHigh: 1.75,
  demandBreakpoint: 39.6,

  demandRndPeriodNorm: 420,
  demandRndDecayScale: 25000,
  demandRndExcessSlope: 0.0000224,
  demandMktgLnCoeffA: -2.4507,
  demandMktgLnCoeffB: 0.3798,
  demandMktgLnOffset: 879,
  demandMktgLnNorm: 9279,

  costK1: 15,
  costK2: 3,
  costOptimalCu: 80,
  costCuUp: 10000 / 69,
  costCuDown: 10000 / 138,

  storageCostPerUnit: 1,
  firingPenaltyPerEmployee: 10,
  serviceFee: 0.01,
  periodsPerYear: 4,
  depositRate: 0.1,

  employmentModel: 'native',
  staffingSizeDivisor: 100,
  baseStaff: 0,
  staffPerUnit: 1,

  rifMarketingRndCarry: 0,
  rifEffPeak: 9.88,
  rifEffUpSlope: 0.136,
  rifEffDownSlope: 0.102,
  rifEffFarSlope: 0.2,
  rifEffLowThreshold: 30,

  featureFlags: { ...DEFAULT_FEATURE_FLAGS },
};

/** Стартовые макропараметры (раздел 10 источника). Веса РИФ — дефолт 50/10/10/10/10/10. */
export const DEFAULT_MACRO_PARAMS: Omit<PeriodMacroParams, 'periodIndex'> = {
  demandOS: 0,
  demandVM: 0,
  demandVN: 0,
  taxRate: 0.25,
  bankRateBase: 0.1,
  bankRateExtra: 0.4,
  loanLimitBase: 50000,
  loanLimitAbs: 100000,
  rifWeightRetainedProfit: 50,
  rifWeightDemandPotential: 10,
  rifWeightSupplyPotential: 10,
  rifWeightEfficiency: 10,
  rifWeightMarketShare: 10,
  rifWeightGrowth: 10,
  scenarioNewsText: '',
};

/**
 * Отраслевые итоги вводного сценария (раздел 4.1 источника) — не зависят от
 * числа фирм N в лиге, только доля на фирму = итог / N (проверено на замерах
 * N=2/5/8: мощность 2100/840/525, займы 36120/14448/9030, НИОКР 1680/672/420 —
 * всюду итог/N с точностью до округления). Цена — не итог, а сам параметр
 * ($30), поэтому от N не зависит вообще.
 */
const SCENARIO_TOTALS = {
  machines: 4200,
  cashAndLoan: 72240,
  rnd: 3360,
  marketing: 8400,
  investment: 8400,
  price: 30,
};

/**
 * Стартовые условия фирмы, отмасштабированные по размеру лиги: доля на фирму —
 * это отраслевой итог сценария, делённый на N. Капитал берётся равным стоимости
 * станков — тогда тождество стартового баланса (наличные + склад + станки×цена
 * = займы + капитал) сходится по построению при любом N, без ручной подгонки
 * (наличные = займы, склад пуст).
 */
export function makeFirmStart(
  firmCount: number,
  machineCost: number = DEFAULT_LEAGUE_CONFIG.machineCost,
): Omit<Firm, 'id' | 'name'> {
  const machines = Math.round(SCENARIO_TOTALS.machines / firmCount);
  const cashAndLoan = Math.round(SCENARIO_TOTALS.cashAndLoan / firmCount);
  return {
    initialMachines: machines,
    initialCash: cashAndLoan,
    initialLoan: cashAndLoan,
    initialCapital: machines * machineCost,
    initialInventory: 0,
    initialInventoryUnitCost: 0,
    initialAmortFundRemainder: 0,
    initialEmployees: 0,
    // Период 0 ещё будет рассчитан: его решение уже содержит 3360/N НИОКР.
    // Здесь только предыгровой запас, иначе вводный вклад учитывается дважды.
    initialRnd: 0,
  };
}

/**
 * Дефолтные решения периода 0, отмасштабированные так же, как стартовые условия
 * (см. makeFirmStart) — ведущему не нужно вбивать цену, маркетинг, инвестиции и
 * НИОКР с нуля для каждой фирмы. Производство дефолта сценария не имеет, поэтому
 * берём 80% загрузки мощности (оптимум себестоимости) — ведущему проще
 * поправить конкретное число, чем вводить его с нуля.
 */
export function makeFirmDecision(firmId: string, firmCount: number): FirmDecision {
  const machines = Math.round(SCENARIO_TOTALS.machines / firmCount);
  return {
    firmId,
    price: SCENARIO_TOTALS.price,
    production: Math.round(machines * 0.8),
    marketing: Math.round(SCENARIO_TOTALS.marketing / firmCount),
    capexGross: Math.round(SCENARIO_TOTALS.investment / firmCount),
    rnd: Math.round(SCENARIO_TOTALS.rnd / firmCount),
  };
}

/**
 * Стартовые условия для примера раздела 4.1 источника (лига из 8 фирм: 525
 * станков, капитал $21 000, начальный заём $9 030, `initialRnd: 0`). Частный
 * случай makeFirmStart(8) — используется в тестах как эталонный набор.
 */
export const DEFAULT_FIRM_START: Omit<Firm, 'id' | 'name'> = makeFirmStart(8);

export function makeMacroParams(periodIndex: number): PeriodMacroParams {
  return { ...DEFAULT_MACRO_PARAMS, periodIndex };
}
