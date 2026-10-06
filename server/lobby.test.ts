import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalServer, listenLocal } from './http.ts';
import { JsonRepository } from './repository.ts';
import { buildOnlineGameSnapshot, DEFAULT_ONLINE_GAME_SETTINGS } from '../src/online/gameSettings';

const adminToken = 'integration-admin-token-with-at-least-32-characters';
let directory = '';
let server: ReturnType<typeof createLocalServer> | undefined;
let base = '';

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  base = '';
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

async function start() {
  directory = await mkdtemp(join(tmpdir(), 'mecom-lobby-'));
  const repository = new JsonRepository(join(directory, 'state.json'));
  server = createLocalServer(repository, { adminToken });
  await listenLocal(server, 0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  base = `http://127.0.0.1:${address.port}`;
  return { repository, base };
}

const json = (value: unknown) => JSON.stringify(value);
async function body(response: Response): Promise<any> {
  return response.json();
}
async function createGame(url: string, name = 'Autumn Game', snapshot?: unknown) {
  const response = await fetch(`${url}/api/games`, {
    method: 'POST',
    headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
    body: json(snapshot ? { name, snapshot } : { name }),
  });
  expect(response.status).toBe(201);
  return body(response);
}
async function joinGame(url: string, inviteToken: string, firmName: string) {
  const response = await fetch(`${url}/api/join`, {
    method: 'POST',
    headers: { 'x-mecom-invite': inviteToken, 'content-type': 'application/json' },
    body: json({ firmName }),
  });
  return { response, result: await body(response) };
}

 describe('multiplayer lobby HTTP API', () => {
  it('creates games only for an admin with a sufficiently long bearer token', async () => {
    const { base: url } = await start();
    expect(server?.address()).toMatchObject({ address: '127.0.0.1' });
    for (const authorization of [undefined, 'Bearer wrong-admin', 'Bearer short']) {
      const response = await fetch(`${url}/api/games`, {
        method: 'POST', headers: { ...(authorization ? { authorization } : {}), 'content-type': 'application/json' }, body: json({ name: 'Nope' }),
      });
      expect(response.status).toBe(401);
    }
    const game = await createGame(url);
    expect(game).toEqual(expect.objectContaining({ gameId: expect.any(String), name: 'Autumn Game', inviteToken: expect.any(String) }));
  });

  it('creates a default playable snapshot when omitted and exposes only own opening state and current macro', async () => {
    const { base: url } = await start();
    const game = await createGame(url, 'Defaults');
    const { result: one } = await joinGame(url, game.inviteToken, 'Northwind');
    const { result: two } = await joinGame(url, game.inviteToken, 'Contoso');
    const startResponse = await fetch(`${url}/api/games/${game.gameId}/start`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } });
    expect(startResponse.status).toBe(200);
    const state = await body(await fetch(`${url}/api/state`, { headers: { authorization: `Bearer ${adminToken}` } }));
    expect(state.games[game.gameId].snapshot.league.config).toBeTruthy();
    expect(state.games[game.gameId].snapshot.league.config.featureFlags.loanRepayment).toBe('preRevenue');
    for (const player of [one, two]) {
      const dto = await body(await fetch(`${url}/api/player/me`, { headers: { 'x-mecom-player': player.rejoinToken } }));
      expect(dto.openingState).toBeTruthy();
      expect(dto.periodMacro).toBeTruthy();
      expect(JSON.stringify(dto.openingState)).not.toContain(player === one ? two.firmId : one.firmId);
      expect(dto).not.toHaveProperty('firms');
    }
  });

  it('keeps custom financial settings on all periods of a new online game', async () => {
    const { base: url, repository } = await start();
    const settings = {
      ...DEFAULT_ONLINE_GAME_SETTINGS,
      loanRepayment: 'none' as const,
      bankInterestFormula: 'flatLoanRate' as const,
      taxRatePercent: 20,
      bankRateBasePercent: 8,
      bankRateExtraPercent: 32,
      loanLimitBase: 60000,
      loanLimitAbs: 120000,
    };
    const game = await createGame(url, 'Custom finance', buildOnlineGameSnapshot('Custom finance', settings));
    const one = (await joinGame(url, game.inviteToken, 'Northwind')).result;
    const two = (await joinGame(url, game.inviteToken, 'Contoso')).result;
    const startResponse = await fetch(`${url}/api/games/${game.gameId}/start`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(startResponse.status).toBe(200);
    const started = await body(startResponse);
    expect(started.snapshot.league.config.featureFlags.loanRepayment).toBe('none');
    expect(started.snapshot.league.macroByPeriod[1]).toMatchObject({
      taxRate: 0.2, bankRateBase: 0.08, bankRateExtra: 0.32,
      loanLimitBase: 60000, loanLimitAbs: 120000,
    });

    const decision = { price: 30, production: 0, marketing: 0, capexGross: 0, rnd: 0 };
    for (const player of [one, two]) {
      await fetch(`${url}/api/player/decision`, {
        method: 'PUT', headers: { 'x-mecom-player': player.rejoinToken, 'content-type': 'application/json' },
        body: json(decision),
      });
      await fetch(`${url}/api/player/submit`, { method: 'POST', headers: { 'x-mecom-player': player.rejoinToken } });
    }
    const calculation = await fetch(`${url}/api/admin/games/${game.gameId}/calculate`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(calculation.status).toBe(200);
    const state = await repository.read();
    expect(state.games[game.gameId].snapshot?.league.macroByPeriod[2]).toMatchObject({
      taxRate: 0.2, bankRateBase: 0.08, bankRateExtra: 0.32,
      loanLimitBase: 60000, loanLimitAbs: 120000,
    });
  });

  it('starts with period 0 already calculated and opens decisions for period 1', async () => {
    const { base: url } = await start();
    const game = await createGame(url, 'Period zero');
    const { result: one } = await joinGame(url, game.inviteToken, 'Northwind');
    const { result: two } = await joinGame(url, game.inviteToken, 'Contoso');

    const startResponse = await fetch(`${url}/api/games/${game.gameId}/start`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(startResponse.status).toBe(200);
    const started = await body(startResponse);
    expect(started.snapshot.league.results).toHaveLength(1);
    expect(started.snapshot.league.results[0].periodIndex).toBe(0);

    for (const player of [one, two]) {
      const playerResponse = await fetch(`${url}/api/player/me`, { headers: { 'x-mecom-player': player.rejoinToken } });
      expect(playerResponse.status).toBe(200);
      const dto = await body(playerResponse);
      expect(dto.currentPeriodIndex).toBe(1);
      expect(dto.periodMacro.periodIndex).toBe(1);
      expect(dto.phase).toBe('collecting');
      expect(dto.submitted).toBe(false);
      expect(dto.decision).toEqual(expect.objectContaining({
        price: expect.any(Number), production: expect.any(Number), marketing: expect.any(Number),
        capexGross: expect.any(Number), rnd: expect.any(Number),
      }));
      expect(dto.reports[0].report).toContain('И Н Д У С Т Р И Я');
      expect(dto.reports[0].report).toContain('Всего заказов');
    }
  });


  it('rejects duplicate firm names without case sensitivity', async () => {
    const { base: url } = await start();
    const game = await createGame(url);
    expect((await joinGame(url, game.inviteToken, 'Northwind')).response.status).toBe(201);
    expect((await joinGame(url, game.inviteToken, 'nOrThWiNd')).response.status).toBe(409);
  });

  it('keeps decisions private while exposing each firm’s public current RIF', async () => {
    const { base: url } = await start();
    const game = await createGame(url);
    const { response: joined, result: player } = await joinGame(url, game.inviteToken, 'Northwind');
    expect(joined.status).toBe(201);
    expect(player).toEqual(expect.objectContaining({ firmId: expect.any(String), rejoinToken: expect.any(String) }));
    const meResponse = await fetch(`${url}/api/player/me`, { headers: { 'x-mecom-player': player.rejoinToken } });
    expect(meResponse.status).toBe(200);
    expect(await body(meResponse)).toMatchObject({ firmId: player.firmId, firmName: 'Northwind' });

    const statusResponse = await fetch(`${url}/api/games/${game.gameId}/status`, { headers: { 'x-mecom-player': player.rejoinToken } });
    expect(statusResponse.status).toBe(200);
    const status = await body(statusResponse);
    expect(JSON.stringify(status)).not.toMatch(/decision|inviteToken|playerToken|adminToken|price|production|marketing|capex|rnd/i);
    expect(status.firms).toEqual(expect.arrayContaining([expect.objectContaining({
      firmId: player.firmId, firmName: 'Northwind', submitted: false, currentRif: null,
    })]));
    expect(Object.keys(status.firms[0]).sort()).toEqual(['currentRif', 'firmId', 'firmName', 'submitted']);
  });

  it('accepts drafts only after start and clears submission when a draft changes', async () => {
    const { base: url } = await start();
    const game = await createGame(url);
    const { result: player } = await joinGame(url, game.inviteToken, 'Northwind');
    await joinGame(url, game.inviteToken, 'Southwind');
    expect((await fetch(`${url}/api/player/submit`, { method: 'POST', headers: { 'x-mecom-player': player.rejoinToken } })).status).toBe(409);
    const decision = { price: 12.5, production: 20, marketing: 3, capexGross: 4, rnd: 1 };
    expect((await fetch(`${url}/api/player/decision`, { method: 'PUT', headers: { 'x-mecom-player': player.rejoinToken, 'content-type': 'application/json' }, body: json(decision) })).status).toBe(409);
    expect((await fetch(`${url}/api/games/${game.gameId}/start`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } })).status).toBe(200);
    expect((await fetch(`${url}/api/player/decision`, { method: 'PUT', headers: { 'x-mecom-player': player.rejoinToken, 'content-type': 'application/json' }, body: json(decision) })).status).toBe(200);
    expect((await fetch(`${url}/api/player/submit`, { method: 'POST', headers: { 'x-mecom-player': player.rejoinToken } })).status).toBe(200);
    expect((await body(await fetch(`${url}/api/player/me`, { headers: { 'x-mecom-player': player.rejoinToken } }))).submitted).toBe(true);
    expect((await fetch(`${url}/api/player/decision`, { method: 'PUT', headers: { 'x-mecom-player': player.rejoinToken, 'content-type': 'application/json' }, body: json({ ...decision, price: 14 }) })).status).toBe(200);
    expect((await body(await fetch(`${url}/api/player/me`, { headers: { 'x-mecom-player': player.rejoinToken } }))).submitted).toBe(false);
    const beforeInvalidSave = await body(await fetch(`${url}/api/player/me`, { headers: { 'x-mecom-player': player.rejoinToken } }));
    const overCapacity = { ...decision, production: beforeInvalidSave.openingState.machines + 1 };
    const rejected = await fetch(`${url}/api/player/decision`, { method: 'PUT', headers: { 'x-mecom-player': player.rejoinToken, 'content-type': 'application/json' }, body: json(overCapacity) });
    expect(rejected.status).toBe(400);
    expect((await body(await fetch(`${url}/api/player/me`, { headers: { 'x-mecom-player': player.rejoinToken } }))).decision).toEqual(beforeInvalidSave.decision);
    const overCategoryLimit = { ...decision, marketing: 50001 };
    expect((await fetch(`${url}/api/player/decision`, { method: 'PUT', headers: { 'x-mecom-player': player.rejoinToken, 'content-type': 'application/json' }, body: json(overCategoryLimit) })).status).toBe(400);
    const overBudget = { ...decision, production: beforeInvalidSave.openingState.machines, marketing: 50000, capexGross: 50000, rnd: 50000 };
    expect((await fetch(`${url}/api/player/decision`, { method: 'PUT', headers: { 'x-mecom-player': player.rejoinToken, 'content-type': 'application/json' }, body: json(overBudget) })).status).toBe(400);
    expect((await body(await fetch(`${url}/api/player/me`, { headers: { 'x-mecom-player': player.rejoinToken } }))).decision).toEqual(beforeInvalidSave.decision);
    expect(beforeInvalidSave.config).toBeTruthy();
    expect(beforeInvalidSave.recentResults).toHaveLength(1);
    expect(beforeInvalidSave.recentResults[0].firmId).toBe(player.firmId);
    for (const invalid of [{ ...decision, price: 0 }, { ...decision, production: -1 }, { ...decision, marketing: Infinity }, { ...decision, extra: 1 }]) {
      const response = await fetch(`${url}/api/player/decision`, { method: 'PUT', headers: { 'x-mecom-player': player.rejoinToken, 'content-type': 'application/json' }, body: json(invalid) });
      expect(response.status).toBe(400);
    }
  });

  it('enforces game boundaries, lobby closure, and admin-only state/close operations', async () => {
    const { base: url } = await start();
    const first = await createGame(url, 'First');
    const second = await createGame(url, 'Second');
    const { result: player } = await joinGame(url, first.inviteToken, 'Northwind');
    expect((await fetch(`${url}/api/games/${second.gameId}/status`, { headers: { 'x-mecom-player': player.rejoinToken } })).status).toBe(403);
    expect((await fetch(`${url}/api/state`)).status).toBe(401);
    expect((await fetch(`${url}/api/state`, { headers: { authorization: `Bearer ${adminToken}` } })).status).toBe(200);
    expect((await fetch(`${url}/api/games/${first.gameId}/close`, { method: 'POST' })).status).toBe(401);
    expect((await fetch(`${url}/api/games/${first.gameId}/close`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } })).status).toBe(200);
    expect((await joinGame(url, first.inviteToken, 'Contoso')).response.status).toBe(409);
  });

  it('handles concurrent joins without losing players and persists no plaintext token material', async () => {
    const { base: url, repository } = await start();
    const game = await createGame(url);
    const names = Array.from({ length: 8 }, (_, i) => `Firm ${i}`);
    const results = await Promise.all(names.map(name => joinGame(url, game.inviteToken, name)));
    expect(results.every(item => item.response.status === 201)).toBe(true);
    const state = await body(await fetch(`${url}/api/state`, { headers: { authorization: `Bearer ${adminToken}` } }));
    expect(JSON.stringify(state)).not.toContain(game.inviteToken);
    for (const item of results) expect(JSON.stringify(state)).not.toContain(item.result.rejoinToken);
    const disk = await readFile(join(directory, 'state.json'), 'utf8');
    expect(disk).not.toContain(game.inviteToken);
    for (const item of results) expect(disk).not.toContain(item.result.rejoinToken);
    const status = await body(await fetch(`${url}/api/games/${game.gameId}/status`, { headers: { 'x-mecom-player': results[0].result.rejoinToken } }));
    const serialized = JSON.stringify(status);
    for (const name of names) expect(serialized).toContain(name);
    // Repository read is deliberately exercised after all concurrent writes.
    expect(JSON.stringify(await repository.read())).not.toContain(game.inviteToken);
  });
});
