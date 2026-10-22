import { computeDepreciation } from './capex';
import { computePeriod, nextOpeningState } from './computePeriod';
import { checkDecisionBudget } from './decisionBudget';
import { botPeriodConfig, estimateBotMarket, observeBot, type BotObservation } from './botObservation';
import type { BotPersonality, BotStrategy } from './botPersonality';
import type { LeagueSnapshot } from '../state/persistence';
import type { FirmDecision, FirmOpeningState, FirmPeriodResult } from './types';

const MAX_SPEND = 50_000;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const integers = (values: number[]) => [...new Set(values.filter(Number.isFinite).map(Math.round))];

export type { BotStrategy } from './botPersonality';
export interface BotOptions extends Partial<BotPersonality> {
  /** Online rooms persist this choice once, before the first playable turn. */
  strategy?: BotStrategy;
}
export interface BotForecast {
  rif: number;
  profit: number;
  fundingRisk: number;
  endingInventory: number;
  endingLoan: number;
}
export interface BotRecommendation {
  decision: FirmDecision;
  strategy: BotStrategy;
  explanation: string;
  forecast: BotForecast;
  evaluatedPlans: number;
}

// Search policy, not game formulas. Economic effects use the actual engine.
const PROFILES: Record<BotStrategy, { growth: number; quality: number }> = {
  scale: { growth: 0.3, quality: 0.02 },
  quality: { growth: 0.05, quality: 0.35 },
  mixed: { growth: 0.15, quality: 0.15 },
};
type Plan = { decision: FirmDecision; strategy: BotStrategy };
type Score = BotForecast & { utility: number; netCash: number };

/** Server-compatible entry point; randomness only breaks evaluated numeric ties. */
export function chooseBotDecision(
  snapshot: LeagueSnapshot,
  firmId: string,
  random: () => number = Math.random,
  options: BotOptions = {},
): FirmDecision {
  return recommendBotDecision(observeBot(snapshot, firmId), random, options).decision;
}

