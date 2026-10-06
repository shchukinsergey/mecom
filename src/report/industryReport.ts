/**
 * Публичный отраслевой отчёт: блок «Экономика», блок «Индустрия» и
 * сравнительная таблица фирм (шаблон раздела 1 источника).
 *
 * Рассылается всем без ограничений — здесь нет ни решений фирм, ни их P&L,
 * только те шесть строк сравнения, что видны всем в оригинале.
 */

import type { PeriodResults } from '../engine/types';
import {
  deltaPercent,
  deltaUnits,
  labelValue,
  money,
  num,
  padLeft,
  percent,
  rule,
} from './format';

const TOTAL_WIDTH = 79;
const COLUMN = 39;

/** Строка блока индустрии: подпись, значение, изменение к прошлому периоду. */
function statLine(label: string, value: string, delta: string): string {
  const body = labelValue(label, value, COLUMN - 8);
  return `${body} ${padLeft(delta, 7)}`;
}

function pair(left: string, right: string): string {
  return `${left.padEnd(COLUMN)} ${right}`.trimEnd();
}

/**
 * Метка вместо числа для фирмы в тяжёлом минусе (ТЗ п.5).
 * Числа таких фирм не показываем — иначе они смешиваются с обычными.
 */
function firmCell(value: string, isBankrupt: boolean, label: string): string {
  return isBankrupt ? label : value;
}

/**
 * Блок «Экономика» + «Индустрия»: агрегаты периода с изменениями к прошлому.
 * Общий для публичного отраслевого отчёта и приватного сводного отчёта
 * ведущего — оба показывают одни и те же макропоказатели.
 */
export function renderIndustryStats(period: PeriodResults): string[] {
  const ind = period.industry;
  const d = ind.deltas;
  const lines: string[] = [];

  // Левая половина — натуральные показатели, правая — «Экономика» (макропараметры).
  lines.push(
    pair(
      statLine('Всего заказов', num(ind.totalOrders), deltaPercent(d.totalOrders)),
      statLine('Банк. ст. (осн)', percent(ind.bankRateBase), deltaPercent(d.bankRateBase)),
    ),
  );
  lines.push(
    pair(
      statLine('Всего произв.', num(ind.totalProduced), deltaPercent(d.totalProduced)),
      statLine('Сум. займа (осн)', money(ind.loanAmountBase), deltaPercent(d.loanAmountBase)),
    ),
  );
  lines.push(
    pair(
      statLine('Всего продано', num(ind.totalSold), deltaPercent(d.totalSold)),
      statLine('Банк. ст. (экс)', percent(ind.bankRateExtra), ''),
    ),
  );
  lines.push(
    pair(
      statLine('Складировано', num(ind.totalInventory), deltaUnits(d.totalInventory)),
      statLine('Сум. займа (экс)', money(ind.loanAmountExtra), ''),
    ),
  );
  lines.push(
    pair(
      statLine('Общая мощность', num(ind.totalCapacity), deltaPercent(d.totalCapacity)),
      statLine('Ст.нал.на приб.', percent(ind.taxRate, 0), ''),
    ),
  );
  lines.push('');
  lines.push(
    pair(
      statLine('Выручка по инд.', money(ind.industryRevenue), deltaPercent(d.industryRevenue)),
      statLine('Капвложения', money(ind.totalCapex), deltaPercent(d.totalCapex)),
    ),
  );
  lines.push(
    pair(
      statLine('Средняя цена', money(ind.avgPrice, 2), deltaPercent(d.avgPrice)),
      statLine(
        'Исп.мощности',
        percent(ind.industryUtilization),
        deltaPercent(d.industryUtilization),
      ),
    ),
  );
  lines.push(
    pair(
      statLine('Ст-сть пр-ва ед.', money(ind.avgUnitCost, 2), deltaPercent(d.avgUnitCost)),
      statLine('Служащих', num(ind.totalEmployees), ''),
    ),
  );

  return lines;
}

export function renderIndustryReport(period: PeriodResults, leagueName: string): string {
  const lines: string[] = [];

  lines.push(centreTitle(`И Н Д У С Т Р И Я  «${leagueName}»`));
  lines.push('');
  lines.push(...renderIndustryStats(period));
  lines.push('');
  lines.push(rule(TOTAL_WIDTH));
  lines.push(...renderComparisonTable(period));
  lines.push(rule(TOTAL_WIDTH));

  return lines.join('\n');
}

/**
 * Сравнительная таблица всех фирм. Колонки подстраиваются под число фирм;
 * при большом числе фирм таблица разбивается на несколько блоков, чтобы
 * оставаться читаемой в моноширинном тексте.
 */
export function renderComparisonTable(period: PeriodResults, columnsPerBlock = 5): string[] {
  const labelWidth = 16;
  const cellWidth = 12;
  const out: string[] = [];

  for (let start = 0; start < period.firms.length; start += columnsPerBlock) {
    const chunk = period.firms.slice(start, start + columnsPerBlock);

    const row = (label: string, cells: string[]) =>
      label.padEnd(labelWidth) + cells.map((c) => padLeft(c, cellWidth)).join('');

    out.push(row('', chunk.map((f) => f.firmName.slice(0, cellWidth - 1))));
    out.push(
      row(
        'Цена',
        chunk.map((f) => firmCell(money(f.decision.price, 2), f.isBankrupt, 'Убытки')),
      ),
    );
    out.push(
      row(
        'Выручка',
        chunk.map((f) => firmCell(money(f.revenue), f.isBankrupt, 'банкрот')),
      ),
    );
    out.push(
      row(
        'Ч.Приб',
        chunk.map((f) => firmCell(money(f.netProfit), f.isBankrupt, 'Убытки')),
      ),
    );
    out.push(
      row(
        'Н.Приб',
        chunk.map((f) => firmCell(money(f.retainedEarnings), f.isBankrupt, 'Убытки')),
      ),
    );
    out.push(
      row(
        'Доля Р',
        // Доля рынка — в штуках проданного (мекомspec 1: доля_i = 100·сбыт_i/Σсбыт),
        // а не в полученных заказах.
        chunk.map((f) => firmCell(percent(f.marketShareSold / 100), f.isBankrupt, 'акц-ров:')),
      ),
    );
    out.push(
      row(
        'РИФ',
        chunk.map((f) => firmCell(num(f.rif.total, 1), f.isBankrupt, '—')),
      ),
    );

    if (start + columnsPerBlock < period.firms.length) out.push('');
  }

  return out;
}

function centreTitle(text: string): string {
  const pad = Math.max(0, Math.floor((TOTAL_WIDTH - text.length) / 2));
  return ' '.repeat(pad) + text;
}

export const INDUSTRY_REPORT_WIDTH = TOTAL_WIDTH;
