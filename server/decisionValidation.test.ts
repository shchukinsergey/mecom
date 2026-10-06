import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAGUE_CONFIG, makeMacroParams } from '../src/engine/config.ts';
import { validateOnlineDecision } from './decisionValidation.ts';


const opening = { machines: 10, period0Machines: 10, cash: 100000, loan: 0, amortFundRemainder: 0 } as any;
const valid = { price: 10, production: 10, marketing: 0, capexGross: 0, rnd: 0 };
const validate = (d: typeof valid, cash = opening.cash) => validateOnlineDecision(d, { ...opening, cash }, makeMacroParams(0), DEFAULT_LEAGUE_CONFIG);

describe('validateOnlineDecision', () => {
  it('rejects production above current opening capacity with a field-specific Russian error', () => {
    expect(validate({ ...valid, production: 11 })?.production).toMatch(/мощност/i);
    expect(validate({ ...valid, production: 1.5 })?.production).toMatch(/целым/i);
  });
  it('rejects each category above $50,000 and accepts its exact limit', () => {
    for (const key of ['marketing', 'capexGross', 'rnd'] as const) {
      expect(validate({ ...valid, [key]: 50001 })?.[key]).toMatch(/50\s?000/);
      expect(validate({ ...valid, [key]: 50000 })).toBeNull();
    }
  });
  it('rejects overspending and accepts the decision budget boundary', () => {
    expect(validate({ ...valid, production: 10, marketing: 50000, rnd: 50000 }, 0)).toBeTruthy();
    expect(validate({ ...valid, production: 10, marketing: 50000, rnd: 50000 }, 100000)).toBeNull();
  });
  it('accepts exact production capacity and valid positive-price decisions', () => expect(validate(valid)).toBeNull());
});