/** Only own state and public reports are accessible inside the planner. */
export function recommendBotDecision(
  o: BotObservation,
  random: () => number = Math.random,
  options: BotOptions = {},
): BotRecommendation {
  const market = estimateBotMarket(o);
  const investmentIntensity = clamp(options.investmentIntensity ?? 1, 0.8, 1.2);
  const priceBias = clamp(options.priceBias ?? 1, 0.96, 1.04);
  let evaluations = 0;
  const cache = new Map<string, Score>();
  const evaluate = (plan: Plan, stress = false): Score => {
    const key = JSON.stringify([plan, stress]);
    const cached = cache.get(key);
    if (cached) return cached;
    evaluations++;
    const score = project(o, market, plan, stress);
    if (options.strategy) score.utility -= strategyDeviation(o, plan, investmentIntensity, priceBias);
    cache.set(key, score);
    return score;
  };
  const strategies: BotStrategy[] = options.strategy ? [options.strategy] : ['scale', 'quality', 'mixed'];
  const candidates = candidateValues(o);
  const initial = normalize(o, o.initial);
  const valid = (d: FirmDecision) => !checkDecisionBudget(o.opening, d, o.macro, botPeriodConfig(o.config, o.macro)).overspend;
  const finalists: { plan: Plan; score: Score }[] = [];

  // Preserve the common introduction and its retained-profit RIF denominator.
  if (o.period === 0 && valid(initial)) {
    const plan: Plan = { decision: initial, strategy: options.strategy ?? 'mixed' };
    return recommendation(plan, evaluate(plan), evaluations, 'Вводный период: сохраняем общие стартовые условия.');
  }

  for (const strategy of strategies) {
    const profile = PROFILES[strategy];
    const targets = strategyTargets(o, strategy, investmentIntensity, priceBias);
    const strategyCandidates = {
      ...candidates,
      price: integers([...candidates.price, targets.price, targets.price - 1, targets.price + 1]),
      rnd: integers([...candidates.rnd, targets.rnd, targets.rnd * 0.5]),
      capexGross: integers([...candidates.capexGross, targets.capexGross]),
    };
    const depreciation = computeDepreciation(o.opening.machines, o.config, o.opening.amortFundRemainder);
    const resources = checkDecisionBudget(o.opening, initial, o.macro, o.config).resourcesAvailable;
    const seeds = [initial, normalize(o, { ...initial, ...targets }), ...[0.5, 1, 1.5].map(intensity => normalize(o, {
      ...initial,
      production: Math.round(o.opening.machines * o.config.costOptimalCu / 100),
      capexGross: o.remainingPeriods <= 1 ? 0 : depreciation + o.opening.machines * profile.growth * intensity * investmentIntensity * o.config.machineCost,
      rnd: o.remainingPeriods <= 1 ? 0 : Math.max(0, resources) * profile.quality * intensity * investmentIntensity,
    })), normalize(o, { ...initial, production: 0, marketing: 0, rnd: 0, capexGross: 0 })];
    const feasibleSeeds = seeds.filter(valid);
    if (!feasibleSeeds.length) continue;
    let plan: Plan = { decision: feasibleSeeds[0], strategy };
    let score = evaluate(plan);
    for (const seed of feasibleSeeds.slice(1)) {
      const trial = { decision: seed, strategy };
      const value = evaluate(trial);
      if (better(value, score)) { plan = trial; score = value; }
    }
    // Price and output must be evaluated together, including restarting output.
    for (let pass = 0; pass < 2; pass++) {
      for (const price of strategyCandidates.price) {
        for (const production of candidates.production) {
          const decision = normalize(o, { ...plan.decision, price, production });
          if (!valid(decision)) continue;
          const trial = { decision, strategy };
          const value = evaluate(trial);
          if (better(value, score)) { plan = trial; score = value; }
        }
      }
      for (const key of ['marketing', 'rnd', 'capexGross'] as const) {
        for (const value of strategyCandidates[key]) {
          const decision = normalize(o, { ...plan.decision, [key]: value });
          if (!valid(decision)) continue;
          const trial = { decision, strategy };
          const valueScore = evaluate(trial);
          if (better(valueScore, score)) { plan = trial; score = valueScore; }
        }
      }
    }
    for (const price of [plan.decision.price - 1, plan.decision.price + 1]) {
      for (const production of candidates.production) {
        const decision = normalize(o, { ...plan.decision, price, production });
        if (!valid(decision)) continue;
        const trial = { decision, strategy };
        const value = evaluate(trial);
        if (better(value, score)) { plan = trial; score = value; }
      }
    }
    if (valid(plan.decision)) finalists.push({ plan, score });
  }
  if (!finalists.length) throw new Error('No affordable bot decision, including zero production.');
  // Stress-test finalists against cheaper, expanding rivals.
  const robust = finalists.map(({ plan, score }) => {
    const stress = evaluate(plan, true);
    return { plan, score: {
      ...score,
      fundingRisk: Math.max(score.fundingRisk, stress.fundingRisk),
      utility: (score.utility + stress.utility) / 2,
    } };
  });
  robust.sort((a, b) => better(a.score, b.score) ? -1 : better(b.score, a.score) ? 1 : 0);
  const best = robust[0];
  const ties = robust.filter(entry => !better(entry.score, best.score) && !better(best.score, entry.score));
  const selected = ties[Math.min(ties.length - 1, Math.floor(clamp(random(), 0, 1) * ties.length))];
  const names: Record<BotStrategy, string> = { scale: 'масштабирование', quality: 'качество', mixed: 'смешанное развитие' };
  return recommendation(selected.plan, selected.score, evaluations,
    `План: ${names[selected.plan.strategy]}. Сравнены прибыль и итоговый РИФ с учётом кредита, склада и снижения цен конкурентами. Прогноз является оценкой.`);
}

/** Strategic priorities affect real decisions, not just a label on identical plans.
 * They are soft preferences: affordability and survival always rank first. */
