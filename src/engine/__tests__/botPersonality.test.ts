import { describe, expect, it } from 'vitest';
import { BOT_STRATEGIES, isBotPersonality, makeBotPersonality } from '../botPersonality';

describe('persistent bot personalities', () => {
  it('generates valid, reproducible personalities from a stable game identity', () => {
    for (const strategy of BOT_STRATEGIES) {
      const profile = makeBotPersonality(strategy, 'room:bot');
      expect(isBotPersonality(profile)).toBe(true);
      expect(profile.strategy).toBe(strategy);
      expect(makeBotPersonality(strategy, 'room:bot')).toEqual(profile);
      expect(makeBotPersonality(strategy, 'other-room:bot')).not.toEqual(profile);
    }
  });
  it('varies behaviour within the same strategic family', () => {
    const profiles = Array.from({ length: 12 }, (_, i) => makeBotPersonality('scale', `room:bot${i}`));
    expect(new Set(profiles.map(p => JSON.stringify(p))).size).toBe(12);
    expect(profiles.every(isBotPersonality)).toBe(true);
  });
  it('rejects missing, invalid and nonfinite saved personalities', () => {
    for (const value of [null, {}, { strategy: 'random' }, { strategy: 'scale', investmentIntensity: NaN, priceBias: 1 },
      { strategy: 'quality', investmentIntensity: 5, priceBias: 1 }, { strategy: 'mixed', investmentIntensity: 1, priceBias: Infinity }]) {
      expect(isBotPersonality(value)).toBe(false);
    }
  });
});
