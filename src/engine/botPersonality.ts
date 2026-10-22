export const BOT_STRATEGIES = ['scale', 'quality', 'mixed'] as const;
export type BotStrategy = typeof BOT_STRATEGIES[number];

/** Assigned once per game and stored with the bot, not rolled on each turn. */
export interface BotPersonality {
  strategy: BotStrategy;
  investmentIntensity: number;
  priceBias: number;
}

export function isBotPersonality(value: unknown): value is BotPersonality {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<BotPersonality>;
  return BOT_STRATEGIES.includes(p.strategy as BotStrategy) &&
    typeof p.investmentIntensity === 'number' && Number.isFinite(p.investmentIntensity) &&
    p.investmentIntensity >= 0.8 && p.investmentIntensity <= 1.2 &&
    typeof p.priceBias === 'number' && Number.isFinite(p.priceBias) && p.priceBias >= 0.96 && p.priceBias <= 1.04;
}

/** Stable across process restarts; UUIDs provide variation without runtime RNG. */
export function botSeed(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function makeBotPersonality(strategy: BotStrategy, seed: string): BotPersonality {
  return {
    strategy,
    investmentIntensity: 0.8 + (botSeed(`investment:${seed}`) % 4001) / 10000,
    priceBias: 0.96 + (botSeed(`price:${seed}`) % 801) / 10000,
  };
}
