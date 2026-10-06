/**
 * Приватный отчёт фирмы — моноширинный текст в две колонки по шаблону
 * раздела 1 источника.
 *
 * Приватность: сюда попадают только данные самой фирмы. Чужие решения и P&L
 * не рендерятся вообще — ведущий рассылает эти отчёты по одному.
 */

import type { FirmPeriodResult, LeagueConfig, PeriodResults } from '../engine/types';
import {
  labelValue,
  money,
  moneyExpense,
  num,
  percent,
  reportTimestamp,
  rule,
} from './format';

const LEFT_WIDTH = 34;
const RIGHT_WIDTH = 42;
const TOTAL_WIDTH = LEFT_WIDTH + 3 + RIGHT_WIDTH;

/** Склеивает две колонки в строку с вертикальным разделителем. */
function twoColumns(left: string[], right: string[]): string[] {
  const height = Math.max(left.length, right.length);
  const out: string[] = [];
  for (let i = 0; i < height; i++) {
    const l = (left[i] ?? '').padEnd(LEFT_WIDTH);
    const r = right[i] ?? '';
    out.push(`${l} │ ${r}`.trimEnd());
  }
  return out;
}

function subtotalRule(indent = 2): string {
  return ' '.repeat(indent) + rule(9);
}

export function renderFirmReport(
  result: FirmPeriodResult,
  period: PeriodResults,
  config: LeagueConfig,
  leagueName: string,
): string {
  const d = result.decision;

  const left: string[] = [
    'Отчёт о прибыли и убытках:',
    labelValue('Выручка', money(result.revenue), LEFT_WIDTH),
    labelValue('СЕБЕСТ', moneyExpense(result.cogs), LEFT_WIDTH),
    subtotalRule(),
    labelValue('Валовый доход', money(result.grossProfit), LEFT_WIDTH),
    labelValue('Маркетинг', moneyExpense(result.marketingExpense), LEFT_WIDTH),
    labelValue('НИОКР', moneyExpense(result.rndExpense), LEFT_WIDTH),
    labelValue('Амортизация', moneyExpense(result.depreciation), LEFT_WIDTH),
    labelValue('Штраф за увольнения', moneyExpense(result.firingPenalty), LEFT_WIDTH),
    labelValue('Стоимость хранения', moneyExpense(result.storageCost), LEFT_WIDTH),
    labelValue('Банковский процент', moneyExpense(result.bankInterest), LEFT_WIDTH),
    subtotalRule(),
    labelValue('Прибыль до налога', money(result.profitBeforeTax), LEFT_WIDTH),
    labelValue('Налог', moneyExpense(result.tax), LEFT_WIDTH),
    subtotalRule(),
    labelValue('Чистая прибыль', money(result.netProfit), LEFT_WIDTH),
    '',
    labelValue('Получено заказов', num(result.ordersReceived), LEFT_WIDTH),
    labelValue('Продано', num(result.sold), LEFT_WIDTH),
    '',
    labelValue('Невыполненных заказов', num(result.unfulfilledOrders), LEFT_WIDTH),
    labelValue('На складе', num(result.inventoryEnd), LEFT_WIDTH),
  ];

  const right: string[] = [
    'Решения (принятые в этом периоде):',
    labelValue('Цена', money(d.price, 2), RIGHT_WIDTH, 2),
    labelValue('Производство', num(d.production), RIGHT_WIDTH, 2),
    labelValue('Маркетинг', money(d.marketing), RIGHT_WIDTH, 2),
    labelValue('Инвестиции', money(d.capexGross), RIGHT_WIDTH, 2),
    labelValue('НИОКР', money(d.rnd), RIGHT_WIDTH, 2),
    '',
    'Баланс:',
    labelValue('Наличные средства', money(result.cash), RIGHT_WIDTH, 2),
    labelValue('На складе', money(result.inventoryValue), RIGHT_WIDTH, 2),
    labelValue('Капвложения', money(result.capexBookValue), RIGHT_WIDTH, 2),
    subtotalRule(4),
    labelValue('Суммарный актив', money(result.totalAssets), RIGHT_WIDTH, 2),
    '',
    labelValue('Займы', money(result.loan), RIGHT_WIDTH, 2),
    labelValue('Накопленная прибыль', money(result.retainedEarnings), RIGHT_WIDTH, 2),
    labelValue('Капитал', money(result.capital), RIGHT_WIDTH, 2),
    subtotalRule(4),
    labelValue('Обязат-ва + капитал', money(result.totalLiabEquity), RIGHT_WIDTH, 2),
    '',
    labelValue(
      'Полная мощность',
      `${money(result.fullCapacity * config.machineCost)}  ${num(result.fullCapacity)} шт`,
      RIGHT_WIDTH,
    ),
    labelValue(
      'Доп. вложения',
      `${money(result.capexAdditions)}  ${num(result.newMachines)} шт`,
      RIGHT_WIDTH,
    ),
    subtotalRule(2),
    labelValue(
      'Мощность след. период',
      `${money(result.capacityNextPeriod * config.machineCost)}  ${num(result.capacityNextPeriod)} шт`,
      RIGHT_WIDTH,
    ),
    '',
    labelValue('Использование мощности', percent(result.capacityUtilization), RIGHT_WIDTH),
    labelValue('Ст. производства ед.прод', money(result.unitCost, 2), RIGHT_WIDTH),
    labelValue('Занято в производстве', num(result.employed), RIGHT_WIDTH),
    labelValue('РИФ', num(result.rif.total, 1), RIGHT_WIDTH),
  ];

  const header =
    `"${result.firmName}"`.padEnd(24) +
    `Отчёт фирмы за ${result.periodIndex} период`.padEnd(32) +
    reportTimestamp(period.computedAt);

  const lines: string[] = [
    header,
    '',
    rule(TOTAL_WIDTH),
    ...twoColumns(left, right),
    rule(TOTAL_WIDTH),
  ];

  if (period.macro.scenarioNewsText.trim()) {
    lines.push('', ...wrapText(period.macro.scenarioNewsText.trim(), TOTAL_WIDTH));
  }

  lines.push('', `Лига «${leagueName}»`);

  if (result.isBankrupt) {
    lines.push(
      '',
      '! ФИРМА В ТЯЖЁЛОМ МИНУСЕ: наличные отрицательны, кредитная линия исчерпана.',
      `! Непокрытая потребность в средствах: ${money(result.unfundedShortfall)}.`,
    );
  }

  return lines.join('\n');
}

/** Перенос свободного текста ведущего по ширине отчёта. */
export function wrapText(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (line.length === 0) {
        line = word;
      } else if (line.length + 1 + word.length <= width) {
        line += ' ' + word;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export const FIRM_REPORT_WIDTH = TOTAL_WIDTH;
