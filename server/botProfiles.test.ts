import { describe, expect, it } from 'vitest';
import { buildOnlineGameSnapshot, DEFAULT_ONLINE_GAME_SETTINGS } from '../src/online/gameSettings.ts';
import { BOT_STRATEGIES, makeBotPersonality } from '../src/engine/botPersonality.ts';
import type { StoredRoom } from './roomDatabase.ts';
import { ensureBotProfiles } from './botProfiles.ts';

function room(count = 6): StoredRoom {
  return { id: 'room-with-bots', name: 'Bots', ownerId: 'owner', ownerLogin: 'owner',
    visibility: 'link', phase: 'lobby', timerMode: 'unlimited', deadlineAt: null,
    autoBankruptcy: true, settings: { ...DEFAULT_ONLINE_GAME_SETTINGS },
    snapshot: buildOnlineGameSnapshot('Bots'), members: [],
    bots: Array.from({ length: count }, (_, i) => ({ firmId: `bot${i}`, firmName: `Бот ${i}` })) };
}

describe('room bot strategy assignment', () => {
  it('assigns every strategic family in a three-bot room and balances a larger room', () => {
    for (const count of [2, 3, 6, 12]) {
      const game = room(count);
      const profiles = [...ensureBotProfiles(game).values()];
      expect(new Set(profiles.map(p => p.strategy)).size).toBe(Math.min(3, count));
      const counts = BOT_STRATEGIES.map(s => profiles.filter(p => p.strategy === s).length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });
  it('preserves all assigned preferences on repeated turns and serialized reloads', () => {
    const game = room();
    ensureBotProfiles(game);
    const original = structuredClone(game.bots);
    for (let turn = 0; turn < 8; turn++) {
      game.phase = 'collecting';
      ensureBotProfiles(game);
      expect(game.bots).toEqual(original);
      const restored = JSON.parse(JSON.stringify(game)) as StoredRoom;
      ensureBotProfiles(restored);
      expect(restored.bots).toEqual(original);
    }
  });
  it('upgrades a legacy bot without losing identity or rewriting game history', () => {
    const game = room(1);
    game.botFirmId = 'legacy';
    const snapshot = JSON.stringify(game.snapshot);
    ensureBotProfiles(game);
    expect(game.bots!.map(b => b.firmId)).toContain('legacy');
    expect(game.bots).toHaveLength(2);
    expect(new Set(game.bots!.map(b => b.profile!.strategy)).size).toBe(2);
    expect(JSON.stringify(game.snapshot)).toBe(snapshot);
    const first = JSON.stringify(game.bots);
    ensureBotProfiles(game);
    expect(JSON.stringify(game.bots)).toBe(first);
  });
  it('keeps existing valid profiles when filling missing entries', () => {
    const game = room(3);
    const fixed = makeBotPersonality('quality', 'fixed');
    game.bots![1].profile = fixed;
    ensureBotProfiles(game);
    expect(game.bots![1].profile).toEqual(fixed);
    expect(new Set(game.bots!.map(b => b.profile!.strategy)).size).toBe(3);
  });
});
