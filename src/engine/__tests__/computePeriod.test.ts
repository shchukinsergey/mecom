import { describe, expect, it } from 'vitest';
import {
  computePeriod,
  initialOpeningState,
  nextOpeningState,
  type ComputePeriodInput,
} from '../computePeriod';
import { DEFAULT_FIRM_START, DEFAULT_LEAGUE_CONFIG, makeMacroParams } from '../config';
import { computeBankInterest } from '../pnl';
import type {
  FirmDecision,
  FirmOpeningState,
  League,
  LeagueConfig,
  PeriodResults,
} from '../types';

function makeLeague(firmCount: number, config: LeagueConfig = DEFAULT_LEAGUE_CONFIG): League {
  return {
    id: 'L',
    name: 'Тестовая лига',
    createdAt: new Date().toISOString(),
    config,
    firms: Array.from({ length: firmCount }, (_, i) => ({
      ...DEFAULT_FIRM_START,
      id: `f${i}`,
      name: `Фирма ${i + 1}`,
    })),
    macroByPeriod: [],
    decisionsByPeriod: [],
    confirmedByPeriod: [],
    results: [],
  };
}

function decide(firmId: string, over: Partial<FirmDecision> = {}): FirmDecision {
  return {
    firmId,
    price: 35,
    production: 420, // 80% от стартовых 525 станков
    marketing: 2000,
    capexGross: 1050, // ровно амортизация 525 × $2
    rnd: 500,
    ...over,
  };
}

/** Прогон партии на несколько периодов; решения задаёт колбэк. */
function playGame(
  league: League,
  periods: number,
  decisionsFor: (periodIndex: number, firmId: string, i: number) => FirmDecision,
): PeriodResults[] {
  let opening: Record<string, FirmOpeningState> = initialOpeningState(league);
  const results: PeriodResults[] = [];

  for (let p = 0; p < periods; p++) {
    const decisions: Record<string, FirmDecision> = {};
    league.firms.forEach((f, i) => {
      decisions[f.id] = decisionsFor(p, f.id, i);
    });

    const input: ComputePeriodInput = {
      periodIndex: p,
      config: league.config,
      macro: makeMacroParams(p),
      firms: league.firms.map((f) => ({ id: f.id, name: f.name })),
      opening,
      decisions,
      previousIndustry: results[p - 1]?.industry,
    };

    const res = computePeriod(input);
    results.push(res);
    opening = nextOpeningState(opening, res);
  }

  return results;
}

describe('Тождество баланса', () => {
  it('держится у 5 фирм на 5 периодах при случайных решениях', () => {
    const league = makeLeague(5);
    // Детерминированный псевдослучайный генератор — тест должен быть воспроизводим.
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const results = playGame(league, 5, () =>
      decide('', {
        price: 15 + rnd() * 45,
        production: Math.round(rnd() * 900),
        marketing: Math.round(rnd() * 9000),
        capexGross: Math.round(rnd() * 25000),
        rnd: Math.round(rnd() * 6000),
      }),
    );

    expect(results).toHaveLength(5);
    for (const period of results) {
      for (const f of period.firms) {
        expect(Math.abs(f.totalAssets - f.totalLiabEquity)).toBeLessThan(0.01);
      }
    }
  });

  it('держится при пустых решениях (всё по нулям)', () => {
    const league = makeLeague(3);
    const results = playGame(league, 3, (_, firmId) =>
      decide(firmId, { price: 0, production: 0, marketing: 0, capexGross: 0, rnd: 0 }),
    );
    for (const period of results) {
      for (const f of period.firms) {
        expect(Math.abs(f.totalAssets - f.totalLiabEquity)).toBeLessThan(0.01);
      }
    }
  });
});