function strategyTargets(o: BotObservation, strategy: BotStrategy, intensity: number, priceBias: number) {
  const profile = PROFILES[strategy];
  const config = botPeriodConfig(o.config, o.macro);
  const depreciation = computeDepreciation(o.opening.machines, config, o.opening.amortFundRemainder);
  const capacityValue = o.opening.machines * config.machineCost;
  const operatingPlan = { ...o.initial, production: Math.round(o.opening.machines * config.costOptimalCu / 100),
    rnd: 0, capexGross: depreciation };
  const budget = checkDecisionBudget(o.opening, operatingPlan, o.macro, config);
  const spareBudget = Math.max(0, budget.remainingBudget);
  const early = clamp((o.remainingPeriods - 1) / 5, 0, 1);
  const last = o.ownHistory.at(-1);
  const stockPressure = o.opening.inventory > Math.max(1, last?.sold ?? operatingPlan.production);
  const rnd = Math.min(MAX_SPEND, Math.max(0, budget.resourcesAvailable) * profile.quality * intensity * early);
  const growth = stockPressure ? 0 : Math.max(0, Math.min(MAX_SPEND - depreciation, capacityValue * profile.growth * intensity * early));
  const desired = Math.max(0, rnd + growth);
  const affordableFraction = desired > 0 ? Math.min(1, spareBudget / desired) : 0;
  const marketPrice = o.marketHistory.at(-1)?.industry.avgPrice || o.initial.price;
  const pricePosition = strategy === 'scale' ? 0.9 : strategy === 'quality' ? 1.2 : 1.03;
  return {
    price: marketPrice * pricePosition * priceBias,
    rnd: rnd * affordableFraction,
    capexGross: o.remainingPeriods <= 1 ? 0 : Math.min(MAX_SPEND, depreciation + growth * affordableFraction),
  };
}

function strategyDeviation(o: BotObservation, plan: Plan, intensity: number, priceBias: number): number {
  const target = strategyTargets(o, plan.strategy, intensity, priceBias);
  const d = plan.decision;
  const early = clamp((o.remainingPeriods - 1) / 5, 0, 1);
  const capacityValue = Math.max(1, o.opening.machines * o.config.machineCost);
  // RIF-point search preferences, not financial expenses or altered game formulas.
  // Budget-scaled investment targets shrink in distress; the last turn has none.
  const qualityWeight = plan.strategy === 'quality' ? 22 : plan.strategy === 'mixed' ? 12 : 4;
  const growthWeight = plan.strategy === 'scale' ? 22 : plan.strategy === 'mixed' ? 12 : 4;
  const rndDistance = Math.min(2, Math.abs(d.rnd - target.rnd) / Math.max(capacityValue * 0.03, target.rnd));
  const capexDistance = Math.min(2, Math.abs(d.capexGross - target.capexGross) / Math.max(capacityValue * 0.05, target.capexGross));
  const priceDistance = Math.min(2, Math.abs(d.price - target.price) / Math.max(1, target.price));
  return early * (qualityWeight * rndDistance + growthWeight * capexDistance) + 20 * priceDistance;
}

function recommendation(plan: Plan, score: Score, evaluatedPlans: number, explanation: string): BotRecommendation {
  const { utility: _utility, netCash: _netCash, ...forecast } = score;
  return { decision: plan.decision, strategy: plan.strategy, explanation, forecast, evaluatedPlans };
}

function normalize(o: BotObservation, d: FirmDecision): FirmDecision {
  const limits = o.macro.scenarioRules;
  const min = Math.max(1, Math.ceil(limits?.priceMin ?? 1));
  const max = Math.floor(limits?.priceMax ?? Number.MAX_SAFE_INTEGER);
  if (max < min) throw new Error('Scenario has no positive integer price.');
  return {
    firmId: o.firmId,
    price: clamp(Math.round(d.price), min, max),
    production: clamp(Math.round(d.production), 0, Math.floor(o.opening.machines)),
    marketing: clamp(Math.round(d.marketing), 0, limits?.marketingMax ?? MAX_SPEND),
    rnd: clamp(Math.round(d.rnd), 0, limits?.rndMax ?? MAX_SPEND),
    capexGross: clamp(Math.round(d.capexGross), 0, limits?.capexMax ?? MAX_SPEND),
  };
}

