import { checkDecisionBudget } from '../src/engine/decisionBudget.ts';
import type { Decision } from './repository.ts';
import type { FirmOpeningState, LeagueConfig, PeriodMacroParams } from '../src/engine/types.ts';

export type DecisionValidationErrors = Partial<Record<keyof Decision, string>>;

export function validateOnlineDecision(
  decision: Decision,
  opening: FirmOpeningState,
  macro: PeriodMacroParams,
  config: LeagueConfig,
): DecisionValidationErrors | null {
  const errors: DecisionValidationErrors = {};
  if (decision.price <= 0) errors.price = 'Цена должна быть больше нуля.';
  if (!Number.isInteger(decision.production)) errors.production = 'Производство указывается целым количеством штук.';
  if (decision.production > opening.machines) errors.production = `Производство не может превышать текущую мощность (${opening.machines} шт.).`;
  for (const field of ['marketing', 'capexGross', 'rnd'] as const) {
    if (decision[field] > 50000) errors[field] = 'Сумма не может превышать 50 000 $.';
  }
  if (checkDecisionBudget(opening, decision, macro, config).overspend) {
    errors.production ??= 'Недостаточно средств с учётом доступного кредита для этого решения.';
  }
  return Object.keys(errors).length ? errors : null;
}