describe('Расчёт периода', () => {
  it('продажи ограничены и заказами, и наличием товара', () => {
    const league = makeLeague(3);
    const [p0] = playGame(league, 1, (_, firmId) => decide(firmId, { production: 10 }));

    for (const f of p0.firms) {
      expect(f.sold).toBeLessThanOrEqual(f.ordersReceived);
      expect(f.sold).toBeLessThanOrEqual(f.produced + 0);
      expect(f.unfulfilledOrders).toBe(f.ordersReceived - f.sold);
      expect(f.inventoryEnd).toBe(f.produced - f.sold);
    }
  });

  it('загрузка считается от текущей мощности, а не от следующей', () => {
    const league = makeLeague(2);
    const [p0] = playGame(league, 1, (_, firmId) =>
      decide(firmId, { production: 420, capexGross: 21050 }),
    );
    const f = p0.firms[0];

    expect(f.fullCapacity).toBe(525);
    expect(f.capacityNextPeriod).toBe(1025); // 525 + 500 новых станков
    expect(f.capacityUtilization).toBeCloseTo(420 / 525, 6);
    expect(f.capacityUtilization).not.toBeCloseTo(420 / 1025, 3);
  });

  it('мощность следующего периода становится полной мощностью в следующем', () => {
    const league = makeLeague(2);
    const results = playGame(league, 2, (_, firmId) =>
      decide(firmId, { capexGross: 21050 }),
    );
    expect(results[1].firms[0].fullCapacity).toBe(results[0].firms[0].capacityNextPeriod);
  });

  it('плата за хранение приходит с задержкой в один период', () => {
    const league = makeLeague(2);
    // Обе фирмы симметричны (одна цена, без вложений) → делят весь отраслевой
    // спрос D(39) поровну; производство намеренно выше их доли, поэтому остаток
    // ложится на склад с периода 0.
    const results = playGame(league, 2, (_, firmId) =>
      decide(firmId, { production: 2000, price: 39, marketing: 0, rnd: 0 }),
    );

    expect(results[0].firms[0].inventoryEnd).toBeGreaterThan(0);
    // В периоде 0 склада на начало не было → за хранение не платим.
    expect(results[0].firms[0].storageCost).toBe(0);
    // В периоде 1 платим ровно за то, что лежало на складе с периода 0.
    expect(results[1].firms[0].storageCost).toBe(results[0].firms[0].inventoryEnd);
  });

  it('архивная линейная модель сохраняет штраф от падения выпуска', () => {
    const league = makeLeague(2);
    league.config = { ...league.config, employmentModel: 'legacy' };
    const results = playGame(league, 2, (p, firmId) =>
      decide(firmId, { production: p === 0 ? 400 : 300 }),
    );
    // Занятость = выпуск при дефолтных коэффициентах → уволено 100 человек × $10.
    expect(results[1].firms[0].firingPenalty).toBe(1000);
    expect(results[0].firms[0].firingPenalty).toBe(0);
  });

  it('накопленный НИОКР растёт и переносится между периодами (с базой initialRnd)', () => {
    const league = makeLeague(2);
    const results = playGame(league, 3, (_, firmId) => decide(firmId, { rnd: 500 }));
    const base = DEFAULT_FIRM_START.initialRnd;
    expect(results[0].firms[0].rndCumulative).toBe(base + 500);
    expect(results[1].firms[0].rndCumulative).toBe(base + 1000);
    expect(results[2].firms[0].rndCumulative).toBe(base + 1500);
  });

  it('native cumulative R&D is retained; the retired decay counter is not advanced', () => {
    // Ровно пример из mecom-spec.md, Шаг 1: разовый крупный вклад 50000 в
    // периоде 0, дальше — обычные 420 (норма) каждый период.
    const league = makeLeague(2);
    const results = playGame(league, 3, (p, firmId) => decide(firmId, { rnd: p === 0 ? 50000 : 420 }));
    const base = DEFAULT_FIRM_START.initialRnd;

    // Вечный счётчик (для дележа долей) — никогда не уменьшается, в точности
    // как в таблице спеки (420 / 50420 / 50840 / 51260 при базе 420).
    expect(results[0].firms[0].rndCumulative).toBe(base + 50000);
    expect(results[1].firms[0].rndCumulative).toBe(base + 50000 + 420);
    expect(results[2].firms[0].rndCumulative).toBe(base + 50000 + 840);
    expect(results[2].firms[0].rndCumulative).toBeGreaterThan(results[1].firms[0].rndCumulative);

    // The EXE uses cumulative stock/(period+1), not the old hypothesized decay.
    expect(results.map(r => r.firms[0].rndDecayStock)).toEqual([0, 0, 0]);
  });

  it('процент по займу учитывает и заём, взятый в этом же периоде', () => {
    // Огромные капвложения при низкой цене гарантированно создают нехватку
    // наличных — фирма занимает новые деньги ВНУТРИ этого периода.
    const league = makeLeague(2);
    const [p0] = playGame(league, 1, (_, firmId, i) =>
      i === 0
        ? decide(firmId, { price: 5, production: 420, marketing: 500, capexGross: 20000, rnd: 200 })
        : decide(firmId),
    );
    const victim = p0.firms[0];
    const { config } = league;
    const macro = makeMacroParams(0);

    // Займ действительно вырос, и фирма не в банкротстве — иначе внешнее
    // управление ограничивает заём и тест перестаёт проверять нужный сценарий.
    expect(victim.newBorrowing).toBeGreaterThan(0);
    expect(victim.isBankrupt).toBe(false);

    const interestOnOpeningLoanOnly = computeBankInterest(
      {
        openingLoan: DEFAULT_FIRM_START.initialLoan,
        loanLimitBase: macro.loanLimitBase,
        bankRateBase: macro.bankRateBase,
        bankRateExtra: macro.bankRateExtra,
      },
      config,
    );
    // Старый баг: процент считался бы ровно от входящего остатка, игнорируя
    // заём, взятый в этом же периоде. Начисленный процент должен быть выше.
    expect(victim.bankInterest).toBeGreaterThan(interestOnOpeningLoanOnly);

    // Самосогласованность: итерация должна сойтись к проценту, отвечающему
    // закрывающему остатку займа (а не застрять на промежуточном значении).
    const interestOnClosingLoan = computeBankInterest(
      {
        openingLoan: victim.loan,
        loanLimitBase: macro.loanLimitBase,
        bankRateBase: macro.bankRateBase,
        bankRateExtra: macro.bankRateExtra,
      },
      config,
    );
    expect(Math.abs(victim.bankInterest - interestOnClosingLoan)).toBeLessThan(0.01);

    expect(Math.abs(victim.totalAssets - victim.totalLiabEquity)).toBeLessThan(0.01);
  });
});

