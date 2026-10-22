import { makeFirmDecision, makeFirmStart } from './config';
import { initialOpeningState } from './computePeriod';
import { configForPeriod } from './periodConfig';
import type { LeagueSnapshot } from '../state/persistence';
import type { FirmDecision, FirmOpeningState, FirmPeriodResult, IndustryPeriodResult, LeagueConfig, PeriodMacroParams } from './types';

/** Optional scenario compatibility without requiring the separate scenario feature. */
export type BotPeriodMacro = PeriodMacroParams & {
  scenarioRules?: {
    priceWeight: number; mktgWeight: number; rndWeight: number;
    storageCostPerUnit: number; firingPenaltyPerEmployee: number;
    priceMin: number; priceMax: number;
  };
};

export function botPeriodConfig(config: LeagueConfig, macro: BotPeriodMacro): LeagueConfig {
  return configForPeriod(config, macro);
}

/** Only fields actually published in the industry comparison are exposed here. */
export interface BotPublicFirm {
  id: string;
  price: number;
  revenue: number;
  profit: number;
  retainedEarnings: number;
  share: number;
  rif: number;
  excluded: boolean;
}

export interface BotObservation {
  firmId: string;
  period: number;
  remainingPeriods: number;
  config: LeagueConfig;
  macro: BotPeriodMacro;
  opening: FirmOpeningState;
  initial: FirmDecision;
  ownHistory: FirmPeriodResult[];
  marketHistory: { industry: IndustryPeriodResult; firms: BotPublicFirm[] }[];
  firms: { id: string; name: string }[];
}

/** Privacy boundary: no opponent openings, decisions, R&D or future macro values. */
export function observeBot(snapshot: LeagueSnapshot, firmId: string): BotObservation {
  const { league } = snapshot;
  const opening = snapshot.opening[firmId];
  const period = league.results.length;
  const ownHistory = league.results.flatMap(p => p.firms.filter(f => f.firmId === firmId));
  const initial = league.decisionsByPeriod[period]?.[firmId] ?? ownHistory.at(-1)?.decision;
  const macro = league.macroByPeriod[period];
  if (!league.firms.some(f => f.id === firmId) || !opening || !initial || !macro) {
    throw new Error(`No current game state for firm: ${firmId}`);
  }
  if (opening.isBankrupt || opening.nativeBankruptcy) throw new Error('A bankrupt firm cannot receive a bot decision.');
  return structuredClone({
    firmId, period, remainingPeriods: Math.max(1, league.macroByPeriod.length - period),
    config: league.config, macro, opening, initial, ownHistory,
    firms: league.firms.map(({ id, name }) => ({ id, name })),
    marketHistory: league.results.map(p => ({
      industry: p.industry,
      firms: p.firms.map(f => ({
        id: f.firmId,
        // The public renderer masks these figures for bankrupt firms.
        price: f.isBankrupt || f.nativeBankruptcy ? 0 : f.decision.price,
        revenue: f.isBankrupt || f.nativeBankruptcy ? 0 : f.revenue,
        profit: f.isBankrupt || f.nativeBankruptcy ? 0 : f.netProfit,
        retainedEarnings: f.isBankrupt || f.nativeBankruptcy ? 0 : f.retainedEarnings,
        share: f.isBankrupt || f.nativeBankruptcy ? 0 : f.marketShareSold,
        rif: f.isBankrupt || f.nativeBankruptcy ? 0 : f.rif.total,
        excluded: Boolean(f.nativeBankruptcy) || (f.isBankrupt && league.config.featureFlags.bankruptcyMode === 'freeze'),
      })),
    })),
  });
}

