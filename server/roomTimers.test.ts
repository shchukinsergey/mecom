import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import { RoomDatabase } from './roomDatabase.ts';
import { createAccountServer, listenAccounts, processExpiredRooms } from './roomsHttp.ts';

let db: RoomDatabase | undefined, server: Server | undefined, directory = '', base = '';
afterEach(async () => {
  if (server?.listening) await new Promise<void>(resolve => server!.close(() => resolve()));
  db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function setup() {
  directory = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'mecom-timers-'));
  db = new RoomDatabase(join(directory, 'rooms.sqlite'));
  server = createAccountServer(db);
  await listenAccounts(server, 0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function call(path: string, method = 'GET', payload?: unknown, cookie?: string) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  });
  return { status: response.status, body: await response.json() as Record<string, any>, cookie: response.headers.get('set-cookie') };
}
async function register(login: string) {
  const response = await call('/api/auth/register', 'POST', { login, password: 'password123' });
  expect(response.status).toBe(201);
  return response.cookie!.split(';')[0];
}

test('fast timer mode is persisted and starts its deadline only when the room starts', async () => {
  await setup();
  const owner = await register('TimerOwner'), alpha = await register('TimerAlpha'), beta = await register('TimerBeta');
  const created = await call('/api/rooms', 'POST', { name: 'Timed', visibility: 'public', timerMode: 'fast' }, owner);
  expect(created.status).toBe(201);
  expect(created.body.timerMode).toBe('fast');
  expect(created.body.deadlineAt).toBeNull();
  const route = `/api/rooms/${created.body.id}`;
  await call(route + '/join', 'POST', { firmName: 'Alpha' }, alpha);
  await call(route + '/join', 'POST', { firmName: 'Beta' }, beta);
  const start = Date.now();
  const started = await call(route + '/start', 'POST', {}, owner);
  expect(started.status).toBe(200);
  expect(started.body.deadlineAt).toBeGreaterThanOrEqual(start + 7 * 60_000 - 1000);
  expect(started.body.deadlineAt).toBeLessThanOrEqual(Date.now() + 7 * 60_000);
  const saved = db!.room(created.body.id);
  await new Promise<void>(resolve => server!.close(() => resolve()));
  db!.close();
  db = new RoomDatabase(join(directory, 'rooms.sqlite'));
  expect(db.room(created.body.id)).toEqual(saved);
});

test('expired room uses the previous calculated decision, not the saved draft', async () => {
  await setup();
  const owner = await register('AutoOwner'), alpha = await register('AutoAlpha'), beta = await register('AutoBeta');
  const created = await call('/api/rooms', 'POST', { name: 'Autoplay', visibility: 'public', timerMode: 'fast' }, owner);
  const route = `/api/rooms/${created.body.id}`;
  await call(route + '/join', 'POST', { firmName: 'Alpha' }, alpha);
  await call(route + '/join', 'POST', { firmName: 'Beta' }, beta);
  await call(route + '/start', 'POST', {}, owner);
  const before = db!.room(created.body.id)!;
  const member = before.members[0];
  const previous = before.snapshot.league.decisionsByPeriod[0][member.firmId];
  member.decision = { ...previous, price: previous.price + 10 };
  db!.saveRoom(before);
  processExpiredRooms(db!, before.deadlineAt!);
  const after = db!.room(created.body.id)!;
  expect(after.snapshot.league.results).toHaveLength(2);
  expect(after.snapshot.league.decisionsByPeriod[1][member.firmId].price).toBe(previous.price);
});