function candidateValues(o: BotObservation): Record<'price' | 'production' | 'marketing' | 'rnd' | 'capexGross', number[]> {
  const previous = o.ownHistory.at(-1);
  const capacity = o.opening.machines;
  const marketPrice = o.marketHistory.at(-1)?.industry.avgPrice || o.initial.price;
  const demand = previous?.ordersReceived ?? o.initial.production;
  const required = Math.max(0, demand - o.opening.inventory);
  const depreciation = computeDepreciation(capacity, o.config, o.opening.amortFundRemainder);
  const resources = Math.max(0, checkDecisionBudget(o.opening, o.initial, o.macro, o.config).resourcesAvailable);
  const baseline = Math.max(1, capacity * marketPrice);
  const spend = (recent: number) => integers([0, recent / 2, recent, recent * 1.5, baseline * 0.01, baseline * 0.03, baseline * 0.08]);
  return {
    price: integers([o.initial.price, ...[0.6, 0.8, 0.9, 1, 1.1, 1.3, 1.6].map(s => marketPrice * s)]),
    production: integers([0, capacity * 0.1, capacity * 0.25, capacity * 0.5, capacity * 0.65,
      capacity * o.config.costOptimalCu / 100, capacity * 0.9, capacity,
      required * 0.8, required, required * 1.2, o.initial.production]),
    marketing: spend(o.initial.marketing),
    rnd: integers([...spend(o.initial.rnd), resources * 0.15, resources * 0.35, resources * 0.6]),
    capexGross: integers([0, depreciation, o.initial.capexGross,
      ...[0.1, 0.3, 0.6, 1].map(growth => depreciation + capacity * o.config.machineCost * growth)]),
  };
}

/** Initial capex/quality spending is a pulse followed by adaptive decisions. */
function project(o: BotObservation, market: ReturnType<typeof estimateBotMarket>, plan: Plan, stress: boolean): Score {
  let opening = structuredClone(market.opening);
  let previousIndustry = o.marketHistory.at(-1)?.industry;
  let previousNativeIndustryState: Parameters<typeof computePeriod>[0]['previousNativeIndustryState'];
  let previous: FirmPeriodResult | undefined = o.ownHistory.at(-1);
  let profit = 0;
  let fundingRisk = 0;
  let terminal: FirmPeriodResult | undefined;
  const decisions = structuredClone(market.decisions);
  for (let step = 0; step < o.remainingPeriods; step++) {
    // Unknown future announcements are never read from the saved scenario plan.
    const macro = { ...o.macro, periodIndex: o.period + step };
    const config = botPeriodConfig(o.config, macro);
    for (const f of o.firms) {
      if (f.id === o.firmId || opening[f.id].nativeBankruptcy) continue;
      const state = opening[f.id];
      const baseline = market.decisions[f.id];
      decisions[f.id] = normalize({ ...o, firmId: f.id, opening: state }, {
        ...baseline,
        price: Math.max(1, Math.round(baseline.price * (stress ? 0.9 : 1))),
        production: Math.round(clamp(baseline.production * state.machines / Math.max(1, market.opening[f.id].machines), 0, state.machines)),
        capexGross: Math.min(MAX_SPEND, computeDepreciation(state.machines, config, state.amortFundRemainder) +
          (stress ? state.machines * config.machineCost * 0.1 : 0)),
      });
    }
    const state = opening[o.firmId];
    let decision = step === 0 ? plan.decision : followUp(o, plan, state, previous!, step);
    if (step > 0) decision = affordableFollowUp(o, state, decision);
    decisions[o.firmId] = decision;
    const budget = checkDecisionBudget(state, decision, macro, config);
    fundingRisk += Math.max(0, -budget.remainingBudget);
    const result = computePeriod({
      periodIndex: macro.periodIndex, config, macro, firms: o.firms,
      opening, decisions, previousIndustry, previousNativeIndustryState,
    });
    terminal = result.firms.find(f => f.firmId === o.firmId)!;
    profit += terminal.netProfit;
    fundingRisk += terminal.unfundedShortfall + Math.max(0, terminal.loan - macro.loanLimitAbs) + Math.max(0, -terminal.cash);
    if (terminal.isBankrupt) { fundingRisk += macro.loanLimitAbs; break; }
    opening = nextOpeningState(opening, result);
    previous = terminal;
    previousIndustry = result.industry;
    previousNativeIndustryState = result.nativeIndustryState;
  }
  const own = terminal!;
  const profitBase = Math.max(1, Math.abs(o.opening.retainedEarningsBase || o.ownHistory[0]?.netProfit || 1));
  // RIF is the game objective. Profit breaks close ratings without penalizing
  // capex as an expense or debt as an intrinsic loss. Unsold stock earns no cash.
  const strandedInventory = Math.max(0, own.inventoryEnd - own.ordersReceived * 0.1);
  const utility = own.rif.total + (profit - strandedInventory * own.inventoryUnitCostEnd) / profitBase;
  return { rif: own.rif.total, profit, fundingRisk, utility,
    endingInventory: own.inventoryEnd, endingLoan: own.loan, netCash: own.cash - own.loan };
}

