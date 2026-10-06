/**
 * Инвестиции, амортизация и мощность следующего периода (раздел 4 источника).
 *
 * «Остаточный принцип»: решение игрока «Инвестиции» — это ИНВЕСТИЦИИ-БРУТТО,
 * они сперва покрывают амортизацию, а остаток идёт на новые станки.
 */

import type { LeagueConfig } from './types';

export interface CapexInput {
  /** Станки на начало периода («Полная мощность»). */
  machines: number;
  /** Решение игрока «Инвестиции», $. */
  capexGross: number;
  /** Недоинвестированный остаток, накопленный за прошлые периоды, $. */
  amortFundRemainder: number;
}

export interface CapexResult {
  depreciation: number; // амортизация всего, $
  netInvestment: number; // инвестиции-нетто, $
  newMachines: number; // прирост станков (может быть отрицательным)
  capexAdditions: number; // доп. вложения в станки, $
  amortFundRemainder: number; // новый остаток в амортфонде, $
  capacityNext: number; // мощность следующего периода, шт
  capexBookValue: number; // «Капвложения» в балансе, $
}

/**
 * Оригинальный MECOM амортизирует всю входящую балансовую стоимость,
 * включая остаток в амортфонде, с округлением до целого доллара (half-up).
 */
export function computeDepreciation(
  machines: number,
  config: LeagueConfig,
  amortFundRemainder: number = 0,
): number {
  const openingBookValue = machines * config.machineCost + amortFundRemainder;
  return Math.floor(openingBookValue / config.machineLifespanPeriods + 0.5);
}

export function computeCapex(input: CapexInput, config: LeagueConfig): CapexResult {
  const depreciation = computeDepreciation(input.machines, config, input.amortFundRemainder);
  const netInvestment = input.capexGross - depreciation;

  // Недоинвестированные доллары копятся между периодами: в реальном отчёте RLC
  // капвложения $48 153 при 1203 станках × $40 = $48 120, то есть в фонде лежит
  // 33 = 30 (перенос с прошлых периодов) + 3 (текущий остаток).
  const pool = netInvestment + input.amortFundRemainder;

  // Math.floor и для отрицательного пула: при недоинвестировании станки
  // разбираются на запчасти, мощность падает (см. раздел 4).
  const newMachines = Math.floor(pool / config.machineCost);
  const amortFundRemainder = pool - newMachines * config.machineCost;

  const capacityNext = Math.max(0, input.machines + newMachines);
  const capexAdditions = newMachines * config.machineCost;

  // Раздел 7: Капвложения = Полная_мощность_$ + Доп.вложения_$ + Остаток_в_амортфонде.
  // Упрощённая формула из памятки (мощность × $40) не сходится с отчётом на $33 —
  // остаток в фонде обязателен.
  const capexBookValue = capacityNext * config.machineCost + amortFundRemainder;

  return {
    depreciation,
    netInvestment,
    newMachines,
    capexAdditions,
    amortFundRemainder,
    capacityNext,
    capexBookValue,
  };
}
