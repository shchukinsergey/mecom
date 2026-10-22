import { describe, expect, it } from 'vitest';
import { chooseBotDecision, recommendBotDecision } from '../bot';
import { estimateBotMarket, observeBot, type BotPeriodMacro } from '../botObservation';
import { checkDecisionBudget } from '../decisionBudget';
import { DEFAULT_LEAGUE_CONFIG, makeFirmDecision, makeFirmStart, makeMacroParams } from '../config';
import { computePeriod, initialOpeningState, nextOpeningState } from '../computePeriod';
import type { League } from '../types';
import type { LeagueSnapshot } from '../../state/persistence';

function snapshot(horizon = 1, count = 2): LeagueSnapshot {
  const config = structuredClone(DEFAULT_LEAGUE_CONFIG);
  const firms = Array.from({ length: count }, (_, i) => i === 0 ? 'bot' : i === 1 ? 'rival' : `rival${i}`).map((id, index) => ({
    ...makeFirmStart(count, config.machineCost), id, name: index ? id : 'Bot',
  }));
  const league: League = {
    id: 'test', name: 'Test', createdAt: '2026-01-01T00:00:00.000Z', config, firms,
    macroByPeriod: Array.from({ length: horizon }, (_, index) => makeMacroParams(index)),
    decisionsByPeriod: [Object.fromEntries(firms.map(f => [f.id, makeFirmDecision(f.id, count)]))],
    confirmedByPeriod: [{}], results: [],
  };
  return { league, opening: initialOpeningState(league) };
}

describe('market-aware bot decision', () => {
  it('returns valid decisions for only the requested firm and does not mutate the game', () => {
    const game = snapshot();
    const rivalBefore = structuredClone(game.league.decisionsByPeriod[0].rival);
    const decision = chooseBotDecision(game, 'bot', () => 0.5);

    expect(decision).toMatchObject({ firmId: 'bot' });
    expect(decision.price).toBeGreaterThan(0);
    expect(decision.production).toBeGreaterThanOrEqual(0);
    expect(decision.production).toBeLessThanOrEqual(game.opening.bot.machines);
    expect(decision.marketing).toBeGreaterThanOrEqual(0);
    expect(decision.rnd).toBeGreaterThanOrEqual(0);
    expect(decision.capexGross).toBeGreaterThanOrEqual(0);
    expect(game.league.decisionsByPeriod[0].rival).toEqual(rivalBefore);
  });

  it('chooses a decision that improves forecast net profit over the current plan', () => {
    const game = snapshot();
    const current = game.league.decisionsByPeriod[0];
    const recommendation = chooseBotDecision(game, 'bot', () => 0.5);
    const evaluate = (botDecision: typeof recommendation) => computePeriod({
      periodIndex: 0,
      config: game.league.config,
      macro: game.league.macroByPeriod[0],
      firms: game.league.firms.map(({ id, name }) => ({ id, name })),
      opening: game.opening,
      decisions: { ...current, bot: botDecision },
    }).firms.find(result => result.firmId === 'bot')!.netProfit;

    expect(evaluate(recommendation)).toBeGreaterThanOrEqual(evaluate(current.bot));
  });

  it('evaluates long-term effects of recurring R&D and capacity investment through the remaining game', () => {
    const recommendation = chooseBotDecision(snapshot(8), 'bot', () => 0.5);
    const { firmId, ...values } = recommendation;
    expect(firmId).toBe('bot');
    expect(Object.values(values).every(Number.isFinite)).toBe(true);
  });

  it('does not perturb the common introductory decision with random cents', () => {
    const low = chooseBotDecision(snapshot(), 'bot', () => 0);
    const high = chooseBotDecision(snapshot(), 'bot', () => 0.999);
    expect(low).toEqual(high);
    expect(low).toEqual(makeFirmDecision('bot', 2));
  });
});

function advance(game: LeagueSnapshot, botDecision = makeFirmDecision('bot', game.league.firms.length), price = 30) {
  const { league } = game;
  const periodIndex = league.results.length;
  const decisions = Object.fromEntries(league.firms.map(f => [f.id, f.id === 'bot' ? botDecision : {
    ...makeFirmDecision(f.id, league.firms.length), price,
    production: Math.round(game.opening[f.id].machines * 0.8),
    capexGross: Math.round(game.opening[f.id].machines * league.config.machineCost / league.config.machineLifespanPeriods),
  }]));
  const result = computePeriod({ periodIndex, config: league.config, macro: league.macroByPeriod[periodIndex],
    firms: league.firms, opening: game.opening, decisions,
    previousIndustry: league.results.at(-1)?.industry,
    previousNativeIndustryState: league.results.at(-1)?.nativeIndustryState });
  league.results.push(result);
  league.decisionsByPeriod[periodIndex] = decisions;
  // This is the online room lifecycle that the original tests never exercised.
  league.decisionsByPeriod[periodIndex + 1] = {};
  game.opening = nextOpeningState(game.opening, result);
  return result.firms.find(f => f.firmId === 'bot')!;
}

