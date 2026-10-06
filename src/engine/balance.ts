/**
 * Баланс фирмы (раздел 7 источника) и проверка основного тождества.
 */

export interface BalanceInput {
  cash: number;
  inventoryUnits: number;
  inventoryUnitCost: number;
  capexBookValue: number;
  loan: number;
  retainedEarningsOpening: number;
  netProfit: number;
  capital: number;
}

export interface BalanceResult {
  cash: number;
  inventoryValue: number;
  capexBookValue: number;
  totalAssets: number;
  loan: number;
  retainedEarnings: number;
  capital: number;
  totalLiabEquity: number;
  /** Расхождение актива и пассива; должно быть нулевым с точностью до копеек. */
  discrepancy: number;
}

export function computeBalance(input: BalanceInput): BalanceResult {
  const inventoryValue = input.inventoryUnits * input.inventoryUnitCost;
  const totalAssets = input.cash + inventoryValue + input.capexBookValue;

  const retainedEarnings = input.retainedEarningsOpening + input.netProfit;
  const totalLiabEquity = input.loan + retainedEarnings + input.capital;

  return {
    cash: input.cash,
    inventoryValue,
    capexBookValue: input.capexBookValue,
    totalAssets,
    loan: input.loan,
    retainedEarnings,
    capital: input.capital,
    totalLiabEquity,
    discrepancy: totalAssets - totalLiabEquity,
  };
}

/**
 * Тождество «Актив == Пассив + Капитал» (ТЗ 6.1, шаг 8).
 *
 * Выполняется по построению: Δактив = ЧП + Δзайм, что в точности равно
 * Δнакопленной прибыли + Δпассива. Допуск нужен только под ошибку округления,
 * поэтому он маленький — реальных расхождений тут быть не должно.
 */
export function assertBalanceIdentity(balance: BalanceResult, tolerance = 1): void {
  if (Math.abs(balance.discrepancy) > tolerance) {
    throw new Error(
      `Баланс не сходится: актив ${balance.totalAssets.toFixed(2)} ` +
        `против пассив+капитал ${balance.totalLiabEquity.toFixed(2)} ` +
        `(расхождение ${balance.discrepancy.toFixed(2)})`,
    );
  }
}