function followUp(o: BotObservation, plan: Plan, state: FirmOpeningState, previous: FirmPeriodResult, step: number): FirmDecision {
  const optimal = state.machines * o.config.costOptimalCu / 100;
  const demand = previous.ordersReceived;
  const production = Math.round(clamp(demand - state.inventory, 0, state.machines));
  const inventoryPressure = state.inventory > Math.max(1, previous.sold);
  const profile = PROFILES[plan.strategy];
  const early = step < o.remainingPeriods - 2;
  const depreciation = computeDepreciation(state.machines, o.config, state.amortFundRemainder);
  const resources = Math.max(0, checkDecisionBudget(state, previous.decision, o.macro, o.config).resourcesAvailable);
  return normalize({ ...o, opening: state }, {
    ...plan.decision, production,
    price: previous.decision.price * (inventoryPressure ? 0.9 : previous.unfulfilledOrders > optimal * 0.2 ? 1.05 : 1),
    capexGross: step === o.remainingPeriods - 1 ? 0 : depreciation + (early && demand > optimal && !inventoryPressure
      ? state.machines * o.config.machineCost * profile.growth : 0),
    rnd: early ? Math.min(plan.decision.rnd, resources * profile.quality * 0.15) : 0,
    marketing: inventoryPressure || demand > 0 ? plan.decision.marketing : Math.max(plan.decision.marketing, resources * 0.01),
  });
}

function affordableFollowUp(o: BotObservation, state: FirmOpeningState, decision: FirmDecision): FirmDecision {
  const valid = (d: FirmDecision) => !checkDecisionBudget(state, d, o.macro, botPeriodConfig(o.config, o.macro)).overspend;
  let d = { ...decision };
  for (const key of ['capexGross', 'rnd', 'marketing'] as const) {
    if (valid(d)) return d;
    d[key] = 0;
  }
  if (valid(d)) return d;
  // Unit cost is nonmonotonic, so binary search would discard feasible output.
  for (const fraction of [0.8, 1, 0.65, 0.5, 0.25, 0.1, 0]) {
    d = { ...d, production: Math.round(state.machines * fraction) };
    if (valid(d)) return d;
  }
  return d;
}

function better(a: Score, b: Score): boolean {
  if (Math.abs(a.fundingRisk - b.fundingRisk) > 0.01) return a.fundingRisk < b.fundingRisk;
  if (Math.abs(a.utility - b.utility) > 0.01) return a.utility > b.utility;
  return a.netCash > b.netCash + 0.01;
}
