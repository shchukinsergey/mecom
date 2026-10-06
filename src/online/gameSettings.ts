import { DEFAULT_LEAGUE_CONFIG, makeMacroParams } from '../engine/config';
import type { League, LeagueConfig } from '../engine/types';
import type { LeagueSnapshot } from '../state/persistence';

export interface OnlineGameSettings {
  loanRepayment: LeagueConfig['featureFlags']['loanRepayment'];
  bankInterestFormula: LeagueConfig['featureFlags']['bankInterestFormula'];
  serviceFeePercent: number;
  periodsPerYear: number;
  depositRatePercent: number;
  taxRatePercent: number;
  bankRateBasePercent: number;
  bankRateExtraPercent: number;
  loanLimitBase: number;
  loanLimitAbs: number;
}

export const DEFAULT_ONLINE_GAME_SETTINGS: OnlineGameSettings = {
  loanRepayment: DEFAULT_LEAGUE_CONFIG.featureFlags.loanRepayment,
  bankInterestFormula: DEFAULT_LEAGUE_CONFIG.featureFlags.bankInterestFormula,
  serviceFeePercent: DEFAULT_LEAGUE_CONFIG.serviceFee * 100,
  periodsPerYear: DEFAULT_LEAGUE_CONFIG.periodsPerYear,
  depositRatePercent: DEFAULT_LEAGUE_CONFIG.depositRate * 100,
  taxRatePercent: 25,
  bankRateBasePercent: 10,
  bankRateExtraPercent: 40,
  loanLimitBase: 50000,
  loanLimitAbs: 100000,
};

/** Build an empty online-game snapshot with the chosen settings preloaded for all periods. */
export function buildOnlineGameSnapshot(
  name: string,
  settings: OnlineGameSettings = DEFAULT_ONLINE_GAME_SETTINGS,
): LeagueSnapshot {
  const config: LeagueConfig = {
    ...structuredClone(DEFAULT_LEAGUE_CONFIG),
    serviceFee: settings.serviceFeePercent / 100,
    periodsPerYear: settings.periodsPerYear,
    depositRate: settings.depositRatePercent / 100,
    featureFlags: {
      ...DEFAULT_LEAGUE_CONFIG.featureFlags,
      bankInterestFormula: settings.bankInterestFormula,
      loanRepayment: settings.loanRepayment,
    },
  };
  const macroByPeriod = Array.from({ length: 8 }, (_, periodIndex) => ({
    ...makeMacroParams(periodIndex),
    taxRate: settings.taxRatePercent / 100,
    bankRateBase: settings.bankRateBasePercent / 100,
    bankRateExtra: settings.bankRateExtraPercent / 100,
    loanLimitBase: settings.loanLimitBase,
    loanLimitAbs: settings.loanLimitAbs,
  }));
  const league: League = {
    id: 'new-online-game',
    name,
    createdAt: new Date().toISOString(),
    config,
    firms: [],
    macroByPeriod,
    decisionsByPeriod: [{}],
    confirmedByPeriod: [{}],
    results: [],
  };
  return { league, opening: {} };
}
