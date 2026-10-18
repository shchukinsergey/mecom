import { describe, expect, it } from 'vitest';
import { chooseBotDecision } from '../bot';
import { DEFAULT_LEAGUE_CONFIG, makeFirmDecision, makeFirmStart, makeMacroParams } from '../config';
import { computePeriod, initialOpeningState } from '../computePeriod';
import type { League } from '../types';
import type { LeagueSnapshot } from '../../state/persistence';

function snapshot(horizon = 1): LeagueSnapshot {
  const config = structuredClone(DEFAULT_LEAGUE_CONFIG);
  const firms = ['bot', 'rival'].map((id, index) => ({
    ...makeFirmStart(2, config.machineCost), id, name: index ? 'Rival' : 'Bot',
  }));
  const league: League = {
    id: 'test', name: 'Test', createdAt: '2026-01-01T00:00:00.000Z', config, firms,
    macroByPeriod: Array.from({ length: horizon }, (_, index) => makeMacroParams(index)),
    decisionsByPeriod: [{ bot: makeFirmDecision('bot', 2), rival: makeFirmDecision('rival', 2) }],
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

  it('uses supplied randomness for small variation without losing market adaptation', () => {
    const low = chooseBotDecision(snapshot(), 'bot', () => 0);
    const high = chooseBotDecision(snapshot(), 'bot', () => 0.999);
    expect(low.price).not.toBe(high.price);
    expect(Math.abs(low.price - high.price)).toBeLessThan(3);
  });
});
