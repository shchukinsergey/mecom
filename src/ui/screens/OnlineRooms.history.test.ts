import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { OnlineRooms } from './OnlineRooms';

const state = vi.hoisted(() => ({ index: 0 }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = state.index++;
      if (index >= 22) return actual.useState(initial);
      const overrides: Record<number, unknown> = {
        0: { id: 'own-user', login: 'test_user' }, 1: false, 5: 'test-room',
        8: { id: 'test-room', name: 'Test room', ownFirmId: 'own-firm', firms: [], isOwner: false, phase: 'collecting', currentPeriodIndex: 4 },
        21: true,
      };
      return [Object.hasOwn(overrides, index) ? overrides[index] : typeof initial === 'function' ? initial() : initial, vi.fn()];
    },
  };
});

afterEach(() => vi.unstubAllGlobals());

test('opening the player cabinet replaces room management rather than appending below it', () => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/', search: '', hash: '#room/test-room' } });
  state.index = 0;
  const html = renderToStaticMarkup(createElement(OnlineRooms, { onLocal: () => {} }));
  expect(html).toContain('Кабинет участника');
  expect(html).toContain('player-cabinet');
  expect(html).toContain('Загружаем вашу компанию');
  expect(html).not.toContain('Игровые комнаты');
  expect(html.match(/<main /g)).toHaveLength(1);
});
