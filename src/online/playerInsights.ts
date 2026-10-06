import type { FirmPeriodResult } from '../engine/types';

export type PlayerInsightKind =
  | 'unfulfilled-orders'
  | 'ending-inventory'
  | 'price-near-unit-cost'
  | 'bank-interest-burden'
  | 'investment-capacity-change';

export interface PlayerInsight {
  kind: PlayerInsightKind;
  text: string;
  value: number;
}

const number = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value);
const money = (value: number) => `${number(value)} $`;

/** Build up to three factual observations using only this firm's two results. */
export function getPlayerInsights(
  current: FirmPeriodResult,
  previous: FirmPeriodResult | null,
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
  return observations.slice(0, 3);
}
