/**
 * Себестоимость единицы продукции (мекомspec, часть 3 — откалибровано).
 *
 * Себест_ед = costK1 · (мощность_баз / мощность_тек) + costK2 + A
 * A = (CU − CUopt)² / costCuUp      при CU > CUopt
 *   = (CUopt − CU)² / costCuDown    при CU < CUopt
 *
 * CU — загрузка мощности в процентах: 100 · производство / мощность_тек.
 * Нативные дефолты: costCuUp=10000/69, costCuDown=10000/138; прежние
 * 145/72.5 были приближением. Пользовательские делители сохраняются.
 * Возвращает raw-полином без округления единицы: preview усекает q*cost,
 * стадия округления settled-периода — отдельная от этого helper.
 */

import type { LeagueConfig } from './types';

export interface UnitCostInput {
  /** Мощность_баз — стартовая мощность фирмы (период 0). */
  capacityBase: number;
  /** Мощность_тек — «полная мощность» текущего периода. */
  capacityCurrent: number;
  /** План выпуска этого периода. */
  production: number;
}

export function computeUnitCost(input: UnitCostInput, config: LeagueConfig): number {
  const current = Math.max(1e-9, input.capacityCurrent);
  const cu = (100 * Math.max(0, input.production)) / current;
  const opt = config.costOptimalCu;

  let a = 0;
  if (cu > opt) {
    a = (cu - opt) ** 2 / config.costCuUp;
  } else if (cu < opt) {
    a = (opt - cu) ** 2 / config.costCuDown;
  }

  const linear = config.costK1 * (input.capacityBase / current) + config.costK2;
  return Math.max(0, linear + a);
}
