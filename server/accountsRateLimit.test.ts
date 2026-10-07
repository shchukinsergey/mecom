import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Authentication, HttpError } from "./accounts.ts";
import { RoomDatabase } from "./roomDatabase.ts";

let db: RoomDatabase;
let auth: Authentication;
const password = "password123";
const res = { setHeader() {} } as unknown as ServerResponse;
function request(peer = "192.0.2.1", forwarded = "198.51.100.1") {
  return {
    socket: { remoteAddress: peer },
    headers: { "x-forwarded-for": forwarded },
  } as unknown as IncomingMessage;
}
async function attempt(
  login: string,
  secret = password,
  register = false,
  req = request(),
  extra: Record<string, unknown> = {},
) {
  try {
    await auth.credentials(req, res, { login, password: secret, ...extra }, register);
    return register ? 201 : 200;
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return error.status;
  }
}
beforeEach(() => {
  db = new RoomDatabase(":memory:");
  auth = new Authentication(db, false);
});
afterEach(() => {
  vi.restoreAllMocks();
  db.close();
});

test("distinct attempts behind one ingress do not lock unrelated login or registration", async () => {
  expect(await attempt("Friend", password, true)).toBe(201);
  for (let i = 0; i < 31; i++) {
    expect(await attempt(`missing_${i}`)).toBe(401);
    expect(await attempt(`malformed ${i}`)).toBe(400);
  }
  expect(await attempt("FRIEND")).toBe(200);
  expect(await attempt("AnotherFriend", password, true)).toBe(201);
});

test("ten bad passwords share one normalized login bucket across peers and routes", async () => {
  expect(await attempt("Target", password, true)).toBe(201);
  for (let i = 0; i < 10; i++)
    expect(
      await attempt(i % 2 ? "TARGET" : "target", "wrongpass", false, request(`192.0.2.${i}`)),
    ).toBe(401);
  expect(await attempt("TaRgEt", "wrongpass")).toBe(429);
  expect(await attempt("TARGET", password, true)).toBe(429);
  expect(await attempt("Unrelated", password, true)).toBe(201);
});

test("invalid credential formats do not consume a valid login bucket", async () => {
  expect(await attempt("Friend", password, true)).toBe(201);
  for (let i = 0; i < 31; i++) {
    expect(await attempt("FRIEND", "short")).toBe(400);
    expect(await attempt("Friend", password, false, request(), { unexpected: true })).toBe(400);
  }
  expect(await attempt("friend")).toBe(200);
});

test("a successful login resets only its login bucket", async () => {
  expect(await attempt("Friend", password, true)).toBe(201);
  for (let i = 0; i < 9; i++) expect(await attempt("friend", "wrongpass")).toBe(401);
  expect(await attempt("FRIEND")).toBe(200);
  for (let i = 0; i < 10; i++) expect(await attempt("friend", "wrongpass")).toBe(401);
  expect(await attempt("friend", "wrongpass")).toBe(429);
});

test("changing forwarded headers cannot bypass the aggregate cap, which expires", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000000);
  for (let i = 0; i < 300; i++)
    expect(await attempt("bad login", password, false, request("192.0.2.1", `198.51.100.${i}`))).toBe(400);
  expect(await attempt("Friend", password, true, request("192.0.2.1", "203.0.113.1"))).toBe(429);
  expect(await attempt("Friend", password, true, request("192.0.2.2"))).toBe(201);
  // Success on another peer must not reset the exhausted aggregate bucket.
  expect(await attempt("Friend")).toBe(429);
  clock.mockReturnValue(1060000);
  expect(await attempt("Friend")).toBe(200);
});

test("per-login limit expires at the fixed window boundary", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000000);
  for (let i = 0; i < 10; i++) expect(await attempt("Missing")).toBe(401);
  clock.mockReturnValue(1059999);
  expect(await attempt("MISSING")).toBe(429);
  clock.mockReturnValue(1060000);
  expect(await attempt("missing")).toBe(401);
});

test("peer buckets are bounded without evicting active limits and expired buckets are reclaimed", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000000);
  for (let i = 0; i < 4096; i++)
    expect(await attempt("invalid login", password, false, request(`peer-${i}`))).toBe(400);
  expect(await attempt("invalid login", password, false, request("new-peer"))).toBe(429);
  expect(await attempt("invalid login", password, false, request("peer-0"))).toBe(400);
  clock.mockReturnValue(1060000);
  expect(await attempt("invalid login", password, false, request("new-peer"))).toBe(400);
});

test("login buckets are bounded without evicting active limits and expired buckets are reclaimed", async () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000000);
  // Existing registrations exercise valid-login admission without thousands of hashes.
  db.transaction(() => {
    for (let i = 0; i <= 4096; i++)
      db.addUser({ id: `id-${i}`, login: `User_${i}`, salt: "unused", passwordHash: "unused" });
  });
  for (let i = 0; i < 4096; i++)
    expect(await attempt(`User_${i}`, password, true, request(`peer-${i}`))).toBe(409);
  expect(await attempt("User_4096", password, true, request("peer-0"))).toBe(429);
  expect(await attempt("User_0", password, true, request("peer-0"))).toBe(409);
  clock.mockReturnValue(1060000);
  expect(await attempt("User_4096", password, true, request("peer-0"))).toBe(409);
});

test("the global two-hash concurrency safeguard is retained across distinct peers", async () => {
  const statuses = await Promise.all(
    Array.from({ length: 6 }, (_, i) => attempt(`Parallel_${i}`, password, true, request(`peer-${i}`))),
  );
  expect(statuses.filter((status) => status === 201)).toHaveLength(2);
  expect(statuses.filter((status) => status === 429)).toHaveLength(4);
});
