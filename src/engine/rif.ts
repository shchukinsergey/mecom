/**
 * Рейтинговый индекс фирмы, РИФ (мекомspec, часть 1 — откалибровано, совпадение
 * 100% на 32 фирмах в 4 партиях по итогу и по каждой из шести компонент).
 *
 * РИФ_i = C1 + C2 + C3 + C4 + C5 + C6. Критично: каждая компонента округляется
 * до целого ОТДЕЛЬНО (половина вверх), и только потом суммируется — если сложить
 * и округлить в конце, результат разойдётся с игрой.
 */

import type { LeagueConfig, RifBreakdown, RifWeights } from './types';

export interface RifInput {
  /** НакопПриб_i — накопленная прибыль фирмы в этом периоде. */
  retainedEarnings: number;
  /** НакопПриб_база — накопленная прибыль вводного периода (параметр сценария). */
  retainedEarningsBase: number;
  /** t — номер периода, вводный = 1. */
  period: number;

  marketing: number;
  rnd: number;
  /** avg(P) по лиге в этом периоде, P_k = маркетинг_k + НИОКР_k + P_перенос. */
  avgMarketingRndPlusCarry: number;

  production: number;
  /** произв_i,пред — производство этой же фирмы в прошлом периоде. */
  productionPrevious: number;
  /** avg(S) по лиге в этом периоде, S_k = произв_k + произв_k,пред. */
  avgProductionPlusPrevious: number;

  /** CU_i — загрузка мощности, %: 100 · производство / мощность. */
  utilizationPercent: number;

  sold: number;
  /** Σсбыт по лиге в этом периоде. */
  industrySold: number;
  /** доля_i,пред — доля рынка (по сбыту) этой же фирмы в прошлом периоде, %. */
  sharePrevious: number;

  firmCount: number;
  isFirstPeriod: boolean;

  weights: RifWeights;
}

/** Округление как в игре: половина вверх, симметрично для отрицательных. */
function roundHalfUp(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : -Math.floor(-x + 0.5);
}

/**
 * Eff(CU) — отклонение загрузки мощности от оптимума 80%. Вершина именно
 * rifEffPeak (9.88), не 10 — при CU=80 десятка получается округлением компоненты,
 * а не самой функции. Нижний излом (rifEffLowThreshold) не откалиброван точно —
 * данные допускают диапазон 25–34.
 */
function eff80(cu: number, config: LeagueConfig): number {
  const { rifEffPeak: a, rifEffUpSlope: sUp, rifEffDownSlope: sDown, rifEffFarSlope: sFar, rifEffLowThreshold: t } =
    config;
  if (cu >= 80) return a - sUp * (cu - 80);
  if (cu >= t) return a - sDown * (80 - cu);
  return a - sDown * (80 - t) - sFar * (t - cu);
}

export function computeRif(input: RifInput, config: LeagueConfig): RifBreakdown {
  const w = input.weights;

  // C1 — Н.Приб: средняя накопленная прибыль за период к базовой.
  const retainedProfitScore =
    input.retainedEarningsBase !== 0
      ? roundHalfUp((w.retainedProfit * input.retainedEarnings) / (input.period * input.retainedEarningsBase))
      : 0;

  // C2 — ПотСпр: накопленные маркетинг+НИОКР к среднему по лиге, потолок 2·w2.
  const p = Math.max(0, input.marketing) + Math.max(0, input.rnd) + config.rifMarketingRndCarry;
  const demandPotential =
    input.avgMarketingRndPlusCarry > 1e-9
      ? roundHalfUp(Math.min((w.demandPotential * p) / input.avgMarketingRndPlusCarry, 2 * w.demandPotential))
      : 0;

  // C3 — ПотПр: производство (тек. + пред.) к среднему по лиге.
  const s = Math.max(0, input.production) + Math.max(0, input.productionPrevious);
  const supplyPotential =
    input.avgProductionPlusPrevious > 1e-9
      ? roundHalfUp((w.supplyPotential * s) / input.avgProductionPlusPrevious)
      : 0;

  // C4 — Эфф80%.
  const efficiency80 = roundHalfUp((w.efficiency80 / 10) * eff80(input.utilizationPercent, config));

  // C5 — Доля Р: доля рынка (по сбыту) к равной доле 100/N.
  const share = input.industrySold > 0 ? (100 * input.sold) / input.industrySold : 0;
  const equalShare = 100 / Math.max(1, input.firmCount);
  const marketShareScore = roundHalfUp(Math.min((w.marketShare * share) / equalShare, 2 * w.marketShare));

  // C6 — Рост: доля к своей же доле прошлого периода. В периоде 0 (вводном)
  // предыдущей доли нет — критерий даёт ровно базу w6.
  const growthScore =
    input.isFirstPeriod || input.sharePrevious <= 0
      ? roundHalfUp(w.growth)
      : roundHalfUp(Math.min((w.growth * share) / input.sharePrevious, 2 * w.growth));

  const total =
    retainedProfitScore + demandPotential + supplyPotential + efficiency80 + marketShareScore + growthScore;

  return {
    retainedProfitScore,
    demandPotential,
    supplyPotential,
    efficiency80,
    marketShareScore,
    growthScore,
    total,
  };
}

/** Средние по лиге за период — P_k и S_k считаются одинаково для всех фирм. */
export function computeRifLeagueAverages(
  firms: { marketing: number; rnd: number; production: number; productionPrevious: number }[],
  marketingRndCarry: number,
): { avgMarketingRndPlusCarry: number; avgProductionPlusPrevious: number } {
  const n = firms.length || 1;
  const sumP = firms.reduce(
    (acc, f) => acc + Math.max(0, f.marketing) + Math.max(0, f.rnd) + marketingRndCarry,
    0,
  );
  const sumS = firms.reduce(
    (acc, f) => acc + Math.max(0, f.production) + Math.max(0, f.productionPrevious),
    0,
  );
  return { avgMarketingRndPlusCarry: sumP / n, avgProductionPlusPrevious: sumS / n };
}
