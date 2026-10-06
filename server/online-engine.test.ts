import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeMacroParams, DEFAULT_LEAGUE_CONFIG } from '../src/engine/config.ts';
import type { League } from '../src/engine/types.ts';
import type { LeagueSnapshot } from '../src/state/persistence.ts';
import { createLocalServer, listenLocal } from './http.ts';
import { JsonRepository } from './repository.ts';

const adminToken = 'online-engine-test-admin-token-at-least-32-bytes';
let server: ReturnType<typeof createLocalServer> | undefined;
let directory = '';

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
  directory = '';
});

function makeSnapshot(): LeagueSnapshot {
  const league: League = {
    id: 'template', name: 'Test league', createdAt: new Date().toISOString(),
    config: { ...DEFAULT_LEAGUE_CONFIG }, firms: [], macroByPeriod: [makeMacroParams(0)],
    decisionsByPeriod: [{}], confirmedByPeriod: [{}], results: [],
  };
  return { league, opening: {} };
}

async function start() {
  directory = await mkdtemp(join(tmpdir(), 'mecom-online-engine-'));
  const repository = new JsonRepository(join(directory, 'state.json'));
  server = createLocalServer(repository, { adminToken });
  await listenLocal(server, 0);
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP listener');
  return { base: `http://127.0.0.1:${address.port}`, repository };
}

async function json(response: Response): Promise<Record<string, any>> {
  return await response.json() as Record<string, any>;
}

const decision = { price: 30, production: 100, marketing: 100, capexGross: 0, rnd: 0 };

describe('online game engine HTTP integration', () => {
  it('runs a private two-firm game through calculation and persists report history', async () => {
    const { base, repository } = await start();
    const admin = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
    const createdResponse = await fetch(`${base}/api/games`, {
      method: 'POST', headers: admin, body: JSON.stringify({ name: 'Online test', snapshot: makeSnapshot() }),
    });
    expect(createdResponse.status).toBe(201);
    const created = await json(createdResponse);
    const join = async (firmName: string) => {
      const response = await fetch(`${base}/api/join`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-mecom-invite': created.inviteToken },
        body: JSON.stringify({ firmName }),
      });
      expect(response.status).toBe(201);
      return json(response);
    };
    const first = await join('North');
    const second = await join('South');
    expect((await fetch(`${base}/api/games/${created.gameId}/start`, { method: 'POST', headers: admin })).status).toBe(200);

    const firstHeaders = { 'content-type': 'application/json', 'x-mecom-player': first.rejoinToken };
    const secondHeaders = { 'content-type': 'application/json', 'x-mecom-player': second.rejoinToken };
    expect((await fetch(`${base}/api/games/${created.gameId}/status`)).status).toBe(401);
    const status = await json(await fetch(`${base}/api/games/${created.gameId}/status`, { headers: firstHeaders }));
    expect(status.firms).toEqual(expect.arrayContaining([
      expect.objectContaining({ firmId: first.firmId, firmName: 'North', submitted: false, currentRif: expect.any(Number) }),
      expect.objectContaining({ firmId: second.firmId, firmName: 'South', submitted: false, currentRif: expect.any(Number) }),
    ]));
    expect(JSON.stringify(status)).not.toContain('rejoinToken');
    for (const headers of [firstHeaders, secondHeaders]) {
      expect((await fetch(`${base}/api/player/decision`, { method: 'PUT', headers, body: JSON.stringify(decision) })).status).toBe(200);
      expect((await fetch(`${base}/api/player/submit`, { method: 'POST', headers })).status).toBe(200);
    }
    const calculated = await fetch(`${base}/api/admin/games/${created.gameId}/calculate`, { method: 'POST', headers: admin });
    expect(calculated.status).toBe(200);
    const calculatedResult = await json(calculated);
    expect(calculatedResult.firms).toHaveLength(2);
    const updatedStatus = await json(await fetch(`${base}/api/games/${created.gameId}/status`, { headers: firstHeaders }));
    for (const result of calculatedResult.firms) {
      expect(updatedStatus.firms).toEqual(expect.arrayContaining([
        expect.objectContaining({ firmId: result.firmId, currentRif: result.rif.total }),
      ]));
    }

    const firstMe = await json(await fetch(`${base}/api/player/me`, { headers: { 'x-mecom-player': first.rejoinToken } }));
    const secondMe = await json(await fetch(`${base}/api/player/me`, { headers: { 'x-mecom-player': second.rejoinToken } }));
    expect(firstMe.reports.map((report: { periodIndex: number }) => report.periodIndex)).toEqual([0, 1]);
    expect(secondMe.reports.map((report: { periodIndex: number }) => report.periodIndex)).toEqual([0, 1]);
    for (const report of firstMe.reports) {
      const privateFirmBlock = report.report.split('И Н Д У С Т Р И Я')[0];
      expect(privateFirmBlock).toContain('North');
      expect(privateFirmBlock).not.toContain('South');
      expect(report.report).toContain('Всего заказов');
      expect(report.report).toContain('South');
    }
    for (const report of secondMe.reports) {
      const privateFirmBlock = report.report.split('И Н Д У С Т Р И Я')[0];
      expect(privateFirmBlock).toContain('South');
      expect(privateFirmBlock).not.toContain('North');
      expect(report.report).toContain('Всего заказов');
      expect(report.report).toContain('North');
    }
    expect((await repository.read()).games[created.gameId].snapshot?.league.results).toHaveLength(2);
  });

  it('rotates the invite key and refuses the previously issued invite', async () => {
    const { base } = await start();
    const headers = { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' };
    const created = await json(await fetch(`${base}/api/games`, {
      method: 'POST', headers, body: JSON.stringify({ name: 'Invite rotation', snapshot: makeSnapshot() }),
    }));
    const rotated = await json(await fetch(`${base}/api/admin/games/${created.gameId}/invite-token`, {
      method: 'POST', headers: { authorization: `Bearer ${adminToken}` },
    }));
    expect(typeof rotated.inviteToken).toBe('string');
    expect((await fetch(`${base}/api/join`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mecom-invite': created.inviteToken },
      body: JSON.stringify({ firmName: 'Old link' }),
    })).status).toBe(401);
    expect((await fetch(`${base}/api/join`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-mecom-invite': rotated.inviteToken },
      body: JSON.stringify({ firmName: 'New link' }),
    })).status).toBe(201);
  });
});
