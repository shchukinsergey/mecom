import { accountRequest } from './roomsApi';
import type { LeagueSnapshot } from '../state/persistence';
import type { FirmDecision, FirmOpeningState, LeagueConfig, PeriodMacroParams, FirmPeriodResult } from '../engine/types';

const BASE = '/api';
export interface OnlineFirm { firmId: string; firmName: string; submitted: boolean; currentRif?: number | null; }
export interface OnlineGame { gameId: string; name: string; inviteToken?: string; inviteTokenHash?: string; open: boolean; phase: 'lobby' | 'collecting' | 'complete' | 'closed'; firms: Array<{firmId:string;firmName:string;submitted:boolean;decision?:Partial<FirmDecision>|null}>; snapshot?: LeagueSnapshot | null; }
export interface PlayerMe { gameId: string; firmId: string; firmName: string; phase: 'lobby' | 'collecting' | 'complete' | 'closed'; currentPeriodIndex: number; submitted: boolean; decision?: Partial<FirmDecision> | null; openingState?: FirmOpeningState | null; periodMacro?: PeriodMacroParams | null; config?: LeagueConfig | null; recentResults?: FirmPeriodResult[]; report?: string | null; reports?: Array<{ periodIndex: number; report: string }>; }
export interface JoinResult { gameId: string; firmId: string; firmName: string; rejoinToken: string; }
export interface GameStatus { gameId: string; phase: 'lobby' | 'collecting' | 'complete' | 'closed'; currentPeriodIndex: number; firms: OnlineFirm[]; }
export type ApiError = Error & { status?: number };
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`${BASE}${path}`, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } }); }
  catch { throw new Error('Сервер недоступен. Проверьте подключение и попробуйте снова.'); }
  if (!response.ok) {
    let message = response.status === 401 || response.status === 403 ? 'Доступ отклонён. Проверьте токен или ссылку повторного входа.' : `Ошибка сервера (${response.status}).`;
    try {
      const payload = await response.json() as { error?: unknown };
      if (typeof payload.error === 'string' && payload.error) message = payload.error;
    } catch { /* keep the status-based fallback */ }
    const error = new Error(message) as ApiError;
    error.status = response.status; throw error;
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
const adminHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });
const playerHeaders = (token: string) => ({ 'X-MECOM-PLAYER': token });
export const createGame = (token: string, name: string, snapshot?: LeagueSnapshot) => request<OnlineGame>('/games', { method: 'POST', headers: adminHeaders(token), body: JSON.stringify(snapshot ? { name, snapshot } : { name }) });
export const joinGame = (inviteToken: string, firmName: string) => request<JoinResult>('/join', { method: 'POST', headers: { 'X-MECOM-INVITE': inviteToken }, body: JSON.stringify({ firmName }) });
export const getAdminGame = (token: string, id: string) => request<OnlineGame>(`/admin/games/${encodeURIComponent(id)}`, { headers: adminHeaders(token) });
export const rotateInviteToken = (token: string, id: string) => request<{ inviteToken: string }>(`/admin/games/${encodeURIComponent(id)}/invite-token`, { method: 'POST', headers: adminHeaders(token) });
export const startGame = (token: string, id: string) => request<OnlineGame>(`/games/${encodeURIComponent(id)}/start`, { method: 'POST', headers: adminHeaders(token) });
export const closeGame = (token: string, id: string) => request<OnlineGame>(`/games/${encodeURIComponent(id)}/close`, { method: 'POST', headers: adminHeaders(token) });
export const updateMacro = (token: string, id: string, macro: Partial<PeriodMacroParams>) => request<OnlineGame>(`/admin/games/${encodeURIComponent(id)}/macro`, { method: 'PUT', headers: adminHeaders(token), body: JSON.stringify(macro) });
export const calculateGame = (token: string, id: string) => request<OnlineGame>(`/admin/games/${encodeURIComponent(id)}/calculate`, { method: 'POST', headers: adminHeaders(token) });
export const rotateRejoinToken = (token: string, id: string, firmId: string) => request<{ rejoinToken: string }>(`/admin/games/${encodeURIComponent(id)}/firms/${encodeURIComponent(firmId)}/rejoin-token`, { method: 'POST', headers: adminHeaders(token) });
export const kickFirm = (token: string, id: string, firmId: string) => request<{ ok: true }>(`/admin/games/${encodeURIComponent(id)}/firms/${encodeURIComponent(firmId)}`, { method: 'DELETE', headers: adminHeaders(token) });
const accountPath = (token: string) => `/rooms/${encodeURIComponent(token.slice('account:'.length))}`;
export const getPlayerMe = (token: string) => token.startsWith('account:') ? accountRequest<PlayerMe>(`${accountPath(token)}/me`) : request<PlayerMe>('/player/me', { headers: playerHeaders(token) });
export const saveDecision = (token: string, decision: Partial<FirmDecision>, expectedPeriod?: number) => {
  if (!token.startsWith('account:')) return request<void>('/player/decision', { method: 'PUT', headers: playerHeaders(token), body: JSON.stringify(decision) });
  if (!Number.isInteger(expectedPeriod) || expectedPeriod! < 0) return Promise.reject(new Error('Не указан текущий период. Обновите страницу.'));
  return accountRequest<void>(`${accountPath(token)}/decision`, { method: 'PUT', body: JSON.stringify({ periodIndex: expectedPeriod, decision }) });
};
export const submitDecision = (token: string, expectedPeriod?: number) => {
  if (!token.startsWith('account:')) return request<void>('/player/submit', { method: 'POST', headers: playerHeaders(token) });
  if (!Number.isInteger(expectedPeriod) || expectedPeriod! < 0) return Promise.reject(new Error('Не указан текущий период. Обновите страницу.'));
  return accountRequest<void>(`${accountPath(token)}/submit`, { method: 'POST', body: JSON.stringify({ periodIndex: expectedPeriod }) });
};
export const getGameStatus = (token: string, id: string) => token.startsWith('account:') ? accountRequest<GameStatus>(`${accountPath(token)}/status`) : request<GameStatus>(`/games/${encodeURIComponent(id)}/status`, { headers: playerHeaders(token) });
