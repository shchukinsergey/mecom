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
  type StoredRoom,
  type StoredMember,
} from "./roomDatabase.ts";
import type {
  AccountUser,
  RoomDetail,
  RoomSummary,
  CalculatePreview,
} from "../src/online/roomTypes.ts";
import type { PlayerMe, GameStatus } from "../src/online/api.ts";
import {
  buildOnlineGameSnapshot,
  DEFAULT_ONLINE_GAME_SETTINGS,
  type OnlineGameSettings,
} from "../src/online/gameSettings.ts";
import { makeFirmDecision, makeFirmStart } from "../src/engine/config.ts";
import {
  computePeriod,
  initialOpeningState,
  nextOpeningState,
} from "../src/engine/computePeriod.ts";
import { renderIndustryReport, renderFirmExport } from "../src/report/index.ts";
import { validDecision, type Decision } from "./repository.ts";
import { validateOnlineDecision } from "./decisionValidation.ts";
export interface AccountServerOptions {
  webRoot?: string;
  secureCookies?: boolean;
  publicOrigin?: string;
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
function publicFirms(room: StoredRoom): RoomDetail["firms"] {
  return room.members.map((m) => ({
    firmId: m.firmId,
    firmName: m.firmName,
    submitted: m.submitted,
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
    playerCount: room.members.length,
    ownFirmId: room.members.find((m) => m.userId === user.id)?.firmId ?? null,
  };
}
function detail(room: StoredRoom, user: AccountUser): RoomDetail {
  const l = room.snapshot.league;
  return {
    ...summary(room, user),
    firms: publicFirms(room),
    settings: room.settings,
    periodMacro: l.macroByPeriod[period(room)] ?? null,
    industryReport: l.results.length
      ? renderIndustryReport(l.results.at(-1)!, room.name)
      : null,
  };
}
function player(room: StoredRoom, m: StoredMember): PlayerMe {
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
    submitted: m.submitted,
    decision: room.phase === "lobby" ? null : (m.decision ?? previous(room, m)),
    openingState:
      room.phase === "lobby" ? null : (room.snapshot.opening[m.firmId] ?? null),
    periodMacro: l.macroByPeriod[period(room)] ?? null,
    config: l.config,
    recentResults: l.results
      .flatMap((p) => p.firms.filter((f) => f.firmId === m.firmId))
      .slice(-2),
    reports,
    report: reports.at(-1)?.report ?? null,
  };
}
function preview(room: StoredRoom): CalculatePreview {
  const firms = room.members.map((m) => ({
    firmId: m.firmId,
    firmName: m.firmName,
    submitted: m.submitted,
    source: (m.decision
      ? m.submitted
        ? "submitted"
        : "draft"
      : previous(room, m)
        ? "previous"
        : "missing") as CalculatePreview["firms"][number]["source"],
    valid: valid(room, m, m.decision ?? previous(room, m)),
  }));
  const active = room.phase === "collecting" && firms.length >= 2;
  return {
    periodIndex: period(room),
    canCalculate:
      active && firms.every((f) => f.valid && f.source === "submitted"),
    canForce: active && firms.every((f) => f.valid),
    firms,
  };
}
// Both automatic submission and the owner's fallback run inside db.transaction.
function calculate(room: StoredRoom, db: RoomDatabase, force: boolean): void {
  const p = preview(room);
  if (force ? !p.canForce : !p.canCalculate)
    throw new HttpError(409, "Valid decisions required");
  const i = period(room), l = room.snapshot.league;
  const decisions = Object.fromEntries(
    room.members.map(m => [m.firmId, { ...(m.decision ?? previous(room, m))!, firmId: m.firmId }]),
  );
  const confirmed = Object.fromEntries(room.members.map(m => [m.firmId, m.submitted]));
  const affected = room.members.filter(m => !m.submitted).map(m => m.firmId);
  const result = computePeriod({
    periodIndex: i,
    config: l.config,
    macro: l.macroByPeriod[i],
    firms: l.firms,
    opening: room.snapshot.opening,
    decisions,
    previousIndustry: l.results.at(-1)?.industry,
  });
  l.decisionsByPeriod[i] = decisions;
  l.confirmedByPeriod[i] = confirmed;
  l.results.push(result);
  room.snapshot.opening = nextOpeningState(room.snapshot.opening, result);
  for (const m of room.members) {
    m.decision = null;
    m.submitted = false;
  }
  if (i + 1 >= 8) room.phase = "complete";
  else {
    l.decisionsByPeriod[i + 1] = {};
    l.confirmedByPeriod[i + 1] = {};
  }
  db.audit(room.id, i, force, affected);
}
function initialize(room: StoredRoom): void {
  const l = room.snapshot.league;
  l.firms = room.members.map((m) => ({
    id: m.firmId,
    name: m.firmName,
    ...makeFirmStart(room.members.length, l.config.machineCost),
  }));
  const decisions = Object.fromEntries(
    room.members.map((m) => [
      m.firmId,
      makeFirmDecision(m.firmId, room.members.length),
    ]),
  );
  l.decisionsByPeriod = [decisions, {}];
  l.confirmedByPeriod = [
    Object.fromEntries(room.members.map((m) => [m.firmId, true])),
    {},
  ];
  room.snapshot.opening = initialOpeningState(l);
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
  if (
    path !== "/api/auth/me" &&
    path !== "/api/rooms" &&
    !/^\/api\/rooms\/[0-9a-f-]{36}(?:\/(join|start|close|me|status|decision|submit|calculate-preview|calculate))?$/.test(
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
      keys(b, ["name", "visibility", "settings"]);
      const roomName = name(b.name);
      if (b.visibility !== "public" && b.visibility !== "link")
        throw new HttpError(400, "Invalid visibility");
      const s = settings(b.settings);
      const room: StoredRoom = {
        id: randomUUID(),
        name: roomName,
        ownerId: user.id,
        ownerLogin: user.login,
        visibility: b.visibility,
        phase: "lobby",
        settings: s,
        snapshot: buildOnlineGameSnapshot(roomName, s),
        members: [],
      };
      room.snapshot.league.id = room.id;
      db.transaction(() => {
        if (db.countOwned(user.id) >= 50)
          throw new HttpError(409, "Room limit reached");
        db.insertRoom(room);
      });
      return send(res, 201, detail(room, user));
    }
  }
  const match =
    /^\/api\/rooms\/([0-9a-f-]{36})(?:\/(join|start|close|me|status|decision|submit|calculate-preview|calculate))?$/.exec(
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
    if (!action) return send(res, 200, detail(room, user));
    if (action === "me")
      return send(res, 200, player(room, member(room, user)));
    if (action === "status") {
      if (room.ownerId !== user.id) member(room, user);
      const status: GameStatus = {
        gameId: id,
        phase: room.phase,
        currentPeriodIndex: period(room),
        firms: publicFirms(room),
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
      ["join", "start", "close", "submit", "calculate"].includes(action ?? "")
    ) &&
    !(method === "PUT" && action === "decision")
  )
    return send(res, 404, { error: "Not found" });
  const b = await body(req);
  const allowed: Record<string, string[]> = {
    join: ["firmName"],
    start: [],
    close: [],
    submit: ["periodIndex"],
    decision: ["periodIndex", "decision"],
    calculate: ["periodIndex", "force"],
  };
  keys(b, allowed[action!]);
  const output = db.transaction(() => {
    const room = load();
    if (action === "join") {
      if (room.members.some((m) => m.userId === user.id))
        return detail(room, user);
      if (room.phase !== "lobby") throw new HttpError(409, "Lobby closed");
      if (room.members.length >= 12 || db.countMemberships(user.id) >= 100)
        throw new HttpError(409, "Membership limit reached");
      const firmName = name(b.firmName);
      if (
        room.members.some(
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
      if (room.phase !== "lobby" || room.members.length < 2)
        throw new HttpError(409, "Lobby requires at least two firms");
      initialize(room);
    } else if (action === "close") {
      owner(room, user);
      room.phase = "closed";
    } else if (action === "decision" || action === "submit") {
      const m = member(room, user);
      current(room, b);
      if (action === "decision") {
        if (m.submitted) throw new HttpError(409, "Decision already submitted");
        if (!validDecision(b.decision) || !valid(room, m, b.decision))
          throw new HttpError(400, "Invalid current decision");
        m.decision = b.decision;
      } else {
        if (!valid(room, m, m.decision))
          throw new HttpError(409, "Save a valid current decision first");
        m.submitted = true;
        if (room.members.every(member => member.submitted))
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
    return detail(room, user);
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
