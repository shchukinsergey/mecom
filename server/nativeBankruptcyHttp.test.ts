import { afterEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
// Runtime-only UI imports keep the server's non-JSX typecheck boundary intact.
const { OnlinePlayer } = await vi.importActual<{ OnlinePlayer: React.ComponentType<{ accountRoomId: string; onBack: () => void }> }>('../src/ui/screens/OnlinePlayer');
const { OnlineRooms } = await vi.importActual<{ OnlineRooms: React.ComponentType<{ onLocal: () => void }> }>('../src/ui/screens/OnlineRooms');
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import type { Server } from 'node:http';
import { RoomDatabase } from './roomDatabase.ts';
import { createAccountServer, listenAccounts } from './roomsHttp.ts';
const ui = vi.hoisted(() => ({ screen: '', index: 0, native: true }));
vi.mock('react', async original => {
  const actual = await original<typeof import('react')>();
  return { ...actual, useState: (initial: unknown) => {
    if (!ui.screen) return actual.useState(initial);
    const i = ui.index++;
    const overrides: Record<number, unknown> = ui.screen === 'player' ? {
      4: { price: '35', production: '0', marketing: '0', capexGross: '0', rnd: '0' },
      5: { firmId: 'own', firmName: 'Excluded firm', phase: 'collecting', currentPeriodIndex: 1, submitted: false,
        openingState: { machines: 0, nativeBankruptcy: { periodIndex: 1 } },
        decision: { price: 35, production: 0, marketing: 0, capexGross: 0, rnd: 0 },
        periodMacro: {}, config: {}, recentResults: [], reports: [], report: null },
    } : {
      0: { id: 'owner', login: 'Owner' }, 1: false, 5: 'test-room',
      8: { id: 'test-room', name: 'Test room', isOwner: true, phase: 'collecting', currentPeriodIndex: 1,
        firms: [{ firmId: 'one', firmName: 'One', submitted: false }], nativeBankruptcyAvailable: ui.native },
    };
    return [Object.hasOwn(overrides, i) ? overrides[i] : typeof initial === 'function' ? initial() : initial, vi.fn()];
  } };
});
let db: RoomDatabase, server: Server, directory: string, base: string;
afterEach(async () => { ui.screen = ''; ui.index = 0; vi.unstubAllGlobals(); if (server) await new Promise<void>(r => server.close(() => r())); db?.close(); if (directory) await rm(directory, { recursive: true, force: true }); db = undefined!; server = undefined!; directory = ''; });
async function startServer() { server = createAccountServer(db); await listenAccounts(server, 0); base = `http://127.0.0.1:${(server.address() as { port: number }).port}`; }
async function call(path: string, method = 'GET', body?: unknown, cookie?: string) {
  const r = await fetch(base + path, { method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, body: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0] };
}
async function setup() {
  directory = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'mecom-native-http-'));
  db = new RoomDatabase(join(directory, 'synthetic.sqlite')); await startServer();
  const cookies: string[] = [];
  for (const login of ['Owner', 'Alpha', 'Beta']) { const r = await call('/api/auth/register', 'POST', { login, password: 'password123' }); expect(r.status).toBe(201); cookies.push(r.cookie!); }
  const [owner, a, b] = cookies;
  const made = await call('/api/rooms', 'POST', { name: 'Synthetic bankruptcy', visibility: 'public' }, owner);
  const route = `/api/rooms/${made.body.id}`;
  for (const [cookie, firmName] of [[a, 'One'], [b, 'Two']]) expect((await call(route + '/join', 'POST', { firmName }, cookie)).status).toBe(200);
  expect((await call(route + '/start', 'POST', {}, owner)).status).toBe(200);
  return { owner, a, b, route, id: made.body.id as string, firmId: db.room(made.body.id)!.members[0].firmId };
}
const zero = { price: 35, production: 0, marketing: 0, capexGross: 0, rnd: 0 };
test('owner-only declaration is atomic, current-only, private and durable without rolling back history', async () => {
  const { owner, a, route, id, firmId } = await setup();
  const payload = { periodIndex: 1, firmId };
  expect((await call(route + '/bankruptcy', 'POST', payload)).status).toBe(401);
  expect((await call(route + '/bankruptcy', 'POST', payload, a)).status).toBe(403);
  expect((await call(route + '/bankruptcy', 'POST', { ...payload, periodIndex: 0 }, owner)).status).toBe(409);
  expect((await call(route + '/bankruptcy', 'POST', { ...payload, firmId: 'unknown' }, owner)).status).toBe(404);
  const before = db.room(id)!;
  const readProtectedTables = () => {
    const sql = new DatabaseSync(join(directory, 'synthetic.sqlite'), { readOnly: true });
    try { return JSON.stringify(['users', 'sessions', 'audit'].map(t => sql.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())); }
    finally { sql.close(); }
  };
  const protectedBefore = readProtectedTables();
  const response = await call(route + '/bankruptcy', 'POST', payload, owner);
  expect(response.status).toBe(200);
  expect(response.body.nativeBankruptcyAvailable).toBe(true);
  expect(response.body.firms[0].nativeBankrupt).toBe(true);
  const encoded = JSON.stringify(response.body);
  for (const secret of ['opening', 'bankLoss', 'shareholderLoss', 'rndCumulative', 'demandPotentialCumulative', 'decisionsByPeriod', 'nativeIndustryState']) expect(encoded).not.toContain(secret);
  const after = db.room(id)!;
  expect(JSON.stringify(after.snapshot.league)).toBe(JSON.stringify({ ...before.snapshot.league, decisionsByPeriod: after.snapshot.league.decisionsByPeriod, confirmedByPeriod: after.snapshot.league.confirmedByPeriod }));
  expect(after.snapshot.league.results).toEqual(before.snapshot.league.results);
  expect(readProtectedTables()).toBe(protectedBefore);
  expect(JSON.stringify(after.snapshot.league.decisionsByPeriod.slice(0, 1))).toBe(JSON.stringify(before.snapshot.league.decisionsByPeriod.slice(0, 1)));
  expect(JSON.stringify(after.snapshot.league.confirmedByPeriod.slice(0, 1))).toBe(JSON.stringify(before.snapshot.league.confirmedByPeriod.slice(0, 1)));
  expect(after.snapshot.opening[before.members[1].firmId]).toEqual(before.snapshot.opening[before.members[1].firmId]);
  expect(after.members[1]).toEqual(before.members[1]);
  expect(after.members).toHaveLength(2);
  expect(after.snapshot.opening[firmId].nativeBankruptcy?.periodIndex).toBe(1);
  expect(after.members[0].decision).toEqual({ ...zero, price: 0 });
  expect(after.members[0].submitted).toBe(false);
  expect((await call(route + '/bankruptcy', 'POST', payload, owner)).status).toBe(409);
  expect((await call(route + '/decision', 'PUT', { periodIndex: 1, decision: zero }, a)).status).toBe(409);
  expect((await call(route + '/submit', 'POST', { periodIndex: 1 }, a)).status).toBe(409);
  await new Promise<void>(r => server.close(() => r())); db.close(); db = new RoomDatabase(join(directory, 'synthetic.sqlite')); await startServer();
  expect(db.room(id)).toEqual(after);
  expect((await call(route + '/me', 'GET', undefined, a)).body.openingState.nativeBankruptcy.periodIndex).toBe(1);
});

