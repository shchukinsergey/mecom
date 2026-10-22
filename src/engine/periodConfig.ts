import type { LeagueConfig, PeriodMacroParams } from './types';

/** Old games return the same config object, without defaults or migration. */
export function configForPeriod(config: LeagueConfig, macro: PeriodMacroParams): LeagueConfig {
  const rules = macro.scenarioRules;
  if (!rules) return config;
  return { ...config, ...rules.config,
    ...(rules.priceCutoff === undefined ? {} : { nativeDemand: { ...config.nativeDemand, priceCutoff: rules.priceCutoff } }),
    priceWeight: rules.priceWeight, mktgWeight: rules.mktgWeight,
    rndWeight: rules.rndWeight, storageCostPerUnit: rules.storageCostPerUnit,
    firingPenaltyPerEmployee: rules.firingPenaltyPerEmployee };
}
