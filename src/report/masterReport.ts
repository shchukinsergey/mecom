/**
 * Сводный отчёт периода — приватный, только для ведущего.
 *
 * В отличие от отраслевого отчёта (industryReport.ts), здесь нет редактирования
 * чужих решений: показаны решения, вся цепочка «заказы → производство → склад →
 * сбыт», наращивание мощности, полный P&L/баланс и разбивка РИФ по каждой из
 * шести компонент — для всех фирм разом. Банкроты НЕ маскируются метками: это
 * ведущий, а не рассылка игрокам, он должен видеть реальные цифры.
 */

import type { FirmPeriodResult, PeriodMacroParams, PeriodResults } from '../engine/types';
import { renderIndustryStats } from './industryReport';
import { centre, money, num, padLeft, percent, rule } from './format';

const TOTAL_WIDTH = 79;
const COLUMN = 39;
const LABEL_WIDTH = 16;
const CELL_WIDTH = 12;

interface MasterRow {
  label: string;
  values: string[];
}

/**
 * Остаток на складе на начало периода восстанавливается из тождества склада
 * (computePeriod.ts: available = produced + opening.inventory; inventoryEnd =
 * available − sold) — отдельного поля под это заводить не нужно.
 */
function openingInventory(f: FirmPeriodResult): number {
  return f.inventoryEnd - f.produced + f.sold;
}

/**
 * Свободные средства = наличные + неиспользованный остаток кредитной линии до
 * абсолютного предела с отсечением на нуле, по факту на конец периода.
 * Это НЕ нативный бюджет ввода: тот сохраняет отрицательный кредит и
 * отдельно округляет кредит/усекает наличные.
 */
function freeFunds(f: FirmPeriodResult, macro: PeriodMacroParams): number {
  return f.cash + Math.max(0, macro.loanLimitAbs - f.loan);
}

function buildRowGroups(period: PeriodResults): MasterRow[][] {
  const firms = period.firms;
  const macro = period.macro;

  const decisions: MasterRow[] = [
    { label: 'Цена', values: firms.map((f) => money(f.decision.price, 2)) },
    { label: 'Произв', values: firms.map((f) => num(f.decision.production)) },
    { label: 'Маркет', values: firms.map((f) => money(f.decision.marketing)) },
    { label: 'Инвест', values: firms.map((f) => money(f.decision.capexGross)) },
    { label: 'НИОКР', values: firms.map((f) => money(f.decision.rnd)) },
  ];

  const flow: MasterRow[] = [
    { label: 'Заказы', values: firms.map((f) => num(f.ordersReceived)) },
    { label: 'Произв', values: firms.map((f) => num(f.produced)) },
    { label: 'Б/Склд', values: firms.map((f) => num(openingInventory(f))) },
    { label: 'Сбыт', values: firms.map((f) => num(f.sold)) },
    { label: 'Н/Склд', values: firms.map((f) => num(f.inventoryEnd)) },
    { label: 'НевЗак', values: firms.map((f) => num(f.unfulfilledOrders)) },
  ];

  const capacity: MasterRow[] = [
    { label: 'Мощн.', values: firms.map((f) => num(f.fullCapacity)) },
    { label: 'ДопМощ', values: firms.map((f) => num(f.newMachines)) },
    { label: 'НовМощ', values: firms.map((f) => num(f.capacityNextPeriod)) },
    { label: 'ИспМощ', values: firms.map((f) => percent(f.capacityUtilization)) },
    { label: 'Себест', values: firms.map((f) => money(f.unitCost, 2)) },
  ];

  const finance: MasterRow[] = [
    { label: 'Выручк', values: firms.map((f) => money(f.revenue)) },
    { label: 'Ч.Приб', values: firms.map((f) => money(f.netProfit)) },
    { label: 'Н.Приб', values: firms.map((f) => money(f.retainedEarnings)) },
    { label: 'Н.Пот.', values: firms.map((f) => money(f.rndCumulative)) },
    { label: 'Займ', values: firms.map((f) => money(f.loan)) },
    { label: 'Наличн', values: firms.map((f) => money(f.cash)) },
    { label: 'СвобСр', values: firms.map((f) => money(freeFunds(f, macro))) },
  ];

  // Компоненты РИФ (мекомspec, часть 1: C1..C6) — каждая уже округлена до
  // целого отдельно, поэтому здесь без знаков после запятой.
  const rif: MasterRow[] = [
    { label: 'Н.Приб', values: firms.map((f) => num(f.rif.retainedProfitScore)) },
    { label: 'ПотСпр', values: firms.map((f) => num(f.rif.demandPotential)) },
    { label: 'ПотПр.', values: firms.map((f) => num(f.rif.supplyPotential)) },
    { label: 'Эфф80%', values: firms.map((f) => num(f.rif.efficiency80)) },
    { label: 'Доля Р', values: firms.map((f) => num(f.rif.marketShareScore)) },
    { label: 'Рост', values: firms.map((f) => num(f.rif.growthScore)) },
    { label: 'РИФ', values: firms.map((f) => num(f.rif.total)) },
  ];

  return [decisions, flow, capacity, finance, rif];
}

