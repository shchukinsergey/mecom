import { computeDepreciation } from './capex';
import { computePeriod, nextOpeningState } from './computePeriod';
import type { LeagueSnapshot } from '../state/persistence';
import type { FirmDecision, PeriodMacroParams, PeriodResults } from './types';

const MAX_DECISION_SPEND = 50_000;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const unique = (values: number[]) => [...new Set(values.filter(Number.isFinite).map(v => Math.round(v * 100) / 100))];

type DecisionKey = 'price' | 'production' | 'marketing' | 'rnd' | 'capexGross';
type Score = { unfunded: number; profit: number; endingCash: number };

/**
 * Search recommendations by running the real MECOM engine against candidate
 * decisions. The objective is projected cumulative net profit, not market share.
 * Future rival decisions are held at their latest available inputs; the plan is
 * a scenario estimate, not a prediction of how people will play.
 */
export function chooseBotDecision(
  snapshot: LeagueSnapshot,
  firmId: string,
  random: () => number = Math.random,
): FirmDecision {
  const { league } = snapshot;
  const firm = league.firms.find(candidate => candidate.id === firmId);
  const opening = snapshot.opening[firmId];
  const start = league.results.length;
  const currentSlot = league.decisionsByPeriod[start];
  const previous = league.results[start - 1]?.firms.find(result => result.firmId === firmId);
  const initial = currentSlot?.[firmId] ?? previous?.decision;
  if (!firm || !opening || !initial) throw new Error(`No current game state for firm: ${firmId}`);
  if (opening.isBankrupt) throw new Error('A bankrupt firm cannot receive a bot decision.');

  const candidates = candidateValues(snapshot, firmId, initial, previous, random);
  let best = { ...initial };
  let bestScore = project(snapshot, firmId, best);
  const keys: DecisionKey[] = ['price', 'production', 'marketing', 'rnd', 'capexGross'];

  // Coordinate search: use the real engine to test each lever, then make a
  // second pass because price, marketing, production and R&D interact.
  for (let pass = 0; pass < 2; pass++) {
    for (const key of keys) {
      for (const value of candidates[key]) {
        const trial = { ...best, [key]: value };
        const score = project(snapshot, firmId, trial);
        if (isBetter(score, bestScore)) {
          best = trial;
          bestScore = score;
        }
      }
    }
  }
  // Keep a barely perceptible price variation among near-equivalent policies;
  // decisions remain bounded and are still chosen by projected profit.
  best.price = Math.round(best.price * (0.9975 + clamp(random(), 0, 1) * 0.005) * 100) / 100;
  return best;
}

