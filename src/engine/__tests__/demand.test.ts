/**
 * Спрос и распределение заказов (мекомspec, часть 2).
 * Расхождение с игрой у эталонной реализации — не больше 5 заказов на фирму,
 * в большинстве партий 0–1; здесь проверяется, что код воспроизводит именно
 * формулы источника (ветки D(P), таблицу f(P), веса дележа), а не общие цифры.
 */
import { describe, expect, it } from 'vitest';
import {
  computeDemand,
  computeShares,
  industryDemand,
  marketingExpansionMultiplier,
  priceIndex,
  rndExpansionMultiplier,
} from '../demand';
import type { DemandFirmInput } from '../demand';
import { DEFAULT_LEAGUE_CONFIG } from '../config';
import type { LeagueConfig } from '../types';

// Archived custom leagues may explicitly retain this superseded calibrated model.
// Native-default parity is asserted integer-exact in native-demand.test.ts.
const config: LeagueConfig = { ...DEFAULT_LEAGUE_CONFIG, demandModel: 'legacy' };

function firm(
  id: string,
  price: number,
  marketing: number,
  rnd: number,
  rndCumulativeBefore = 0,
  rndDecayStockBefore = 0,
): DemandFirmInput {
  return { firmId: id, price, marketing, rnd, rndCumulativeBefore, rndDecayStockBefore };
}

describe('f(P) — ценовое ядро (таблица + интерполяция)', () => {
  it('в узлах таблицы возвращает табличное значение', () => {
    for (const [p, f] of config.priceFTable) {
      expect(priceIndex(p, config.priceFTable)).toBeCloseTo(f, 6);
    }
  });

  it('между узлами интерполирует линейно', () => {
    // Между 30 (f=1.0) и 35 (f=0.6707): середина 32.5.
    const mid = priceIndex(32.5, config.priceFTable);
    expect(mid).toBeCloseTo((1.0 + 0.6707) / 2, 6);
  });

  it('вне диапазона таблицы — клэмп по краю, а не экстраполяция', () => {
    expect(priceIndex(5, config.priceFTable)).toBeCloseTo(10.2662, 6);
    expect(priceIndex(500, config.priceFTable)).toBeCloseTo(-0.0326, 6);
  });

  it('около P≈74 ядро проходит через ноль (между 70 и 100)', () => {
    expect(priceIndex(70, config.priceFTable)).toBeGreaterThan(0);
    expect(priceIndex(100, config.priceFTable)).toBeLessThan(0);
  });
});

describe('D(P) — общий объём рынка по отрасли (не зависит от N)', () => {
  it('ниже точки перелома использует низкую ветку 60850/P^0.85', () => {
    const expected = 60850 / Math.pow(30, 0.85);
    expect(industryDemand(30, config)).toBeCloseTo(expected, 6);
  });

  it('выше точки перелома использует высокую ветку 1668820/P^1.75', () => {
    const expected = 1668820 / Math.pow(50, 1.75);
    expect(industryDemand(50, config)).toBeCloseTo(expected, 6);
  });

  it('спрос падает при росте цены (в каждой из веток по отдельности)', () => {
    expect(industryDemand(25, config)).toBeGreaterThan(industryDemand(35, config));
    expect(industryDemand(45, config)).toBeGreaterThan(industryDemand(60, config));
  });
});