/**
 * Полная таблица решений, операционной цепочки, мощности, P&L и РИФ по всем
 * фирмам. При большом числе фирм, как и в отраслевом отчёте, разбивается на
 * блоки по несколько колонок для читаемости.
 */
export function renderMasterTable(period: PeriodResults, columnsPerBlock = 5): string[] {
  const groups = buildRowGroups(period);
  const out: string[] = [];

  const row = (label: string, cells: string[]) =>
    label.padEnd(LABEL_WIDTH) + cells.map((c) => padLeft(c, CELL_WIDTH)).join('');

  for (let start = 0; start < period.firms.length; start += columnsPerBlock) {
    const chunk = period.firms.slice(start, start + columnsPerBlock);

    out.push(row('', chunk.map((f) => f.firmName.slice(0, CELL_WIDTH - 1))));
    out.push(row('-'.repeat(LABEL_WIDTH - 1), chunk.map(() => '-'.repeat(CELL_WIDTH - 1))));

    for (const group of groups) {
      for (const r of group) {
        out.push(row(r.label, r.values.slice(start, start + columnsPerBlock)));
      }
      out.push('');
    }
    out.pop(); // не нужна пустая строка после последней группы блока

    if (start + columnsPerBlock < period.firms.length) out.push('');
  }

  return out;
}

function pairColumns(left: string, right: string): string {
  return `${left.padEnd(COLUMN)} ${right}`.trimEnd();
}

function rankingRow(value: string, name: string, valueWidth: number, nameWidth: number): string {
  return `${padLeft(value, valueWidth)} - ${name.padEnd(nameWidth)}`;
}

/**
 * Два рейтинга фирм бок о бок: по РИФ и по чистой прибыли, по убыванию.
 * В отличие от сравнительной таблицы отраслевого отчёта — без масок банкрота,
 * ведущему нужны настоящие цифры, чтобы видеть реальную картину партии.
 */
export function renderRankings(period: PeriodResults): string[] {
  const firms = period.firms;
  const nameWidth = Math.max(8, ...firms.map((f) => f.firmName.length));

  const byRif = [...firms].sort((a, b) => b.rif.total - a.rif.total);
  const byProfit = [...firms].sort((a, b) => b.netProfit - a.netProfit);

  const rifValues = byRif.map((f) => num(f.rif.total));
  const profitValues = byProfit.map((f) => num(f.netProfit));
  const rifWidth = Math.max(4, ...rifValues.map((v) => v.length));
  const profitWidth = Math.max(6, ...profitValues.map((v) => v.length));

  const lines: string[] = [
    pairColumns(
      rankingRow('РИФ', 'Фирма', rifWidth, nameWidth),
      rankingRow('Ч.Приб', 'Фирма', profitWidth, nameWidth),
    ),
    pairColumns(
      rankingRow('-'.repeat(rifWidth), '-'.repeat(nameWidth), rifWidth, nameWidth),
      rankingRow('-'.repeat(profitWidth), '-'.repeat(nameWidth), profitWidth, nameWidth),
    ),
  ];

  for (let i = 0; i < firms.length; i++) {
    lines.push(
      pairColumns(
        rankingRow(rifValues[i], byRif[i].firmName, rifWidth, nameWidth),
        rankingRow(profitValues[i], byProfit[i].firmName, profitWidth, nameWidth),
      ),
    );
  }

  return lines;
}

export function renderMasterReport(period: PeriodResults, leagueName: string): string {
  const lines: string[] = [];

  lines.push(centre(`С В О Д Н Ы Й   О Т Ч Ё Т   « ${leagueName} »`, TOTAL_WIDTH));
  lines.push('');
  lines.push(...renderIndustryStats(period));
  lines.push('');
  lines.push(rule(TOTAL_WIDTH));
  lines.push(...renderMasterTable(period));
  lines.push(rule(TOTAL_WIDTH));
  lines.push('');
  lines.push(...renderRankings(period));

  return lines.join('\n');
}

export const MASTER_REPORT_WIDTH = TOTAL_WIDTH;
