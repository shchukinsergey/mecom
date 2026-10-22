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
  const limits = macro.scenarioRules;
  if (limits && (decision.price < limits.priceMin || decision.price > limits.priceMax)) {
    errors.price = `Цена по сценарию: от ${limits.priceMin} до ${limits.priceMax} $.`;
  }
  if (decision.price <= 0) errors.price = 'Цена должна быть больше нуля.';
  if (!Number.isInteger(decision.production)) errors.production = 'Производство указывается целым количеством штук.';
  if (decision.production > opening.machines) errors.production = `Производство не может превышать текущую мощность (${opening.machines} шт.).`;
  for (const field of ['marketing', 'capexGross', 'rnd'] as const) {
    const max = (field === 'marketing' ? limits?.marketingMax : field === 'capexGross' ? limits?.capexMax : limits?.rndMax) ?? 50000;
    if (decision[field] > max) errors[field] = `Сумма не может превышать ${max} $.`;
  }
  if (checkDecisionBudget(opening, decision, macro, config).overspend) {
    errors.production ??= 'Недостаточно средств с учётом доступного кредита для этого решения.';
  }
  return Object.keys(errors).length ? errors : null;
}