describe('Дележ заказов между фирмами (доля_i = w_м·m̂ + w_ц·p̂ + w_н·n̂)', () => {
  it('одинаковые фирмы получают равную долю', () => {
    const firms = Array.from({ length: 5 }, (_, i) => firm(`f${i}`, 30, 1000, 500));
    const shares = computeShares(firms, config);
    for (const f of firms) expect(shares[f.firmId].total).toBeCloseTo(1 / 5, 10);
  });

  it('маркетинг делится как M^1.5, БЕЗ деления на цену', () => {
    // Разные цены не должны влиять на маркетинговый канал — только M^1.5.
    const firms = [firm('cheap', 20, 1, 0), firm('rich', 80, 8, 0)];
    const shares = computeShares(firms, config);
    const total = Math.pow(1, 1.5) + Math.pow(8, 1.5);
    expect(shares.cheap.marketing).toBeCloseTo(Math.pow(1, 1.5) / total, 8);
    expect(shares.rich.marketing).toBeCloseTo(Math.pow(8, 1.5) / total, 8);
  });

  it('НИОКР делится линейно и учитывает накопление ДО периода', () => {
    const firms = [firm('a', 30, 0, 100, 400), firm('b', 30, 0, 0, 100)];
    const shares = computeShares(firms, config);
    // a: 400+100=500, b: 100+0=100 → доли 5/6 и 1/6.
    expect(shares.a.rnd).toBeCloseTo(500 / 600, 8);
    expect(shares.b.rnd).toBeCloseTo(100 / 600, 8);
  });

  it('канал без вложений делится поровну (защита от деления на ноль)', () => {
    const firms = [firm('a', 30, 0, 0), firm('b', 30, 0, 0)];
    const shares = computeShares(firms, config);
    expect(shares.a.marketing).toBeCloseTo(0.5, 8);
    expect(shares.a.rnd).toBeCloseTo(0.5, 8); // ни у кого нет ни текущего, ни накопленного НИОКР
  });

  it('дорогая фирма может получать отрицательную ценовую долю (вычитание λ·f̄)', () => {
    // Одна очень дешёвая (f=2.9643 при P=20) и одна очень дорогая (f=-0.0326 при P=100).
    const firms = [firm('cheap', 20, 0, 0), firm('costly', 100, 0, 0)];
    const shares = computeShares(firms, config);
    const fMean = (2.9643 + -0.0326) / 2;
    const xCheap = 2.9643 - config.priceLambda * fMean;
    const xCostly = -0.0326 - config.priceLambda * fMean;
    const xSum = xCheap + xCostly;
    expect(shares.cheap.price).toBeCloseTo(xCheap / xSum, 6);
    expect(shares.costly.price).toBeCloseTo(xCostly / xSum, 6);
    expect(shares.costly.price).toBeLessThan(shares.cheap.price);
  });
});

describe('computeDemand — полный расчёт периода', () => {
  it('итог по отрасли = D(P̄) · множители лиги, заказы по фирмам ~= D · доля_i (округление до целого)', () => {
    const firms = Array.from({ length: 4 }, (_, i) => firm(`f${i}`, 30, 1000, 500));
    const { totalOrders, ordersByFirm, breakdown } = computeDemand(firms, config);

    expect(breakdown.priceDemand).toBeCloseTo(industryDemand(30, config), 6);
    expect(totalOrders).toBeCloseTo(
      breakdown.priceDemand * breakdown.rndMultiplier * breakdown.marketingMultiplier,
      6,
    );
    const sumOrders = Object.values(ordersByFirm).reduce((s, v) => s + v, 0);
    expect(Math.abs(sumOrders - totalOrders)).toBeLessThanOrEqual(4); // допуск на округление по фирмам
  });

  it('breakdown.priceDemand (база D(P̄)) не зависит от числа фирм в лиге (регрессия старого бага)', () => {
    // Раньше D домножался на N (кривая была калибровкой «на фирму» при N=8) —
    // при том же P̄ лига из 2 фирм давала вчетверо меньший итог, чем лига из 8.
    // Множители масштаба лиги (мекомspec 2.3) намеренно зависят от N — это
    // проверяется отдельно ниже, здесь же проверяется именно БАЗОВАЯ кривая
    // от цены, до применения этих множителей.
    const priceDemandAt = (n: number) => computeDemand(
      Array.from({ length: n }, (_, i) => firm(`f${i}`, 30, 1000, 500)),
      config,
    ).breakdown.priceDemand;

    const priceDemand2 = priceDemandAt(2);
    const priceDemand8 = priceDemandAt(8);
    expect(priceDemand2).toBeCloseTo(priceDemand8, 6);
    expect(priceDemand2).toBeCloseTo(industryDemand(30, config), 6);
  });

  it('заказы никогда не отрицательны, даже если доля_i вышла в минус', () => {
    const firms = [firm('cheap', 20, 5000, 0), firm('costly', 100, 0, 0)];
    const { ordersByFirm } = computeDemand(firms, config);
    for (const v of Object.values(ordersByFirm)) expect(v).toBeGreaterThanOrEqual(0);
  });

  it('пустая лига не падает', () => {
    const { totalOrders, ordersByFirm } = computeDemand([], config);
    expect(totalOrders).toBe(0);
    expect(ordersByFirm).toEqual({});
  });

  it('нестандартная λ и таблица f берутся из конфига, а не зашиты в коде', () => {
    const customConfig: LeagueConfig = {
      ...config,
      priceLambda: 0,
      priceFTable: [
        [10, 5],
        [20, 1],
      ],
    };
    const firms = [firm('a', 10, 0, 0), firm('b', 20, 0, 0)];
    const shares = computeShares(firms, customConfig);
    // λ=0: p̂_i = f_i / Σf, без вычитания среднего.
    expect(shares.a.price).toBeCloseTo(5 / 6, 8);
    expect(shares.b.price).toBeCloseTo(1 / 6, 8);
  });
});

