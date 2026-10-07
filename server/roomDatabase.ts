import { DatabaseSync, backup } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AccountUser,
  RoomPhase,
  RoomVisibility,
} from "../src/online/roomTypes.ts";
import type { OnlineGameSettings } from "../src/online/gameSettings.ts";
import type { LeagueSnapshot } from "../src/state/persistence.ts";
import type { Decision } from "./repository.ts";
export interface StoredMember {
  userId: string;
  firmId: string;
  firmName: string;
  decision: Decision | null;
  submitted: boolean;
}
export interface StoredRoom {
  id: string;
  name: string;
  ownerId: string;
  ownerLogin: string;
  visibility: RoomVisibility;
  phase: RoomPhase;
  settings: OnlineGameSettings;
  snapshot: LeagueSnapshot;
  members: StoredMember[];
}
export interface StoredUser extends AccountUser {
  salt: string;
  passwordHash: string;
}
export class RoomDatabase {
  private readonly db: DatabaseSync;
  constructor(filePath: string) {
    if (filePath !== ":memory:")
      mkdirSync(dirname(filePath), { recursive: true });
    this.db = new DatabaseSync(filePath, { timeout: 5000 });
    this.db
      .exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,login TEXT NOT NULL,login_key TEXT NOT NULL UNIQUE,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires);
      CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,visibility TEXT NOT NULL,phase TEXT NOT NULL,settings TEXT NOT NULL,snapshot TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS rooms_owner ON rooms(owner_id);
      CREATE TABLE IF NOT EXISTS members(room_id TEXT NOT NULL REFERENCES rooms(id),user_id TEXT NOT NULL REFERENCES users(id),firm_id TEXT NOT NULL UNIQUE,firm_name TEXT NOT NULL,firm_name_key TEXT NOT NULL,decision TEXT,submitted INTEGER NOT NULL,PRIMARY KEY(room_id,user_id),UNIQUE(room_id,firm_name_key));
      CREATE INDEX IF NOT EXISTS members_user ON members(user_id);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id),period_index INTEGER NOT NULL,forced INTEGER NOT NULL,affected_firms TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  }
  close(): void {
    this.db.close();
  }
  async backup(destination: string): Promise<void> {
    await backup(this.db, destination);
  }
  transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  user(login: string): StoredUser | undefined {
    const row = this.db
      .prepare(
        "SELECT id,login,salt,password_hash AS passwordHash FROM users WHERE login_key=?",
      )
      .get(login.toLowerCase());
    return row as unknown as StoredUser | undefined;
  }
  addUser(user: StoredUser): void {
    this.db
      .prepare("INSERT INTO users VALUES(?,?,?,?,?)")
      .run(
        user.id,
        user.login,
        user.login.toLowerCase(),
        user.salt,
        user.passwordHash,
      );
  }
  session(hash: string): AccountUser | undefined {
    return this.db
      .prepare(
        "SELECT u.id,u.login FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?",
      )
      .get(hash, Date.now()) as unknown as AccountUser | undefined;
  }
  addSession(hash: string, userId: string): void {
    this.transaction(() => {
      this.db.prepare("DELETE FROM sessions WHERE expires<=?").run(Date.now());
      this.db
        .prepare(
          "DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires DESC LIMIT 9)",
        )
        .run(userId, userId);
      this.db
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(hash, userId, Date.now() + 30 * 86400000);
    });
  }
  removeSession(hash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(hash);
  }
  countOwned(userId: string): number {
    return Number(
      this.db
        .prepare("SELECT count(*) AS n FROM rooms WHERE owner_id=?")
        .get(userId)!.n,
    );
  }
  countMemberships(userId: string): number {
    return Number(
      this.db
        .prepare("SELECT count(*) AS n FROM members WHERE user_id=?")
        .get(userId)!.n,
    );
  }
  room(id: string): StoredRoom | undefined {
    const row = this.db
      .prepare(
        "SELECT r.*,u.login AS ownerLogin FROM rooms r JOIN users u ON u.id=r.owner_id WHERE r.id=?",
      )
      .get(id);
    if (!row) return;
    const members = this.db
      .prepare("SELECT * FROM members WHERE room_id=? ORDER BY rowid")
      .all(id)
      .map((m) => ({
        userId: String(m.user_id),
        firmId: String(m.firm_id),
        firmName: String(m.firm_name),
        decision: m.decision
          ? (JSON.parse(String(m.decision)) as Decision)
          : null,
        submitted: !!m.submitted,
      }));
    return {
      id: String(row.id),
      name: String(row.name),
      ownerId: String(row.owner_id),
      ownerLogin: String(row.ownerLogin),
      visibility: row.visibility as RoomVisibility,
      phase: row.phase as RoomPhase,
      settings: JSON.parse(String(row.settings)),
      snapshot: JSON.parse(String(row.snapshot)),
      members,
    };
  }
  listIds(scope: "open" | "mine", userId: string): string[] {
    const rows =
      scope === "open"
        ? this.db
            .prepare(
              "SELECT id FROM rooms WHERE visibility='public' AND phase='lobby' ORDER BY rowid DESC LIMIT 200",
            )
            .all()
        : this.db
            .prepare(
              "SELECT id FROM rooms WHERE owner_id=? OR id IN(SELECT room_id FROM members WHERE user_id=?) ORDER BY rowid DESC",
            )
            .all(userId, userId);
    return rows.map((row) => String(row.id));
  }
  insertRoom(room: StoredRoom): void {
    this.db
      .prepare("INSERT INTO rooms VALUES(?,?,?,?,?,?,?)")
      .run(
        room.id,
        room.ownerId,
        room.name,
        room.visibility,
        room.phase,
        JSON.stringify(room.settings),
        JSON.stringify(room.snapshot),
      );
  }
  saveRoom(room: StoredRoom): void {
    this.db
      .prepare("UPDATE rooms SET phase=?,snapshot=? WHERE id=?")
      .run(room.phase, JSON.stringify(room.snapshot), room.id);
    for (const m of room.members)
      this.db
        .prepare(
          "INSERT INTO members VALUES(?,?,?,?,?,?,?) ON CONFLICT(room_id,user_id) DO UPDATE SET decision=excluded.decision,submitted=excluded.submitted",
        )
        .run(
          room.id,
          m.userId,
          m.firmId,
          m.firmName,
          m.firmName.toLowerCase(),
          m.decision ? JSON.stringify(m.decision) : null,
          Number(m.submitted),
        );
  }
  audit(
    roomId: string,
    period: number,
    forced: boolean,
    affected: string[],
  ): void {
    this.db
      .prepare(
        "INSERT INTO audit(room_id,period_index,forced,affected_firms,created_at) VALUES(?,?,?,?,?)",
      )
      .run(
        roomId,
        period,
        Number(forced),
        JSON.stringify(affected),
        Date.now(),
      );
  }
}
