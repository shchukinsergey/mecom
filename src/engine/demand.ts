/**
 * Native EXE demand is the default: supply-weighted price, cumulative R&D
 * normalized by period+1, rounded latent volume and individually capped orders.
 * Float32 coefficient/accumulator/store boundaries are explicit, not float80 emulation.
 * The superseded curve/table/decay helpers below exist ONLY for explicit legacy
 * custom configurations. They are not evidence for native-game behavior.
 */

import type { LeagueConfig, PeriodMacroParams } from './types';

/** Вход дележа: решение фирмы + накопленные счётчики НИОКР ДО этого периода. */
export interface DemandFirmInput {
  firmId: string;
  production?: number;
  openingInventory?: number;
  price: number;
  marketing: number;
  rnd: number;
  /** Накопленный НИОКР за все ПРЕДЫДУЩИЕ периоды, включая initialRnd (без текущего решения).
   * Вечный счётчик — для дележа долей (канал B, мекомspec «Шаг 2»). */
  rndCumulativeBefore: number;
  /** Legacy-only counter. Native demand ignores it and preserves its stored value. */
  rndDecayStockBefore: number;
}

export interface DemandResult {
  /** Rounded volume before per-firm cutoff and rounding. */
  latentMarketDemand: number;
  totalOrders: number;
  ordersByFirm: Record<string, number>;
  breakdown: {
    avgPrice: number;
    priceDemand: number; // D_цена(P̄) — база от цены, БЕЗ множителей лиги (не «на фирму»)
    rndDecayStockSum: number; // Σ ЗатухающийЗапас_i(t) по лиге (мекомspec «Шаг 3»)
    rndMultiplier: number; // max(0.1, 1 + demandRndExcessSlope · rndDecayStockSum)
    /** Затухающий запас каждой фирмы НА КОНЕЦ этого периода — переносится в
     * следующий период как rndDecayStockBefore (см. computePeriod.ts). */
    rndDecayStockByFirm: Record<string, number>;
    marketingSum: number; // ΣM за текущий период по лиге, сырой маркетинг (мекомspec 2.3)
    marketingMultiplier: number; // множитель_маркетинг(ΣM), = 1 в калибровочной точке
    /** Доли по каналам и итоговая доля_i — нужны для юнит-тестов калибровки. */
    shares: Record<string, { marketing: number; price: number; rnd: number; total: number }>;
  };
}

/** Линейная интерполяция ядра f(P) по калиброванной таблице; вне диапазона — клэмп по краю. */
export function priceIndex(price: number, table: [number, number][], extrapolateLow = false): number {
  const sorted = [...table].sort((a, b) => a[0] - b[0]);
  const p = Math.max(0.01, price);
  if (p <= sorted[0][0]) {
    const [p0, f0] = sorted[0];
    const next = sorted[1];
    if (extrapolateLow && next && p0 > 0 && next[0] > p0 && f0 > 0 && next[1] > 0) {
      const exponent = Math.log(f0 / next[1]) / Math.log(next[0] / p0);
      return f0 * Math.pow(p0 / p, exponent);
    }
    return f0;
  }
  if (p >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];
  for (let i = 1; i < sorted.length; i++) {
    const [p0, f0] = sorted[i - 1];
    const [p1, f1] = sorted[i];
    if (p <= p1) {
      const t = (p - p0) / (p1 - p0);
      return f0 + t * (f1 - f0);
    }
  }
  return sorted[sorted.length - 1][1];
}

/** Стадия A: общий объём рынка по отрасли — не зависит от числа фирм N. */
export function industryDemand(avgPrice: number, config: LeagueConfig): number {
  const p = Math.max(0.01, avgPrice);
  return p <= config.demandBreakpoint
    ? config.demandCoeffLow / Math.pow(p, config.demandExpLow)
    : config.demandCoeffHigh / Math.pow(p, config.demandExpHigh);
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]) => (xs.length > 0 ? sum(xs) / xs.length : 0);

/** Legacy allocation helper; native demand uses the cumulative stock in both channels. */
function rndAccumByFirm(firms: DemandFirmInput[]): number[] {
  return firms.map((f) => Math.max(0, f.rndCumulativeBefore) + Math.max(0, f.rnd));
}

