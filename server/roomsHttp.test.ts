import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { RoomDatabase } from "./roomDatabase.ts";
import { createAccountServer, listenAccounts, processExpiredRooms } from "./roomsHttp.ts";
import type { Server } from "node:http";
let db: RoomDatabase, server: Server, directory: string, base: string;
afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server.close(() => resolve()));
  db?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function setup() {
  directory = await mkdtemp(
    join(process.env.TMPDIR ?? tmpdir(), "mecom-rooms-"),
  );
  db = new RoomDatabase(join(directory, "rooms.sqlite"));
  server = createAccountServer(db);
  await listenAccounts(server, 0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
async function call(
  path: string,
  method = "GET",
  body?: unknown,
  cookie?: string,
  extra: Record<string, string> = {},
) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json(),
    cookie: response.headers.get("set-cookie"),
  };
}
async function register(login: string) {
  const v = await call("/api/auth/register", "POST", {
    login,
    password: "password123",
  });
  expect(v.status).toBe(201);
  return v.cookie!.split(";")[0];
}

test('the owner adds multiple bots after room creation; all bots calculate and persist', async () => {
  await setup();
  const owner = await register('MultiBotOwner');
  const human = await register('MultiBotPlayer');
  const created = await call('/api/rooms', 'POST', { name: 'Multiple bots', visibility: 'public' }, owner);
  const route = `/api/rooms/${created.body.id}`;
  expect(created.body.playerCount).toBe(0);
  expect((await call(route + '/bots', 'POST', {}, human)).status).toBe(403);
  expect((await call(route + '/bots', 'POST', {})).status).toBe(401);
  expect((await call(route + '/bots', 'POST', { count: 100 }, owner)).status).toBe(400);
  const first = await call(route + '/bots', 'POST', {}, owner);
  const second = await call(route + '/bots', 'POST', {}, owner);
  expect(first.status).toBe(200);
  expect(second.body.firms.map((f: { firmName: string }) => f.firmName)).toEqual(['Бот', 'Бот 2']);
  expect(second.body.firms.every((f: { isBot?: boolean }) => f.isBot)).toBe(true);
  expect((await call(route + '/join', 'POST', { firmName: 'Бот 2' }, human)).status).toBe(409);
  expect((await call(route + '/join', 'POST', { firmName: 'Human' }, human)).status).toBe(200);
  const started = await call(route + '/start', 'POST', {}, owner);
  expect(started.status).toBe(200);
  expect(started.body.playerCount).toBe(3);
  expect(started.body.submittedCount).toBe(2);
  expect((await call(route + '/bots', 'POST', {}, owner)).status).toBe(409);
  for (const periodIndex of [1, 2]) {
    expect((await call(route + '/decision', 'PUT', { periodIndex,
      decision: { price: 30, production: 0, marketing: 0, rnd: 0, capexGross: 0 } }, human)).status).toBe(200);
    expect((await call(route + '/submit', 'POST', { periodIndex }, human)).status).toBe(200);
    const stored = db.room(created.body.id)!;
    expect(stored.snapshot.league.results).toHaveLength(periodIndex + 1);
    for (const bot of stored.bots!) {
      const result = stored.snapshot.league.results.at(-1)!.firms.find(f => f.firmId === bot.firmId)!;
      expect(result.produced).toBeGreaterThan(0);
      expect(result.isBankrupt).toBe(false);
      expect(Number.isInteger(result.decision.price)).toBe(true);
    }
  }
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  db = new RoomDatabase(join(directory, 'rooms.sqlite'));
  server = createAccountServer(db);
  await listenAccounts(server, 0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const reloaded = await call(route, 'GET', undefined, owner);
  expect(reloaded.body.firms.filter((f: { isBot?: boolean }) => f.isBot)).toHaveLength(2);
  expect(reloaded.body.playerCount).toBe(3);
  expect(reloaded.body.submittedCount).toBe(2);
});

test('bots share the 12-firm limit with people and names skip existing human firms', async () => {
  await setup();
  const owner = await register('BotLimitOwner');
  const human = await register('BotLimitPlayer');
  const outsider = await register('BotLimitOutsider');
  const created = await call('/api/rooms', 'POST', { name: 'Limit', visibility: 'public' }, owner);
  const route = `/api/rooms/${created.body.id}`;
  await call(route + '/join', 'POST', { firmName: 'Бот 2' }, human);
  for (let i = 0; i < 11; i++) expect((await call(route + '/bots', 'POST', {}, owner)).status).toBe(200);
  const detail = await call(route, 'GET', undefined, owner);
  expect(detail.body.playerCount).toBe(12);
  expect(new Set(detail.body.firms.map((f: { firmName: string }) => f.firmName)).size).toBe(12);
  expect((await call(route + '/bots', 'POST', {}, owner)).status).toBe(409);
  expect((await call(route + '/join', 'POST', { firmName: 'Extra' }, outsider)).status).toBe(409);
});

test('three bots retain different strategies through every turn and a real database restart', async () => {
  await setup();
  const owner = await register('PersistentBotOwner');
  const created = await call('/api/rooms', 'POST', { name: 'Persistent strategies', visibility: 'link', timerMode: 'unlimited' }, owner);
  const route = `/api/rooms/${created.body.id}`;
  for (let i = 0; i < 3; i++) expect((await call(route + '/bots', 'POST', {}, owner)).status).toBe(200);
  expect(db.room(created.body.id)!.bots!.every(bot => !bot.profile)).toBe(true);
  expect((await call(route + '/start', 'POST', {}, owner)).status).toBe(200);
  const original = structuredClone(db.room(created.body.id)!.bots!);
  expect(new Set(original.map(bot => bot.profile!.strategy)).size).toBe(3);
  for (let p = 1; p <= 8; p++) {
    const response = await call(route + '/calculate', 'POST', { periodIndex: p, force: false }, owner);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const stored = db.room(created.body.id)!;
    expect(stored.bots).toEqual(original);
    const results = stored.snapshot.league.results[p].firms;
    if (p === 1) {
      expect(new Set(results.map(f => JSON.stringify({ ...f.decision, firmId: '' }))).size).toBe(3);
      const scale = original.find(bot => bot.profile!.strategy === 'scale')!;
      const quality = original.find(bot => bot.profile!.strategy === 'quality')!;
      expect(results.find(f => f.firmId === quality.firmId)!.decision.rnd)
        .toBeGreaterThan(results.find(f => f.firmId === scale.firmId)!.decision.rnd);
    }
    if (p === 3) {
      await new Promise<void>(resolve => server.close(() => resolve()));
      db.close();
      db = new RoomDatabase(join(directory, 'rooms.sqlite'));
      server = createAccountServer(db);
      await listenAccounts(server, 0);
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      expect(db.room(created.body.id)!.bots).toEqual(original);
    }
  }
  expect((await call(route, 'GET', undefined, owner)).body.phase).toBe('complete');
});

test('legacy single-bot databases migrate and accept additional bots without duplicates', async () => {
  await setup();
  const owner = await register('LegacyBotOwner');
  const created = await call('/api/rooms', 'POST', { name: 'Legacy', visibility: 'link', addBot: true }, owner);
  const route = `/api/rooms/${created.body.id}`;
  const legacyId = created.body.firms[0].firmId;
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  const legacy = new DatabaseSync(join(directory, 'rooms.sqlite'));
  legacy.exec('ALTER TABLE rooms DROP COLUMN bot_firms');
  legacy.close();
  db = new RoomDatabase(join(directory, 'rooms.sqlite'));
  server = createAccountServer(db);
  await listenAccounts(server, 0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const loaded = await call(route, 'GET', undefined, owner);
  expect(loaded.body.firms).toHaveLength(1);
  expect(loaded.body.firms[0].firmId).toBe(legacyId);
  const added = await call(route + '/bots', 'POST', {}, owner);
  expect(added.body.playerCount).toBe(2);
  expect(added.body.firms.map((f: { firmName: string }) => f.firmName)).toEqual(['Бот', 'Бот 2']);
  const started = await call(route + '/start', 'POST', {}, owner);
  expect(started.status).toBe(200);
  expect(started.body.activeFirmCount).toBe(2);
});

test('a room with only bots advances on its timer and disallows adding bots after closing', async () => {
  await setup();
  const owner = await register('BotsOnlyOwner');
  const created = await call('/api/rooms', 'POST', { name: 'Bots only', visibility: 'link', timerMode: 'fast' }, owner);
  const route = `/api/rooms/${created.body.id}`;
  await call(route + '/bots', 'POST', {}, owner);
  await call(route + '/bots', 'POST', {}, owner);
  expect((await call(route + '/start', 'POST', {}, owner)).status).toBe(200);
  expect((await call(route + '/calculate', 'POST', { periodIndex: 1, force: false }, owner)).status).toBe(200);
  const deadline = db.room(created.body.id)!.deadlineAt!;
  processExpiredRooms(db, deadline + 1);
  expect(db.room(created.body.id)!.snapshot.league.results).toHaveLength(3);
  await call(route + '/close', 'POST', {}, owner);
  expect((await call(route + '/bots', 'POST', {}, owner)).status).toBe(409);
});
test("accounts persist case-insensitive credentials and revoke opaque sessions on logout", async () => {
  await setup();
  const cookie = await register("Alice");
  expect(
    (await call("/api/auth/me", "GET", undefined, cookie)).body.user.login,
  ).toBe("Alice");
  expect(
    (
      await call("/api/auth/register", "POST", {
        login: "ALICE",
        password: "password123",
      })
    ).status,
  ).toBe(409);
  expect((await call("/api/auth/logout", "POST", {}, cookie)).status).toBe(200);
  expect((await call("/api/auth/me", "GET", undefined, cookie)).status).toBe(
    401,
  );
  db.close();
  db = new RoomDatabase(join(directory, "rooms.sqlite"));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server = createAccountServer(db);
  await listenAccounts(server, 0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  expect(
    (
      await call("/api/auth/login", "POST", {
        login: "alice",
        password: "password123",
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await call("/api/auth/login", "POST", {
        login: "alice",
        password: "wrongpass",
      })
    ).status,
  ).toBe(401);
});

async function game() {
  await setup();
  const owner = await register("Owner"),
    a = await register("Alpha"),
    b = await register("Beta"),
    outsider = await register("Visitor");
  const made = await call(
    "/api/rooms",
    "POST",
    { name: "Test room", visibility: "public" },
    owner,
  );
  expect(made.status).toBe(201);
  const route = "/api/rooms/" + made.body.id;
  expect(
    (await call(route + "/join", "POST", { firmName: "One" }, a)).status,
  ).toBe(200);
  expect(
    (await call(route + "/join", "POST", { firmName: "Two" }, b)).status,
  ).toBe(200);
  return { owner, a, b, outsider, route };
}
const conservative = {
  price: 35,
  production: 0,
  marketing: 0,
  capexGross: 0,
  rnd: 0,
};

test.each(['tractors-v1', 'ipad-v1', 'emobile-v1', 'tractors-v2', 'ipad-v2', 'emobile-v2', 'tractors-v3', 'ipad-v3', 'emobile-v3'])('%s creation is opt-in, preserves existing rooms and survives its saved duration and restart', async (scenarioId) => {
  const duration = scenarioId === 'ipad-v3' ? 9 : 8;
  const { owner, a, b, route: ordinaryRoute } = await game();
  const ordinaryId = ordinaryRoute.split('/').at(-1)!;
  const ordinaryBefore = JSON.stringify(db.room(ordinaryId));
  expect((await call('/api/rooms', 'POST', { name: 'Invalid', visibility: 'public', scenarioId: 'unknown' }, owner)).status).toBe(400);
  const created = await call('/api/rooms', 'POST', { name: 'Scenario', visibility: 'link', timerMode: 'unlimited', scenarioId }, owner);
  expect(created.status).toBe(201);
  expect(created.body.scenarioTitle).toContain(String(duration));
  expect(db.room(created.body.id)!.snapshot.league.scenario?.id).toBe(scenarioId);
  const route = '/api/rooms/' + created.body.id;
  for (const [cookie, firmName] of [[a, 'One'], [b, 'Two']]) {
    expect((await call(route + '/join', 'POST', { firmName }, cookie)).status).toBe(200);
  }
  expect((await call(route + '/start', 'POST', {}, owner)).status).toBe(200);
  const savedPlan = structuredClone(db.room(created.body.id)!.snapshot.league.macroByPeriod);
  for (let i = 1; i <= duration; i++) {
    const current = await call(route + '/me', 'GET', undefined, a);
    expect(current.body.currentPeriodIndex).toBe(i);
    expect(current.body.periodMacro).toEqual(savedPlan[i]);
    expect(current.body).not.toHaveProperty('snapshot');
    expect(current.body).not.toHaveProperty('macroByPeriod');
    expect(current.body.config.priceWeight).toBe(savedPlan[i].scenarioRules!.priceWeight);
    const invalid = await call(route + '/decision', 'PUT', { periodIndex: i, decision: { ...conservative, price: 201 } }, a);
    expect(invalid.status).toBe(400);
    for (const cookie of [a, b]) {
      expect((await call(route + '/decision', 'PUT', { periodIndex: i, decision: conservative }, cookie)).status).toBe(200);
      expect((await call(route + '/submit', 'POST', { periodIndex: i }, cookie)).status).toBe(200);
    }
    // The last participant submission automatically calculates the period.
    const computed = await call(route, 'GET', undefined, owner);
    expect(computed.status).toBe(200);
    expect(computed.body.phase).toBe(i === duration ? 'complete' : 'collecting');
    expect(db.room(created.body.id)!.snapshot.league.results[i].macro).toEqual(savedPlan[i]);
    if (i === duration - 1) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      db.close();
      db = new RoomDatabase(join(directory, 'rooms.sqlite'));
      server = createAccountServer(db);
      await listenAccounts(server, 0);
      base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    }
  }
  expect(JSON.stringify(db.room(ordinaryId))).toBe(ordinaryBefore);
  db.close();
  db = new RoomDatabase(join(directory, 'rooms.sqlite'));
  expect(db.room(created.body.id)!.snapshot.league.macroByPeriod).toEqual(savedPlan);
  expect(db.room(created.body.id)!.snapshot.league.results).toHaveLength(duration + 1);
  expect(JSON.stringify(db.room(ordinaryId))).toBe(ordinaryBefore);
});
test("room authorization, link visibility, membership and public DTO privacy", async () => {
  const { owner, a, b, outsider, route } = await game();
  const linked = await call(
    "/api/rooms",
    "POST",
    { name: "Private link", visibility: "link" },
    owner,
  );
  expect(
    (
      await call("/api/rooms?scope=open", "GET", undefined, outsider)
    ).body.rooms.map((r: { id: string }) => r.id),
  ).not.toContain(linked.body.id);
  expect(
    (await call("/api/rooms/" + linked.body.id, "GET", undefined, outsider))
      .status,
  ).toBe(200);
  expect((await call(route + "/start", "POST", {}, a)).status).toBe(403);
  expect((await call(route + "/me", "GET", undefined, owner)).status).toBe(403);
  expect(
    (await call(route + "/status", "GET", undefined, outsider)).status,
  ).toBe(403);
  expect(
    (await call(route + "/join", "POST", { firmName: "oNe" }, outsider)).status,
  ).toBe(409);
  expect((await call(route + "/start", "POST", {}, owner)).status).toBe(200);
  const rejoin = await call(
    route + "/join",
    "POST",
    { firmName: "Changed" },
    a,
  );
  expect(rejoin.body.playerCount).toBe(2);
  expect(
    (await call(route + "/join", "POST", { firmName: "Third" }, outsider))
      .status,
  ).toBe(409);
  const me = await call(route + "/me", "GET", undefined, a);
  expect(me.body.currentPeriodIndex).toBe(1);
  expect(
    me.body.recentResults.every(
      (f: { firmId: string }) => f.firmId === me.body.firmId,
    ),
  ).toBe(true);
  for (const cookie of [owner, a, b, outsider]) {
    const dto = (await call(route, "GET", undefined, cookie)).body;
    expect(Object.keys(dto).sort()).toEqual(
      [
        "id",
        "name",
        "ownerLogin",
        "isOwner",
        "visibility",
        "phase",
        "currentPeriodIndex",
        "playerCount",
        "activeFirmCount",
        "submittedCount",
        "ownFirmId",
        "ownFirmSubmitted",
        "timerMode",
        "deadlineAt",
        "firms",
        "settings",
        "periodMacro",
        "industryReport",
        "nativeBankruptcyAvailable",
      ].sort(),
    );
    expect(dto.activeFirmCount).toBe(2);
    expect(dto.submittedCount).toBe(0);
    expect(dto.ownFirmSubmitted).toBe(dto.ownFirmId ? false : null);
    for (const f of dto.firms)
      expect(Object.keys(f).sort()).toEqual(
        ["firmId", "firmName", "submitted", "currentRif"].sort(),
      );
    expect(JSON.stringify(dto)).not.toContain("passwordHash");
  }
  expect(
    (await call(route + "/calculate-preview", "GET", undefined, a)).status,
  ).toBe(403);
  expect((await call(route + "/close", "POST", {}, a)).status).toBe(403);
  expect((await call(route + "/close", "POST", {}, owner)).body.phase).toBe(
    "closed",
  );
});

test("a room created with one bot initializes and calculates the bot as a firm", async () => {
  await setup();
  const owner = await register("BotOwner");
  const human = await register("BotHuman");
  const created = await call("/api/rooms", "POST", {
    name: "Bot room", visibility: "public", addBot: true,
  }, owner);
  expect(created.status).toBe(201);
  expect(created.body.firms).toHaveLength(1);
  expect(created.body.firms[0]).toMatchObject({ firmName: "Бот", isBot: true });
  expect(created.body.playerCount).toBe(1);
  const id = created.body.id as string;
  const route = `/api/rooms/${id}`;

  expect((await call(route + "/join", "POST", { firmName: "Human firm" }, human)).status).toBe(200);
  const started = await call(route + "/start", "POST", {}, owner);
  expect(started.status).toBe(200);
  expect(started.body.firms.find((firm: { isBot?: boolean }) => firm.isBot)?.submitted).toBe(true);
  expect(started.body.activeFirmCount).toBe(2);
  expect(started.body.submittedCount).toBe(1);
  const listing = (await call('/api/rooms?scope=mine', 'GET', undefined, owner)).body.rooms;
  expect(listing.find((room: { id: string }) => room.id === id)).toMatchObject({ activeFirmCount: 2, submittedCount: 1 });

  const decision = {
    price: 35, production: 0, marketing: 0, capexGross: 0, rnd: 0,
  };
  const savedDecision = await call(route + "/decision", "PUT", { periodIndex: 1, decision }, human);
  expect(savedDecision.status, JSON.stringify(savedDecision.body)).toBe(200);
  expect((await call(route + "/submit", "POST", { periodIndex: 1 }, human)).status).toBe(200);
  const stored = db.room(id)!;
  const botId = created.body.firms[0].firmId as string;
  expect(stored.snapshot.league.decisionsByPeriod[1][botId]).toBeDefined();
  expect(stored.snapshot.league.results[1].firms.find(firm => firm.firmId === botId)?.netProfit).toEqual(expect.any(Number));
});
test("status returns all saved public history to members and owner only", async () => {
  const { owner, a, outsider, route } = await game();
  expect((await call(route + "/status", "GET", undefined, a)).body.history).toEqual([]);
  expect((await call(route + "/start", "POST", {}, owner)).status).toBe(200);
  expect((await call(route + "/calculate", "POST", { periodIndex: 1, force: true }, owner)).status).toBe(200);
  const id = route.split("/").at(-1)!;
  const room = db.room(id)!;
  // Seed a saved historical firm absent from the current roster.
  for (const p of room.snapshot.league.results) {
    p.firms.push({ ...structuredClone(p.firms[1]), firmId: "removed-historical", firmName: "Saved removed" });
  }
  const saved = structuredClone(room.snapshot.league.results);
  const removed = { firmId: "removed-historical" };
  db.transaction(() => db.saveRoom(room));
  const expectedHistory = saved.map(p => ({
    periodIndex: p.periodIndex,
    firms: p.firms.map(f => ({
      firmId: f.firmId, firmName: f.firmName, rif: f.rif.total,
      netProfit: f.netProfit, marketShareSold: f.marketShareSold,
      revenue: f.revenue, retainedEarnings: f.retainedEarnings,
    })),
  }));
  for (const cookie of [a, owner]) {
    const response = await call(route + "/status", "GET", undefined, cookie);
    expect(response.status).toBe(200);
    expect(response.body.history).toEqual(expectedHistory);
    expect(Object.keys(response.body).sort()).toEqual(["gameId", "phase", "currentPeriodIndex", "firms", "history"].sort());
    expect(response.body.currentPeriodIndex).toBe(2);
    expect(response.body.firms.map((f: { firmId: string }) => f.firmId)).not.toContain(removed.firmId);
    expect(response.body.history.map((p: { periodIndex: number }) => p.periodIndex)).toEqual([0, 1]);
  }
  expect((await call(route + "/status")).status).toBe(401);
  expect((await call(route + "/status", "GET", undefined, outsider)).status).toBe(403);
  expect(db.room(id)!.snapshot.league.results).toEqual(saved);
});

test("last submission advances exactly once without early advancement", async () => {
  const { owner, a, b, route } = await game();
  await call(route + "/start", "POST", {}, owner);
  const id = route.split("/").at(-1)!;
  for (const cookie of [a, b])
    expect((await call(route + "/decision", "PUT", { periodIndex: 1, decision: conservative }, cookie)).status).toBe(200);
  expect((await call(route + "/submit", "POST", { periodIndex: 1 }, a)).status).toBe(200);
  expect(db.room(id)!.snapshot.league.results).toHaveLength(1);
  const responses = await Promise.all([
    call(route + "/submit", "POST", { periodIndex: 1 }, b),
    call(route + "/submit", "POST", { periodIndex: 1 }, b),
  ]);
  expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  const room = db.room(id)!;
  expect(room.snapshot.league.results).toHaveLength(2);
  expect(room.phase).toBe("collecting");
  expect(room.members.every(m => !m.submitted && m.decision === null)).toBe(true);
  expect(Object.values(room.snapshot.league.confirmedByPeriod[1])).toEqual([true, true]);
  expect((await call(route + "/calculate", "POST", { periodIndex: 1, force: false }, owner)).status).toBe(409);
});

test("ongoing five-member period three survives restart and final submission persists period four", async () => {
  const { owner, a, b, route } = await game();
  const c = await register("Gamma"), d = await register("Delta");
  for (const [cookie, firmName] of [[owner, "Host firm"], [c, "Three"], [d, "Four"]])
    expect((await call(route + "/join", "POST", { firmName }, cookie)).status).toBe(200);
  const players = [a, b, owner, c, d];
  await call(route + "/start", "POST", {}, owner);
  for (let i = 1; i < 3; i++) {
    for (const cookie of players)
      expect((await call(route + "/decision", "PUT", { periodIndex: i, decision: conservative }, cookie)).status).toBe(200);
    expect((await call(route + "/calculate", "POST", { periodIndex: i, force: true }, owner)).status).toBe(200);
  }
  for (const cookie of players)
    expect((await call(route + "/decision", "PUT", { periodIndex: 3, decision: conservative }, cookie)).status).toBe(200);
  for (const cookie of players.slice(0, 4))
    expect((await call(route + "/submit", "POST", { periodIndex: 3 }, cookie)).status).toBe(200);
  const id = route.split("/").at(-1)!;
  const before = db.room(id)!;
  expect(before.snapshot.league.results).toHaveLength(3);
  expect(before.members.filter(m => m.submitted)).toHaveLength(4);
  const restart = async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    db = new RoomDatabase(join(directory, "rooms.sqlite"));
    server = createAccountServer(db);
    await listenAccounts(server, 0);
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  };
  await restart();
  expect(db.room(id)).toEqual(before);
  expect((await call(route + "/me", "GET", undefined, d)).body.currentPeriodIndex).toBe(3);
  expect((await call(route + "/submit", "POST", { periodIndex: 3 }, d)).status).toBe(200);
  const advanced = db.room(id)!;
  expect(advanced.snapshot.league.results).toHaveLength(4);
  expect(advanced.snapshot.league.results.slice(0, 3)).toEqual(before.snapshot.league.results);
  expect(advanced.members.every(m => !m.submitted && m.decision === null)).toBe(true);
  await restart();
  expect(db.room(id)).toEqual(advanced);
  expect((await call(route + "/submit", "POST", { periodIndex: 3 }, d)).status).toBe(409);
  const me = (await call(route + "/me", "GET", undefined, d)).body;
  expect(me.currentPeriodIndex).toBe(4);
  expect(me.reports).toHaveLength(4);
  expect(me.recentResults.every((f: { firmId: string }) => f.firmId === me.firmId)).toBe(true);
  const dto = (await call(route, "GET", undefined, a)).body;
  for (const firm of dto.firms)
    expect(Object.keys(firm).sort()).toEqual(["firmId", "firmName", "submitted", "currentRif"].sort());
});

test("invalid submitted budget prevents last-submit calculation and leaves flags unchanged", async () => {
  const { owner, a, b, route } = await game();
  await call(route + "/start", "POST", {}, owner);
  const id = route.split("/").at(-1)!;
  for (const cookie of [a, b])
    await call(route + "/decision", "PUT", { periodIndex: 1, decision: conservative }, cookie);
  await call(route + "/submit", "POST", { periodIndex: 1 }, a);
  db.transaction(() => {
    const room = db.room(id)!;
    room.members[0].decision = { ...conservative, marketing: 50000, rnd: 50000, capexGross: 50000 };
    db.saveRoom(room);
  });
  const before = db.room(id);
  expect((await call(route + "/submit", "POST", { periodIndex: 1 }, b)).status).toBe(409);
  expect(db.room(id)).toEqual(before);
});

test("calculation write failure rolls back final submission, results and audit", async () => {
  const { owner, a, b, route } = await game();
  await call(route + "/start", "POST", {}, owner);
  const id = route.split("/").at(-1)!;
  for (const cookie of [a, b])
    await call(route + "/decision", "PUT", { periodIndex: 1, decision: conservative }, cookie);
  await call(route + "/submit", "POST", { periodIndex: 1 }, a);
  const before = db.room(id);
  const writeAudit = db.audit.bind(db);
  const audit = vi.spyOn(db, "audit");
  audit.mockImplementationOnce((...args) => { writeAudit(...args); throw new Error("synthetic write failure"); });
  expect((await call(route + "/submit", "POST", { periodIndex: 1 }, b)).status).toBe(500);
  expect(db.room(id)).toEqual(before);
  audit.mockRestore();
  expect((await call(route + "/submit", "POST", { periodIndex: 1 }, b)).status).toBe(200);
  const raw = new (await import("node:sqlite")).DatabaseSync(join(directory, "rooms.sqlite"));
  try {
    const rows = raw.prepare("SELECT period_index, forced, affected_firms FROM audit WHERE room_id=?").all(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ period_index: 1, forced: 0, affected_firms: "[]" });
  } finally { raw.close(); }
});

test("full eight-period game persists private histories and rejects stale parallel calculations", async () => {
  const { owner, a, b, route } = await game();
  await call(route + "/start", "POST", {}, owner);
  for (let i = 1; i <= 8; i++) {
    for (const cookie of [a, b]) {
      expect(
        (await call(route + "/submit", "POST", { periodIndex: i }, cookie))
          .status,
      ).toBe(409);
      expect(
        (
          await call(
            route + "/decision",
            "PUT",
            { periodIndex: i, decision: conservative },
            cookie,
          )
        ).status,
      ).toBe(200);
      expect(
        (await call(route + "/submit", "POST", { periodIndex: i }, cookie))
          .status,
      ).toBe(200);
      expect(
        (await call(route + "/submit", "POST", { periodIndex: i }, cookie))
          .status,
      ).toBe(cookie === a ? 200 : 409);
      expect(
        (
          await call(
            route + "/decision",
            "PUT",
            { periodIndex: i, decision: conservative },
            cookie,
          )
        ).status,
      ).toBe(409);
    }
    expect((await call(route, "GET", undefined, owner)).body.currentPeriodIndex).toBe(i + 1);
    expect(
      (await call(route + "/calculate-preview", "GET", undefined, owner)).body
        .canCalculate,
    ).toBe(false);
    const responses = await Promise.all([
      call(
        route + "/calculate",
        "POST",
        { periodIndex: i, force: false },
        owner,
      ),
      call(
        route + "/calculate",
        "POST",
        { periodIndex: i, force: true },
        owner,
      ),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([409, 409]);
  }
  const me = (await call(route + "/me", "GET", undefined, a)).body;
  expect(me.phase).toBe("complete");
  expect(me.reports).toHaveLength(9);
  expect(me.currentPeriodIndex).toBe(9);
  const stored = db.room(route.split("/").at(-1)!)!;
  expect(stored.snapshot.league.results.map(p => p.periodIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  expect(stored.snapshot.league.confirmedByPeriod[8][me.firmId]).toBe(true);
  expect(
    (
      await call(
        route + "/calculate",
        "POST",
        { periodIndex: 8, force: true },
        owner,
      )
    ).status,
  ).toBe(409);
});
test.each(["lobby", "collecting", "existing-eight"])("legacy %s snapshot advances through period eight without resetting saved macros", async (variant) => {
  const { owner, a, b, route } = await game();
  const id = route.split("/").at(-1)!;
  const seedLegacy = () => db.transaction(() => {
    const room = db.room(id)!;
    const l = room.snapshot.league;
    l.macroByPeriod = l.macroByPeriod.slice(0, 8);
    l.macroByPeriod[7] = { ...l.macroByPeriod[7], taxRate: 0.13, bankRateBase: 0.07, scenarioNewsText: "Period seven only" };
    if (variant === "existing-eight")
      l.macroByPeriod[8] = { ...l.macroByPeriod[7], periodIndex: 8, taxRate: 0.19, scenarioNewsText: "Saved period eight news" };
    db.saveRoom(room);
  });
  if (variant === "lobby") seedLegacy();
  await call(route + "/start", "POST", {}, owner);
  if (variant !== "lobby") seedLegacy();
  const initial = db.room(id)!.snapshot.league;
  for (let i = 1; i <= 7; i++)
    expect((await call(route + "/calculate", "POST", { periodIndex: i, force: true }, owner)).status).toBe(200);
  const before = db.room(id)!;
  expect(before.phase).toBe("collecting");
  expect(before.snapshot.league.macroByPeriod.slice(0, 8)).toEqual(initial.macroByPeriod.slice(0, 8));
  expect(before.snapshot.league.config).toEqual(initial.config);
  expect(before.snapshot.league.macroByPeriod[8]).toEqual(variant === "existing-eight"
    ? initial.macroByPeriod[8]
    : { ...initial.macroByPeriod[7], periodIndex: 8, scenarioNewsText: "" });
  if (variant === "lobby") {
    for (const cookie of [a, b])
      expect((await call(route + "/decision", "PUT", { periodIndex: 8, decision: conservative }, cookie)).status).toBe(200);
    expect((await call(route + "/submit", "POST", { periodIndex: 8 }, a)).status).toBe(200);
    const responses = await Promise.all([1, 2].map(() => call(route + "/submit", "POST", { periodIndex: 8 }, b)));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  } else {
    const responses = await Promise.all([1, 2].map(() => call(route + "/calculate", "POST", { periodIndex: 8, force: true }, owner)));
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
  }
  const completed = db.room(id)!;
  expect(completed.phase).toBe("complete");
  expect(completed.snapshot.league.results).toHaveLength(9);
  expect(completed.snapshot.league.results.at(-1)!.periodIndex).toBe(8);
  expect(completed.snapshot.league.results.slice(0, 8)).toEqual(before.snapshot.league.results);
  expect((await call(route + "/submit", "POST", { periodIndex: 8 }, b)).status).toBe(409);
  expect((await call(route + "/calculate", "POST", { periodIndex: 8, force: true }, owner)).status).toBe(409);
});

test("completed period seven remains complete after restart without reopening period eight", async () => {
  const { owner, a, b, route } = await game();
  const id = route.split("/").at(-1)!;
  await call(route + "/start", "POST", {}, owner);
  for (let i = 1; i <= 7; i++) {
    for (const cookie of [a, b])
      expect((await call(route + "/decision", "PUT", { periodIndex: i, decision: conservative }, cookie)).status).toBe(200);
    expect((await call(route + "/calculate", "POST", { periodIndex: i, force: true }, owner)).status).toBe(200);
  }
  db.transaction(() => {
    const room = db.room(id)!;
    room.phase = "complete";
    room.deadlineAt = null;
    room.snapshot.league.macroByPeriod.length = 8;
    room.snapshot.league.decisionsByPeriod.length = 8;
    room.snapshot.league.confirmedByPeriod.length = 8;
    db.saveRoom(room);
  });
  const historical = db.room(id)!;
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  db = new RoomDatabase(join(directory, "rooms.sqlite"));
  server = createAccountServer(db);
  await listenAccounts(server, 0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const unchanged = db.room(id)!;
  expect(unchanged.phase).toBe("complete");
  expect(unchanged.snapshot).toEqual(historical.snapshot);
  expect(unchanged.members).toEqual(historical.members);
  expect(unchanged.deadlineAt).toBeNull();
  expect((await call(route + "/me", "GET", undefined, a)).body.phase).toBe("complete");
  expect((await call(route + "/calculate", "POST", { periodIndex: 7, force: true }, owner)).status).toBe(409);
  expect((await call(route + "/decision", "PUT", { periodIndex: 8, decision: conservative }, a)).status).toBe(409);
  expect((await call(route + "/submit", "POST", { periodIndex: 8 }, b)).status).toBe(409);
  const raw = new (await import("node:sqlite")).DatabaseSync(join(directory, "rooms.sqlite"));
  try { expect(raw.prepare("SELECT period_index FROM audit WHERE room_id=? ORDER BY id").all(id).map(row => row.period_index)).toEqual([1, 2, 3, 4, 5, 6, 7]); }
  finally { raw.close(); }
});

test("forced calculation chooses saved draft then previous, and invalid current draft rolls back atomically", async () => {
  const { owner, a, route } = await game();
  await call(route + "/start", "POST", {}, owner);
  const id = route.split("/").at(-1)!;
  expect(
    (
      await call(
        route + "/calculate",
        "POST",
        { periodIndex: 1, force: false },
        owner,
      )
    ).status,
  ).toBe(409);
  await call(
    route + "/decision",
    "PUT",
    { periodIndex: 1, decision: conservative },
    a,
  );
  let p = (await call(route + "/calculate-preview", "GET", undefined, owner))
    .body;
  expect(p.firms.map((f: { source: string }) => f.source)).toEqual([
    "draft",
    "previous",
  ]);
  expect(p.canForce).toBe(true);
  expect(
    (
      await call(
        route + "/calculate",
        "POST",
        { periodIndex: 1, force: true },
        owner,
      )
    ).status,
  ).toBe(200);
  expect(
    db.room(id)!.snapshot.league.decisionsByPeriod[1][
      db.room(id)!.members[0].firmId
    ].production,
  ).toBe(0);
  db.transaction(() => {
    const room = db.room(id)!;
    room.members[0].decision = { ...conservative, production: 1e9 };
    db.saveRoom(room);
  });
  const before = JSON.stringify(db.room(id));
  p = (await call(route + "/calculate-preview", "GET", undefined, owner)).body;
  expect(p.firms[0].source).toBe("draft");
  expect(p.firms[0].valid).toBe(false);
  expect(
    (
      await call(
        route + "/calculate",
        "POST",
        { periodIndex: 2, force: true },
        owner,
      )
    ).status,
  ).toBe(409);
  expect(JSON.stringify(db.room(id))).toBe(before);
  expect(
    (
      await call(
        route + "/decision",
        "PUT",
        { periodIndex: 1, decision: conservative },
        a,
      )
    ).status,
  ).toBe(409);
  expect(
    (
      await call(
        route + "/decision",
        "PUT",
        { periodIndex: 2, decision: { ...conservative, production: 1e9 } },
        a,
      )
    ).status,
  ).toBe(400);
});
test("mutation origin, cookies, bounded JSON, strict settings and disabled legacy routes", async () => {
  await setup();
  const cookie = await register("Secure");
  expect(
    (
      await call("/api/auth/logout", "POST", {}, cookie, {
        Origin: "https://evil.example",
      })
    ).status,
  ).toBe(403);
  expect((await call("/api/auth/me", "GET", undefined, cookie)).status).toBe(
    200,
  );
  expect(
    (
      await call(
        "/api/rooms",
        "POST",
        { name: "Bad", visibility: "public", snapshot: {} },
        cookie,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        "/api/rooms",
        "POST",
        { name: "Bad", visibility: "public", settings: { periodsPerYear: 0 } },
        cookie,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await call(
        "/api/rooms",
        "POST",
        { name: "x".repeat(17000), visibility: "public" },
        cookie,
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await call("/api/rooms", "POST", {}, cookie, {
        "Content-Type": "text/plain",
      })
    ).status,
  ).toBe(415);
  for (const route of [
    "/api/state",
    "/api/player/me",
    "/api/admin/games/anything",
  ])
    expect((await call(route, "GET", undefined, cookie)).status).toBe(404);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server = createAccountServer(db, {
    secureCookies: true,
    publicOrigin: "https://game.example",
  });
  await listenAccounts(server, 0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const login = await call(
    "/api/auth/login",
    "POST",
    { login: "secure", password: "password123" },
    undefined,
    { Origin: "https://game.example" },
  );
  expect(login.status).toBe(200);
  expect(login.cookie).toContain("; Secure");
  expect(login.cookie).toContain("; HttpOnly");
  expect(login.cookie).toContain("SameSite=Lax");
  expect(
    (
      await call("/api/auth/logout", "POST", {}, login.cookie!.split(";")[0], {
        Origin: "http://game.example",
      })
    ).status,
  ).toBe(403);
});
test("online SQLite backup preserves credentials and room snapshots", async () => {
  const { owner, route } = await game();
  await call(route + "/start", "POST", {}, owner);
  const file = join(directory, "backup.sqlite");
  await db.backup(file);
  const copy = new RoomDatabase(file);
  try {
    expect(copy.user("OWNER")?.login).toBe("Owner");
    expect(
      copy.room(route.split("/").at(-1)!)?.snapshot.league.results,
    ).toHaveLength(1);
  } finally {
    copy.close();
  }
});

test("unknown API routes are 404 even without authentication and never SPA", async () => {
  await setup();
  for (const route of ["/api/state", "/api/admin/games", "/api/unknown"])
    expect((await call(route)).status).toBe(404);
});
test("auth input limits, bounded concurrent hashes, rate limit ignores forwarded IP", async () => {
  await setup();
  for (const credentials of [
    { login: "ab", password: "password123" },
    { login: "bad space", password: "password123" },
    { login: "Okay", password: "short" },
    { login: "Okay", password: "😀".repeat(65) },
  ])
    expect((await call("/api/auth/register", "POST", credentials)).status).toBe(
      400,
    );
  const parallel = await Promise.all(
    Array.from({ length: 6 }, (_, i) =>
      call("/api/auth/register", "POST", {
        login: "Parallel" + i,
        password: "password123",
      }),
    ),
  );
  expect(parallel.filter((r) => r.status === 201).length).toBeLessThanOrEqual(
    2,
  );
  expect(parallel.some((r) => r.status === 429)).toBe(true);
  // Aggregate abuse protection is deliberately generous for a shared ingress.
  for (let i = 0; i < 300; i++)
    await call(
      "/api/auth/login",
      "POST",
      { login: "x", password: "short" },
      undefined,
      { "X-Forwarded-For": `192.0.2.${i}` },
    );
  expect(
    (
      await call(
        "/api/auth/login",
        "POST",
        { login: "someone", password: "password123" },
        undefined,
        { "X-Forwarded-For": "1.1.1.1" },
      )
    ).status,
  ).toBe(429);
});

test("session hashes and salted credentials stay private, expire after TTL, and mutations commit audit", async () => {
  const { owner, route } = await game();
  const raw = new (await import("node:sqlite")).DatabaseSync(
    join(directory, "rooms.sqlite"),
  );
  try {
    const rows = raw.prepare("SELECT * FROM users").all();
    expect(
      rows.every((row) => !JSON.stringify(row).includes("password123")),
    ).toBe(true);
    expect(new Set(rows.map((row) => row.salt)).size).toBe(rows.length);
    const sessions = raw.prepare("SELECT * FROM sessions").all();
    expect(sessions.every((row) => String(row.token_hash).length === 64)).toBe(
      true,
    );
    expect(JSON.stringify(sessions)).not.toContain(owner.split("=")[1]);
    await call(route + "/start", "POST", {}, owner);
    await call(
      route + "/calculate",
      "POST",
      { periodIndex: 1, force: true },
      owner,
    );
    const audit = raw.prepare("SELECT * FROM audit").all();
    expect(audit).toHaveLength(1);
    expect(audit[0].forced).toBe(1);
    expect(JSON.parse(String(audit[0].affected_firms))).toHaveLength(2);
    raw.prepare("UPDATE sessions SET expires=?").run(Date.now() - 1);
    expect((await call("/api/auth/me", "GET", undefined, owner)).status).toBe(
      401,
    );
  } finally {
    raw.close();
  }
});
test("static files have MIME/security headers and cannot expose data or legacy API fallbacks", async () => {
  await setup();
  const fs = await import("node:fs/promises");
  const root = join(directory, "web");
  await fs.mkdir(root);
  await fs.writeFile(join(root, "index.html"), "<html>app</html>");
  await fs.writeFile(join(root, "app.js"), "console.log(1)");
  await fs.mkdir(join(root, "data"));
  await fs.writeFile(join(root, "data", "secret.json"), "secret");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  server = createAccountServer(db, { webRoot: root });
  await listenAccounts(server, 0);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const js = await fetch(base + "/app.js");
  expect(js.headers.get("content-type")).toContain("text/javascript");
  expect(js.headers.get("x-content-type-options")).toBe("nosniff");
  expect(js.headers.get("access-control-allow-origin")).toBeNull();
  expect(
    (await fetch(base + "/room/page", { headers: { Accept: "text/html" } }))
      .status,
  ).toBe(200);
  for (const path of [
    "/data/secret.json",
    "/%64ata/secret.json",
    "/.env",
    "/api/state",
    "/api/unknown",
  ])
    expect(
      (await fetch(base + path, { headers: { Accept: "text/html" } })).status,
    ).toBe(404);
});
test("custom settings are rebuilt server-side, mine is scoped, and owner can be a player", async () => {
  const { owner, a, outsider, route } = await game();
  const s = {
    ...(await call(route, "GET", undefined, owner)).body.settings,
    taxRatePercent: 32,
    periodsPerYear: 12,
  };
  const custom = await call(
    "/api/rooms",
    "POST",
    { name: "Configured", visibility: "link", settings: s },
    owner,
  );
  expect(custom.status).toBe(201);
  expect(custom.body.periodMacro.taxRate).toBe(0.32);
  expect(
    (await call("/api/rooms?scope=mine", "GET", undefined, a)).body.rooms,
  ).toHaveLength(1);
  expect(
    (await call("/api/rooms?scope=mine", "GET", undefined, outsider)).body
      .rooms,
  ).toHaveLength(0);
  expect(
    (await call("/api/rooms?scope=mine", "GET", undefined, owner)).body.rooms,
  ).toHaveLength(2);
  const joined = await call(
    route + "/join",
    "POST",
    { firmName: "Facilitator player" },
    owner,
  );
  expect(joined.body.ownFirmId).not.toBeNull();
  expect(joined.body.playerCount).toBe(3);
  for (const settings of [
    { ...s, periodsPerYear: 0 },
    { ...s, loanLimitAbs: 1 },
    { ...s, taxRatePercent: 101 },
    { ...s, extra: 1 },
    { ...s, bankInterestFormula: "fake" },
  ])
    expect(
      (
        await call(
          "/api/rooms",
          "POST",
          { name: "Invalid", visibility: "public", settings },
          owner,
        )
      ).status,
    ).toBe(400);
});

test("rooms cap firms at twelve and bound per-user room creation", async () => {
  const { owner, outsider, route } = await game();
  for (let i = 0; i < 10; i++) {
    const cookie = await register("Player_" + i);
    expect(
      (await call(route + "/join", "POST", { firmName: "Firm " + i }, cookie))
        .status,
    ).toBe(200);
  }
  expect(
    (await call(route + "/join", "POST", { firmName: "Overflow" }, outsider))
      .status,
  ).toBe(409);
  expect((await call(route, "GET", undefined, owner)).body.playerCount).toBe(
    12,
  );
  const original = db.room(route.split("/").at(-1)!)!;
  db.transaction(() => {
    for (let i = 0; i < 49; i++)
      db.insertRoom({
        ...original,
        id: i.toString(16).padStart(8, "0") + "-0000-4000-8000-000000000000",
        members: [],
      });
  });
  expect(
    (
      await call(
        "/api/rooms",
        "POST",
        { name: "Overflow", visibility: "link" },
        owner,
      )
    ).status,
  ).toBe(409);
});
