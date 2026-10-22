import { afterEach, expect, test } from 'vitest';
import type { Server } from 'node:http';
import { RoomDatabase } from './roomDatabase.ts';
import { createAccountServer, listenAccounts, processExpiredRooms } from './roomsHttp.ts';
import { TelegramBot } from './telegram.ts';
import { periodMessage, reminderMessage } from './telegramMessages.ts';
import { ONLINE_PLAYABLE_PERIODS } from '../src/online/gameSettings.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: RoomDatabase, server: Server, bot: TelegramBot, base: string;
let sent: Array<{ chat_id: string; text: string; reply_markup?: unknown }>;
let failure = 0, admin = true;
let directory = '';
const secret = 'telegram_webhook_secret_123';
afterEach(async () => {
  await bot?.stop();
  if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve()));
  db?.close();
  if (directory) { await rm(directory, { recursive: true, force: true }); directory = ''; }
});
const transport: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/getChatAdministrators')) return Response.json({ ok: true, result: admin ? [{ user: { id: 42 } }] : [] });
    if (failure) return Response.json({ ok: false, error_code: failure, ...(failure === 429 ? { parameters: { retry_after: 60 } } : {}) });
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, result: {} });
};
async function setup() {
  db = new RoomDatabase(':memory:'); sent = []; failure = 0; admin = true;
  bot = new TelegramBot(db, { token: 'test-token', username: 'mecom_test_bot', secret, publicOrigin: 'https://mecom.example' }, transport);
  server = createAccountServer(db, { telegram: bot }); await listenAccounts(server, 0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function call(path: string, method = 'GET', payload?: unknown, cookie?: string, headers: Record<string, string> = {}) {
  const response = await fetch(base + '/api' + path, { method, headers: { ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }), ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  return { status: response.status, body: await response.json() as Record<string, any>, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
async function register(login: string) { const result = await call('/auth/register', 'POST', { login, password: 'password123' }); expect(result.status).toBe(201); return result.cookie!; }
async function connect(cookie: string, updateId = 1) {
  const code = await call('/telegram/code', 'POST', {}, cookie);
  return call('/telegram/webhook', 'POST', { update_id: updateId, message: { from: { id: 42 }, chat: { id: -123, type: 'supergroup', title: 'Игроки' }, text: `/connect@mecom_test_bot ${code.body.code}` } }, undefined, { 'x-telegram-bot-api-secret-token': secret });
}
async function game(timerMode = 'standard', addBot = false) {
  const owner = await register('Owner'), alpha = await register('Alpha'), beta = await register('Beta');
  const created = await call('/rooms', 'POST', { name: 'Лига <Осень>', visibility: 'public', timerMode, addBot }, owner);
  const id = created.body.id as string, path = `/rooms/${id}`;
  await call(path + '/join', 'POST', { firmName: 'Альфа' }, alpha);
  await call(path + '/join', 'POST', { firmName: 'Бета' }, beta);
  await connect(owner);
  expect((await call('/telegram/subscriptions', 'PUT', { chatId: '-123', roomIds: [id] }, owner)).status).toBe(200);
  await call(path + '/start', 'POST', {}, owner);
  return { owner, alpha, beta, id, path };
}

test('webhook secret, chat admin and room owner are required; codes are single-use and expire', async () => {
  await setup();
  const owner = await register('Owner');
  expect((await call('/telegram/webhook', 'POST', { update_id: 1 })).status).toBe(403);
  admin = false; await connect(owner);
  expect((await call('/telegram', 'GET', undefined, owner)).body.chats).toEqual([]);
  admin = true; await connect(owner, 2);
  const user = (await call('/auth/me', 'GET', undefined, owner)).body.user;
  const code = db.telegram.code(user.id, 1000);
  expect(db.telegram.connect(code.code, '-2', 'Expired', '42', code.expiresAt)).toBe(false);
  expect(db.telegram.connect(code.code, '-2', 'Valid', '42', 1001)).toBe(true);
  expect(db.telegram.connect(code.code, '-2', 'Again', '42', 1002)).toBe(false);
  const foreign = await register('Foreign');
  const room = await call('/rooms', 'POST', { name: 'Private', visibility: 'link' }, foreign);
  expect((await call('/telegram/subscriptions', 'PUT', { chatId: '-123', roomIds: [room.body.id] }, owner)).status).toBe(403);
  expect((await call('/telegram/subscriptions', 'PUT', { chatId: '-123', roomIds: [] }, foreign)).status).toBe(403);
  admin = false;
  expect((await call('/telegram/subscriptions', 'PUT', { chatId: '-123', roomIds: [] }, owner)).status).toBe(403);
});

test('period notifications are deduplicated; drafts do not count as submitted; latest flags are read on retry', async () => {
  await setup(); const { id } = await game('standard', true);
  sent = []; await bot.tick(); await bot.tick();
  expect(sent).toHaveLength(1);
  expect(sent[0].text).toContain('Начался период №1');
  expect(sent[0].text).not.toContain('Итоги периода №0');
  expect(sent[0].text).toContain('&lt;Осень&gt;');
  const room = db.room(id)!;
  room.deadlineAt = Date.now() + 3599000;
  room.members[0].decision = room.snapshot.league.decisionsByPeriod[0][room.members[0].firmId];
  db.transaction(() => db.saveRoom(room));
  failure = 500; await bot.tick();
  room.members[0].submitted = true;
  db.transaction(() => db.saveRoom(room));
  failure = 0; await bot.tick(Date.now() + 31000);
  expect(sent).toHaveLength(2);
  expect(sent[1].text).toContain('Бета');
  expect(sent[1].text).not.toContain('Альфа');
  expect(sent[1].text).not.toContain('БОТ');
  await bot.tick(Date.now() + 32000); expect(sent).toHaveLength(2);
});

test('last submission and owner calculation produce rankings, with ties sorted by name', async () => {
  await setup(); const { id, path, owner, alpha, beta } = await game();
  await bot.tick(); sent = [];
  const room = db.room(id)!;
  for (const [i, cookie] of [alpha, beta].entries()) {
    const { price, production, marketing, capexGross, rnd } = room.snapshot.league.decisionsByPeriod[0][room.members[i].firmId];
    const decision = { price, production, marketing, capexGross, rnd };
    expect((await call(path + '/decision', 'PUT', { periodIndex: 1, decision }, cookie)).status).toBe(200);
    expect((await call(path + '/submit', 'POST', { periodIndex: 1 }, cookie)).status).toBe(200);
  }
  await bot.tick(); expect(sent).toHaveLength(1);
  expect(sent[0].text).toContain('Начался период №2'); expect(sent[0].text).toContain('Итоги периода №1');
  const after = db.room(id)!;
  const firms = after.snapshot.league.results.at(-1)!.firms;
  firms[0].rif.total = 100; firms[1].rif.total = 200;
  expect(periodMessage(after).indexOf('Бета')).toBeLessThan(periodMessage(after).indexOf('Альфа'));
  firms[0].rif.total = 200;
  expect(periodMessage(after).indexOf('Альфа')).toBeLessThan(periodMessage(after).indexOf('Бета'));
  expect((await call(path + '/calculate', 'POST', { periodIndex: 2, force: true }, owner)).status).toBe(200);
  await bot.tick(); expect(sent.at(-1)!.text).toContain('Начался период №3');
});

test('timer advancement, final ranking and stale notification suppression', async () => {
  await setup(); const { id } = await game('fast');
  await bot.tick(); sent = [];
  for (let i = 0; i < ONLINE_PLAYABLE_PERIODS; i++) processExpiredRooms(db, db.room(id)!.deadlineAt!);
  expect(db.room(id)!.phase).toBe('complete');
  await bot.tick(); expect(sent).toHaveLength(1);
  expect(sent[0].text).toContain('Игра завершена'); expect(sent[0].text).toContain('Итоговый рейтинг');
  expect(sent[0].text).not.toContain('Начался период');
});

test('reminders exclude bankrupt firms and are disabled for fast, unlimited, expired and completed games', async () => {
  await setup(); const { id } = await game(); const room = db.room(id)!;
  const now = Date.now(); room.deadlineAt = now + 3599000;
  expect(reminderMessage(room, now)).toContain('Альфа');
  room.members[0].submitted = true;
  room.snapshot.opening[room.members[1].firmId].nativeBankruptcy = { declaredAtPeriod: 1 } as any;
  expect(reminderMessage(room, now)).toBeNull();
  room.members[0].submitted = false;
  for (const mode of ['fast', 'unlimited'] as const) { room.timerMode = mode; expect(reminderMessage(room, now)).toBeNull(); }
  room.timerMode = 'standard'; room.deadlineAt = now; expect(reminderMessage(room, now)).toBeNull();
  room.deadlineAt = now + 1000; room.phase = 'complete'; expect(reminderMessage(room, now)).toBeNull();
});

test('disconnect cancels queued messages; forbidden delivery marks chat inactive; rollback removes events', async () => {
  await setup(); const { id, owner } = await game();
  await call('/telegram/subscriptions', 'PUT', { chatId: '-123', roomIds: [] }, owner);
  sent = []; await bot.tick(); expect(sent).toHaveLength(0);
  await call('/telegram/subscriptions', 'PUT', { chatId: '-123', roomIds: [id] }, owner);
  failure = 403; await bot.tick();
  expect((await call('/telegram', 'GET', undefined, owner)).body.chats[0].active).toBe(false);
  const before = db.room(id)!;
  expect(() => db.transaction(() => { const room = db.room(id)!; room.phase = 'complete'; db.saveRoom(room); throw new Error('rollback'); })).toThrow('rollback');
  expect(db.room(id)).toEqual(before);
});

test('queued events survive database reopening; duplicate webhooks are ignored', async () => {
  await setup(); const { id, owner } = await game();
  const user = (await call('/auth/me', 'GET', undefined, owner)).body.user;
  const replay = { update_id: 1, message: { from: { id: 42 }, chat: { id: -123, type: 'supergroup' }, text: '/connect' } };
  sent = []; await bot.update(replay); expect(sent).toHaveLength(0);
  directory = await mkdtemp(join(tmpdir(), 'mecom-telegram-'));
  const file = join(directory, 'rooms.sqlite'); await db.backup(file);
  await new Promise<void>(resolve => server.close(() => resolve())); db.close();
  db = new RoomDatabase(file);
  bot = new TelegramBot(db, bot.options, transport);
  expect(db.telegram.chats(user.id)[0].roomIds).toEqual([id]);
  await bot.tick(); expect(sent).toHaveLength(1); expect(sent[0].text).toContain('Начался период №1');
  db.close(); db = new RoomDatabase(file); bot = new TelegramBot(db, bot.options, transport);
  await bot.tick(); expect(sent).toHaveLength(1);
});

test('rollback does not enqueue a new period; expired reminders are dropped; throttling pauses delivery', async () => {
  await setup(); const { id } = await game(); await bot.tick(); sent = [];
  expect(() => db.transaction(() => {
    const room = db.room(id)!; room.snapshot.league.results.push({ ...room.snapshot.league.results[0], periodIndex: 1 });
    db.saveRoom(room); throw new Error('rollback');
  })).toThrow('rollback');
  expect(db.telegram.due(Date.now())).toEqual([]);
  const room = db.room(id)!; room.deadlineAt = Date.now() + 3599000; db.transaction(() => db.saveRoom(room));
  failure = 429; await bot.tick(); failure = 0;
  await bot.tick(Date.now() + 31000); expect(sent).toHaveLength(0);
  room.deadlineAt = Date.now() - 1; db.transaction(() => db.saveRoom(room));
  await bot.tick(Date.now() + 61000); expect(sent).toHaveLength(0);
  expect(db.telegram.due(Date.now() + 61000)).toEqual([]);
});

async function personalConnect(cookie: string | undefined, telegramId: number, updateId: number, username = 'player') {
  const route = cookie ? '/telegram/personal' : '/auth/telegram';
  const start = await call(route + '/start', 'POST', {}, cookie);
  expect(start.status).toBe(200);
  const webhook = await call('/telegram/webhook', 'POST', { update_id: updateId, message: { from: { id: telegramId, username, first_name: '<Игрок>' }, chat: { id: telegramId, type: 'private' }, text: `/login ${start.body.code}` } }, undefined, { 'x-telegram-bot-api-secret-token': secret });
  expect(webhook.status).toBe(200);
  return { start, finish: await call(route + '/finish', 'POST', { token: start.body.token }, cookie) };
}

test('personal linking preserves account; Telegram login resumes it; secrets expire and are single-use', async () => {
  await setup();
  const owner = await register('Owner');
  const user = (await call('/auth/me', 'GET', undefined, owner)).body.user;
  const linked = await personalConnect(owner, 101, 1001);
  expect(linked.finish.body.user.id).toBe(user.id);
  expect((await call('/telegram', 'GET', undefined, owner)).body.identity.username).toBe('player');
  expect((await call('/telegram/personal/finish', 'POST', { token: linked.start.body.token }, owner)).status).toBe(410);
  const login = await personalConnect(undefined, 101, 1002);
  expect(login.finish.body.user.id).toBe(user.id);
  expect((await call('/auth/me', 'GET', undefined, login.finish.cookie)).body.user.id).toBe(user.id);
  const pending = db.telegram.beginAuth(null, 1000);
  expect(db.telegram.confirmAuth(pending.code, '202', null, 'Name', pending.expiresAt)).toBe(false);
  expect(db.telegram.consumeAuth(pending.token, null, pending.expiresAt)).toEqual({ expired: true });
  const other = await register('Other');
  const conflict = await personalConnect(other, 101, 1003);
  expect(conflict.finish.body.pending).toBe(true);
  expect((await call('/telegram', 'GET', undefined, other)).body.identity).toBeNull();
  expect((await call('/telegram/personal/unlink', 'POST', {}, owner)).status).toBe(200);
  expect(db.telegram.identity(user.id)).toBeNull();
  expect((await call('/auth/login', 'POST', { login: 'Owner', password: 'password123' })).status).toBe(200);
});

test('new Telegram account cannot lose its only login; code in group cannot authenticate; browser token is required', async () => {
  await setup();
  const created = await personalConnect(undefined, 303, 1101);
  expect(created.finish.cookie).toBeTruthy();
  expect((await call('/telegram/personal/unlink', 'POST', {}, created.finish.cookie)).status).toBe(409);
  expect((await call('/auth/login', 'POST', { login: created.finish.body.user.login, password: 'password123' })).status).toBe(401);
  const start = await call('/auth/telegram/start', 'POST', {});
  await bot.update({ update_id: 1102, message: { from: { id: 404 }, chat: { id: -99, type: 'group' }, text: `/login ${start.body.code}` } });
  expect((await call('/auth/telegram/finish', 'POST', { token: start.body.token })).body.pending).toBe(true);
  expect((await call('/auth/telegram/finish', 'POST', { token: start.body.code })).status).toBe(400);
});

test('personal period and reminder delivery, group mentions, retries and submission suppression', async () => {
  await setup();
  const { alpha, beta, id } = await game();
  const a = await personalConnect(alpha, 501, 1201, 'alpha_player');
  await personalConnect(beta, 502, 1202, 'beta_player');
  const room = db.room(id)!;
  // A transition enqueues both personal and existing group notifications.
  const before = structuredClone(room);
  room.snapshot.league.results.push(structuredClone(room.snapshot.league.results[0]));
  room.snapshot.league.results.at(-1)!.periodIndex = 1;
  room.deadlineAt = Date.now() + 3590000;
  db.transaction(() => db.saveRoom(room));
  expect(before.snapshot.league.results.length + 1).toBe(room.snapshot.league.results.length);
  sent = []; failure = 500;
  await bot.tick();
  expect(sent).toHaveLength(0);
  failure = 0;
  await bot.tick(Date.now() + 31000);
  expect(sent.some(m => m.chat_id === '501' && m.text.includes('Начался период'))).toBe(true);
  expect(sent.some(m => m.chat_id === '-123' && m.text.includes('tg://user?id=501') && m.text.includes('@alpha_player'))).toBe(true);
  expect(sent.some(m => m.chat_id === '501' && m.text.includes('Ещё не отправили: Альфа.') && !m.text.includes('Ещё не отправили: Бета'))).toBe(true);
  const count = sent.length;
  await bot.tick(Date.now() + 62000);
  expect(sent.length).toBe(count);
  expect(a.finish.body.user).toBeTruthy();
});

test('personal reminders recheck submitted state on retry and unlink cancels pending delivery', async () => {
  await setup();
  const { alpha, beta, id } = await game();
  await personalConnect(alpha, 601, 1301);
  await personalConnect(beta, 602, 1302);
  const room = db.room(id)!; room.deadlineAt = Date.now() + 3500000;
  db.transaction(() => db.saveRoom(room));
  failure = 500; await bot.tick();
  room.members.find(m => m.firmName === 'Альфа')!.submitted = true;
  db.transaction(() => db.saveRoom(room));
  expect((await call('/telegram/personal/unlink', 'POST', {}, beta)).status).toBe(200);
  sent = []; failure = 0; await bot.tick(Date.now() + 31000);
  expect(sent.filter(m => ['601', '602'].includes(m.chat_id))).toEqual([]);
  expect(sent.find(m => m.chat_id === '-123' && m.text.includes('Ещё не отправили'))?.text).toContain('Бета');
});