describe('РИФ', () => {
  it('в периоде 0 у одинаковых фирм даёт ровно 100', () => {
    const league = makeLeague(6);
    const [p0] = playGame(league, 1, (_, firmId) => decide(firmId, { production: 420 }));

    for (const f of p0.firms) {
      expect(f.rif.retainedProfitScore).toBeCloseTo(50, 6);
      expect(f.rif.demandPotential).toBeCloseTo(10, 6);
      expect(f.rif.supplyPotential).toBeCloseTo(10, 6);
      expect(f.rif.efficiency80).toBeCloseTo(10, 6);
      expect(f.rif.marketShareScore).toBeCloseTo(10, 6);
      expect(f.rif.growthScore).toBe(10);
      expect(f.rif.total).toBeCloseTo(100, 6);
    }
  });

  it('загрузка вдали от 80% штрафует критерий эффективности', () => {
    const league = makeLeague(2);
    const [p0] = playGame(league, 1, (_, firmId, i) =>
      decide(firmId, { production: i === 0 ? 420 : 525 }),
    );
    expect(p0.firms[0].rif.efficiency80).toBeCloseTo(10, 6); // 80% → Eff=9.88 → round 10
    expect(p0.firms[1].rif.efficiency80).toBeCloseTo(7, 6); // 100% → 9.88−0.136×20=7.16 → round 7
  });
});