/** λ_i(t) — переменная скорость забывания затухающего запаса: чем крупнее
 * вклад фирмы В ЭТОМ периоде, тем медленнее он потом тает (мекомspec «Шаг
 * 3.1», формула для клона — качественно верная, не идеально точная). */
function rndDecayLambda(rndThisPeriod: number, config: LeagueConfig): number {
  const r = Math.max(0, rndThisPeriod);
  return 1 - 1 / (1 + r / config.demandRndDecayScale);
}

/**
 * Затухающий запас НИОКР по фирме на конец периода — ОТДЕЛЬНЫЙ от
 * rndAccumByFirm счётчик, только для множителя объёма рынка (мекомspec «Шаг
 * 3»). В запас кладётся не сырая трата, а избыток над нормой
 * demandRndPeriodNorm; прошлый запас взвешивается переменной λ. Если фирма
 * тратит меньше нормы, избыток отрицателен и запас может уйти в минус — это
 * ожидаемо: такая фирма слегка тянет общий рынок вниз.
 */
function rndDecayStockByFirm(firms: DemandFirmInput[], config: LeagueConfig): number[] {
  return firms.map((f) => {
    const excess = f.rnd - config.demandRndPeriodNorm;
    const lambda = rndDecayLambda(f.rnd, config);
    return lambda * f.rndDecayStockBefore + excess;
  });
}

/**
 * Множитель расширения категории от избытка ЗАТУХАЮЩЕГО запаса НИОКР ЛИГИ
 * (мекомspec «Шаг 3.2»). Сумма (не среднее!) запаса каждой фирмы — линейно,
 * без насыщения. Калибровочная точка (множитель = 1) — Σ запаса = 0, то есть
 * все фирмы тратят ровно норму (demandRndPeriodNorm) без предыстории.
 * `max(0.1, ...)` — защитный пол, а не откалиброванное значение (мекомspec):
 * страхует только от затяжного глубокого недоинвестирования всей лиги
 * одновременно, что не встречалось в калибровочных партиях.
 */
export function rndExpansionMultiplier(firms: DemandFirmInput[], config: LeagueConfig): number {
  const stockSum = sum(rndDecayStockByFirm(firms, config));
  return Math.max(0.1, 1 + config.demandRndExcessSlope * stockSum);
}

/**
 * Множитель расширения категории от суммарного маркетинга ЛИГИ ЗА ТЕКУЩИЙ
 * период (мекомspec 2.3) — не накапливается, важна только сумма ΣM, а не то,
 * как она распределена между фирмами. Логарифм с насыщением, нормирован на 1
 * в калибровочной точке ΣM = 8400 — по построению config.demandMktgLnNorm
 * равен ΣM_калибровка + config.demandMktgLnOffset.
 */
export function marketingExpansionMultiplier(firms: DemandFirmInput[], config: LeagueConfig): number {
  const marketingSum = sum(firms.map((f) => Math.max(0, f.marketing)));
  const core = (x: number) => config.demandMktgLnCoeffA + config.demandMktgLnCoeffB * Math.log(x);
  return core(marketingSum + config.demandMktgLnOffset) / core(config.demandMktgLnNorm);
}

/**
 * Стадия B: доля_i = w_м·m̂_i + w_ц·p̂_i + w_н·n̂_i.
 *
 * m̂ — маркетинг в степени 1.5, БЕЗ деления на цену и без накопления между
 * периodами. n̂ — накопленный НИОКР, линейно. p̂ — ядро f(P) за вычетом λ·f̄
 * (среднего по лиге): из-за вычитания x может быть отрицательным — дорогая
 * фирма не просто мало получает, а уменьшает общую привлекательность рынка.
 * Канал без вложений делится поровну — иначе деление на ноль.
 */
