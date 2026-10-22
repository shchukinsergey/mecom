import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
import { OnlineRooms } from './OnlineRooms';

const state = vi.hoisted(() => ({ index: 0, overrides: {} as Record<number, unknown> }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const index = state.index++;
      if (index >= 28) return actual.useState(initial);
      const overrides: Record<number, unknown> = {
        0: { id: 'own-user', login: 'test_user' }, 1: false, 5: 'test-room',
        8: { id: 'test-room', name: 'Test room', ownFirmId: 'own-firm', firms: [], isOwner: false, phase: 'collecting', currentPeriodIndex: 4 },
        21: true,
        ...state.overrides,
      };
      return [Object.hasOwn(overrides, index) ? overrides[index] : typeof initial === 'function' ? initial() : initial, vi.fn()];
    },
  };
});

afterEach(() => { vi.unstubAllGlobals(); state.overrides = {}; });

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

function roomMarkup(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/', search: '', hash: '#room/test-room' } });
  state.index = 0;
  state.overrides = { 21: false, 8: {
    id: 'test-room', name: 'Bots room', ownerLogin: 'Owner', isOwner: true,
    ownFirmId: null, playerCount: 2, activeFirmCount: 2, submittedCount: 0,
    phase: 'lobby', currentPeriodIndex: 0, timerMode: 'unlimited', deadlineAt: null,
    visibility: 'public', firms: [
      { firmId: 'bot1', firmName: 'Бот', isBot: true, submitted: false, currentRif: null },
      { firmId: 'bot2', firmName: 'Бот 2', isBot: true, submitted: false, currentRif: null },
    ], ...overrides,
  } };
  return renderToStaticMarkup(createElement(OnlineRooms, { onLocal: () => {} }));
}

test('the owner can add more bots in a created lobby and see their separate firms', () => {
  const html = roomMarkup();
  expect(html).toContain('Добавить бота</button>');
  expect(html).toContain('Бот 2');
  expect(html.match(/class="badge">БОТ/g)).toHaveLength(2);
});

test('adding bots is hidden for visitors and after the game starts', () => {
  expect(roomMarkup({ isOwner: false })).not.toContain('Добавить бота</button>');
  expect(roomMarkup({ phase: 'collecting', currentPeriodIndex: 1, submittedCount: 2 })).not.toContain('Добавить бота</button>');
});

test('the add-bot button is disabled at the shared firm limit', () => {
  expect(roomMarkup({ playerCount: 12 })).toMatch(/<button[^>]*disabled=""[^>]*>Добавить бота<\/button>/);
});

test('the room creation form no longer offers a bot toggle', () => {
  vi.stubGlobal('window', { location: { origin: 'http://localhost', pathname: '/', search: '', hash: '#rooms' } });
  state.index = 0;
  state.overrides = { 5: null, 8: null, 21: false, 24: true };
  const html = renderToStaticMarkup(createElement(OnlineRooms, { onLocal: () => {} }));
  expect(html).toContain('id="create-title"');
  expect(html).not.toContain('Добавить бота');
  expect(html).not.toContain('Бот добавлен');
});