describe('Множители масштаба лиги: НИОКР и маркетинг (мекомspec 2.3, «Шаг 3»)', () => {
  it('множитель НИОКР = 1 в калибровочной точке (все фирмы тратят точно норму, без предыстории запаса)', () => {
    const firms = Array.from({ length: 8 }, (_, i) => firm(`f${i}`, 30, 1050, config.demandRndPeriodNorm));
    expect(rndExpansionMultiplier(firms, config)).toBeCloseTo(1, 10);
  });

  it('множитель НИОКР растёт линейно с избытком без предыстории: Σ=10000 → ×1.224', () => {
    // Без предыстории (rndDecayStockBefore=0) запас = избыток этого периода: 10420-420=10000.
    const firms = [firm('a', 30, 0, 10420)];
    expect(rndExpansionMultiplier(firms, config)).toBeCloseTo(1.224, 8);
  });

  it('множитель НИОКР может быть < 1, если фирмы тратят меньше нормы', () => {
    // 8 фирм вообще не тратят на НИОКР в этом периоде → избыток/фирму = 0-420 = -420, Σ = -3360.
    const firms = Array.from({ length: 8 }, (_, i) => firm(`f${i}`, 30, 0, 0));
    const expected = 1 + config.demandRndExcessSlope * -3360;
    expect(rndExpansionMultiplier(firms, config)).toBeCloseTo(expected, 8);
    expect(rndExpansionMultiplier(firms, config)).toBeLessThan(1);
  });

  it('затухающий запас НЕ путается с вечным накопленным счётчиком дележа долей', () => {
    // Одинаковый rndCumulativeBefore (вечный, влияет на канал B), но разный
    // rndDecayStockBefore (затухающий, влияет только на множитель объёма
    // рынка) — множитель НИОКР должен реагировать на второе, а не на первое.
    const withoutStock = [firm('a', 30, 0, config.demandRndPeriodNorm, 999999, 0)];
    const withStock = [firm('a', 30, 0, config.demandRndPeriodNorm, 999999, 50000)];
    expect(rndExpansionMultiplier(withoutStock, config)).toBeCloseTo(1, 10);
    expect(rndExpansionMultiplier(withStock, config)).toBeGreaterThan(1);
  });

  it('старый запас тает переменной λ, зависящей от вклада ТЕКУЩЕГО периода', () => {
    // Фирма несёт большой запас с прошлого периода (50000), но в этом периоде
    // тратит ровно норму → λ считается от маленького текущего вклада (420) и
    // потому мала: старый запас почти полностью забывается за один период.
    const lambda = 1 - 1 / (1 + config.demandRndPeriodNorm / config.demandRndDecayScale);
    const expectedStock = lambda * 50000; // избыток этого периода = 0 (спенд = норме)
    const firms = [firm('a', 30, 0, config.demandRndPeriodNorm, 0, 50000)];
    const expectedMultiplier = 1 + config.demandRndExcessSlope * expectedStock;
    expect(rndExpansionMultiplier(firms, config)).toBeCloseTo(expectedMultiplier, 8);
    // λ при обычной трате (420 из масштаба 25000) — заведомо маленькая доля.
    expect(lambda).toBeLessThan(0.05);
  });

  it('защитный пол 0.1 срабатывает при глубоко отрицательной сумме запаса', () => {
    // rnd=100 (ниже нормы, но > 0) держит λ ненулевой, поэтому огромный
    // отрицательный запас с прошлых периодов почти целиком переносится и в
    // сумме по 20 фирмам уводит «сырой» множитель далеко в минус.
    const firms = Array.from({ length: 20 }, (_, i) => firm(`f${i}`, 30, 0, 100, 0, -1_000_000));
    expect(rndExpansionMultiplier(firms, config)).toBeCloseTo(0.1, 10);
  });

  it('множитель маркетинга = 1 при ΣM = 8400 (калибровочная точка)', () => {
    const firms = [firm('a', 30, 8400, 0), firm('b', 30, 0, 0)];
    expect(marketingExpansionMultiplier(firms, config)).toBeCloseTo(1, 10);
  });

  it('множитель маркетинга падает до ≈0.12 при ΣM = 0 (реклама отсутствует у всех)', () => {
    const firms = Array.from({ length: 8 }, (_, i) => firm(`f${i}`, 30, 0, 0));
    expect(marketingExpansionMultiplier(firms, config)).toBeCloseTo(0.1216, 3);
  });

  it('множитель маркетинга зависит только от суммы, не от распределения между фирмами', () => {
    const concentrated = [firm('a', 30, 8400, 0), firm('b', 30, 0, 0)];
    const spread = [firm('a', 30, 2000, 0), firm('b', 30, 6400, 0)];
    expect(marketingExpansionMultiplier(concentrated, config))
      .toBeCloseTo(marketingExpansionMultiplier(spread, config), 10);
  });

  it('на калибровочных дефолтах (N=8) totalOrders в точности равен базовому industryDemand(P̄)', () => {
    const firms = Array.from({ length: 8 }, (_, i) => firm(`f${i}`, 30, 1050, 420, 420));
    const { totalOrders } = computeDemand(firms, config);
    expect(totalOrders).toBeCloseTo(industryDemand(30, config), 6);
  });

  it('totalOrders растёт с N через сумму маркетинга при нейтральном НИОКР (Σизбытка = 0)', () => {
    const at = (n: number) => computeDemand(
      Array.from({ length: n }, (_, i) => firm(`f${i}`, 30, 1050, 420, 420)),
      config,
    ).totalOrders;
    const base = industryDemand(30, config);
    expect(at(8)).toBeCloseTo(base, 6); // ΣM=8400 у калибровки N=8 → множитель=1
    expect(at(2)).toBeLessThan(at(8)); // ΣM=2100 у N=2 → множитель маркетинга < 1
  });

  it('totalOrders растёт с N через сумму избытка (затухающего запаса) НИОКР при нейтральном маркетинге (ΣM = 8400)', () => {
    const at = (n: number) => computeDemand(
      // marketing = 8400/n держит ΣM ровно 8400 (нейтрально) при любом n;
      // rnd=500 без предыстории → избыток/фирму = 500-420 = 80, растёт суммой с n.
      Array.from({ length: n }, (_, i) => firm(`f${i}`, 30, 8400 / n, 500)),
      config,
    ).totalOrders;
    expect(at(2)).toBeLessThan(at(8));
  });

  it('breakdown: totalOrders = priceDemand · rndMultiplier · marketingMultiplier (тождество)', () => {
    const firms = [firm('a', 30, 3000, 700), firm('b', 40, 500, 100)];
    const { totalOrders, breakdown } = computeDemand(firms, config);
    expect(totalOrders).toBeCloseTo(
      breakdown.priceDemand * breakdown.rndMultiplier * breakdown.marketingMultiplier,
      6,
    );
    expect(breakdown.rndDecayStockSum).toBeCloseTo(
      (700 - config.demandRndPeriodNorm) + (100 - config.demandRndPeriodNorm),
      8,
    );
    expect(breakdown.marketingSum).toBeCloseTo(3000 + 500, 8);
  });
});