export function computeLegacyShares(
  firms: DemandFirmInput[],
  config: LeagueConfig,
): DemandResult['breakdown']['shares'] {
  const n = firms.length;
  const result: DemandResult['breakdown']['shares'] = {};
  if (n === 0) return result;

  const marketingScores = firms.map((f) => Math.pow(Math.max(0, f.marketing), config.mktgExponent));
  const marketingSum = sum(marketingScores);

  const rndAccum = rndAccumByFirm(firms);
  const rndSum = sum(rndAccum);

  const fValues = firms.map((f) => priceIndex(f.price, config.priceFTable, config.priceLowExtrapolation));
  const fMean = mean(fValues);
  const x = fValues.map((fv) => fv - config.priceLambda * fMean);
  const xSum = sum(x);

  firms.forEach((f, i) => {
    const marketing = marketingSum > 1e-9 ? marketingScores[i] / marketingSum : 1 / n;
    const rnd = rndSum > 1e-9 ? rndAccum[i] / rndSum : 1 / n;
    const price = Math.abs(xSum) > 1e-9 ? x[i] / xSum : 1 / n;
    const total = config.mktgWeight * marketing + config.priceWeight * price + config.rndWeight * rnd;
    result[f.firmId] = { marketing, price, rnd, total };
  });

  return result;
}

const f32 = Math.fround;
const accumulate32 = (values: number[]) => values.reduce((a, b) => f32(a + b), 0);
const attenuate = (x: number, threshold: number, slope: number) =>
  Math.min(x, threshold) + slope * Math.max(x - threshold, 0);
/** Native helper rounds a stored float32 halfway away from zero. */
export const nativeRound = (x: number) => Math.sign(x) * Math.floor(Math.abs(f32(x)) + 0.5);

function nativeStock(firms: DemandFirmInput[]): number {
  return Math.max(1, f32(accumulate32(firms.map(f => Math.max(0, f.rnd))) +
    accumulate32(firms.map(f => Math.max(0, f.rndCumulativeBefore)))));
}

export function computeShares(firms: DemandFirmInput[], config: LeagueConfig): DemandResult['breakdown']['shares'] {
  if (config.demandModel === 'legacy') return computeLegacyShares(firms, config);
  const g = config.nativeDemand;
  const k = Math.ceil(firms.length / 8);
  // Zero/invalid prices are a conservative browser guard, not proven native behavior.
  const price = (f: DemandFirmInput) => Math.max(0.01, f.price);
  const dm = accumulate32(firms.map(f => Math.pow(Math.max(0, f.marketing) / price(f), f32(config.mktgExponent)))) || 1;
  const dp = accumulate32(firms.map(f => Math.pow(price(f), f32(g.priceExponent)))) || 1;
  const stock = nativeStock(firms);
  const shares: DemandResult['breakdown']['shares'] = {};
  for (const f of firms) {
    const marketing = f32(Math.pow(attenuate(Math.max(0, f.marketing), f32(g.firmMarketingThreshold * k),
      f32(g.firmMarketingExcessSlope)) / price(f), f32(config.mktgExponent)) / dm);
    const p = f32(Math.pow(price(f), f32(g.priceExponent)) / dp);
    const rnd = f32((attenuate(Math.max(0, f.rnd), f32(g.firmRndThreshold * k),
      f32(g.firmRndExcessSlope)) + Math.max(0, f.rndCumulativeBefore)) / stock);
    const total = (f32(config.mktgWeight * 100) * marketing + f32(config.priceWeight * 100) * p +
      f32(config.rndWeight * 100) * rnd) / 100;
    shares[f.firmId] = { marketing, price: p, rnd, total };
  }
  return shares;
}

/** Native arithmetic transcription, verified integer-exact on the immutable corpus.
 * Not a bitwise Borland float80 emulator; custom coefficients/status exclusions remain unverified. */
