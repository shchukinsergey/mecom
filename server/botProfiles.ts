import { BOT_STRATEGIES, botSeed, isBotPersonality, makeBotPersonality, type BotPersonality } from '../src/engine/botPersonality.ts';
import { roomBots, type StoredRoom } from './roomDatabase.ts';

/** Called inside the room transaction at start, or once when upgrading an old game. */
export function ensureBotProfiles(room: StoredRoom): Map<string, BotPersonality> {
  const bots = roomBots(room);
  const counts = { scale: 0, quality: 0, mixed: 0 };
  for (const bot of bots) if (isBotPersonality(bot.profile)) counts[bot.profile.strategy]++;
  const offset = botSeed(room.id) % BOT_STRATEGIES.length;
  const order = [...BOT_STRATEGIES.slice(offset), ...BOT_STRATEGIES.slice(0, offset)];
  room.bots = bots.map(bot => {
    if (isBotPersonality(bot.profile)) return bot;
    // Balanced initial assignment guarantees variety even in a small room.
    const strategy = order.reduce((best, candidate) => counts[candidate] < counts[best] ? candidate : best);
    counts[strategy]++;
    return { ...bot, profile: makeBotPersonality(strategy, `${room.id}:${bot.firmId}`) };
  });
  return new Map(room.bots.map(bot => [bot.firmId, bot.profile!]));
}
