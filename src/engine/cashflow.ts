/**
 * Кэш-флоу и кредитная линия (раздел 6 источника).
 *
 * Заём — не решение игрока. Режим 'preRevenue' воспроизводит подтверждённое
 * HERMES1 финансирование до выручки и отдельное позднее докредитование.
 * Ниже описаны исторические режимы 'none'/'sweep', оставленные для совместимости;
 * совпадение одного отчёта RLC не доказывает их тождественность оригиналу.
 *
 * ── Почему формула переписана ─────────────────────────────────────────────
 * Официальная схема раздела 6 начинает расчёт с выручки, без входящего остатка
 * наличных, и формально запрещает одновременно иметь и кэш, и займы. В реальном
 * отчёте RLC (раздел 0) фирма имеет $51 096 наличных ПРИ $80 002 займов, так что
 * буквальная запись неполна. Эквивалентная рабочая форма — «револьверный» заём:
 * заём не гасится автоматически, а растёт, когда наличных не хватает.
 *
 * Проверка на RLC: восстановленный из баланса входящий кэш $47 910 плюс
 * денежный поток $3 186 даёт ровно $51 096 из отчёта.
 *
 * Тождество баланса при такой записи выполняется ПО ПОСТРОЕНИЮ:
 *   Δактив = ЧП + Δзайм = Δнакопленная_прибыль + Δпассив.
 *
 * ── Гашение займа («cash sweep», featureFlags.loanRepayment) ──────────────
 * По умолчанию ('none') заём никогда не гасится сам — историческая гипотеза по
 * одному отчёту RLC (см. выше). Опционально ('sweep') можно включить другое
 * поведение: гасится ИЗБЫТОК наличных, которые уже были на начало периода
 * СВЕРХ того, что нужно на затраты этого же периода (себестоимость
 * произведённого, маркетинг, НИОКР, инвестиции-брутто, штраф, хранение,
 * банк.процент, налог — всё, кроме выручки). Свежая выручка ЭТОГО периода в
 * гашение не идёт вообще: она осядет в кэш и станет «лишней» только со
 * СЛЕДУЮЩЕГО периода, когда сама окажется входящим остатком.
 *
 * Это не то же самое, что «гасить из положительного денежного потока
 * периода» (более простая и неверная формулировка): денежный поток уже
 * включает выручку, а её как раз нужно исключить. Разница принципиальна —
 * проверка на RLC: входящий кэш $47 910 МЕНЬШЕ затрат периода без выручки
 * (~$64 520), значит избытка не было вообще и займ не должен был гаситься —
 * ровно так и есть в реальном отчёте. При «sweep» по этой формуле RLC
 * считается идентично 'none' (расхождения нет), в отличие от более простой
 * формулировки «гасить из денежного потока», которая гасила бы часть займа
 * и разошлась бы с отчётом.
 *
 * Погашение НЕ останавливается на нуле: если избытка больше, чем весь заём,
 * остаток уходит «в минус» — заём становится депозитом. Дальше он продолжает
 * расти тем же способом (лишний кэш пополняет депозит), а не лежит без дела.
 * Проценты на депозит считает `computeBankInterest` (pnl.ts) — по отдельной
 * ставке `config.depositRate`, без тарифных лимитов займа.
 */

import type { LeagueConfig, PeriodMacroParams } from './types';

export interface CashFlowInput {
  openingCash: number;
  openingLoan: number;
  revenue: number;
  produced: number;
  unitCost: number;
  marketing: number;
  rnd: number;
  capexGross: number;
  /** Only the pre-revenue budget deducts depreciation; actual cash pays gross capex. */
  depreciation?: number;
  firingPenalty: number;
  storageCost: number;
  bankInterest: number;
  tax: number;
  isBankrupt: boolean;
}

export interface CashFlowResult {
  cashFlow: number;
  cash: number;
  loan: number;
  newBorrowing: number;
  /** Сколько фирма запросила сверх абсолютного лимита и не получила. */
  unfundedShortfall: number;
  /** Present only in preRevenue mode, separating interest-bearing funding from the late topup. */
  initialLoanMovement?: number;
  financedLoan?: number;
  topupBorrowing?: number;
}

export interface PreRevenueFinancing {
  budget: number;
  /** Signed: a negative movement repays beyond zero into a deposit. */
  initialLoanMovement: number;
  financedLoan: number;
}