function candidateValues(
  snapshot: LeagueSnapshot,
  firmId: string,
  current: FirmDecision,
  previous: PeriodResults['firms'][number] | undefined,
  random: () => number,
): Record<DecisionKey, number[]> {
  const { league } = snapshot;
  const start = league.results.length;
  const opening = snapshot.opening[firmId];
  const capacity = Math.max(0, opening.machines);
  const recent = previous?.decision ?? current;
  const marketPrice = league.results.at(-1)?.industry.avgPrice ?? recent.price;
  const demandSignal = previous ? previous.unfulfilledOrders - previous.inventoryEnd : 0;
  const priceSteps = demandSignal > 0
    ? [1, 1.05, 1.1, 1.2]
    : demandSignal < 0 ? [0.8, 0.9, 0.95, 1] : [0.9, 0.95, 1, 1.05, 1.1];
  const randomPrice = recent.price * (0.985 + clamp(random(), 0, 1) * 0.03);
  const prices = unique([
    ...priceSteps.map(step => recent.price * step),
    marketPrice * 0.9, marketPrice, marketPrice * 1.1, randomPrice,
  ]).filter(price => price > 0);

  const production = unique([
    0, capacity * 0.5, capacity * 0.65, capacity * 0.75, capacity * 0.8,
    capacity * 0.85, capacity * 0.9, capacity * 0.95, capacity,
    recent.production, previous ? previous.sold + opening.inventory : current.production,
  ]).map(value => Math.round(clamp(value, 0, capacity)));

  const peerSpend = (field: 'marketing' | 'rnd') => league.firms
    .filter(other => other.id !== firmId)
    .map(other => league.decisionsByPeriod[start]?.[other.id]?.[field] ?? 0);
  const marketingPeers = peerSpend('marketing');
  const rndPeers = peerSpend('rnd');
  const avgMarketing = marketingPeers.reduce((sum, value) => sum + value, 0) / Math.max(1, marketingPeers.length);
  const avgRnd = rndPeers.reduce((sum, value) => sum + value, 0) / Math.max(1, rndPeers.length);
  const marketing = unique([0, recent.marketing * 0.5, recent.marketing, recent.marketing * 1.25,
    recent.marketing * 1.5, avgMarketing, avgMarketing * 1.5]).map(value => clamp(value, 0, MAX_DECISION_SPEND));
  const rnd = unique([0, recent.rnd * 0.5, recent.rnd, recent.rnd * 1.25,
    recent.rnd * 1.5, avgRnd, avgRnd * 1.5]).map(value => clamp(value, 0, MAX_DECISION_SPEND));

  const depreciation = computeDepreciation(capacity, league.config, opening.amortFundRemainder);
  const capexGross = unique([0, depreciation, depreciation + league.config.machineCost,
    depreciation + league.config.machineCost * 2, depreciation + league.config.machineCost * 4,
    recent.capexGross]).map(value => clamp(value, 0, MAX_DECISION_SPEND));
  return { price: prices, production, marketing, rnd, capexGross };
}

function project(snapshot: LeagueSnapshot, firmId: string, candidate: FirmDecision): Score {
  const { league } = snapshot;
  const start = league.results.length;
  const horizon = Math.max(start + 1, league.macroByPeriod.length);
  let opening = structuredClone(snapshot.opening);
  let previousIndustry = league.results[start - 1]?.industry;
  let previousNativeIndustryState = league.results[start - 1]?.nativeIndustryState;
  let profit = 0;
  let unfunded = 0;
  let endingCash = opening[firmId]?.cash ?? 0;
  const baseRivals = league.decisionsByPeriod[start] ?? {};
  const startingCapacity = Math.max(1, opening[firmId]?.machines ?? 1);

  for (let period = start; period < horizon; period++) {
    const baseMacro = league.macroByPeriod[period] ?? league.macroByPeriod[start];
    if (!baseMacro) break;
    const macro: PeriodMacroParams = { ...baseMacro, periodIndex: period };
    const decisions = { ...baseRivals };
    const capacity = opening[firmId]?.machines ?? 0;
    decisions[firmId] = period === start ? candidate : {
      ...candidate,
      production: Math.round(clamp(candidate.production * capacity / startingCapacity, 0, capacity)),
    };

    const result = computePeriod({
      periodIndex: period,
      config: league.config,
      macro,
      firms: league.firms.map(({ id, name }) => ({ id, name })),
      opening,
      decisions,
      previousIndustry,
      previousNativeIndustryState,
    });
    const own = result.firms.find(entry => entry.firmId === firmId);
    if (!own) break;
    profit += own.netProfit;
    unfunded += own.unfundedShortfall;
    endingCash = own.cash;
    if (own.isBankrupt) break;

    opening = nextOpeningState(opening, result);
    previousIndustry = result.industry;
    previousNativeIndustryState = result.nativeIndustryState;
  }
  return { unfunded, profit, endingCash };
}

function isBetter(a: Score, b: Score): boolean {
  if (Math.abs(a.unfunded - b.unfunded) > 0.01) return a.unfunded < b.unfunded;
  if (Math.abs(a.profit - b.profit) > 0.01) return a.profit > b.profit;
  return a.endingCash > b.endingCash;
}