test.each(['submit', 'normal', 'force'] as const)('retired firm does not block %s calculation, remains a compute slot and never changes prior history', async mode => {
  const { owner, b, route, id, firmId } = await setup();
  expect((await call(route + '/bankruptcy', 'POST', { periodIndex: 1, firmId }, owner)).status).toBe(200);
  const saved = JSON.stringify(db.room(id)!.snapshot.league.results);
  const draft = await call(route + '/decision', 'PUT', { periodIndex: 1, decision: zero }, b);
  expect(draft.status).toBe(200);
  if (mode === 'normal') {
    // Persist a submitted current decision without triggering the automatic path.
    const room = db.room(id)!; room.members[1].submitted = true; db.transaction(() => db.saveRoom(room));
  }
  const preview = await call(route + '/calculate-preview', 'GET', undefined, owner);
  expect(preview.body.firms).toHaveLength(1);
  const readiness = (await call(route, 'GET', undefined, owner)).body;
  expect(readiness.playerCount).toBe(2);
  expect(readiness.activeFirmCount).toBe(1);
  expect(readiness.submittedCount).toBe(mode === 'normal' ? 1 : 0);
  expect(preview.body.canForce).toBe(true);
  const response = mode === 'submit'
    ? await call(route + '/submit', 'POST', { periodIndex: 1 }, b)
    : await call(route + '/calculate', 'POST', { periodIndex: 1, force: mode === 'force' }, owner);
  expect(response.status).toBe(200);
  const after = db.room(id)!;
  expect(after.snapshot.league.results).toHaveLength(2);
  expect(JSON.stringify(after.snapshot.league.results.slice(0, 1))).toBe(saved);
  expect(after.snapshot.league.results[1].firms).toHaveLength(2);
  expect(after.snapshot.opening[firmId].nativeBankruptcy).toBeDefined();
});
test('all-out calculation rejects explicitly without changing saved state', async () => {
  const { owner, route, id } = await setup();
  for (const m of db.room(id)!.members) expect((await call(route + '/bankruptcy', 'POST', { periodIndex: 1, firmId: m.firmId }, owner)).status).toBe(200);
  const before = db.room(id)!;
  for (const force of [true, false]) {
    const response = await call(route + '/calculate', 'POST', { periodIndex: 1, force }, owner);
    expect(response.status).toBe(409); expect(response.body.error).toMatch(/No active firms/);
  }
  expect(db.room(id)).toEqual(before);
});
test('explicit archived external-management room remains unchanged and has no declaration capability', async () => {
  const { owner, route, id, firmId } = await setup();
  const archived = db.room(id)!; archived.snapshot.league.config.featureFlags.bankruptcyMode = 'externalManagement';
  db.transaction(() => db.saveRoom(archived));
  const response = await call(route + '/bankruptcy', 'POST', { periodIndex: 1, firmId }, owner);
  expect(response.status).toBe(409);
  expect(db.room(id)).toEqual(archived);
  expect((await call(route, 'GET', undefined, owner)).body.nativeBankruptcyAvailable).toBeUndefined();
});

