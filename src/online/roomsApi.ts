import type { AccountUser, CalculatePreview, CreateRoomInput, RoomDetail, RoomSummary } from './roomTypes';
import type { ApiError } from './api';

export async function accountRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } }); }
  catch (error) { if (init.signal?.aborted) throw error; throw new Error('Сервер недоступен. Проверьте подключение и попробуйте снова.'); }
  if (!response.ok) {
    let message = response.status === 401 ? 'Войдите в аккаунт снова.' : `Ошибка сервера (${response.status}).`;
    try { const data = await response.json(); if (typeof data.error === 'string') message = data.error; } catch { /* fallback */ }
    const error = new Error(message) as ApiError; error.status = response.status; throw error;
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
const post = <T>(path: string, body: unknown = {}) => accountRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const login = async (login: string, password: string) => (await post<{ user: AccountUser }>('/auth/login', { login, password })).user;
export const register = async (login: string, password: string) => (await post<{ user: AccountUser }>('/auth/register', { login, password })).user;
export const getAccount = async (signal?: AbortSignal) => (await accountRequest<{ user: AccountUser }>('/auth/me', { signal })).user;
export const logout = () => post<{ ok: true }>('/auth/logout');
export const listRooms = async (scope: 'open' | 'mine', signal?: AbortSignal) => (await accountRequest<{ rooms: RoomSummary[] }>(`/rooms?scope=${scope}`, { signal })).rooms;
export const createRoom = (input: CreateRoomInput) => post<RoomDetail>('/rooms', input);
const roomPath = (id: string) => `/rooms/${encodeURIComponent(id)}`;
export const getRoom = (id: string, signal?: AbortSignal) => accountRequest<RoomDetail>(roomPath(id), { signal });
export const joinRoom = (id: string, firmName: string) => post<RoomDetail>(`${roomPath(id)}/join`, { firmName });
export const startRoom = (id: string) => post<RoomDetail>(`${roomPath(id)}/start`);
export const closeRoom = (id: string) => post<RoomDetail>(`${roomPath(id)}/close`);
export const getCalculatePreview = (id: string) => accountRequest<CalculatePreview>(`${roomPath(id)}/calculate-preview`);
export const calculateRoom = (id: string, periodIndex: number, force = false) => post<RoomDetail>(`${roomPath(id)}/calculate`, { periodIndex, force });
export const forceSourceLabels: Record<CalculatePreview['firms'][number]['source'], string> = { submitted: 'Отправленное решение', draft: 'Сохранённый черновик', previous: 'Решение предыдущего периода', missing: 'Решение отсутствует' };
export const canConfirmForce = (preview: CalculatePreview) => preview.canForce && preview.firms.every(firm => firm.valid && firm.source !== 'missing');
