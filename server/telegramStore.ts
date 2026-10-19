import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { StoredRoom } from './roomDatabase.ts';
import { connectedMessage, periodMessage, roomPeriod } from './telegramMessages.ts';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export interface TelegramChat { chatId: string; title: string; active: boolean; error: string | null; roomIds: string[] }
export interface TelegramJob { id: number; linkId: string; chatId: string; roomId: string; period: number; kind: string; text: string; attempts: number }
export class TelegramStore {
  constructor(private db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_codes(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS telegram_chats(chat_id TEXT PRIMARY KEY,title TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,error TEXT);
      CREATE TABLE IF NOT EXISTS telegram_managers(chat_id TEXT NOT NULL REFERENCES telegram_chats(chat_id),user_id TEXT NOT NULL REFERENCES users(id),telegram_user_id TEXT NOT NULL,PRIMARY KEY(chat_id,user_id));
      CREATE TABLE IF NOT EXISTS telegram_links(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL REFERENCES telegram_chats(chat_id),room_id TEXT NOT NULL REFERENCES rooms(id),UNIQUE(chat_id,room_id));
      CREATE INDEX IF NOT EXISTS telegram_links_room ON telegram_links(room_id);
      CREATE TABLE IF NOT EXISTS telegram_jobs(id INTEGER PRIMARY KEY,link_id TEXT NOT NULL REFERENCES telegram_links(id) ON DELETE CASCADE,period INTEGER NOT NULL,kind TEXT NOT NULL,text TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0,UNIQUE(link_id,period,kind));
      CREATE INDEX IF NOT EXISTS telegram_due ON telegram_jobs(done,next_at);
      CREATE TABLE IF NOT EXISTS telegram_updates(id INTEGER PRIMARY KEY,created_at INTEGER NOT NULL);
    `);
  }
  code(userId: string, now = Date.now()) {
    this.db.prepare('DELETE FROM telegram_codes WHERE expires<=? OR user_id=?').run(now, userId);
    const code = randomBytes(18).toString('hex'), expiresAt = now + 10 * 60000;
    this.db.prepare('INSERT INTO telegram_codes VALUES(?,?,?)').run(hash(code), userId, expiresAt);
    return { code, expiresAt };
  }
  connect(code: string, chatId: string, title: string, telegramUserId: string, now = Date.now()): boolean {
    const row = this.db.prepare('SELECT user_id FROM telegram_codes WHERE hash=? AND expires>?').get(hash(code), now);
    if (!row) return false;
    this.db.prepare('INSERT INTO telegram_chats VALUES(?,?,1,NULL) ON CONFLICT(chat_id) DO UPDATE SET title=excluded.title,active=1,error=NULL').run(chatId, title);
    this.db.prepare('INSERT INTO telegram_managers VALUES(?,?,?) ON CONFLICT(chat_id,user_id) DO UPDATE SET telegram_user_id=excluded.telegram_user_id').run(chatId, String(row.user_id), telegramUserId);
    this.db.prepare('DELETE FROM telegram_codes WHERE hash=?').run(hash(code));
    return true;
  }
  manages(userId: string, chatId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM telegram_managers WHERE chat_id=? AND user_id=?').get(chatId, userId);
  }
  managerTelegramId(userId: string, chatId: string): string | null {
    const row = this.db.prepare('SELECT telegram_user_id FROM telegram_managers WHERE chat_id=? AND user_id=?').get(chatId, userId);
    return row ? String(row.telegram_user_id) : null;
  }
  chats(userId: string): TelegramChat[] {
    return this.db.prepare('SELECT c.* FROM telegram_chats c JOIN telegram_managers m USING(chat_id) WHERE m.user_id=? ORDER BY c.title').all(userId).map(row => ({
      chatId: String(row.chat_id), title: String(row.title), active: !!row.active, error: row.error === null ? null : String(row.error),
      roomIds: this.db.prepare('SELECT l.room_id FROM telegram_links l JOIN rooms r ON r.id=l.room_id WHERE l.chat_id=? AND r.owner_id=?').all(String(row.chat_id), userId).map(r => String(r.room_id)),
    }));
  }
  select(userId: string, chatId: string, rooms: StoredRoom[]) {
    const selected = new Set(rooms.map(r => r.id));
    const existing = this.db.prepare('SELECT l.id,l.room_id FROM telegram_links l JOIN rooms r ON r.id=l.room_id WHERE l.chat_id=? AND r.owner_id=?').all(chatId, userId);
    for (const row of existing) if (!selected.has(String(row.room_id))) this.db.prepare('DELETE FROM telegram_links WHERE id=?').run(String(row.id));
    for (const room of rooms) {
      if (existing.some(row => row.room_id === room.id)) continue;
      const id = randomUUID();
      this.db.prepare('INSERT INTO telegram_links VALUES(?,?,?)').run(id, chatId, room.id);
      if (room.phase === 'collecting' || room.phase === 'complete') this.enqueue(id, room, 'current', periodMessage(room, true));
      else if (room.phase === 'lobby') this.enqueue(id, room, 'connected', connectedMessage(room));
    }
  }
  links(roomId?: string) {
    return this.db.prepare(`SELECT l.* FROM telegram_links l JOIN telegram_chats c USING(chat_id) WHERE c.active=1${roomId ? ' AND l.room_id=?' : ''}`).all(...(roomId ? [roomId] : [])).map(row => ({ id: String(row.id), roomId: String(row.room_id), chatId: String(row.chat_id) }));
  }
  enqueue(linkId: string, room: StoredRoom, kind: string, text: string) {
    this.db.prepare('INSERT OR IGNORE INTO telegram_jobs(link_id,period,kind,text) VALUES(?,?,?,?)').run(linkId, roomPeriod(room), kind, text);
  }
  transition(before: StoredRoom, room: StoredRoom) {
    if ((room.phase !== 'collecting' && room.phase !== 'complete') || (before.phase === room.phase && roomPeriod(before) === roomPeriod(room))) return;
    for (const link of this.links(room.id)) this.enqueue(link.id, room, room.phase === 'complete' ? 'complete' : 'period', periodMessage(room));
  }
  due(now: number): TelegramJob[] {
    return this.db.prepare('SELECT j.*,l.chat_id,l.room_id FROM telegram_jobs j JOIN telegram_links l ON l.id=j.link_id JOIN telegram_chats c USING(chat_id) WHERE j.done=0 AND j.next_at<=? AND c.active=1 ORDER BY j.id LIMIT 20').all(now).map(r => ({ id: Number(r.id), linkId: String(r.link_id), chatId: String(r.chat_id), roomId: String(r.room_id), period: Number(r.period), kind: String(r.kind), text: String(r.text), attempts: Number(r.attempts) }));
  }
  done(id: number) { this.db.prepare('UPDATE telegram_jobs SET done=1 WHERE id=?').run(id); }
  retry(id: number, nextAt: number) { this.db.prepare('UPDATE telegram_jobs SET attempts=attempts+1,next_at=? WHERE id=?').run(nextAt, id); }
  inactive(chatId: string, error: string) { this.db.prepare('UPDATE telegram_chats SET active=0,error=? WHERE chat_id=?').run(error, chatId); }
  seen(updateId: number) { return !!this.db.prepare('SELECT 1 FROM telegram_updates WHERE id=?').get(updateId); }
  mark(updateId: number) {
    this.db.prepare('INSERT OR IGNORE INTO telegram_updates VALUES(?,?)').run(updateId, Date.now());
    this.db.prepare('DELETE FROM telegram_updates WHERE created_at<?').run(Date.now() - 7 * 86400000);
  }
}
