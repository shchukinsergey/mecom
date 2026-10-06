import { describe, expect, it } from 'vitest';
import { decisionFields, emptyDecision, syncDecisionForm } from '../playerDecisionForm';

describe('player decision form synchronization', () => {
  it('shows investments before R&D', () => {
    expect(decisionFields.map(([key]) => key)).toEqual(['price', 'production', 'marketing', 'capexGross', 'rnd']);
  });

  it('preserves unsaved local edits during background refresh', () => {
    const local = { ...emptyDecision, price: '41', marketing: '120' };
    expect(syncDecisionForm(local, { price: 30, production: 100 }, true)).toBe(local);
  });

  it('hydrates a clean form from the saved draft', () => {
    expect(syncDecisionForm(emptyDecision, { price: 30, production: 100, marketing: 5 }, false)).toEqual({
      price: '30', production: '100', marketing: '5', rnd: '', capexGross: '',
    });
  });
});
