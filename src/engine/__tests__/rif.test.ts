/**
 * Регрессия на проверочный пример мекомspec (часть 1): лига из 8 фирм, период 1
 * (t=2), веса 50/10/10/10/10/10, мощность 525 у всех, НакопПриб_база=1704,
 * P_перенос=1470, произв_пред=420 у всех, доля_пред=12.5%, маркетинг 1050 и
 * НИОКР 420 у всех. Источник: проверено на 32 фирмах в 4 партиях, совпадение
 * 100% по итогу и по каждой из шести компонент — здесь воспроизводится ровно
 * эта таблица, компонента за компонентой, а не только итог.
 */
import { describe, expect, it } from 'vitest';
import { computeRif, computeRifLeagueAverages, type RifInput } from '../rif';
import { DEFAULT_LEAGUE_CONFIG } from '../config';
import type { LeagueConfig, RifWeights } from '../types';

const config: LeagueConfig = { ...DEFAULT_LEAGUE_CONFIG, rifMarketingRndCarry: 1470 };
const weights: RifWeights = {
  retainedProfit: 50,
  demandPotential: 10,
  supplyPotential: 10,
  efficiency80: 10,
  marketShare: 10,
  growth: 10,
};

const production = [50, 100, 200, 300, 400, 420, 500, 525];
const sold = [50, 100, 200, 300, 400, 420, 420, 420];
const retainedEarnings = [-4517, -5585, -3950, 163, 3177, 3442, 2892, 2504];
const industrySold = sold.reduce((s, v) => s + v, 0);

// [C1, C2, C3, C4, C5, C6, РИФ] по каждой из 8 фирм — дословно из спеки.
const expected: [number, number, number, number, number, number, number][] = [
  [-66, 10, 6, 1, 2, 2, -45],
  [-82, 10, 7, 3, 3, 3, -56],
  [-58, 10, 8, 6, 7, 7, -20],
  [2, 10, 10, 8, 10, 10, 50],
  [47, 10, 11, 9, 14, 14, 105],
  [50, 10, 11, 10, 15, 15, 111],
  [42, 10, 13, 8, 15, 15, 103],
  [37, 10, 13, 7, 15, 15, 97],
];

const averages = computeRifLeagueAverages(
  production.map((p) => ({ marketing: 1050, rnd: 420, production: p, productionPrevious: 420 })),
  config.rifMarketingRndCarry,
);

describe('РИФ — проверочный пример мекомspec (8 фирм, часть 1)', () => {
  it('avg(P) и avg(S) по лиге совпадают с примером', () => {
    expect(averages.avgMarketingRndPlusCarry).toBeCloseTo(2940, 6);
    expect(averages.avgProductionPlusPrevious).toBeCloseTo(731.875, 6);
  });

  it.each(production.map((_, i) => i))('фирма %i воспроизводит все шесть компонент и итог', (i) => {
    const input: RifInput = {
      retainedEarnings: retainedEarnings[i],
      retainedEarningsBase: 1704,
      period: 2,
      marketing: 1050,
      rnd: 420,
      avgMarketingRndPlusCarry: averages.avgMarketingRndPlusCarry,
      production: production[i],
      productionPrevious: 420,
      avgProductionPlusPrevious: averages.avgProductionPlusPrevious,
      utilizationPercent: (100 * production[i]) / 525,
      sold: sold[i],
      industrySold,
      sharePrevious: 12.5,
      firmCount: 8,
      isFirstPeriod: false,
      weights,
    };

    const rif = computeRif(input, config);
    const [c1, c2, c3, c4, c5, c6, total] = expected[i];

    expect(rif.retainedProfitScore).toBe(c1);
    expect(rif.demandPotential).toBe(c2);
    expect(rif.supplyPotential).toBe(c3);
    expect(rif.efficiency80).toBe(c4);
    expect(rif.marketShareScore).toBe(c5);
    expect(rif.growthScore).toBe(c6);
    expect(rif.total).toBe(total);
  });
});

describe('РИФ — округление и краевые случаи', () => {
  // Свой конфиг без P_перенос — иначе avgMarketingRndPlusCarry ниже придётся
  // тоже пересчитывать через carry, а тест должен остаться самоочевидным.
  const edgeConfig: LeagueConfig = { ...DEFAULT_LEAGUE_CONFIG, rifMarketingRndCarry: 0 };
  const base: RifInput = {
    retainedEarnings: 100,
    retainedEarningsBase: 100,
    period: 1,
    marketing: 1000,
    rnd: 0,
    avgMarketingRndPlusCarry: 1000,
    production: 420,
    productionPrevious: 0,
    avgProductionPlusPrevious: 420,
    utilizationPercent: 80,
    sold: 100,
    industrySold: 800,
    sharePrevious: 0,
    firmCount: 8,
    isFirstPeriod: true,
    weights,
  };

  it('в периоде 0 у одинаковых фирм каждая компонента даёт ровно свой вес', () => {
    const rif = computeRif(base, edgeConfig);
    expect(rif.retainedProfitScore).toBe(50); // t=1, база=текущему → ровно w1
    expect(rif.demandPotential).toBe(10); // P_i/avg(P) = 1
    expect(rif.supplyPotential).toBe(10); // S_i/avg(S) = 1
    expect(rif.efficiency80).toBe(10); // CU=80 → Eff=9.88 → round(9.88)=10
    expect(rif.marketShareScore).toBe(10); // доля = равная доля
    expect(rif.growthScore).toBe(10); // isFirstPeriod → база w6
    expect(rif.total).toBe(100);
  });

  it('C2 упирается в потолок 2·w2', () => {
    const rif = computeRif({ ...base, marketing: 100000 }, edgeConfig);
    expect(rif.demandPotential).toBe(20);
  });

  it('C1 = 0, если НакопПриб_база = 0 (защита от деления на ноль)', () => {
    const rif = computeRif({ ...base, retainedEarningsBase: 0 }, edgeConfig);
    expect(rif.retainedProfitScore).toBe(0);
  });

  it('Эфф80% штрафует и выше, и ниже оптимума', () => {
    const above = computeRif({ ...base, utilizationPercent: 100 }, edgeConfig);
    const below = computeRif({ ...base, utilizationPercent: 60 }, edgeConfig);
    // Eff(100) = 9.88 − 0.136×20 = 7.16 → round = 7
    expect(above.efficiency80).toBe(7);
    // Eff(60) = 9.88 − 0.102×20 = 7.84 → round = 8
    expect(below.efficiency80).toBe(8);
  });
});
