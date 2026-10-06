import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.hoisted(() => { vi.stubGlobal('localStorage', undefined); });
vi.mock('../../state/leagueStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/leagueStore')>();
  return { ...actual, useCurrentSnapshot: () => {
    const state = actual.useLeagueStore.getState();
    return state.currentLeagueId ? state.leagues[state.currentLeagueId] : null;
  } };
});
import { useLeagueStore } from '../../state/leagueStore';
import { LeagueSetup } from '../screens/LeagueSetup';
import { PeriodScreen } from '../screens/PeriodScreen';

describe('native demand configuration controls', () => {
  it('faithfully displays an imported pre-revenue financing mode without calling legacy official', () => {
    const id = useLeagueStore.getState().createLeague('Financing controls', ['A', 'B']);
    useLeagueStore.getState().openLeague(id);
    useLeagueStore.getState().updateFeatureFlags({ loanRepayment: 'preRevenue' });
    const html = renderToStaticMarkup(createElement(LeagueSetup));
    expect(html).toContain('value="preRevenue" selected=""');
    expect(html).not.toContain('Не гасится (официальная');
    useLeagueStore.getState().deleteLeague(id);
  });

  it('displays depreciation using the engine book value and native dollar rounding', () => {
    const id = useLeagueStore.getState().createLeague('Book-value display', ['A', 'B']);
    useLeagueStore.getState().openLeague(id);
    const snapshot = useLeagueStore.getState().leagues[id];
    const firmId = snapshot.league.firms[0].id;
    const opening = { ...snapshot.opening,
      [firmId]: { ...snapshot.opening[firmId], machines: 651, amortFundRemainder: 22 } };
    useLeagueStore.setState({ leagues: { ...useLeagueStore.getState().leagues,
      [id]: { ...snapshot, opening } } });
    const html = renderToStaticMarkup(createElement(PeriodScreen));
    // Native 26062/20 rounds to 1303; the duplicated machine-only formula shows 1302.
    expect(html).toContain('Амортизация за период: $ 1,303');
    expect(html).not.toContain('Амортизация за период: $ 1,302');
    useLeagueStore.getState().deleteLeague(id);
  });

  it('shows active native parameters and hides retired curve/decay controls', () => {
    const id = useLeagueStore.getState().createLeague('Native controls', ['A', 'B']);
    useLeagueStore.getState().openLeague(id);
    const html = renderToStaticMarkup(createElement(LeagueSetup));
    expect(html).toContain('Порог цены');
    expect(html).toContain('Масштаб спроса');
    expect(html).not.toContain('D(P):');
    expect(html).not.toContain('масштаб забывания');
    expect(html).not.toContain('λ ценового индекса');
    useLeagueStore.getState().deleteLeague(id);
  });
});
