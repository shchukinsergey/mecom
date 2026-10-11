import type { DecisionBudget } from '../engine/decisionBudget';
import type { FirmOpeningState, PeriodMacroParams } from '../engine/types';

const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
const ratio = (value: number, total: number) => total > 0 ? value / total * 100 : 0;
const statuses = {
  own: 'Своих средств достаточно', base: 'Нужен кредит',
  extra: 'Нужен экспресс-кредит', shortage: 'Не хватает средств',
} as const;

/** Presentation only. Receives the native check; never recomputes costs or final debt. */
export function buildFundingView(
  budget: DecisionBudget,
  opening: Pick<FirmOpeningState, 'loan'>,
  macro: Pick<PeriodMacroParams, 'loanLimitBase'>,
) {
  const ordinaryRemaining = Math.min(budget.availableCredit, Math.max(0, macro.loanLimitBase - opening.loan));
  const expressRemaining = budget.availableCredit - ordinaryRemaining;
  const fundingNeed = Math.max(0, budget.totalSpending - budget.openingCash);
  const ordinaryUsed = Math.min(fundingNeed, ordinaryRemaining);
  const expressUsed = Math.min(Math.max(0, fundingNeed - ordinaryUsed), expressRemaining);
  const shortage = Math.max(0, -budget.remainingBudget);
  const cashUsed = Math.min(Math.max(0, budget.totalSpending), Math.max(0, budget.openingCash));
  const fundingTotal = cashUsed + fundingNeed;
  const classification = budget.overspend ? 'shortage' : expressUsed > 0 ? 'extra' : ordinaryUsed > 0 ? 'base' : 'own';
  const expenses = [
    { key: 'production', label: 'Производство', value: budget.costOfProduction },
    { key: 'marketing', label: 'Маркетинг', value: budget.marketing },
    { key: 'investment', label: 'Чистые инвестиции', value: budget.netInvestment },
    { key: 'rnd', label: 'НИОКР', value: budget.rnd },
  ];
  const positiveExpenseTotal = expenses.reduce((sum, expense) => sum + Math.max(0, expense.value), 0);
  const fundingSegments = [
    { key: 'cash', label: 'Свои средства', value: cashUsed },
    { key: 'base', label: 'Обычный кредит', value: ordinaryUsed },
    { key: 'extra', label: 'Экспресс-кредит', value: expressUsed },
    { key: 'shortage', label: 'Недостаток средств', value: shortage },
  ].map(segment => ({ ...segment, percent: clampPercent(ratio(segment.value, fundingTotal)) }));
  return {
    totalSpending: budget.totalSpending, resourcesAvailable: budget.resourcesAvailable,
    remainingBudget: budget.remainingBudget, openingCash: budget.openingCash,
    availableCredit: budget.availableCredit, currentDebt: opening.loan,
    existingOrdinaryDebt: Math.min(opening.loan, macro.loanLimitBase),
    existingExpressDebt: Math.max(0, opening.loan - macro.loanLimitBase),
    ordinaryRemaining, expressRemaining, fundingNeed, ordinaryUsed, expressUsed, cashUsed, shortage,
    classification, level: classification, status: statuses[classification], fundingSegments,
    coveragePercent: clampPercent(ratio(cashUsed + ordinaryUsed + expressUsed, fundingTotal)),
    expenses: expenses.map(expense => ({ ...expense, percent: clampPercent(ratio(Math.max(0, expense.value), positiveExpenseTotal)) })),
    positiveExpenseTotal, cashRelease: Math.max(0, -budget.netInvestment),
  };
}
