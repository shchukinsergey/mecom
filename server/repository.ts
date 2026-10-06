import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LeagueSnapshot } from '../src/state/persistence.ts';


export interface Decision { price: number; production: number; marketing: number; capexGross: number; rnd: number }
export interface Firm { firmId: string; firmName: string; rejoinTokenHash: string; decision: Decision | null; submitted: boolean }
export interface Game { gameId: string; name: string; inviteTokenHash: string; open: boolean; firms: Firm[]; phase?: 'lobby' | 'collecting' | 'complete' | 'closed'; snapshot?: LeagueSnapshot | null }
export interface RepositoryState { schemaVersion: 1; leagues: Record<string, unknown>; games: Record<string, Game> }

export class JsonRepository {
  private readonly filePath: string;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(filePath: string) { this.filePath = filePath; }

  async read(): Promise<RepositoryState> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      if (!isRepositoryState(parsed)) throw new Error('Invalid repository state');
      return parsed;
    } catch (error) {
      if (isMissingFile(error)) return { schemaVersion: 1, leagues: {}, games: {} };
      throw error;
    }
  }

  async update<T>(operation: (state: RepositoryState) => T | Promise<T>): Promise<T> {
    const run = this.queue.then(async () => { const state = await this.read(); const result = await operation(state); await this.write(state); return result; });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async write(state: RepositoryState): Promise<void> {
    if (!isRepositoryState(state)) throw new TypeError('Invalid repository state');
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, this.filePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

export function isRepositoryState(value: unknown): value is RepositoryState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.leagues !== 'object' || record.leagues === null || Array.isArray(record.leagues)) return false;
  if (record.games === undefined) { record.games = {}; return true; }
  if (typeof record.games !== 'object' || record.games === null || Array.isArray(record.games)) return false;
  for (const [id, raw] of Object.entries(record.games)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
    const game = raw as Record<string, unknown>;
    if (game.gameId !== id || typeof game.name !== 'string' || typeof game.inviteTokenHash !== 'string' || typeof game.open !== 'boolean' || !Array.isArray(game.firms)) return false;
    if (game.phase !== undefined && !['lobby', 'collecting', 'complete', 'closed'].includes(String(game.phase))) return false;
    if (game.snapshot !== undefined && game.snapshot !== null && !validStoredSnapshot(game.snapshot)) return false;
    const names = new Set<string>();
    for (const entry of game.firms) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return false;
      const firm = entry as Record<string, unknown>;
      if (typeof firm.firmId !== 'string' || typeof firm.firmName !== 'string' || typeof firm.rejoinTokenHash !== 'string' || typeof firm.submitted !== 'boolean' || !(firm.decision === null || validDecision(firm.decision))) return false;
      const name = firm.firmName.trim().toLowerCase(); if (names.has(name)) return false; names.add(name);
    }
  }
  return true;
}

function validStoredSnapshot(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>, l = s.league as Record<string, unknown> | undefined;
  return !!l && typeof l === 'object' && typeof l.id === 'string' && typeof l.name === 'string' && !!l.config && typeof l.config === 'object' && Array.isArray(l.firms) && Array.isArray(l.results) && Array.isArray(l.macroByPeriod) && Array.isArray(l.decisionsByPeriod) && Array.isArray(l.confirmedByPeriod) && !!s.opening && typeof s.opening === 'object' && !Array.isArray(s.opening);
}

export function validDecision(value: unknown): value is Decision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const keys = ['price', 'production', 'marketing', 'capexGross', 'rnd'];
  if (Object.keys(v).length !== keys.length || !keys.every(k => Object.hasOwn(v, k) && typeof v[k] === 'number' && Number.isFinite(v[k]))) return false;
  return (v.price as number) > 0 && keys.slice(1).every(k => (v[k] as number) >= 0);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
