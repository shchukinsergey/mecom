import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createLocalServer, listenLocal } from './http.ts';
import { JsonRepository } from './repository.ts';

let directory = '';
let webDirectory = '';
const adminToken = 'http-test-admin-token-with-at-least-32-characters';
let server: ReturnType<typeof createLocalServer> | undefined;
afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  if (webDirectory) await rm(webDirectory, { recursive: true, force: true });
  directory = '';
  webDirectory = '';
});

async function start(webRoot?: string) {
  directory = await mkdtemp(join(tmpdir(), 'mecom-http-'));
  server = createLocalServer(new JsonRepository(join(directory, 'state.json')), { adminToken }, webRoot);
  await listenLocal(server, 0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  return `http://127.0.0.1:${address.port}`;
}

describe('local HTTP API', () => {
  it('serves the built client for browser routes without exposing files outside the web root', async () => {
    webDirectory = await mkdtemp(join(tmpdir(), 'mecom-web-'));
    const base = await start(webDirectory);
    await writeFile(join(webDirectory, 'index.html'), '<h1>MECOM</h1>');
    const client = await fetch(`${base}/`, { headers: { accept: 'text/html' } });
    expect(client.status).toBe(200);
    expect(await client.text()).toContain('MECOM');
    const route = await fetch(`${base}/player`, { headers: { accept: 'text/html' } });
    expect(route.status).toBe(200);
    expect(await route.text()).toContain('MECOM');
  });

  it('binds loopback and validates then persists state', async () => {
    const base = await start();
    expect(server?.address()).toMatchObject({ address: '127.0.0.1' });
    expect((await fetch(`${base}/health`)).status).toBe(200);
    expect((await fetch(`${base}/api/state`)).status).toBe(401);
    const auth = { authorization: `Bearer ${adminToken}` };
    expect((await fetch(`${base}/api/state`, { headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/api/state`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: '{' })).status).toBe(400);
    expect((await fetch(`${base}/api/state`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: '{"schemaVersion":2,"leagues":{}}' })).status).toBe(400);

    const gameResponse = await fetch(`${base}/api/games`, {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Keep this game' }),
    });
    const game = await gameResponse.json() as { gameId: string; inviteToken: string };
    expect(gameResponse.status).toBe(201);

    const saved = { schemaVersion: 1, leagues: { one: { name: 'Test' } } };
    expect((await fetch(`${base}/api/state`, { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(saved) })).status).toBe(200);
    const state = await (await fetch(`${base}/api/state`, { headers: auth })).json() as { games: Record<string, { inviteTokenHash: string }> };
    expect(state.games[game.gameId]).toBeDefined();
    expect(state.games[game.gameId].inviteTokenHash).not.toBe(game.inviteToken);
  });

  it('stops player decisions after the admin closes a game', async () => {
    const base = await start();
    const auth = { authorization: `Bearer ${adminToken}` };
    const created = await fetch(`${base}/api/games`, {
      method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Closed game' }),
    });
    const game = await created.json() as { gameId: string; inviteToken: string };
    const joined = await fetch(`${base}/api/join`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mecom-invite': game.inviteToken },
      body: JSON.stringify({ firmName: 'Firm one' }),
    });
    const player = await joined.json() as { rejoinToken: string };
    expect((await fetch(`${base}/api/games/${game.gameId}/close`, { method: 'POST', headers: auth })).status).toBe(200);
    const response = await fetch(`${base}/api/player/decision`, {
      method: 'PUT', headers: { 'content-type': 'application/json', 'x-mecom-player': player.rejoinToken },
      body: JSON.stringify({ price: 1, production: 0, marketing: 0, capexGross: 0, rnd: 0 }),
    });
    expect(response.status).toBe(409);
  });

  it('lets only the admin kick a firm and invalidates its player link', async () => {
    const base = await start();
    const auth = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
    const created = await fetch(`${base}/api/games`, {
      method: 'POST', headers: auth, body: JSON.stringify({ name: 'Kick test' }),
    });
    const game = await created.json() as { gameId: string; inviteToken: string };
    const joined = await fetch(`${base}/api/join`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mecom-invite': game.inviteToken },
      body: JSON.stringify({ firmName: 'Remove me' }),
    });
    const player = await joined.json() as { firmId: string; rejoinToken: string };
    const path = `${base}/api/admin/games/${game.gameId}/firms/${player.firmId}`;

    expect((await fetch(path, { method: 'DELETE' })).status).toBe(401);
    expect((await fetch(path, { method: 'DELETE', headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/api/player/me`, { headers: { 'x-mecom-player': player.rejoinToken } })).status).toBe(401);
    const adminGame = await fetch(`${base}/api/admin/games/${game.gameId}`, { headers: { authorization: `Bearer ${adminToken}` } });
    expect((await adminGame.json() as { firms: unknown[] }).firms).toHaveLength(0);
  });

  it('removes a kicked firm from active period participation and invalidates its player link', async () => {
    const base = await start();
    const auth = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
    const created = await fetch(`${base}/api/games`, {
      method: 'POST', headers: auth, body: JSON.stringify({ name: 'Active kick test' }),
    });
    const game = await created.json() as { gameId: string; inviteToken: string };
    const targetJoin = await fetch(`${base}/api/join`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mecom-invite': game.inviteToken },
      body: JSON.stringify({ firmName: 'Remove during play' }),
    });
    const target = await targetJoin.json() as { firmId: string; rejoinToken: string };
    const remainingJoin = await fetch(`${base}/api/join`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mecom-invite': game.inviteToken },
      body: JSON.stringify({ firmName: 'Continue playing' }),
    });
    const remaining = await remainingJoin.json() as { firmId: string; rejoinToken: string };

    expect(targetJoin.status).toBe(201);
    expect(remainingJoin.status).toBe(201);
    expect((await fetch(`${base}/api/games/${game.gameId}/start`, { method: 'POST', headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/api/player/submit`, { method: 'POST', headers: { 'x-mecom-player': target.rejoinToken } })).status).toBe(200);

    const path = `${base}/api/admin/games/${game.gameId}/firms/${target.firmId}`;
    expect((await fetch(path, { method: 'DELETE', headers: auth })).status).toBe(200);
    expect((await fetch(`${base}/api/player/me`, { headers: { 'x-mecom-player': target.rejoinToken } })).status).toBe(401);

    const status = await (await fetch(`${base}/api/games/${game.gameId}/status`, { headers: { 'x-mecom-player': remaining.rejoinToken } })).json() as { firms: { firmId: string }[] };
    expect(status.firms.map(firm => firm.firmId)).toEqual([remaining.firmId]);
    const state = await (await fetch(`${base}/api/state`, { headers: auth })).json() as {
      games: Record<string, { snapshot: { league: { firms: { id: string }[]; decisionsByPeriod: Record<string, unknown>[] } } }>;
    };
    const league = state.games[game.gameId].snapshot.league;
    expect(league.firms.map(firm => firm.id)).toEqual([remaining.firmId]);
    expect(league.decisionsByPeriod[0]).not.toHaveProperty(target.firmId);

    expect((await fetch(`${base}/api/player/submit`, { method: 'POST', headers: { 'x-mecom-player': remaining.rejoinToken } })).status).toBe(200);
    const calculation = await fetch(`${base}/api/admin/games/${game.gameId}/calculate`, { method: 'POST', headers: auth });
    expect(calculation.status).toBe(200);
    const result = await calculation.json() as { firms: { firmId: string }[] };
    expect(result.firms.map(firm => firm.firmId)).toEqual([remaining.firmId]);
  });

});
