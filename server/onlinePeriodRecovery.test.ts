import { afterEach, expect, test } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RoomDatabase, type StoredRoom } from "./roomDatabase.ts";
import { buildOnlineGameSnapshot, DEFAULT_ONLINE_GAME_SETTINGS } from "../src/online/gameSettings.ts";
import { makeFirmStart, makeFirmDecision } from "../src/engine/config.ts";
import { computePeriod, initialOpeningState, nextOpeningState } from "../src/engine/computePeriod.ts";

let directory: string;
let db: RoomDatabase | undefined;
let raw: DatabaseSync | undefined;
afterEach(async () => {
  db?.close(); db = undefined;
  raw?.close(); raw = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function fixture() {
  directory = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "mecom-recovery-"));
  const file = join(directory, "rooms.sqlite");
  db = new RoomDatabase(file);
  db.addUser({ id: "owner", login: "Owner", salt: "saved-salt", passwordHash: "saved-hash" });
  db.addSession("saved-token-hash", "owner");
  const snapshot = buildOnlineGameSnapshot("Saved historical game");
  const l = snapshot.league;
  l.macroByPeriod = l.macroByPeriod.slice(0, 8);
  l.macroByPeriod[7] = { ...l.macroByPeriod[7], taxRate: 0.17, bankRateBase: 0.03,
    rifWeightGrowth: 21, rifWeightRetainedProfit: 39, scenarioNewsText: "Historical news must not repeat" };
  l.config.serviceFee = 0.015;
  l.firms = ["one", "two"].map(id => ({ id, name: id, ...makeFirmStart(2, l.config.machineCost) }));
  snapshot.opening = initialOpeningState(l);
  for (let i = 0; i <= 7; i++) {
    const decisions = Object.fromEntries(l.firms.map(f => [f.id, makeFirmDecision(f.id, 2)]));
    const result = computePeriod({ periodIndex: i, config: l.config, macro: l.macroByPeriod[i],
      firms: l.firms, opening: snapshot.opening, decisions, previousIndustry: l.results.at(-1)?.industry });
    l.decisionsByPeriod[i] = decisions;
    l.confirmedByPeriod[i] = { one: true, two: false };
    l.results.push(result);
    snapshot.opening = nextOpeningState(snapshot.opening, result);
  }
  const room: StoredRoom = { id: "affected", name: l.name, ownerId: "owner", ownerLogin: "Owner",
    phase: "complete", visibility: "link", timerMode: "standard", deadlineAt: null, autoBankruptcy: false,
    settings: { ...DEFAULT_ONLINE_GAME_SETTINGS, taxRatePercent: 17 }, snapshot,
    members: [{ userId: "owner", firmId: "one", firmName: "one", submitted: true,
      decision: { price: 35, production: 0, marketing: 0, capexGross: 0, rnd: 0 } }] };
  db.transaction(() => { db!.insertRoom(room); db!.saveRoom(room); db!.audit(room.id, 7, true, ["two"]); });
  raw = new DatabaseSync(file);
  return { file, room };
}
function tables() {
  return Object.fromEntries(["users", "sessions", "members", "audit"].map(table =>
    [table, raw!.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
}

test("startup preserves completed and closed games, and gives active legacy rooms a full deadline", async () => {
  const { file, room } = await fixture();
  const existing = structuredClone(room);
  existing.id = "existing-eight";
  existing.members = [];
  existing.snapshot.league.macroByPeriod[8] = { ...existing.snapshot.league.macroByPeriod[7], periodIndex: 8,
    taxRate: 0.29, scenarioNewsText: "Saved eighth news" };
  existing.snapshot.league.decisionsByPeriod[8] = { one: makeFirmDecision("one", 2) };
  existing.snapshot.league.confirmedByPeriod[8] = { one: true };
  const excluded: StoredRoom[] = [];
  for (const phase of ["closed", "lobby", "collecting"] as const) excluded.push({ ...structuredClone(room), id: phase, phase,
    deadlineAt: null, members: [] });
  for (const shape of ["full", "short", "duplicate", "reordered", "wrong-last", "wrong-first"]) {
    const other = { ...structuredClone(room), id: shape, members: [] };
    const results = other.snapshot.league.results;
    if (shape === "full") results.push({ ...structuredClone(results[7]), periodIndex: 8 });
    if (shape === "short") results.pop();
    if (shape === "duplicate") results[3].periodIndex = 2;
    if (shape === "reordered") [results[2], results[3]] = [results[3], results[2]];
    if (shape === "wrong-last") results[7].periodIndex = 8;
    if (shape === "wrong-first") results[0].periodIndex = 1;
    excluded.push(other);
  }
  db!.transaction(() => { for (const other of [existing, ...excluded]) db!.insertRoom(other); });
  // Keep historical results serialized identically and detect every persisted room update.
  const protectedBefore = tables();
  const excludedBefore = raw!.prepare("SELECT * FROM rooms WHERE id NOT IN ('affected','existing-eight') ORDER BY id").all();
  raw!.exec("CREATE TABLE recovery_writes(room_id TEXT); CREATE TRIGGER track_recovery AFTER UPDATE ON rooms BEGIN INSERT INTO recovery_writes VALUES(new.id); END;");
  db!.close(); db = undefined;
  db = new RoomDatabase(file);
  expect(db.room(room.id)).toEqual(room);
  expect(db.room(existing.id)).toEqual(existing);
  expect(tables()).toEqual(protectedBefore);
  const afterExcluded = raw!.prepare("SELECT * FROM rooms WHERE id NOT IN ('affected','existing-eight') ORDER BY id").all() as Array<Record<string, unknown>>;
  expect(afterExcluded).toHaveLength(excludedBefore.length);
  for (let i = 0; i < afterExcluded.length; i++) {
    if (afterExcluded[i].id === "collecting") {
      expect(afterExcluded[i].deadline_at).toBeGreaterThan(Date.now());
      expect({ ...afterExcluded[i], deadline_at: null }).toEqual(excludedBefore[i]);
    } else expect(afterExcluded[i]).toEqual(excludedBefore[i]);
  }
  expect(raw!.prepare("SELECT room_id FROM recovery_writes ORDER BY room_id").all()).toEqual([{ room_id: "collecting" }]);
  const allRooms = raw!.prepare("SELECT * FROM rooms ORDER BY id").all();
  db.close(); db = undefined;
  db = new RoomDatabase(file);
  expect(raw!.prepare("SELECT * FROM rooms ORDER BY id").all()).toEqual(allRooms);
  expect(raw!.prepare("SELECT count(*) AS n FROM recovery_writes").get()!.n).toBe(1);
  expect(tables()).toEqual(protectedBefore);
});

test("startup never reopens or writes completed games", async () => {
  const { file, room } = await fixture();
  const second = { ...structuredClone(room), id: "second", members: [] };
  db!.transaction(() => db!.insertRoom(second));
  raw!.exec("CREATE TABLE completed_writes(room_id TEXT); CREATE TRIGGER track_completed AFTER UPDATE ON rooms BEGIN INSERT INTO completed_writes VALUES(new.id); END;");
  const before = raw!.prepare("SELECT * FROM rooms ORDER BY id").all();
  const protectedBefore = tables();
  db!.close(); db = undefined;
  db = new RoomDatabase(file);
  expect(db.room(room.id)!.phase).toBe("complete");
  expect(db.room(second.id)!.phase).toBe("complete");
  expect(raw!.prepare("SELECT * FROM rooms ORDER BY id").all()).toEqual(before);
  expect(raw!.prepare("SELECT room_id FROM completed_writes").all()).toEqual([]);
  expect(tables()).toEqual(protectedBefore);
});