/** Native initial funding excludes sales, interest, tax and storage. */
export function computePreRevenueFinancing(
  input: Pick<CashFlowInput, 'openingCash' | 'openingLoan' | 'produced' | 'unitCost' |
    'marketing' | 'rnd' | 'capexGross' | 'depreciation' | 'firingPenalty'>,
  macro: PeriodMacroParams,
  config: LeagueConfig,
): PreRevenueFinancing {
  const budget = input.produced * input.unitCost + input.marketing + input.rnd +
    input.capexGross - (input.depreciation ?? 0) + input.firingPenalty;
  const requested = budget - input.openingCash;
  const initialLoanMovement = requested <= 0 || config.featureFlags.bankruptcyMode === 'labelOnly'
    ? requested
    : Math.min(requested, Math.max(0, macro.loanLimitAbs - input.openingLoan));
  return { budget, initialLoanMovement, financedLoan: input.openingLoan + initialLoanMovement };
}

export function computeCashFlow(
  input: CashFlowInput,
  macro: PeriodMacroParams,
  config: LeagueConfig,
): CashFlowResult {
  // В кэш-флоу фирма платит ПОЛНУЮ стоимость произведённого за период (а не
  // себестоимость проданного, как в P&L) — отсюда расхождение прибыли и денег.
  // Капитальные затраты уходят наличными целиком, брутто: амортизация внутри них.
  const spending =
    input.produced * input.unitCost +
    input.marketing +
    input.rnd +
    input.capexGross +
    input.firingPenalty +
    input.storageCost +
    input.bankInterest +
    input.tax;

  const cashFlow = input.revenue - spending;

  const raw = input.openingCash + cashFlow;

  if (config.featureFlags.loanRepayment === 'preRevenue') {
    const { initialLoanMovement: movement, financedLoan } = computePreRevenueFinancing(input, macro, config);
    const requestedTopup = Math.max(0, -(raw + movement));
    const topup = config.featureFlags.bankruptcyMode === 'labelOnly'
      ? requestedTopup
      : Math.min(requestedTopup, Math.max(0, macro.loanLimitAbs - financedLoan));
    return {
      cashFlow,
      cash: raw + movement + topup,
      loan: financedLoan + topup,
      newBorrowing: Math.max(0, movement) + topup,
      unfundedShortfall: requestedTopup - topup,
      initialLoanMovement: movement,
      financedLoan,
      topupBorrowing: topup,
    };
  }

  if (raw >= 0) {
    if (config.featureFlags.loanRepayment === 'sweep') {
      // Гасим займ из избытка ВХОДЯЩЕГО кэша сверх затрат этого периода —
      // выручка этого периода в гашение не идёт (см. комментарий в шапке
      // файла). Не ограничиваем сверху остатком займа: если избытка больше,
      // чем весь заём (или заём уже отрицательный — уже депозит), остаток
      // продолжает уходить в минус — заём становится/растёт как депозит.
      const excessOpeningCash = Math.max(0, input.openingCash - spending);
      const repayment = excessOpeningCash;
      return {
        cashFlow,
        cash: raw - repayment,
        loan: input.openingLoan - repayment,
        newBorrowing: 0,
        unfundedShortfall: 0,
      };
    }

    // Профицит копится наличными; заём сам собой не гасится — именно поэтому в
    // отчёте RLC уживаются крупный кэш и крупный долг.
    return {
      cashFlow,
      cash: raw,
      loan: input.openingLoan,
      newBorrowing: 0,
      unfundedShortfall: 0,
    };
  }

  const requested = -raw;

  // Режим внешнего управления: банк не выдаёт займ сверх абсолютного лимита.
  // Фирма уходит в минус по кассе ровно на непокрытую часть — это и есть сигнал
  // банкротства, но долг больше не растёт бесконечно.
  const canBorrow =
    config.featureFlags.bankruptcyMode === 'labelOnly'
      ? requested
      : Math.max(0, Math.min(requested, macro.loanLimitAbs - input.openingLoan));

  const newBorrowing = canBorrow;
  const unfundedShortfall = requested - newBorrowing;

  return {
    cashFlow,
    cash: raw + newBorrowing, // 0, если займа хватило; иначе отрицательный остаток
    loan: input.openingLoan + newBorrowing,
    newBorrowing,
    unfundedShortfall,
  };
}

/**
 * Критерий тяжёлого минуса (ТЗ п.5): наличные < 0 И заём выше абсолютного лимита.
 *
 * Сравнение нестрогое: при внешнем управлении заём упирается в loanLimitAbs и
 * никогда его не превышает, поэтому строгое «>» не сработало бы ни разу.
 */
export function isBankrupt(cash: number, loan: number, macro: PeriodMacroParams): boolean {
  return cash < 0 && loan >= macro.loanLimitAbs;
}
