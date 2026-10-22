import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute, extname } from "node:path";
import { Authentication, authenticated, HttpError } from "./accounts.ts";
import {
  RoomDatabase,
  roomBots,
  type StoredRoom,
  type StoredMember,
} from "./roomDatabase.ts";
import type {
  AccountUser,
  RoomDetail,
  RoomSummary,
  CalculatePreview,
  RoomTimerMode,
} from "../src/online/roomTypes.ts";
import type { PlayerMe, GameStatus } from "../src/online/api.ts";
import {
  buildOnlineGameSnapshot,
  ensureOnlineFinalMacro,
  DEFAULT_ONLINE_GAME_SETTINGS,
  playablePeriodCount,
  type OnlineGameSettings,
} from "../src/online/gameSettings.ts";
import { scenarioFirmStart, scenarioFirmDecision, normalizeScenarioStart } from "../src/engine/originalScenarios.ts";
import { chooseBotDecision } from "../src/engine/bot.ts";
import { ensureBotProfiles } from './botProfiles.ts';
import { isScenarioId, type ScenarioId } from "../src/engine/scenarios.ts";
import { configForPeriod } from "../src/engine/periodConfig.ts";
import {
  computePeriod,
  initialOpeningState,
  nextOpeningState,
} from "../src/engine/computePeriod.ts";
import { declareNativeBankruptcyOpening } from "../src/engine/nativeBankruptcy.ts";
import { renderIndustryReport, renderFirmExport } from "../src/report/index.ts";
import { validDecision, type Decision } from "./repository.ts";
import { buildPublicHistory } from "./publicHistory.ts";
import { validateOnlineDecision } from "./decisionValidation.ts";
import type { TelegramBot } from './telegram.ts';
export interface AccountServerOptions {
  webRoot?: string;
  secureCookies?: boolean;
  publicOrigin?: string;
  telegram?: TelegramBot;
}
export function createAccountServer(
  database: RoomDatabase,
  options: AccountServerOptions = {},
): Server {
  const auth = new Authentication(database, options.secureCookies ?? false);
  const origin = options.publicOrigin
    ? new URL(options.publicOrigin).origin
    : undefined;
  const server = createServer((req, res) => {
    securityHeaders(res);
    void handle(req, res, database, auth, options, origin).catch((error) =>
      send(res, error instanceof HttpError ? error.status : 500, {
        error:
          error instanceof HttpError ? error.message : "Internal server error",
      }),
    );
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.maxHeadersCount = 64;
  server.maxRequestsPerSocket = 1000;
  const expirySweep = setInterval(() => {
    try { processExpiredRooms(database); } catch { /* retry at the next sweep */ }
  }, 1000);
  expirySweep.unref();
  server.once("close", () => clearInterval(expirySweep));
  try { processExpiredRooms(database); } catch { /* retry after server startup */ }
  return server;
}
export async function listenAccounts(
  server: Server,
  port = 8787,
  host = "127.0.0.1",
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}
function securityHeaders(res: ServerResponse): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
}
function send(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent || res.destroyed) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (
    req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  )
    throw new HttpError(415, "Content-Type must be application/json");
  if (Number(req.headers["content-length"]) > 16384) {
    req.resume();
    throw new HttpError(413, "Body too large");
  }
  const chunks: Buffer[] = [];
  let length = 0;
  const text = await new Promise<string>((resolve, reject) => {
    let settled = false;
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      length += chunk.length;
      if (length > 16384) {
        settled = true;
        req.resume();
        reject(new HttpError(413, "Body too large"));
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (!settled) {
        settled = true;
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    req.on("aborted", () => reject(new HttpError(400, "Aborted request")));
    req.on("error", reject);
  });
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Invalid JSON object");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new HttpError(400, "Unknown request field");
}
function name(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > 100 ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new HttpError(400, "Invalid name");
  return value.trim();
}
function settings(value: unknown): OnlineGameSettings {
  if (value === undefined) return structuredClone(DEFAULT_ONLINE_GAME_SETTINGS);
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "Invalid settings");
  const v = value as Record<string, unknown>;
  const defaultKeys = Object.keys(DEFAULT_ONLINE_GAME_SETTINGS);
  if (
    Object.keys(v).length !== defaultKeys.length ||
    defaultKeys.some((k) => !Object.hasOwn(v, k))
  )
    throw new HttpError(400, "Invalid settings fields");
  if (
    !["none", "sweep", "preRevenue"].includes(String(v.loanRepayment)) ||
    !["official", "flatLoanRate"].includes(String(v.bankInterestFormula))
  )
    throw new HttpError(400, "Invalid formula setting");
  for (const key of defaultKeys.filter(
    (k) => !["loanRepayment", "bankInterestFormula"].includes(k),
  )) {
    const n = v[key];
    const max = key.startsWith("loanLimit")
      ? 10000000
      : key === "periodsPerYear"
        ? 365
        : 100;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max)
      throw new HttpError(400, "Invalid numeric setting");
  }
  if (
    !Number.isInteger(v.periodsPerYear) ||
    Number(v.periodsPerYear) < 1 ||
    Number(v.loanLimitAbs) < Number(v.loanLimitBase)
  )
    throw new HttpError(400, "Invalid settings constraints");
  return structuredClone(v) as unknown as OnlineGameSettings;
}
function member(room: StoredRoom, user: AccountUser): StoredMember {
  const m = room.members.find((m) => m.userId === user.id);
  if (!m) throw new HttpError(403, "Room membership required");
  return m;
}
const BOT_FIRM_NAME = "Бот";
function botMembers(room: StoredRoom): StoredMember[] {
  return roomBots(room).map(bot => ({
    userId: `bot:${bot.firmId}`,
    firmId: bot.firmId,
    firmName: bot.firmName,
    decision: room.snapshot.league.decisionsByPeriod[period(room)]?.[bot.firmId] ?? null,
    submitted: room.phase !== "lobby",
  }));
}
function gameMembers(room: StoredRoom): StoredMember[] {
  return [...room.members, ...botMembers(room)];
}
function isBot(room: StoredRoom, m: StoredMember): boolean {
  return roomBots(room).some(bot => bot.firmId === m.firmId);
}
function owner(room: StoredRoom, user: AccountUser): void {
  if (room.ownerId !== user.id) throw new HttpError(403, "Room owner required");
}
function period(room: StoredRoom): number {
  return room.snapshot.league.results.length;
}
function current(room: StoredRoom, b: Record<string, unknown>): number {
  const i = period(room);
  if (
    room.phase !== "collecting" ||
    !Number.isInteger(b.periodIndex) ||
    b.periodIndex !== i
  )
    throw new HttpError(409, "Stale period or room not collecting");
  return i;
}
function previous(room: StoredRoom, m: StoredMember): Decision | null {
  const d =
    room.snapshot.league.decisionsByPeriod[period(room) - 1]?.[m.firmId];
  if (!d) return null;
  const { price, production, marketing, capexGross, rnd } = d;
  return { price, production, marketing, capexGross, rnd };
}
function valid(room: StoredRoom, m: StoredMember, d: Decision | null): boolean {
  const l = room.snapshot.league,
    i = period(room),
    opening = room.snapshot.opening[m.firmId],
    macro = l.macroByPeriod[i];
  return (
    !!d &&
    !!opening &&
    !!macro &&
    validDecision(d) &&
    !validateOnlineDecision(d, opening, macro, l.config)
  );
}
function nativeBankrupt(room: StoredRoom, firmId: string): boolean {
  return room.snapshot.league.config.featureFlags.bankruptcyMode === "native" &&
    !!room.snapshot.opening[firmId]?.nativeBankruptcy;
}
const retiredDecision = { price: 0, production: 0, marketing: 0, capexGross: 0, rnd: 0 };
function publicFirms(room: StoredRoom, db: RoomDatabase): RoomDetail["firms"] {
  return gameMembers(room).map((m) => ({
    firmId: m.firmId,
    firmName: m.firmName,
    ...(isBot(room, m) ? { isBot: true as const } : {}),
    submitted: m.submitted,
    ...(nativeBankrupt(room, m.firmId) ? { nativeBankrupt: true as const } : {}),
    ...(db.autoTurn(room.id, period(room) - 1, m.firmId) ? { autoSubmitted: true as const } : {}),
    ...(db.autoTurn(room.id, period(room) - 1, m.firmId)?.bankrupt ? { autoBankrupt: true as const } : {}),
    currentRif:
      room.snapshot.league.results
        .at(-1)
        ?.firms.find((f) => f.firmId === m.firmId)?.rif.total ?? null,
  }));
}
function summary(room: StoredRoom, user: AccountUser): RoomSummary {
  return {
    id: room.id,
    name: room.name,
    ownerLogin: room.ownerLogin,
    isOwner: room.ownerId === user.id,
    visibility: room.visibility,
    phase: room.phase,
    currentPeriodIndex: period(room),
    playerCount: gameMembers(room).length,
    activeFirmCount: gameMembers(room).filter(m => !nativeBankrupt(room, m.firmId)).length,
    submittedCount: gameMembers(room).filter(m => !nativeBankrupt(room, m.firmId) && m.submitted).length,
    ownFirmId: room.members.find((m) => m.userId === user.id)?.firmId ?? null,
    ownFirmSubmitted: room.members.find((m) => m.userId === user.id)?.submitted ?? null,
    timerMode: room.timerMode,
    deadlineAt: room.deadlineAt,
  };
}
function detail(room: StoredRoom, user: AccountUser, db: RoomDatabase): RoomDetail {
  const l = room.snapshot.league;
  return {
    ...summary(room, user),
    firms: publicFirms(room, db),
    ...(room.phase === "collecting" && l.config.featureFlags.bankruptcyMode === "native"
      ? { nativeBankruptcyAvailable: true } : {}),
    settings: room.settings,
    ...(l.scenario ? { scenarioTitle: l.scenario.title } : {}),
    periodMacro: l.macroByPeriod[period(room)] ?? null,
    industryReport: l.results.length
      ? renderIndustryReport(l.results.at(-1)!, room.name)
      : null,
  };
}
function player(room: StoredRoom, m: StoredMember, db: RoomDatabase): PlayerMe {
  const l = room.snapshot.league,
    reports = l.results.flatMap((p) => {
      const f = p.firms.find((f) => f.firmId === m.firmId);
      return f
        ? [
            {
              periodIndex: p.periodIndex,
              report: renderFirmExport(f, p, l.config, room.name),
            },
          ]
        : [];
    });
  return {
    gameId: room.id,
    firmId: m.firmId,
    firmName: m.firmName,
    phase: room.phase,
    currentPeriodIndex: period(room),
    timerMode: room.timerMode,
    deadlineAt: room.deadlineAt,
    autoTurn: db.autoTurn(room.id, period(room) - 1, m.firmId) ?? null,
    submitted: m.submitted,
    decision: room.phase === "lobby" ? null : (m.decision ?? previous(room, m)),
    openingState:
      room.phase === "lobby" ? null : (room.snapshot.opening[m.firmId] ?? null),
    periodMacro: l.macroByPeriod[period(room)] ?? null,
    config: l.macroByPeriod[period(room)] ? configForPeriod(l.config, l.macroByPeriod[period(room)]) : l.config,
    recentResults: l.results
      .flatMap((p) => p.firms.filter((f) => f.firmId === m.firmId))
      .slice(-2),
    reports,
    report: reports.at(-1)?.report ?? null,
  };
}
function preview(room: StoredRoom): CalculatePreview {
  const firms = gameMembers(room).filter(m => !nativeBankrupt(room, m.firmId)).map((m) => ({
    firmId: m.firmId,
    firmName: m.firmName,
    submitted: isBot(room, m) || m.submitted,
    source: (isBot(room, m) ? "submitted" : m.decision
      ? m.submitted
        ? "submitted"
        : "draft"
      : previous(room, m)
        ? "previous"
        : "missing") as CalculatePreview["firms"][number]["source"],
    valid: isBot(room, m) || valid(room, m, m.decision ?? previous(room, m)),
  }));
  const minimum = room.snapshot.league.config.featureFlags.bankruptcyMode === "native" ? 1 : 2;
  const active = room.phase === "collecting" && firms.length >= minimum;
  return {
    periodIndex: period(room),
    canCalculate:
      active && firms.every((f) => f.valid && f.source === "submitted"),
    canForce: active && firms.every((f) => f.valid),
    firms,
  };
}
// Both automatic submission and the owner's fallback run inside db.transaction.
function calculate(room: StoredRoom, db: RoomDatabase, force: boolean, autoFirmIds: string[] = []): void {
  if (gameMembers(room).every(m => nativeBankrupt(room, m.firmId)))
    throw new HttpError(409, "No active firms remain; period cannot be calculated");
  const p = preview(room);
  if (force ? !p.canForce : !p.canCalculate)
    throw new HttpError(409, "Valid decisions required");
  const profiles = ensureBotProfiles(room);
  const i = period(room), l = room.snapshot.league;
  const decisions = Object.fromEntries(
    gameMembers(room).map(m => [m.firmId, {
      ...(nativeBankrupt(room, m.firmId)
        ? retiredDecision
        : isBot(room, m)
          ? chooseBotDecision(room.snapshot, m.firmId, Math.random, profiles.get(m.firmId))
          : (m.decision ?? previous(room, m))!),
      firmId: m.firmId,
    }]),
  );
  const confirmed = Object.fromEntries(gameMembers(room).map(m => [m.firmId, isBot(room, m) || m.submitted]));
  const affected = [...new Set([...autoFirmIds, ...room.members.filter(m => !nativeBankrupt(room, m.firmId) && !m.submitted).map(m => m.firmId)])];
  const result = computePeriod({
    periodIndex: i,
    config: l.config,
    macro: l.macroByPeriod[i],
    firms: l.firms,
    opening: room.snapshot.opening,
    decisions,
    previousIndustry: l.results.at(-1)?.industry,
    previousNativeIndustryState: l.results.at(-1)?.nativeIndustryState,
  });
  l.decisionsByPeriod[i] = decisions;
  l.confirmedByPeriod[i] = confirmed;
  l.results.push(result);
  room.snapshot.opening = nextOpeningState(room.snapshot.opening, result);
  for (const m of room.members) {
    m.decision = null;
    m.submitted = false;
  }
  if (i >= playablePeriodCount(l)) room.phase = "complete";
  else {
    if (i + 1 === playablePeriodCount(l)) ensureOnlineFinalMacro(l);
    l.decisionsByPeriod[i + 1] = {};
    l.confirmedByPeriod[i + 1] = {};
  }
  room.deadlineAt = room.phase === "collecting" && room.timerMode !== "unlimited"
    ? Date.now() + (room.timerMode === "fast" ? 7 * 60_000 : 86400000)
    : null;
  db.audit(room.id, i, force, affected);
}
export function processExpiredRooms(db: RoomDatabase, now = Date.now()): void {
  for (const id of db.dueRoomIds(now)) db.transaction(() => {
    const room = db.room(id);
    if (!room || room.phase !== "collecting" || room.deadlineAt === null || room.deadlineAt > now) return;
    const league = room.snapshot.league, index = period(room), autoIds: string[] = [];
    const autoTurns: Array<{ firmId: string; cleared: Array<'marketing' | 'rnd' | 'capexGross' | 'production'>; bankrupt: boolean }> = [];
    for (const m of room.members.filter(member => !nativeBankrupt(room, member.firmId) && !member.submitted)) {
      let decision = previous(room, m);
      if (!decision) return;
      const cleared: Array<'marketing' | 'rnd' | 'capexGross' | 'production'> = [];
      if (!valid(room, m, decision)) {
        for (const field of ["marketing", "rnd", "capexGross", "production"] as const) {
          decision = { ...decision, [field]: 0 };
          cleared.push(field);
          if (valid(room, m, decision)) break;
        }
      }
      if (!valid(room, m, decision)) {
        if (!room.autoBankruptcy || league.config.featureFlags.bankruptcyMode !== "native") return;
        room.snapshot.opening[m.firmId] = declareNativeBankruptcyOpening(room.snapshot.opening[m.firmId], league.config, index);
        m.decision = { ...retiredDecision };
        league.decisionsByPeriod[index] ??= {};
        league.decisionsByPeriod[index][m.firmId] = { ...retiredDecision, firmId: m.firmId };
        league.confirmedByPeriod[index] ??= {};
        league.confirmedByPeriod[index][m.firmId] = false;
        autoTurns.push({ firmId: m.firmId, cleared, bankrupt: true });
      } else {
        m.decision = decision;
        autoIds.push(m.firmId);
        autoTurns.push({ firmId: m.firmId, cleared, bankrupt: false });
      }
    }
    const active = gameMembers(room).filter(member => !nativeBankrupt(room, member.firmId));
    for (const m of active) m.submitted = true;
    if (active.length && active.every(m => m.submitted)) {
      calculate(room, db, false, autoIds);
      for (const event of autoTurns) db.recordAutoTurn(room.id, index, event.firmId, event.cleared, event.bankrupt);
      db.saveRoom(room);
    }
  });
}
function initialize(room: StoredRoom): void {
  const profiles = ensureBotProfiles(room);
  const l = room.snapshot.league;
  const participants = gameMembers(room);
  normalizeScenarioStart(l, participants.length);
  l.firms = participants.map((m) => ({
    id: m.firmId,
    name: m.firmName,
    ...(isBot(room, m) ? { isBot: true } : {}),
    ...scenarioFirmStart(l, participants.length),
  }));
  const decisions = Object.fromEntries(
    participants.map((m) => [
      m.firmId,
      scenarioFirmDecision(l, m.firmId, participants.length),
    ]),
  );
  l.decisionsByPeriod = [decisions, {}];
  l.confirmedByPeriod = [
    Object.fromEntries(participants.map((m) => [m.firmId, true])),
    {},
  ];
  room.snapshot.opening = initialOpeningState(l);
  for (const bot of roomBots(room)) decisions[bot.firmId] = chooseBotDecision(room.snapshot, bot.firmId, Math.random, profiles.get(bot.firmId));
  const result = computePeriod({
    periodIndex: 0,
    config: l.config,
    macro: l.macroByPeriod[0],
    firms: l.firms,
    opening: room.snapshot.opening,
    decisions,
  });
  l.results = [result];
  room.snapshot.opening = nextOpeningState(room.snapshot.opening, result);
  room.phase = "collecting";
  for (const m of room.members) {
    m.decision = null;
    m.submitted = false;
  }
}
async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  db: RoomDatabase,
  auth: Authentication,
  options: AccountServerOptions,
  origin?: string,
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const path = url.pathname,
    method = req.method ?? "GET";
  if (method === "GET" && path === "/health")
    return send(res, 200, { ok: true });
  if (method === 'POST' && path === '/api/telegram/webhook') {
    if (!options.telegram) return send(res, 404, { error: 'Telegram is disabled' });
    if (!options.telegram.authorized(req.headers['x-telegram-bot-api-secret-token'])) throw new HttpError(403, 'Invalid webhook secret');
    await options.telegram.update(await body(req));
    return send(res, 200, { ok: true });
  }
  if (!path.startsWith("/api/") && path !== "/api") {
    if (
      method === "GET" &&
      (await serveStatic(path, res, options.webRoot ?? resolve("dist"), req))
    )
      return;
    return send(res, 404, { error: "Not found" });
  }
  if (!["GET", "HEAD"].includes(method)) {
    const expected =
      origin ??
      `${options.secureCookies ? "https" : "http"}://${req.headers.host}`;
    if (
      req.headers["sec-fetch-site"] === "cross-site" ||
      (req.headers.origin !== undefined && req.headers.origin !== expected)
    )
      throw new HttpError(403, "Cross-origin request rejected");
  }
  if (
    method === "POST" &&
    (path === "/api/auth/register" || path === "/api/auth/login")
  ) {
    const b = await body(req);
    return send(res, path.endsWith("register") ? 201 : 200, {
      user: await auth.credentials(req, res, b, path.endsWith("register")),
    });
  }
  if (method === "POST" && path === "/api/auth/logout") {
    keys(await body(req), []);
    auth.logout(req, res);
    return send(res, 200, { ok: true });
  }
  if (method === 'GET' && path === '/api/auth/telegram') return send(res, 200, { enabled: !!options.telegram, username: options.telegram?.options.username ?? null });
  if (method === 'POST' && ['/api/auth/telegram/start', '/api/auth/telegram/finish', '/api/telegram/personal/start', '/api/telegram/personal/finish', '/api/telegram/personal/unlink'].includes(path)) {
    if (!options.telegram) throw new HttpError(503, 'Telegram-бот ещё не настроен.');
    auth.limitTelegram(req, path.endsWith('/start'));
    const personal = path.startsWith('/api/telegram/personal');
    const userId = personal ? authenticated(req, db).id : null;
    const b = await body(req);
    if (path.endsWith('/unlink')) {
      keys(b, []);
      if (!db.transaction(() => db.telegram.unlink(userId!))) throw new HttpError(409, 'Для этого аккаунта Telegram — единственный способ входа.');
      return send(res, 200, { ok: true });
    }
    if (path.endsWith('/start')) {
      keys(b, []);
      return send(res, 200, db.transaction(() => db.telegram.beginAuth(userId)));
    }
    keys(b, ['token']);
    if (typeof b.token !== 'string' || !/^[a-f0-9]{64}$/.test(b.token)) throw new HttpError(400, 'Invalid token');
    const result = db.transaction(() => db.telegram.consumeAuth(b.token as string, userId));
    if ('expired' in result) throw new HttpError(410, 'Код истёк. Начните заново.');
    if ('user' in result && result.user && !personal) auth.signIn(res, result.user.id);
    return send(res, 200, result);
  }
  if (['/api/telegram', '/api/telegram/code', '/api/telegram/subscriptions'].includes(path)) {
    const user = authenticated(req, db);
    if (method === 'GET' && path === '/api/telegram') return send(res, 200, { identity: db.telegram.identity(user.id), enabled: !!options.telegram, username: options.telegram?.options.username ?? null, chats: db.telegram.chats(user.id), rooms: db.listIds('mine', user.id).map(id => db.room(id)!).filter(r => r.ownerId === user.id).map(r => ({ id: r.id, name: r.name, phase: r.phase })) });
    if (!options.telegram) throw new HttpError(503, 'Telegram-бот ещё не настроен на сервере.');
    if (method === 'POST' && path === '/api/telegram/code') {
      keys(await body(req), []);
      return send(res, 200, db.telegram.code(user.id));
    }
    if (method === 'PUT' && path === '/api/telegram/subscriptions') {
      const b = await body(req); keys(b, ['chatId', 'roomIds']);
      if (typeof b.chatId !== 'string' || !Array.isArray(b.roomIds) || b.roomIds.length > 50 || b.roomIds.some(id => typeof id !== 'string') || new Set(b.roomIds).size !== b.roomIds.length) throw new HttpError(400, 'Invalid subscriptions');
      const chatId = b.chatId;
      await options.telegram.verifyManager(user.id, chatId);
      db.transaction(() => {
        if (!db.telegram.manages(user.id, chatId)) throw new HttpError(403, 'Подключите этот чат с помощью своего кода.');
        const rooms = (b.roomIds as string[]).map(id => {
          const room = db.room(id);
          if (!room || room.ownerId !== user.id) throw new HttpError(403, 'Можно подключать только свои игры.');
          return room;
        });
        db.telegram.select(user.id, chatId, rooms);
      });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Not found' });
  }
  if (
    path !== "/api/auth/me" &&
    path !== "/api/rooms" &&
    !/^\/api\/rooms\/[0-9a-f-]{36}(?:\/(join|leave|bots|start|close|me|status|decision|submit|calculate-preview|calculate|bankruptcy))?$/.test(
      path,
    )
  )
    return send(res, 404, { error: "Not found" });
  const user = authenticated(req, db);
  if (method === "GET" && path === "/api/auth/me")
    return send(res, 200, { user });
  if (path === "/api/rooms") {
    if (method === "GET") {
      const scope = url.searchParams.get("scope") ?? "open";
      if (scope !== "open" && scope !== "mine")
        throw new HttpError(400, "Invalid scope");
      return send(res, 200, {
        rooms: db
          .listIds(scope, user.id)
          .map((id) => summary(db.room(id)!, user)),
      });
    }
    if (method === "POST") {
      const b = await body(req);
      keys(b, ["name", "visibility", "settings", "timerMode", "addBot", "scenarioId"]);
      if (b.scenarioId !== undefined && !isScenarioId(b.scenarioId)) throw new HttpError(400, "Unknown scenario");
      const roomName = name(b.name);
      if (b.visibility !== "public" && b.visibility !== "link")
        throw new HttpError(400, "Invalid visibility");
      if (b.addBot !== undefined && typeof b.addBot !== "boolean")
        throw new HttpError(400, "addBot must be boolean");
      const suppliedSettings = settings(b.settings);
      const s = b.scenarioId ? structuredClone(DEFAULT_ONLINE_GAME_SETTINGS) : suppliedSettings;
      const timerMode = (b.timerMode ?? "standard") as RoomTimerMode;
      if (!["fast", "standard", "unlimited"].includes(timerMode)) throw new HttpError(400, "Invalid timer mode");
      const room: StoredRoom = {
        id: randomUUID(),
        name: roomName,
        ownerId: user.id,
        ownerLogin: user.login,
        visibility: b.visibility,
        phase: "lobby",
        timerMode,
        deadlineAt: null,
        autoBankruptcy: true,
        botFirmId: b.addBot ? randomUUID() : null,
        settings: s,
        snapshot: buildOnlineGameSnapshot(roomName, s, b.scenarioId as ScenarioId | undefined),
        members: [],
      };
      room.snapshot.league.id = room.id;
      db.transaction(() => {
        if (db.countOwned(user.id) >= 50)
          throw new HttpError(409, "Room limit reached");
        db.insertRoom(room);
      });
      return send(res, 201, detail(room, user, db));
    }
  }
  const match =
    /^\/api\/rooms\/([0-9a-f-]{36})(?:\/(join|leave|bots|start|close|me|status|decision|submit|calculate-preview|calculate|bankruptcy))?$/.exec(
      path,
    );
  if (!match) return send(res, 404, { error: "Not found" });
  const id = match[1],
    action = match[2];
  const load = () => {
    const r = db.room(id);
    if (!r) throw new HttpError(404, "Room not found");
    return r;
  };
  if (method === "GET") {
    const room = load();
    if (!action) return send(res, 200, detail(room, user, db));
    if (action === "me")
      return send(res, 200, player(room, member(room, user), db));
    if (action === "status") {
      if (room.ownerId !== user.id) member(room, user);
      const status: GameStatus = {
        gameId: id,
        phase: room.phase,
        currentPeriodIndex: period(room),
        firms: publicFirms(room, db),
        history: buildPublicHistory(room.snapshot.league.results),
      };
      return send(res, 200, status);
    }
    if (action === "calculate-preview") {
      owner(room, user);
      return send(res, 200, preview(room));
    }
    return send(res, 404, { error: "Not found" });
  }
  if (
    !(
      method === "POST" &&
      ["join", "leave", "bots", "start", "close", "submit", "calculate", "bankruptcy"].includes(action ?? "")
    ) &&
    !(method === "PUT" && action === "decision")
  )
    return send(res, 404, { error: "Not found" });
  const b = await body(req);
  const allowed: Record<string, string[]> = {
    join: ["firmName"],
    leave: [],
    bots: [],
    start: [],
    close: [],
    submit: ["periodIndex"],
    decision: ["periodIndex", "decision"],
    calculate: ["periodIndex", "force"],
    bankruptcy: ["periodIndex", "firmId"],
  };
  keys(b, allowed[action!]);
  const output = db.transaction(() => {
    const room = load();
    if (action === "bots") {
      owner(room, user);
      if (room.phase !== "lobby") throw new HttpError(409, "Ботов можно добавлять только до начала игры.");
      if (gameMembers(room).length >= 12) throw new HttpError(409, "В комнате может быть не больше 12 фирм, включая ботов.");
      const names = new Set(gameMembers(room).map(m => m.firmName.toLowerCase()));
      let number = 1;
      let firmName = BOT_FIRM_NAME;
      while (names.has(firmName.toLowerCase())) firmName = `${BOT_FIRM_NAME} ${++number}`;
      room.bots = [...roomBots(room), { firmId: randomUUID(), firmName }];
    } else if (action === "leave") {
      if (room.phase !== "lobby") throw new HttpError(409, "Выйти из комнаты можно только до начала игры.");
      db.removeLobbyMember(room.id, user.id);
      room.members = room.members.filter(m => m.userId !== user.id);
    } else if (action === "join") {
      if (room.members.some((m) => m.userId === user.id))
        return detail(room, user, db);
      if (room.phase !== "lobby") throw new HttpError(409, "Lobby closed");
      if (gameMembers(room).length >= 12 || db.countMemberships(user.id) >= 100)
        throw new HttpError(409, "Membership limit reached");
      const firmName = name(b.firmName);
      if (
        firmName.toLowerCase() === BOT_FIRM_NAME.toLowerCase() || gameMembers(room).some(
          (m) => m.firmName.toLowerCase() === firmName.toLowerCase(),
        )
      )
        throw new HttpError(409, "Firm name exists");
      room.members.push({
        userId: user.id,
        firmId: randomUUID(),
        firmName,
        decision: null,
        submitted: false,
      });
    } else if (action === "start") {
      owner(room, user);
      if (room.phase !== "lobby" || gameMembers(room).length < 2)
        throw new HttpError(409, "Lobby requires at least two firms");
      initialize(room);
      room.deadlineAt = room.timerMode === "unlimited" ? null : Date.now() + (room.timerMode === "fast" ? 7 * 60_000 : 86400000);
    } else if (action === "close") {
      owner(room, user);
      room.phase = "closed";
      room.deadlineAt = null;
    } else if (action === "bankruptcy") {
      owner(room, user);
      const i = current(room, b);
      const l = room.snapshot.league;
      if (l.config.featureFlags.bankruptcyMode !== "native")
        throw new HttpError(409, "Native bankruptcy is unavailable for this room");
      const m = gameMembers(room).find(m => m.firmId === b.firmId);
      if (!m || !room.snapshot.opening[m.firmId])
        throw new HttpError(404, "Firm not found");
      if (nativeBankrupt(room, m.firmId))
        throw new HttpError(409, "Firm already declared bankrupt");
      room.snapshot.opening[m.firmId] = declareNativeBankruptcyOpening(
        room.snapshot.opening[m.firmId], l.config, i,
      );
      l.decisionsByPeriod[i] ??= {};
      l.confirmedByPeriod[i] ??= {};
      l.decisionsByPeriod[i][m.firmId] = { ...retiredDecision, firmId: m.firmId };
      l.confirmedByPeriod[i][m.firmId] = false;
      m.decision = { ...retiredDecision };
      m.submitted = false;
    } else if (action === "decision" || action === "submit") {
      const m = member(room, user);
      current(room, b);
      if (nativeBankrupt(room, m.firmId))
        throw new HttpError(409, "Firm permanently excluded after bankruptcy");
      if (action === "decision") {
        if (m.submitted) throw new HttpError(409, "Decision already submitted");
        if (!validDecision(b.decision) || !valid(room, m, b.decision))
          throw new HttpError(400, "Invalid current decision");
        m.decision = b.decision;
      } else {
        if (!valid(room, m, m.decision))
          throw new HttpError(409, "Save a valid current decision first");
        m.submitted = true;
        if (room.members.filter(m => !nativeBankrupt(room, m.firmId)).every(member => member.submitted))
          calculate(room, db, false);
      }
      db.saveRoom(room);
      return { ok: true };
    } else if (action === "calculate") {
      owner(room, user);
      current(room, b);
      if (typeof b.force !== "boolean")
        throw new HttpError(400, "force must be boolean");
      calculate(room, db, b.force);
    }
    db.saveRoom(room);
    return detail(room, user, db);
  });
  send(res, 200, output);
}
async function serveStatic(
  path: string,
  res: ServerResponse,
  webRoot: string,
  req: IncomingMessage,
): Promise<boolean> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return false;
  }
  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded
      .split("/")
      .some((p) => p.startsWith(".") || p.toLowerCase() === "data") ||
    /^\/(api|data)(\/|$)/i.test(decoded)
  )
    return false;
  // Canonicalize both sides: Windows short-name roots and symlinks must
  // compare against the same physical directory.
  let root: string;
  try {
    root = await realpath(resolve(webRoot));
  } catch {
    return false;
  }
  const safe = (file: string) => {
    const rel = relative(root, file);
    return !rel.startsWith("..") && !isAbsolute(rel);
  };
  let file = resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`);
  if (!safe(file)) return false;
  try {
    file = await realpath(file);
    if (!safe(file)) return false;
    const content = await readFile(file);
    res.writeHead(200, {
      "Content-Type": mime(file),
      "Cache-Control": "no-cache",
    });
    res.end(content);
    return true;
  } catch {
    /* only safe client-side paths receive SPA fallback */
  }
  if (extname(decoded) || !req.headers.accept?.includes("text/html"))
    return false;
  try {
    file = await realpath(resolve(root, "index.html"));
    if (!safe(file)) return false;
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(await readFile(file));
    return true;
  } catch {
    return false;
  }
}
function mime(file: string): string {
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".webp": "image/webp",
  };
  return types[extname(file).toLowerCase()] ?? "application/octet-stream";
}
