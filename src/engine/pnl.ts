/**
 * Отчёт о прибылях и убытках (раздел 5 источника — официальная версия).
 *
 * Используются официальные формулы, подтверждённые на реальном отчёте RLC
 * (раздел 0), а НЕ упрощённая «версия А» из раздела 5.1: та зафиксирована под
 * конкретную чужую партию (плоские 20% по займу, налог 25%, хранение без задержки).
 */

import type { LeagueConfig, PeriodMacroParams } from './types';
import { computeFiringPenalty } from './industry';

export interface BankInterestInput {
  /**
   * Остаток займа, от которого считается процент. Поле называется
   * `openingLoan` по историческим причинам, но вызывающий код может передать
   * сюда и закрывающий остаток периода — см. `computeBankInterest` ниже.
   */
  openingLoan: number;
  loanLimitBase: number;
  bankRateBase: number; // годовая доля
  bankRateExtra: number; // годовая доля
}

/**
 * Банковский процент — официальная формула с разделением на транши.
 *
 * Проверено на RLC: заём $80 002 при лимите $60 000, ставки 20% + 1% обслуживания
 * и 80% сверх лимита →
 *   60000 × (20% + 1%)/4 + 20002 × 80%/4 = 3150 + 4000,4 = $7150 (в отчёте $7 150).
 *
 * Процент считается по остатку займа, который передаёт вызывающий код — эта
 * функция сама не решает, входящий он или закрывающий. Официально процент
 * должен облагать и заём, взятый в этом же периоде, а это создаёт цикл:
 * процент → кэш → новый заём → процент. Цикл разрешается итеративным
 * пересчётом P&L и кэш-флоу на уровне оркестратора (`resolvePnlAndCashFlow` в
 * `computePeriod.ts`) до схождения — сама эта функция остаётся чистой и
 * ничего не знает об итерации. На отчёте RLC заём за период не изменился,
 * поэтому входящий и закрывающий остаток совпадают.
 *
 * ── Отрицательный заём — это депозит ────────────────────────────────────
 * При `featureFlags.loanRepayment: 'sweep'` погашение не останавливается на
 * нуле: если входящего избытка кэша больше, чем весь заём, остаток уходит «в
 * минус» — это и есть депозит (см. `cashflow.ts`). На депозит НЕ действуют
 * ни транши, ни `loanLimitBase/Abs` — банк платит фирме фиксированную ставку
 * `config.depositRate`, отдельную от ставок по займу. Функция возвращает
 * ОТРИЦАТЕЛЬНОЕ значение (не расход, а доход) — этого достаточно, чтобы вся
 * остальная арифметика (P&L вычитает `bankInterest`, кэш-флоу вычитает его
 * же в `spending`) сама превратила его в прибавку к прибыли и деньгам, без
 * отдельных веток в вызывающем коде.
 */
export function computeBankInterest(
  input: BankInterestInput,
  config: LeagueConfig,
): number {
  const loan = input.openingLoan;

  if (loan < 0) {
    const deposit = -loan;
    return -(deposit * config.depositRate) / config.periodsPerYear;
  }

  if (loan === 0) return 0;

  const periods = config.periodsPerYear;

  if (config.featureFlags.bankInterestFormula === 'flatLoanRate') {
    // Упрощённый режим для новичков: одна ставка на весь заём.
    return (loan * input.bankRateBase) / periods;
  }

  const withinLimit = Math.min(loan, Math.max(0, input.loanLimitBase));
  const aboveLimit = Math.max(0, loan - Math.max(0, input.loanLimitBase));

  const baseRate = (input.bankRateBase + config.serviceFee) / periods;
  const extraRate = input.bankRateExtra / periods;

  return withinLimit * baseRate + aboveLimit * extraRate;
}

export interface PnlInput {
  price: number;
  sold: number;
  produced: number;
  unitCost: number;
  inventoryOpening: number;
  inventoryOpeningUnitCost: number;
  /** Единицы, пролежавшие на складе ВЕСЬ предыдущий период. */
  inventoryAgedUnits: number;
  marketing: number;
  rnd: number;
  depreciation: number;
  employeesPrevious: number;
  employeesCurrent: number;
  /**
   * Уже посчитанный банковский процент (см. `computeBankInterest`). Вызывающий
   * код сам решает, от какого остатка займа его считать — эта функция лишь
   * вычитает готовое значение из прибыли, никакой циклической зависимости
   * здесь нет.
   */
  bankInterest: number;
}

export interface PnlResult {
  revenue: number;
  cogs: number;
  grossProfit: number;
  marketingExpense: number;
  rndExpense: number;
  depreciation: number;
  firingPenalty: number;
  storageCost: number;
  bankInterest: number;
  profitBeforeTax: number;
  tax: number;
  netProfit: number;
  /** Средневзвешенная себестоимость остатка на складе на конец периода. */
  inventoryUnitCostEnd: number;
}

/**
 * СЕБЕСТ (COGS) — средневзвешенная себестоимость проданного:
 *   (склад_old × себест_old + произведено × себест_new) / (склад_old + произведено) × продано
 *
 * Упрощение «продано × себестоимость» из памятки верно только при пустом складе
 * (как в примере RLC, где склад = 0) — в общем случае нужна средневзвешенная.
 */
export function weightedUnitCost(input: {
  inventoryOpening: number;
  inventoryOpeningUnitCost: number;
  produced: number;
  unitCost: number;
}): number {
  const units = input.inventoryOpening + input.produced;
  if (units <= 0) return input.unitCost;
  return (
    (input.inventoryOpening * input.inventoryOpeningUnitCost + input.produced * input.unitCost) /
    units
  );
}

export function computePnl(
  input: PnlInput,
  macro: PeriodMacroParams,
  config: LeagueConfig,
): PnlResult {
  const revenue = input.price * input.sold;

  const avgCost = weightedUnitCost(input);
  const cogs = avgCost * input.sold;
  const grossProfit = revenue - cogs;

  const firingPenalty = computeFiringPenalty(input.employeesPrevious, input.employeesCurrent, config);

  // Оригинальный MECOM берёт плату только за входящий склад, оставшийся
  // на конец периода. Свежий выпуск не увеличивает оплачиваемый остаток;
  // явно заданное число старых единиц также ограничивает плату.
  const inventoryClosing = Math.max(0, input.inventoryOpening + input.produced - input.sold);
  const storedUnits = Math.max(
    0,
    Math.min(input.inventoryAgedUnits, input.inventoryOpening, inventoryClosing),
  );
  const storageCost = config.storageCostPerUnit * storedUnits;

  const bankInterest = input.bankInterest;

  const profitBeforeTax =
    grossProfit -
    input.marketing -
    input.rnd -
    input.depreciation -
    firingPenalty -
    storageCost -
    bankInterest;

  // Налог берётся из макропараметров периода, а не 25% из конспекта: на реальном
  // отчёте подтвердилась ставка 32% ровно из блока «Ст.нал.на приб.».
  const tax = macro.taxRate * Math.max(0, profitBeforeTax);
  const netProfit = profitBeforeTax - tax;

  return {
    revenue,
    cogs,
    grossProfit,
    marketingExpense: input.marketing,
    rndExpense: input.rnd,
    depreciation: input.depreciation,
    firingPenalty,
    storageCost,
    bankInterest,
    profitBeforeTax,
    tax,
    netProfit,
    inventoryUnitCostEnd: avgCost,
  };
}