describe('Флаги версий формул', () => {
  const flagVariants: Partial<LeagueConfig['featureFlags']>[] = [
    { bankInterestFormula: 'flatLoanRate' },
    { bankruptcyMode: 'freeze' },
    { bankruptcyMode: 'labelOnly' },
    { loanRepayment: 'sweep' },
  ];

  it.each(flagVariants)('партия считается без падений при %o', (flags) => {
    const config: LeagueConfig = {
      ...DEFAULT_LEAGUE_CONFIG,
      featureFlags: { ...DEFAULT_LEAGUE_CONFIG.featureFlags, ...flags },
    };
    const league = makeLeague(4, config);

    const results = playGame(league, 4, (p, firmId, i) =>
      decide(firmId, {
        price: 25 + i * 10 + p,
        production: 400 + i * 40,
        marketing: 1500 * (i + 1),
        capexGross: 1050 + i * 800,
        rnd: 400 * i,
      }),
    );

    expect(results).toHaveLength(4);
    for (const period of results) {
      for (const f of period.firms) {
        expect(Number.isFinite(f.netProfit)).toBe(true);
        expect(Number.isFinite(f.rif.total)).toBe(true);
        expect(Math.abs(f.totalAssets - f.totalLiabEquity)).toBeLessThan(0.01);
      }
    }
  });

  it('себестоимость: на 80% загрузки без роста мощности — ровно линейная часть', () => {
    const league = makeLeague(2);
    const results = playGame(league, 1, (_, firmId) => decide(firmId, { production: 420 }));
    // мощность_баз = мощность_тек = 525, CU=80% → A=0 → 15×(525/525)+3 = 18.
    expect(results[0].firms[0].unitCost).toBeCloseTo(18, 6);
  });

  it('себестоимость растёт при отклонении загрузки от CUopt в обе стороны', () => {
    const league = makeLeague(2);
    const results = playGame(league, 1, (_, firmId, i) =>
      decide(firmId, { production: i === 0 ? 525 : 100 }),
    );
    const atOptimum = 18; // из теста выше
    expect(results[0].firms[0].unitCost).toBeGreaterThan(atOptimum); // 100% загрузки
    expect(results[0].firms[1].unitCost).toBeGreaterThan(atOptimum); // ~19% загрузки
  });
});