test('excluded player hides all decision and budget controls but retains report and public-history access', () => {
  ui.screen = 'player'; ui.index = 0;
  const html = renderToStaticMarkup(createElement(OnlinePlayer, { accountRoomId: 'synthetic', onBack: () => {} }));
  expect(html).toContain('исключена');
  expect(html).not.toContain('pc-decision-workspace');
  expect(html).not.toContain('Параметры решения');
  expect(html).toContain('Компания на фоне рынка');
  expect(html).toContain('Отчёт');
});
test('owner declaration control is shown only for native capability', () => {
  ui.screen = 'rooms'; ui.index = 0; ui.native = true;
  vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/', search: '', hash: '#room/test-room' } });
  const html = renderToStaticMarkup(createElement(OnlineRooms, { onLocal: () => {} }));
  expect(html).toContain('Объявить банкротство');
  ui.index = 0; ui.native = false;
  expect(renderToStaticMarkup(createElement(OnlineRooms, { onLocal: () => {} }))).not.toContain('Объявить банкротство');
});

test('failure after writing declaration rolls back all room state', async () => {
  const { owner, route, id, firmId } = await setup();
  const before = db.room(id)!;
  const save = db.saveRoom.bind(db);
  const spy = vi.spyOn(db, 'saveRoom').mockImplementation(room => { save(room); throw new Error('Synthetic persistence failure'); });
  try { expect((await call(route + '/bankruptcy', 'POST', { periodIndex: 1, firmId }, owner)).status).toBe(500); }
  finally { spy.mockRestore(); }
  expect(db.room(id)).toEqual(before);
});
test('concurrent duplicate declarations persist one declaration only', async () => {
  const { owner, route, id, firmId } = await setup();
  const responses = await Promise.all([1, 2].map(() => call(route + '/bankruptcy', 'POST', { periodIndex: 1, firmId }, owner)));
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  expect(db.room(id)!.snapshot.league.results).toHaveLength(1);
});
