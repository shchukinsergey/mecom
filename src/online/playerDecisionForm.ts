import type { FirmDecision } from '../engine/types';

export const decisionFields = [
  ['price', 'Цена'],
  ['production', 'Объём производства'],
  ['marketing', 'Маркетинг'],
  ['capexGross', 'Инвестиции в оборудование'],
  ['rnd', 'НИОКР'],
] as const;

type DecisionField = (typeof decisionFields)[number][0];
export type DecisionForm = Record<DecisionField, string>;
export const emptyDecision: DecisionForm = { price: '', production: '', marketing: '', rnd: '', capexGross: '' };

export function syncDecisionForm(
  current: DecisionForm,
  decision: Partial<FirmDecision> | null | undefined,
  preserveLocalEdits: boolean,
): DecisionForm {
  if (preserveLocalEdits) return current;
  return Object.fromEntries(decisionFields.map(([key]) => [
    key,
    decision?.[key] == null ? '' : String(decision[key]),
  ])) as DecisionForm;
}
