import { describe, expect, it } from 'vitest';
import { computePeriod, initialOpeningState } from '../../engine/computePeriod';
import { DEFAULT_FIRM_START, DEFAULT_LEAGUE_CONFIG, makeMacroParams } from '../../engine/config';
import type { FirmDecision, League } from '../../engine/types';
import { renderFirmReport, renderFirmExport, renderIndustryReport, renderMasterReport } from '../index';
import { money, num, deltaPercent, percent } from '../format';

function buildPeriod(newsText = '') {
  const league: League = {
    id: 'L',
    name: 'Дельта',
    createdAt: new Date().toISOString(),
    config: DEFAULT_LEAGUE_CONFIG,
    firms: [
      { ...DEFAULT_FIRM_START, id: 'a', name: 'Альфа' },
      { ...DEFAULT_FIRM_START, id: 'b', name: 'Бета' },
      { ...DEFAULT_FIRM_START, id: 'c', name: 'Гамма' },
    ],
    macroByPeriod: [],
    decisionsByPeriod: [],
    confirmedByPeriod: [],
    results: [],
  };

  const decisions: Record<string, FirmDecision> = {
    a: { firmId: 'a', price: 30, production: 420, marketing: 3000, capexGross: 1050, rnd: 700 },
    b: { firmId: 'b', price: 38, production: 400, marketing: 1234, capexGross: 5000, rnd: 111 },
    c: { firmId: 'c', price: 45, production: 300, marketing: 9999, capexGross: 0, rnd: 4321 },
  };

  const period = computePeriod({
    periodIndex: 0,
    config: league.config,
    macro: { ...makeMacroParams(0), scenarioNewsText: newsText },
    firms: league.firms.map((f) => ({ id: f.id, name: f.name })),
    opening: initialOpeningState(league),
    decisions,
  });

  return { league, period, decisions };
}