describe('Гашение займа (cash sweep, featureFlags.loanRepayment)', () => {
  function withLoanRepayment(mode: LeagueConfig['featureFlags']['loanRepayment']): LeagueConfig {
    return {
      ...DEFAULT_LEAGUE_CONFIG,
      featureFlags: { ...DEFAULT_LEAGUE_CONFIG.featureFlags, loanRepayment: mode },
    };
  }

  /**
   * Лига с явно заданным входящим кэшем/займом (вместо дефолтных из
   * DEFAULT_FIRM_START, в т.ч. отрицательным займом — депозитом). Станки не
   * трогаем, капитал досчитываем так, чтобы стартовый баланс сходился по
   * построению при любом cash/loan: cash + 0 + станки×цена = loan + капитал.
   */
  function makeLeagueWithCash(cash: number, loan: number, config: LeagueConfig): League {
    const capital = cash + DEFAULT_FIRM_START.initialMachines * config.machineCost - loan;
    return {
      id: 'L',
      name: 'Тестовая лига',
      createdAt: new Date().toISOString(),
      config,
      firms: [0, 1].map((i) => ({
        ...DEFAULT_FIRM_START,
        id: `f${i}`,
        name: `Фирма ${i + 1}`,
        initialCash: cash,
        initialLoan: loan,
        initialCapital: capital,
      })),
      macroByPeriod: [],
      decisionsByPeriod: [],
      confirmedByPeriod: [],
      results: [],
    };
  }

  it("'none' (дефолт) — займ не меняется, весь денежный поток оседает в наличных", () => {
    const league = makeLeague(2, withLoanRepayment('none'));
    const [p0] = playGame(league, 1, (_, firmId) => decide(firmId));
    const f = p0.firms[0];

    expect(f.newBorrowing).toBe(0);
    expect(f.loan).toBe(DEFAULT_FIRM_START.initialLoan);
    expect(f.cash).toBeGreaterThan(DEFAULT_FIRM_START.initialCash);
  });

  it("'sweep' — на дефолтных стартовых условиях входящий кэш меньше затрат периода, гасить нечего (совпадает с 'none', как в реальном отчёте RLC)", () => {
    // Именно так устроен отчёт RLC: входящий кэш $47 910 меньше затрат периода
    // без выручки (~$64 520) — избытка нет, займ не гасится. На дефолтных
    // стартовых условиях лиги (cash === loan == 9030) ситуация аналогичная.
    const decisions = (_: number, firmId: string) => decide(firmId);
    const [pNone] = playGame(makeLeague(2, withLoanRepayment('none')), 1, decisions);
    const [pSweep] = playGame(makeLeague(2, withLoanRepayment('sweep')), 1, decisions);

    expect(pSweep.firms[0].loan).toBe(pNone.firms[0].loan);
    expect(pSweep.firms[0].cash).toBe(pNone.firms[0].cash);
  });

  it("'sweep' — избыток входящего кэша сверх затрат периода частично гасит займ, свежая выручка не гасится", () => {
    // Крупный входящий кэш (50 000) заведомо превышает затраты периода —
    // сценарий именно на частичное погашение (займа 50 000 хватает не сразу).
    const league = makeLeagueWithCash(50000, 50000, withLoanRepayment('sweep'));
    const [p0] = playGame(league, 1, (_, firmId) => decide(firmId));
    const f = p0.firms[0];

    expect(f.loan).toBeGreaterThan(0);
    expect(f.loan).toBeLessThan(50000);
    // Весь избыток входящего кэша ушёл на погашение — в наличных остаётся
    // ровно выручка этого периода (она в гашение не идёт).
    expect(f.cash).toBeCloseTo(f.revenue, 6);
    expect(Math.abs(f.totalAssets - f.totalLiabEquity)).toBeLessThan(0.01);
  });

  it("'sweep' — гасится даже при нулевых решениях: единственный расход периода — банковский процент", () => {
    // Ничего не производим и не тратим — расход периода состоит только из
    // процента по займу, поэтому почти весь входящий кэш оказывается избытком.
    const league = makeLeague(2, withLoanRepayment('sweep'));
    const [p0] = playGame(league, 1, (_, firmId) =>
      decide(firmId, { price: 0, production: 0, marketing: 0, capexGross: 0, rnd: 0 }),
    );
    const f = p0.firms[0];

    expect(f.loan).toBeLessThan(DEFAULT_FIRM_START.initialLoan);
    expect(f.newBorrowing).toBe(0);
    expect(Math.abs(f.totalAssets - f.totalLiabEquity)).toBeLessThan(0.01);
  });

  it("'sweep' — несколько прибыльных периодов подряд гасят займ, дальше он продолжает уходить в минус (депозит), а наличные стоят на месте", () => {
    // Isolate the sweep contract under its original stable-revenue demand fixture.
    // Native demand changes with elapsed periods; sweep itself is unchanged.
    const league = makeLeagueWithCash(50000, 50000, { ...withLoanRepayment('sweep'), demandModel: 'legacy' });
    const results = playGame(league, 8, (_, firmId) => decide(firmId, { marketing: 200, rnd: 100 }));
    const loans = results.map((r) => r.firms[0].loan);
    const cash = results.map((r) => r.firms[0].cash);

    // Займ монотонно уменьшается period-to-period...
    for (let i = 1; i < loans.length; i++) {
      expect(loans[i]).toBeLessThan(loans[i - 1]);
    }
    // ...пересекает ноль (становится депозитом)...
    expect(loans[0]).toBeGreaterThan(0);
    expect(loans[loans.length - 1]).toBeLessThan(0);
    // ...а наличные всё это время стоят на месте: весь избыток каждый период
    // уходит в займ/депозит, в кэше остаётся только свежая выручка периода.
    for (let i = 1; i < cash.length; i++) {
      expect(cash[i]).toBeCloseTo(cash[0], 6);
    }
  });

  it("'sweep' — отрицательный займ — это депозит: банк платит фирме, а не наоборот", () => {
    // Заём -100 000 (депозит) с самого начала, нулевые решения — единственная
    // статья дохода/расхода периода — процент по депозиту.
    const league = makeLeagueWithCash(1000, -100000, withLoanRepayment('sweep'));
    const [p0] = playGame(league, 1, (_, firmId) =>
      decide(firmId, { price: 0, production: 0, marketing: 0, capexGross: 0, rnd: 0 }),
    );
    const f = p0.firms[0];

    // Процент по депозиту — ДОХОД (отрицательный расход), а не издержка.
    expect(f.bankInterest).toBeLessThan(0);
    expect(f.netProfit).toBeGreaterThan(0);
    // Депозит продолжает расти — доход от него тоже подпадает под sweep.
    expect(f.loan).toBeLessThan(-100000);
    expect(Math.abs(f.totalAssets - f.totalLiabEquity)).toBeLessThan(0.01);
  });

  it("'sweep' — кассовый разрыв в периоде сначала съедает депозит, и лишь потом уходит в реальный долг", () => {
    // Депозит 5000 (loan=-5000), дорогое решение при низкой цене создаёт
    // дефицит, превышающий сам депозит.
    const league = makeLeagueWithCash(1000, -5000, withLoanRepayment('sweep'));
    const [p0] = playGame(league, 1, (_, firmId) =>
      decide(firmId, { price: 5, production: 420, marketing: 500, capexGross: 1050, rnd: 200 }),
    );
    const f = p0.firms[0];

    // Дефицит перекрыл весь депозит и ушёл в положительный долг.
    expect(f.loan).toBeGreaterThan(0);
    expect(f.newBorrowing).toBeGreaterThan(5000); // депозит погашен + реальный новый долг
    expect(Math.abs(f.totalAssets - f.totalLiabEquity)).toBeLessThan(0.01);
  });
});

