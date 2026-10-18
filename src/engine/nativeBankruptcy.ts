import { computeNativeLiquidation } from './bankruptcy';
import type { FirmOpeningState, LeagueConfig } from './types';

/** Explicit host declaration, based on recovered instructions, not a financial trigger.
 * Retain the fixed cost reference but clear all economic state before exclusion. */
export function declareNativeBankruptcyOpening(
  opening: FirmOpeningState, config: LeagueConfig, periodIndex: number,
): FirmOpeningState {
  if (opening.nativeBankruptcy) return { ...opening, nativeBankruptcy: { ...opening.nativeBankruptcy } };
  const nativeBankruptcy = {
    periodIndex,
    ...computeNativeLiquidation({ inventory: opening.inventory, inventoryUnitCost: opening.inventoryUnitCost,
      cash: opening.cash, capexBookValue: opening.machines * config.machineCost + opening.amortFundRemainder,
      loan: opening.loan, initialCapital: opening.capital }),
    rndCumulative: opening.rndCumulative,
    demandPotentialCumulative: opening.demandPotentialCumulative ?? 0,
  };
  return {
    firmId: opening.firmId, period0Machines: opening.period0Machines,
    machines: 0, cash: 0, loan: 0, capital: 0, retainedEarnings: 0,
    inventory: 0, inventoryUnitCost: 0, inventoryAgedUnits: 0,
    amortFundRemainder: 0, employees: 0, rndCumulative: 0, rndDecayStock: 0,
    retainedEarningsBase: 0, productionPrevious: 0, demandPotentialCumulative: 0,
    productionCumulative: 0, sharePrevious: 0, isBankrupt: true, nativeBankruptcy,
  };
}