describe('Отчёт фирмы', () => {
  const { league, period } = buildPeriod();
  const alpha = period.firms[0];
  const text = renderFirmReport(alpha, period, league.config, league.name);

  it('содержит все строки P&L из шаблона', () => {
    for (const label of [
      'Выручка',
      'СЕБЕСТ',
      'Валовый доход',
      'Маркетинг',
      'НИОКР',
      'Амортизация',
      'Штраф за увольнения',
      'Стоимость хранения',
      'Банковский процент',
      'Прибыль до налога',
      'Налог',
      'Чистая прибыль',
      'Получено заказов',
      'Продано',
      'Невыполненных заказов',
      'На складе',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('содержит блоки решений, баланса и мощности', () => {
    for (const label of [
      'Решения (принятые в этом периоде)',
      'Баланс:',
      'Суммарный актив',
      'Обязат-ва + капитал',
      'Полная мощность',
      'Мощность след. период',
      'Использование мощности',
      'Ст. производства ед.прод',
      'Занято в производстве',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('НЕ раскрывает решения и P&L других фирм', () => {
    // Уникальные цифры соперников: маркетинг Беты $1,234 и НИОКР Гаммы $4,321.
    expect(text).not.toContain('1,234');
    expect(text).not.toContain('4,321');
    expect(text).not.toContain('Бета');
    expect(text).not.toContain('Гамма');
  });

  it('печатает собственные цифры фирмы', () => {
    expect(text).toContain('"Альфа"');
    expect(text).toContain(money(alpha.revenue));
    expect(text).toContain(num(alpha.ordersReceived));
    expect(text).toContain(percent(alpha.capacityUtilization));
  });

  it('колонки выровнены — все строки одной ширины до разделителя', () => {
    const body = text.split('\n').filter((l) => l.includes('│'));
    expect(body.length).toBeGreaterThan(15);
    const positions = new Set(body.map((l) => l.indexOf('│')));
    expect(positions.size).toBe(1);
  });

  it('новостной текст ведущего попадает под отчёт с переносом по ширине', () => {
    const news = 'Правительство объявило о снижении пошлин. '.repeat(6);
    const withNews = renderFirmReport(period.firms[0], { ...period, macro: { ...period.macro, scenarioNewsText: news } }, league.config, league.name);
    expect(withNews).toContain('Правительство объявило');
    for (const line of withNews.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(90);
    }
  });
});

describe('Отраслевой отчёт', () => {
  const { league, period } = buildPeriod();
  const text = renderIndustryReport(period, league.name);

  it('содержит блок «Экономика» с макропараметрами', () => {
    for (const label of [
      'Банк. ст. (осн)',
      'Сум. займа (осн)',
      'Банк. ст. (экс)',
      'Сум. займа (экс)',
      'Ст.нал.на приб.',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('содержит агрегаты индустрии', () => {
    for (const label of [
      'Всего заказов',
      'Всего произв.',
      'Всего продано',
      'Складировано',
      'Общая мощность',
      'Выручка по инд.',
      'Средняя цена',
      'Исп.мощности',
    ]) {
      expect(text).toContain(label);
    }
  });

  it('в сравнительной таблице есть все фирмы и шесть строк сравнения', () => {
    for (const name of ['Альфа', 'Бета', 'Гамма']) expect(text).toContain(name);
    for (const row of ['Цена', 'Выручка', 'Ч.Приб', 'Н.Приб', 'Доля Р', 'РИФ']) {
      expect(text).toContain(row);
    }
  });

  it('в первом периоде изменений к предыдущему нет', () => {
    expect(deltaPercent(period.industry.deltas.totalOrders)).toBe('');
  });

  it('банкрот показан текстовой меткой вместо чисел', () => {
    const bankrupt = {
      ...period,
      firms: period.firms.map((f, i) => (i === 1 ? { ...f, isBankrupt: true } : f)),
    };
    const out = renderIndustryReport(bankrupt, league.name);
    expect(out).toContain('банкрот');
    expect(out).toContain('Убытки');
    // Выручка банкрота числом не печатается.
    expect(out).not.toContain(money(period.firms[1].revenue));
  });
});

describe('Сводный отчёт (для ведущего)', () => {
  const { league, period, decisions } = buildPeriod();
  const text = renderMasterReport(period, league.name);

  it('Н.Пот. показывает накопленные НИОКР, а не нехватку финансирования', () => {
    const changed = { ...period, firms: period.firms.map((f, i) => ({
      ...f, rndCumulative: 5420 + i, unfundedShortfall: 0,
    })) };
    const row = renderMasterReport(changed, league.name).split('\n')
      .find(line => line.trimStart().startsWith('Н.Пот.'))!;
    for (const firm of changed.firms) expect(row).toContain(money(firm.rndCumulative));
  });

  it('содержит блок «Экономика» с макропараметрами', () => {
    for (const label of ['Банк. ст. (осн)', 'Сум. займа (осн)', 'Ст.нал.на приб.']) {
      expect(text).toContain(label);
    }
  });

  it('содержит все фирмы и полный набор строк: решения, поток заказов, мощность, P&L, компоненты РИФ', () => {
    for (const name of ['Альфа', 'Бета', 'Гамма']) expect(text).toContain(name);
    for (const row of [
      'Цена',
      'Произв',
      'Маркет',
      'Инвест',
      'НИОКР',
      'Заказы',
      'Б/Склд',
      'Сбыт',
      'Н/Склд',
      'НевЗак',
      'Мощн.',
      'ДопМощ',
      'НовМощ',
      'ИспМощ',
      'Себест',
      'Выручк',
      'Ч.Приб',
      'Н.Приб',
      'Н.Пот.',
      'Займ',
      'Наличн',
      'СвобСр',
      'ПотСпр',
      'ПотПр.',
      'Эфф80%',
      'Доля Р',
      'Рост',
      'РИФ',
    ]) {
      expect(text).toContain(row);
    }
  });

  it('печатает решения каждой фирмы, включая уникальные цифры соперников', () => {
    // В отличие от приватного отчёта фирмы, здесь это разные фирмы одного ведущего,
    // а не рассылка игрокам — секретов друг от друга у них тут нет.
    for (const decision of Object.values(decisions)) {
      expect(text).toContain(money(decision.marketing));
    }
  });

  it('НЕ маскирует банкрота меткой — ведущему нужны настоящие цифры', () => {
    const bankrupt = {
      ...period,
      firms: period.firms.map((f, i) => (i === 1 ? { ...f, isBankrupt: true } : f)),
    };
    const out = renderMasterReport(bankrupt, league.name);
    expect(out).toContain(money(period.firms[1].revenue));
    expect(out).toContain(money(period.firms[1].netProfit));
  });

  it('рейтинги РИФ и чистой прибыли содержат всех фирм в порядке убывания', () => {
    expect(text).toContain('РИФ - Фирма');
    expect(text).toContain('Ч.Приб - Фирма');

    const byRif = [...period.firms].sort((a, b) => b.rif.total - a.rif.total);
    const byProfit = [...period.firms].sort((a, b) => b.netProfit - a.netProfit);
    const lines = text.split('\n');
    const rifStart = lines.findIndex((l) => l.includes('РИФ - Фирма')) + 2;
    for (let i = 0; i < byRif.length; i++) {
      expect(lines[rifStart + i]).toContain(byRif[i].firmName);
      expect(lines[rifStart + i]).toContain(byProfit[i].firmName);
    }
  });
});

describe('Экспорт для рассылки', () => {
  const { league, period } = buildPeriod();

  it('по умолчанию склеивает отчёт фирмы и отраслевой блок', () => {
    const full = renderFirmExport(period.firms[0], period, league.config, league.name);
    expect(full).toContain('Отчёт фирмы за 0 период');
    expect(full).toContain('И Н Д У С Т Р И Я');
  });

  it('отраслевой блок можно отключить', () => {
    const only = renderFirmExport(period.firms[0], period, league.config, league.name, false);
    expect(only).toContain('Отчёт фирмы за 0 период');
    expect(only).not.toContain('И Н Д У С Т Р И Я');
  });
});