describe('Банкротство', () => {
  /** Загоняем фирму в минус: дорогое производство, нулевая выручка. */
  function ruinousDecision(firmId: string): FirmDecision {
    return {
      firmId,
      price: 999, // выше потолка → заказов почти нет
      production: 900,
      marketing: 0,
      capexGross: 30000,
      rnd: 0,
    };
  }

  it('внешнее управление не даёт займу расти бесконечно', () => {
    const league = makeLeague(2);
    const results = playGame(league, 5, (_, firmId, i) =>
      i === 0 ? ruinousDecision(firmId) : decide(firmId),
    );

    const victim = results.map((r) => r.firms[0]);
    const limit = makeMacroParams(0).loanLimitAbs;

    expect(victim[victim.length - 1].isBankrupt).toBe(true);
    for (const v of victim) {
      expect(v.loan).toBeLessThanOrEqual(limit + 0.01);
    }
    // Непокрытая потребность видна отдельно, а не прячется в раздутом займе.
    expect(victim[victim.length - 1].unfundedShortfall).toBeGreaterThan(0);
  });

  it('метка банкротства не сбрасывается в следующих периодах', () => {
    const league = makeLeague(2);
    const results = playGame(league, 5, (_, firmId, i) =>
      i === 0 ? ruinousDecision(firmId) : decide(firmId),
    );

    const flags = results.map((r) => r.firms[0].isBankrupt);
    const firstTrue = flags.indexOf(true);
    expect(firstTrue).toBeGreaterThanOrEqual(0);
    expect(flags.slice(firstTrue).every(Boolean)).toBe(true);
  });

  it("режим 'freeze' выключает фирму из расчёта", () => {
    const config: LeagueConfig = {
      ...DEFAULT_LEAGUE_CONFIG,
      featureFlags: { ...DEFAULT_LEAGUE_CONFIG.featureFlags, bankruptcyMode: 'freeze' },
    };
    const league = makeLeague(2, config);
    const results = playGame(league, 6, (_, firmId, i) =>
      i === 0 ? ruinousDecision(firmId) : decide(firmId),
    );

    const victim = results.map((r) => r.firms[0]);
    const frozenFrom = victim.findIndex((v) => v.isBankrupt) + 1;
    expect(frozenFrom).toBeGreaterThan(0);

    for (let i = frozenFrom; i < victim.length; i++) {
      expect(victim[i].revenue).toBe(0);
      expect(victim[i].ordersReceived).toBe(0);
      expect(victim[i].cash).toBe(victim[frozenFrom - 1].cash);
    }
  });
});
