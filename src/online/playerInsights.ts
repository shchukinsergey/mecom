import type { FirmPeriodResult } from '../engine/types';
import { DEFAULT_LEAGUE_CONFIG } from '../engine/config';

export type PlayerInsightKind =
  | 'unfulfilled-orders'
  | 'ending-inventory'
  | 'price-near-unit-cost'
  | 'bank-interest-burden'
  | 'investment-capacity-change'
  | 'net-loss'
  | 'above-economical-utilization';

export interface PlayerInsight {
  kind: PlayerInsightKind;
  text: string;
  value: number;
}

const number = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
const money = (value: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)} $`;

/** Build up to three factual observations using only this firm's two results. */
export function getPlayerInsights(
  current: FirmPeriodResult,
  previous: FirmPeriodResult | null,
  costOptimalCu = DEFAULT_LEAGUE_CONFIG.costOptimalCu,
): PlayerInsight[] {
  const observations: PlayerInsight[] = [];
  const add = (kind: PlayerInsightKind, text: string, value: number) => {
    observations.push({ kind, text, value });
  };
  if (current.unfulfilledOrders > 0) {
    add('unfulfilled-orders', `⚠️ Ваши товары востребованы, но спрос удовлетворён не полностью: осталось ${number(current.unfulfilledOrders)} невыполненных заказов. Возможно, стоит пересмотреть ценовую политику и план производства.`, current.unfulfilledOrders);
  }
  if (current.inventoryEnd > 0 && current.inventoryUnitCostEnd > 0) {
    add('ending-inventory', `⚠️ На складе осталось ${number(current.inventoryEnd)} шт. на сумму ${money(current.inventoryValue)}. Возможно, стоит сверить объём производства со спросом.`, current.inventoryEnd);
  }
  // Workbook pp. 6, 15: net profit includes sales costs and other expenses.
  // Keep shortages and stock visible; a loss precedes softer cost reminders.
  if (Number.isFinite(current.netProfit) && current.netProfit < 0) {
    add('net-loss', `⚠️ Чистая прибыль за период отрицательная: ${money(current.netProfit)}. Возможно, стоит сопоставить выручку, себестоимость продаж и прочие расходы в отчёте компании.`, current.netProfit);
  }
  const price = current.decision.price;
  if (typeof price === 'number' && current.unitCost > 0 && Math.abs(price - current.unitCost) / current.unitCost <= 0.05) {
    add('price-near-unit-cost', `⚠️ Цена (${money(price)}) почти совпадает с себестоимостью (${money(current.unitCost)}). Возможно, стоит проверить рентабельность: прочие расходы могут уменьшить прибыль.`, price);
  }
  if (current.bankInterest > 0 && current.profitBeforeTax > 0 && current.bankInterest >= current.profitBeforeTax * 0.25) {
    const share = Math.round(current.bankInterest / current.profitBeforeTax * 100);
    add('bank-interest-burden', `⚠️ Банковские проценты составили ${money(current.bankInterest)} — ${share}% от прибыли до налога. Возможно, стоит оценить долговую нагрузку.`, current.bankInterest);
  }
  if (previous && current.capacityNextPeriod < previous.capacityNextPeriod && current.newMachines < 0) {
    add('investment-capacity-change', `⚠️ Мощность следующего периода снизится с ${number(previous.capacityNextPeriod)} до ${number(current.capacityNextPeriod)} шт. Возможно, стоит проверить, покрывают ли инвестиции амортизацию оборудования.`, current.capacityNextPeriod - previous.capacityNextPeriod);
  }
  // Workbook p. 9; cost.ts adds a quadratic penalty around the league's
  // costOptimalCu (80 by default). This is a unit-cost target, not a profit target.
  // Append this softer reminder so existing shortages/inventory remain visible.
  // Compare the same one-decimal percentage we show, avoiding warnings for
  // integer-rounded 80% production plans whose displayed utilization is 80.0%.
  const displayedUtilization = Number((current.capacityUtilization * 100).toFixed(1));
  if (Number.isFinite(current.capacityUtilization) && Number.isFinite(displayedUtilization)
    && Number.isFinite(costOptimalCu) && displayedUtilization > costOptimalCu
    && Number.isFinite(current.produced) && current.produced > 0) {
    const utilization = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(displayedUtilization);
    add('above-economical-utilization', `⚠️ Загрузка мощности — ${utilization}% при выпуске ${number(current.produced)} шт.; минимум себестоимости единицы — при ${number(costOptimalCu)}%. Возможно, стоит сопоставить пользу дополнительного выпуска со спросом и ростом себестоимости единицы.`, current.capacityUtilization);
  }
  return observations.slice(0, 3);
}
