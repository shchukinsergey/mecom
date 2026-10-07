import { afterEach, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RoomDatabase } from "./roomDatabase.ts";
import { createAccountServer, listenAccounts } from "./roomsHttp.ts";
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
        "ownFirmId",
        "firms",
        "settings",
        "periodMacro",
        "industryReport",
      ].sort(),
    );
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
test("full eight-period game persists private histories and rejects stale parallel calculations", async () => {
  const { owner, a, b, route } = await game();
  await call(route + "/start", "POST", {}, owner);
  for (let i = 1; i < 8; i++) {
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
      ).toBe(200);
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
    expect(
      (await call(route + "/calculate-preview", "GET", undefined, owner)).body
        .canCalculate,
    ).toBe(true);
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
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
  }
  const me = (await call(route + "/me", "GET", undefined, a)).body;
  expect(me.phase).toBe("complete");
  expect(me.reports).toHaveLength(8);
  expect(me.currentPeriodIndex).toBe(8);
  const stored = db.room(route.split("/").at(-1)!)!;
  expect(stored.snapshot.league.results).toHaveLength(8);
  expect(stored.snapshot.league.confirmedByPeriod[7][me.firmId]).toBe(true);
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