describe('online bot regression and strategy planning', () => {
  it('chooses genuinely different investment plans for persistent strategies from the same state', () => {
    const game = snapshot(9, 8);
    advance(game);
    const observation = observeBot(game, 'bot');
    const scale = recommendBotDecision(observation, () => 0.5, { strategy: 'scale' });
    const quality = recommendBotDecision(observation, () => 0.5, { strategy: 'quality' });
    const mixed = recommendBotDecision(observation, () => 0.5, { strategy: 'mixed' });
    expect(scale.strategy).toBe('scale');
    expect(quality.strategy).toBe('quality');
    expect(mixed.strategy).toBe('mixed');
    expect(scale.decision.capexGross).toBeGreaterThan(quality.decision.capexGross);
    expect(quality.decision.rnd).toBeGreaterThan(scale.decision.rnd);
    expect(quality.decision.price).toBeGreaterThan(scale.decision.price);
    expect(new Set([scale, quality, mixed].map(r => JSON.stringify(r.decision))).size).toBe(3);
  });
  it('estimates nonzero rivals with an empty current decision slot', () => {
    const game = snapshot(9);
    advance(game);
    const market = estimateBotMarket(observeBot(game, 'bot'));
    expect(market.decisions.rival.price).toBe(30);
    expect(market.decisions.rival.production).toBeGreaterThan(0);
    const decision = chooseBotDecision(game, 'bot', () => 0.5);
    expect(decision.production).toBeGreaterThan(0);
    expect(Number.isInteger(decision.price)).toBe(true);
    expect(checkDecisionBudget(game.opening.bot, decision, game.league.macroByPeriod[1], game.league.config).overspend).toBe(false);
  });

  it('cannot read opponents private state, hidden decisions or future macro announcements', () => {
    const game = snapshot(5);
    advance(game);
    const before = observeBot(game, 'bot');
    const decision = recommendBotDecision(before, () => 0.5);
    game.opening.rival.loan = 99999;
    game.opening.rival.rndCumulative = 500000;
    game.opening.rival.inventory = 20000;
    game.league.decisionsByPeriod[1].rival = { ...makeFirmDecision('rival', 2), price: 1, rnd: 50000 };
    game.league.results[0].firms[1].decision.rnd = 50000;
    game.league.results[0].firms[1].rndCumulative = 500000;
    game.league.results[0].nativeIndustryState!.rndCumulative = 999999;
    game.league.macroByPeriod[2].demandOS = -20;
    expect(observeBot(game, 'bot')).toEqual(before);
    expect(recommendBotDecision(observeBot(game, 'bot'), () => 0.5)).toEqual(decision);
  });

  it.each([30, 20])('finishes a full game against a rival priced at %s without the shutdown spiral', price => {
    const game = snapshot(9);
    advance(game);
    const outputs: number[] = [];
    for (let period = 1; period < 9; period++) {
      const decision = chooseBotDecision(game, 'bot', () => 0.5);
      expect(Object.entries(decision).filter(([key]) => key !== 'firmId').every(([, value]) => Number.isInteger(value))).toBe(true);
      expect(checkDecisionBudget(game.opening.bot, decision, game.league.macroByPeriod[period], game.league.config).overspend).toBe(false);
      const result = advance(game, decision, price);
      outputs.push(result.produced);
      expect(result.unfundedShortfall).toBe(0);
      expect(result.isBankrupt).toBe(false);
    }
    expect(outputs.filter(q => q > 0).length).toBeGreaterThanOrEqual(6);
    expect(game.league.results.at(-1)!.firms[0].retainedEarnings).toBeGreaterThan(0);
  }, 20000);

  it('can restart after a zero-output, zero-spending period', () => {
    const game = snapshot(5);
    advance(game);
    advance(game, { firmId: 'bot', price: 30, production: 0, marketing: 0, rnd: 0, capexGross: 0 });
    const decision = chooseBotDecision(game, 'bot', () => 0.5);
    expect(decision.production).toBeGreaterThan(0);
  });

  it('reduces replenishment when a large inventory is available', () => {
    const game = snapshot(2);
    advance(game);
    game.opening.bot.inventory = 10000;
    game.opening.bot.inventoryUnitCost = 18;
    game.opening.bot.inventoryAgedUnits = 10000;
    game.opening.bot.capital += 180000;
    // Isolate replenishment economics from an explicit RIF reward for producing
    // goods regardless of their sale (supply/efficiency are separate objectives).
    game.league.macroByPeriod[1].rifWeightSupplyPotential = 0;
    game.league.macroByPeriod[1].rifWeightEfficiency = 0;
    const decision = chooseBotDecision(game, 'bot', () => 0.5);
    expect(decision.production).toBe(0);
  });

  it('considers affordable early expansion financed with credit', () => {
    const game = snapshot(9, 8);
    advance(game);
    const result = recommendBotDecision(observeBot(game, 'bot'), () => 0.5, { strategy: 'scale' });
    const depreciation = game.opening.bot.machines * game.league.config.machineCost / game.league.config.machineLifespanPeriods;
    expect(result.decision.capexGross).toBeGreaterThan(depreciation + 4 * game.league.config.machineCost);
    const budget = checkDecisionBudget(game.opening.bot, result.decision, game.league.macroByPeriod[1], game.league.config);
    expect(budget.totalSpending).toBeGreaterThan(budget.openingCash);
    expect(budget.overspend).toBe(false);
    expect(result.explanation).toContain('масштабирование');
    expect(result.evaluatedPlans).toBeGreaterThan(20);
  });

  it('respects scenario integer price bounds and spending limits', () => {
    const game = snapshot(3);
    advance(game);
    (game.league.macroByPeriod[1] as BotPeriodMacro).scenarioRules = { priceMin: 17.2, priceMax: 23.8,
      priceWeight: 0.7, mktgWeight: 0.15, rndWeight: 0.15, storageCostPerUnit: 1, firingPenaltyPerEmployee: 10 };
    const decision = chooseBotDecision(game, 'bot', () => 0.5);
    expect(decision.price).toBeGreaterThanOrEqual(18);
    expect(decision.price).toBeLessThanOrEqual(23);
    expect([decision.marketing, decision.rnd, decision.capexGross].every(v => v >= 0 && v <= 50000)).toBe(true);
  });

  it('can front-load quality when the published scenario rewards R&D', () => {
    const game = snapshot(9, 8);
    advance(game);
    (game.league.macroByPeriod[1] as BotPeriodMacro).scenarioRules = { priceMin: 10, priceMax: 100,
      priceWeight: 0.1, mktgWeight: 0.1, rndWeight: 0.8, storageCostPerUnit: 1, firingPenaltyPerEmployee: 10 };
    const result = recommendBotDecision(observeBot(game, 'bot'), () => 0.5, { strategy: 'quality' });
    expect(result.decision.rnd).toBeGreaterThan(makeFirmDecision('bot', 8).rnd);
    expect(result.strategy).toBe('quality');
    expect(checkDecisionBudget(game.opening.bot, result.decision, game.league.macroByPeriod[1], game.league.config).overspend).toBe(false);
  });

  it('does not expand capacity on the final turn when there is no time to use it', () => {
    const game = snapshot(2, 8);
    advance(game);
    const result = chooseBotDecision(game, 'bot', () => 0.5);
    expect(result.capexGross).toBe(0);
  });

  it('returns an affordable plan when the previous plan no longer fits the credit limit', () => {
    const game = snapshot(3);
    advance(game);
    game.opening.bot.capital += 500 - game.opening.bot.cash - (99000 - game.opening.bot.loan);
    game.opening.bot.cash = 500;
    game.opening.bot.loan = 99000;
    const decision = chooseBotDecision(game, 'bot', () => 0.5);
    expect(checkDecisionBudget(game.opening.bot, decision, game.league.macroByPeriod[1], game.league.config).overspend).toBe(false);
    for (const strategy of ['scale', 'quality', 'mixed'] as const) {
      const committed = chooseBotDecision(game, 'bot', () => 0.5, { strategy, investmentIntensity: 1.2, priceBias: 1.04 });
      expect(checkDecisionBudget(game.opening.bot, committed, game.league.macroByPeriod[1], game.league.config).overspend).toBe(false);
    }
  });
});
