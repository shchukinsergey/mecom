import { afterEach, describe, expect, it, vi } from 'vitest';
import * as rooms from '../roomsApi';
import { getPlayerMe, getGameStatus, saveDecision, submitDecision } from '../api';
const fetchMock = vi.fn();
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });
function mockResponse(payload: unknown = {}) { vi.stubGlobal('fetch', fetchMock); fetchMock.mockImplementation(async () => new Response(JSON.stringify(payload), { status: 200 })); }
describe('account API', () => {
  it('routes account players to scoped cookie endpoints and carries the expected period', async () => {
    mockResponse();
    await getPlayerMe('account:room/a'); await getGameStatus('account:room/a', 'ignored');
    await saveDecision('account:room/a', { price: 12 }, 3); await submitDecision('account:room/a', 3);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/rooms/room%2Fa/me', '/api/rooms/room%2Fa/status', '/api/rooms/room%2Fa/decision', '/api/rooms/room%2Fa/submit']);
    for (const [, init] of fetchMock.mock.calls) { expect(init.credentials).toBe('same-origin'); expect(init.headers).not.toHaveProperty('X-MECOM-PLAYER'); expect(init.headers).not.toHaveProperty('Authorization'); }
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ periodIndex: 3, decision: { price: 12 } });
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ periodIndex: 3 });
  });
  it('refuses account writes without an expected period', async () => {
    mockResponse(); await expect(saveDecision('account:r', {})).rejects.toThrow('период'); await expect(submitDecision('account:r')).rejects.toThrow('период'); expect(fetchMock).not.toHaveBeenCalled();
  });
  it('keeps legacy player contracts unchanged', async () => {
    mockResponse(); await saveDecision('legacy', { price: 8 }); await submitDecision('legacy');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/player/decision'); expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ price: 8 }); expect(fetchMock.mock.calls[0][1].headers['X-MECOM-PLAYER']).toBe('legacy'); expect(fetchMock.mock.calls[1][1].body).toBeUndefined();
  });
  it('blocks invalid or missing forced decisions and labels fallback sources', () => {
    const preview = { periodIndex: 1, canCalculate: false, canForce: true, firms: [{ firmId: 'f', firmName: 'Firm', submitted: false, source: 'draft' as const, valid: true }] };
    expect(rooms.canConfirmForce(preview)).toBe(true); expect(rooms.canConfirmForce({ ...preview, firms: [{ ...preview.firms[0], valid: false }] })).toBe(false); expect(rooms.canConfirmForce({ ...preview, firms: [{ ...preview.firms[0], source: 'missing' }] })).toBe(false); expect(rooms.forceSourceLabels.previous).toContain('предыдущего'); expect(rooms.forceSourceLabels.draft).toContain('черновик');
  });
  it('sends room operations with explicit scope, payloads and force flag', async () => {
    mockResponse({ rooms: [], user: { id: 'u', login: 'a' } });
    await rooms.register('a', 'password'); await rooms.getAccount(); await rooms.logout(); await rooms.listRooms('mine'); await rooms.createRoom({ name: 'Room', visibility: 'link' }); await rooms.getRoom('r/a'); await rooms.joinRoom('r/a', 'Firm'); await rooms.startRoom('r/a'); await rooms.closeRoom('r/a'); await rooms.getCalculatePreview('r/a'); await rooms.calculateRoom('r/a', 4); await rooms.calculateRoom('r/a', 4, true);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['/api/auth/register', '/api/auth/me', '/api/auth/logout', '/api/rooms?scope=mine', '/api/rooms', '/api/rooms/r%2Fa', '/api/rooms/r%2Fa/join', '/api/rooms/r%2Fa/start', '/api/rooms/r%2Fa/close', '/api/rooms/r%2Fa/calculate-preview', '/api/rooms/r%2Fa/calculate', '/api/rooms/r%2Fa/calculate']);
    expect(JSON.parse(fetchMock.mock.calls[4][1].body)).toEqual({ name: 'Room', visibility: 'link' }); expect(JSON.parse(fetchMock.mock.calls[6][1].body)).toEqual({ firmName: 'Firm' }); expect(JSON.parse(fetchMock.mock.calls[10][1].body)).toEqual({ periodIndex: 4, force: false }); expect(JSON.parse(fetchMock.mock.calls[11][1].body)).toEqual({ periodIndex: 4, force: true });
  });
  it('preserves 401 status so the UI can clear identity', async () => {
    vi.stubGlobal('fetch', fetchMock); fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Войдите снова' }), { status: 401 })); await expect(rooms.getAccount()).rejects.toMatchObject({ status: 401, message: 'Войдите снова' });
  });
  it('reports network failures without exposing credentials', async () => {
    vi.stubGlobal('fetch', fetchMock); fetchMock.mockRejectedValue(new Error('secret')); await expect(rooms.login('a', 'password')).rejects.toThrow('Сервер недоступен');
  });
  it('uses same-origin cookies for login without legacy headers', async () => {
    mockResponse({ user: { id: 'u', login: 'Alice' } });
    expect(await rooms.login('Alice', 'password123')).toEqual({ id: 'u', login: 'Alice' });
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe('/api/auth/login'); expect(init.credentials).toBe('same-origin');
    expect(JSON.parse(init.body)).toEqual({ login: 'Alice', password: 'password123' });
    expect(init.headers).not.toHaveProperty('Authorization'); expect(init.headers).not.toHaveProperty('X-MECOM-PLAYER');
  });
});
