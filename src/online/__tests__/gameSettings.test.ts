import { describe, expect, it } from 'vitest';
import { buildOnlineGameSnapshot, DEFAULT_ONLINE_GAME_SETTINGS } from '../gameSettings';

describe('online game financial settings', () => {
  it('uses original MECOM financing and financial parameters for every period by default', () => {
    const snapshot = buildOnlineGameSnapshot('Test game');
    const { config, macroByPeriod } = snapshot.league;

    expect(config.featureFlags.loanRepayment).toBe('preRevenue');
    expect(config.featureFlags.bankInterestFormula).toBe('official');
    expect(config.serviceFee).toBe(0.01);
    expect(config.periodsPerYear).toBe(4);
    expect(config.depositRate).toBe(0.1);
    expect(macroByPeriod).toHaveLength(8);
    expect(macroByPeriod.map(macro => macro.periodIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(macroByPeriod.every(macro =>
      macro.taxRate === 0.25 && macro.bankRateBase === 0.1 && macro.bankRateExtra === 0.4 &&
      macro.loanLimitBase === 50000 && macro.loanLimitAbs === 100000,
    )).toBe(true);
  });

  it('applies custom financial choices to the config and each period macro', () => {
    const snapshot = buildOnlineGameSnapshot('Custom game', {
      ...DEFAULT_ONLINE_GAME_SETTINGS,
      loanRepayment: 'none',
      bankInterestFormula: 'flatLoanRate',
      serviceFeePercent: 2.5,
      periodsPerYear: 12,
      depositRatePercent: 4,
      taxRatePercent: 20,
      bankRateBasePercent: 8,
      bankRateExtraPercent: 32,
      loanLimitBase: 60000,
      loanLimitAbs: 120000,
    });

    expect(snapshot.league.config.featureFlags.loanRepayment).toBe('none');
    expect(snapshot.league.config.featureFlags.bankInterestFormula).toBe('flatLoanRate');
    expect(snapshot.league.config.serviceFee).toBe(0.025);
    expect(snapshot.league.config.periodsPerYear).toBe(12);
    expect(snapshot.league.config.depositRate).toBe(0.04);
    expect(snapshot.league.macroByPeriod.every(macro =>
      macro.taxRate === 0.2 && macro.bankRateBase === 0.08 && macro.bankRateExtra === 0.32 &&
      macro.loanLimitBase === 60000 && macro.loanLimitAbs === 120000,
    )).toBe(true);
  });
});
