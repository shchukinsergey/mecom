export interface StoredPlayerSession { gameId: string; firmId: string; firmName: string; rejoinToken: string; }
const KEY = 'mecom.online.player-sessions';
export function readPlayerSessions(): StoredPlayerSession[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]'); return Array.isArray(value) ? value.filter((v): v is StoredPlayerSession => !!v && typeof v.gameId === 'string' && typeof v.firmId === 'string' && typeof v.firmName === 'string' && typeof v.rejoinToken === 'string') : []; } catch { return []; }
}
export function savePlayerSession(session: StoredPlayerSession): void {
  const sessions = readPlayerSessions().filter(item => !(item.gameId === session.gameId && item.firmId === session.firmId));
  localStorage.setItem(KEY, JSON.stringify([...sessions, session]));
}
export function removePlayerSession(gameId: string, firmId: string): void {
  localStorage.setItem(KEY, JSON.stringify(readPlayerSessions().filter(item => !(item.gameId === gameId && item.firmId === firmId))));
}
