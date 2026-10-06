import { afterEach, expect, it, vi } from 'vitest';
// SSR reads Zustand's initial snapshot; expose the live store to this rendering test.
// No browser persistence in this rendering-only test (Node's experimental getter warns).
vi.hoisted(() => Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined }));
vi.mock('../../state/leagueStore', async importOriginal => {
  const actual = await importOriginal<typeof import('../../state/leagueStore')>();
  return { ...actual,
    useCurrentSnapshot: () => {
      const state = actual.useLeagueStore.getState();
      return state.currentLeagueId ? state.leagues[state.currentLeagueId] : null;
    },
  };
});
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LeagueSetup } from '../screens/LeagueSetup';
import { useLeagueStore } from '../../state/leagueStore';
const original = useLeagueStore.getState();
afterEach(() => useLeagueStore.setState(original));
it('new leagues expose native staffing divisor and hide archived linear controls', () => {
  useLeagueStore.getState().createLeague('Native', ['A', 'B']);
  const html = renderToStaticMarkup(createElement(LeagueSetup));
  expect(html).toContain('Модель занятости');
  expect(html).toContain('Занятость: делитель размера выпуска');
  expect(html).not.toContain('Занятость: постоянный штат');
  expect(html).not.toContain('Занятость: человек на ед. выпуска');
});
it('legacy mode exposes only linear staffing controls', () => {
  useLeagueStore.getState().createLeague('Legacy', ['A', 'B']);
  useLeagueStore.getState().updateLeagueConfig({ employmentModel: 'legacy' });
  const html = renderToStaticMarkup(createElement(LeagueSetup));
  expect(html).toContain('Занятость: постоянный штат');
  expect(html).toContain('Занятость: человек на ед. выпуска');
  expect(html).not.toContain('Занятость: делитель размера выпуска');
});