export function computeDemand(firms: DemandFirmInput[], config: LeagueConfig,
  macro: Pick<PeriodMacroParams, 'periodIndex' | 'demandOS' | 'demandVM' | 'demandVN'> = { periodIndex: 0 },
): DemandResult {
  if (config.demandModel === 'legacy') return computeLegacyDemand(firms, config);
  const g = config.nativeDemand;
  const k = Math.ceil(firms.length / 8);
  const marketingSum = accumulate32(firms.map(f => Math.max(0, f.marketing)));
  const supply = firms.map(f => Math.max(0, f.production ?? 0) + Math.max(0, f.openingInventory ?? 0));
  const supplySum = accumulate32(supply);
  const supplyValue = accumulate32(firms.map((f, i) => f.price * supply[i]));
  // No-supply denominator has not been observed in the original; return no market.
  const avgPrice = supplySum > 0 ? f32(supplyValue / supplySum) : 0;
  const marketingTerm = avgPrice > 0 ? Math.sqrt(k * attenuate(marketingSum,
    f32(g.marketingThreshold * k), f32(g.marketingExcessSlope))) * f32(g.marketingScale) *
    (f32(g.marketingIntercept) + f32(g.marketingModifierSensitivity) * (macro.demandVM ?? 0)) / avgPrice : 0;
  const rndTerm = (1 + f32(g.rndModifierSensitivity) * (macro.demandVN ?? 0)) * k *
    f32(g.rndScale) * nativeStock(firms) / Math.max(1, f32(g.initialLeagueRnd * k) * (macro.periodIndex + 1));
  const latentMarketDemand = avgPrice > 0 ? Math.max(0, nativeRound(f32(g.demandScale) *
    (1 + f32(g.generalDemandSensitivity) * (macro.demandOS ?? 0)) * (marketingTerm + rndTerm))) : 0;
  const shares = computeShares(firms, config);
  const ordersByFirm: Record<string, number> = {};
  const stocks: Record<string, number> = {};
  for (const f of firms) {
    const p = Math.max(0.01, f.price);
    ordersByFirm[f.firmId] = Math.max(0, nativeRound(latentMarketDemand * shares[f.firmId].total *
      Math.min(p, f32(g.priceCutoff)) / p));
    // Retired legacy counter is preserved at the serialization boundary, never consumed.
    stocks[f.firmId] = f.rndDecayStockBefore;
  }
  return { latentMarketDemand, totalOrders: sum(Object.values(ordersByFirm)), ordersByFirm,
    breakdown: { avgPrice, priceDemand: latentMarketDemand, rndDecayStockSum: 0,
      rndMultiplier: 1, rndDecayStockByFirm: stocks, marketingSum, marketingMultiplier: 1, shares } };
}

/** Legacy calibrated model, retained only for explicit custom archives. */
function computeLegacyDemand(firms: DemandFirmInput[], config: LeagueConfig): DemandResult {
  if (firms.length === 0) {
    return {
      totalOrders: 0,
      latentMarketDemand: 0,
      ordersByFirm: {},
      breakdown: {
        avgPrice: 0,
        priceDemand: 0,
        rndDecayStockSum: 0,
        rndMultiplier: 1,
        rndDecayStockByFirm: {},
        marketingSum: 0,
        marketingMultiplier: 1,
        shares: {},
      },
    };
  }

  const avgPrice = mean(firms.map((f) => Math.max(0.01, f.price)));
  // База — целиком из D(P̄), без домножения на число фирм: N уже учтено в
  // дележе долей на стадии B (сумма долей всей лиги равна 1). Сверху — два
  // множителя масштаба лиги (стадия C, мекомspec 2.3), которые, в отличие от
  // D(P̄), сознательно зависят от N (это агрегаты по всей лиге).
  const priceDemand = industryDemand(avgPrice, config);
  const rndDecayStocks = rndDecayStockByFirm(firms, config);
  const rndMultiplier = rndExpansionMultiplier(firms, config);
  const marketingMultiplier = marketingExpansionMultiplier(firms, config);
  // Клэмп на всякий случай: множитель НИОКР уже не уходит ниже 0.1 сам по
  // себе (пол зашит в формулу выше), это дополнительная страховка итога.
  const totalOrders = Math.max(0, priceDemand * rndMultiplier * marketingMultiplier);

  const shares = computeLegacyShares(firms, config);
  const ordersByFirm: Record<string, number> = {};
  for (const f of firms) {
    ordersByFirm[f.firmId] = Math.max(0, Math.round(totalOrders * (shares[f.firmId]?.total ?? 0)));
  }

  const rndDecayStockByFirmMap: Record<string, number> = {};
  firms.forEach((f, i) => {
    rndDecayStockByFirmMap[f.firmId] = rndDecayStocks[i];
  });

  return {
    totalOrders,
    latentMarketDemand: totalOrders,
    ordersByFirm,
    breakdown: {
      avgPrice,
      priceDemand,
      rndDecayStockSum: sum(rndDecayStocks),
      rndMultiplier,
      rndDecayStockByFirm: rndDecayStockByFirmMap,
      marketingSum: sum(firms.map((f) => Math.max(0, f.marketing))),
      marketingMultiplier,
      shares,
    },
  };
}
