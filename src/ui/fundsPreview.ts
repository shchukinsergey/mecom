/**
 * Бюджет нативного диалога ввода решений, НЕ прогноз итоговой ликвидности.
 * Четыре подписанных слагаемых: производство, маркетинг, нетто-инвестиции,
 * НИОКР. Каждое отдельно усекается к нулю; амортизация возвращается в бюджет.
 * Штрафы, хранение, проценты и налоги остаются в расчёте периода, но здесь
 * не вычитаются. Положительный бюджет не гарантирует отсутствие нехватки
 * при расчёте. Источник: read-only mecom-funds-decoding/NOTES.md, EXE S02.
 * JS double не эмулирует x87 extended у экстремальных границ усечения.
 */

import { computeUnitCost } from '../engine/cost';
import { computeBankInterest } from '../engine/pnl';
import { computeEmployees, computeFiringPenalty } from '../engine/industry';
import type { FirmDecision, FirmOpeningState, LeagueConfig, PeriodMacroParams } from '../engine/types';

export interface FundsPreview {
  cash: number;
  availableCredit: number;
  totalFunds: number;
  costOfProduction: number;
  marketing: number;
  rnd: number;
  investment: number;
  depreciation: number;
  netInvestment: number;
  cashRemaining: number;
  creditRemaining: number;
  /** Диагностика расчёта периода: не вычитается из бюджета ввода. */
  firingPenalty: number;
  storageCost: number;
  bankInterest: number;
  outflow: number;
  /** Остаток бюджета ввода, не нижняя граница итоговой ликвидности. */
  remaining: number;
}

export function estimateFunds(
  opening: FirmOpeningState,
  decision: FirmDecision,
  macro: PeriodMacroParams,
  config: LeagueConfig,
): FundsPreview {
  const production = Math.max(0, decision.production);

  const unitCost = computeUnitCost(
    { capacityBase: opening.period0Machines, capacityCurrent: opening.machines, production },
    config,
  );
  // Raw polynomial: no settled-period cent rounding before signed truncation.
  const productionSigned = Math.trunc(-production * unitCost);
  const costOfProduction = -productionSigned || 0;

  const employed = computeEmployees(production, opening.machines, config);
  const firingPenalty = computeFiringPenalty(opening.employees, employed, config);

  const storageCost = config.storageCostPerUnit * Math.max(0, opening.inventoryAgedUnits);

  const bankInterest = computeBankInterest(
    {
      openingLoan: opening.loan,
      loanLimitBase: macro.loanLimitBase,
      bankRateBase: macro.bankRateBase,
      bankRateExtra: macro.bankRateExtra,
    },
    config,
  );

  const marketingSigned = Math.trunc(-decision.marketing);
  const rndSigned = Math.trunc(-decision.rnd);
  const marketing = -marketingSigned || 0;
  const rnd = -rndSigned || 0;
  const investment = decision.capexGross;
  const bookValue = opening.machines * config.machineCost + opening.amortFundRemainder;
  const depreciation = nativeRound(bookValue / config.machineLifespanPeriods);
  const investmentSigned = Math.trunc(depreciation - investment);
  const netInvestment = -investmentSigned || 0;
  const signedSum = productionSigned + marketingSigned + investmentSigned + rndSigned;
  const outflow = -signedSum || 0;

  const availableCredit = nativeRound(macro.loanLimitAbs - opening.loan);
  const totalFunds = Math.trunc(opening.cash + availableCredit) || 0;
  const afterCash = opening.cash + signedSum;
  const cashRemaining = Math.trunc(Math.max(0, afterCash));
  const creditRemaining = Math.trunc(availableCredit + Math.min(0, afterCash)) || 0;

  return {
    cash: opening.cash,
    availableCredit,
    totalFunds,
    costOfProduction,
    marketing,
    rnd,
    investment,
    depreciation,
    netInvestment,
    cashRemaining,
    creditRemaining,
    firingPenalty,
    storageCost,
    bankInterest,
    outflow,
    remaining: cashRemaining + creditRemaining,
  };
}

/** Native helper takes an f32 argument, then rounds half away from zero. */
function nativeRound(value: number): number {
  const stored = Math.fround(value);
  return Math.sign(stored) * Math.floor(Math.abs(stored) + 0.5) || 0;
}

export type FundsLevel = 'ok' | 'low' | 'negative';

/** Порог «мало» — доля от суммарных доступных средств. */
const LOW_FUNDS_RATIO = 0.15;

export function fundsLevel(preview: FundsPreview): FundsLevel {
  if (preview.remaining < 0) return 'negative';
  if (preview.totalFunds <= 0 || preview.remaining / preview.totalFunds < LOW_FUNDS_RATIO) return 'low';
  return 'ok';
}