/** Synthetic opponents are estimates, never reconstructed from private state. */
export function estimateBotMarket(observation: BotObservation): {
  opening: Record<string, FirmOpeningState>;
  decisions: Record<string, FirmDecision>;
} {
  const o = observation;
  const count = o.firms.length;
  const last = o.marketHistory.at(-1);
  const ownLast = o.ownHistory.at(-1);
  const activePeers = o.firms.filter(f => f.id !== o.firmId && !last?.firms.find(p => p.id === f.id)?.excluded);
  const peerCount = Math.max(1, activePeers.length);
  const peerCapacity = Math.max(0, (last?.industry.totalCapacity ?? o.opening.machines * count) - (ownLast?.fullCapacity ?? o.opening.machines));
  const peerInventory = Math.max(0, (last?.industry.totalInventory ?? 0) - o.opening.inventory);
  const peerProduction = Math.max(0, (last?.industry.totalProduced ?? o.opening.machines * count * o.config.costOptimalCu / 100) - (ownLast?.produced ?? o.initial.production));
  const peerLoans = (last ? last.industry.loanAmountBase + last.industry.loanAmountExtra : 0) - (ownLast?.loan ?? 0);
  const base = makeFirmStart(count, o.config.machineCost);
  const syntheticLeague = {
    id: 'bot-forecast', name: 'bot-forecast', createdAt: '', config: o.config,
    firms: o.firms.map(f => ({ ...base, ...f })),
    macroByPeriod: [], decisionsByPeriod: [], confirmedByPeriod: [], results: [],
  };
  const opening = initialOpeningState(syntheticLeague);
  const decisions: Record<string, FirmDecision> = {};
  for (const f of o.firms) {
    if (f.id === o.firmId) {
      opening[f.id] = structuredClone(o.opening);
      decisions[f.id] = { ...o.initial };
      continue;
    }
    const publicFirm = last?.firms.find(p => p.id === f.id);
    const defaults = makeFirmDecision(f.id, count);
    const state = opening[f.id];
    state.machines = Math.max(1, Math.round(peerCapacity / peerCount));
    state.inventory = Math.round(peerInventory / peerCount);
    state.inventoryAgedUnits = state.inventory;
    state.inventoryUnitCost = last?.industry.avgUnitCost ?? o.config.costK1 + o.config.costK2;
    state.loan = last ? peerLoans / peerCount : base.initialLoan;
    // Cash and quality are unknown: neutral priors, not competitors' actual values.
    state.cash = publicFirm?.revenue ?? base.initialCash;
    state.rndCumulative = defaults.rnd * o.period;
    state.retainedEarnings = publicFirm?.retainedEarnings ?? 0;
    state.retainedEarningsBase = o.marketHistory[0]?.firms.find(p => p.id === f.id)?.retainedEarnings ?? 0;
    state.sharePrevious = publicFirm?.share ?? 0;
    state.productionPrevious = Math.round(peerProduction / peerCount);
    state.productionCumulative = state.productionPrevious * o.period;
    state.demandPotentialCumulative = (defaults.rnd + defaults.marketing) * o.period;
    // Estimated assets/financing must form a coherent synthetic balance. Equity
    // is the unknown residual, not an additional estimate taken from a rival.
    state.capital = state.cash + state.inventory * state.inventoryUnitCost +
      state.machines * o.config.machineCost + state.amortFundRemainder - state.loan - state.retainedEarnings;
    decisions[f.id] = {
      ...defaults,
      price: publicFirm && publicFirm.price > 0 ? publicFirm.price : last?.industry.avgPrice || o.initial.price,
      production: Math.min(state.machines, state.productionPrevious),
      capexGross: Math.round(state.machines * o.config.machineCost / o.config.machineLifespanPeriods),
    };
    if (publicFirm?.excluded) {
      // Public retirement is known; its private carried counters are not.
      state.nativeBankruptcy = { periodIndex: o.period - 1, assets: 0, bankLoss: 0, shareholderLoss: 0, rndCumulative: 0, demandPotentialCumulative: 0 };
      decisions[f.id] = { firmId: f.id, price: 0, production: 0, marketing: 0, rnd: 0, capexGross: 0 };
    }
  }
  return { opening, decisions };
}
