import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PeriodScreen } from '../screens/PeriodScreen';
import { useLeagueStore, ensurePeriodSlots } from '../../state/leagueStore';
import { DEFAULT_LEAGUE_CONFIG, makeFirmStart } from '../../engine/config';
import { initialOpeningState } from '../../engine/computePeriod';
import type { League } from '../../engine/types';

// This node test uses no browser storage; avoid Node's experimental getter.
vi.hoisted(() => { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined }); });

// SSR has no subscription; feed the real store's current snapshot to selectors.
vi.mock('../../state/leagueStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../state/leagueStore')>();
  const hook = Object.assign((selector: (state: ReturnType<typeof actual.useLeagueStore.getState>) => unknown) =>
    selector(actual.useLeagueStore.getState()), actual.useLeagueStore);
  return { ...actual, useLeagueStore: hook, useCurrentSnapshot: () => {
    const s = actual.useLeagueStore.getState();
    return s.currentLeagueId ? s.leagues[s.currentLeagueId] : null;
  } };
});

const originalStore = useLeagueStore.getState();
afterEach(() => { useLeagueStore.setState(originalStore); vi.restoreAllMocks(); });

function renderBudget(marketing = 15000): string {
  const league = ensurePeriodSlots({ id: 'ui-budget', name: 'Budget', createdAt: '',
    config: { ...DEFAULT_LEAGUE_CONFIG }, firms: [{ ...makeFirmStart(8), id: 'f', name: 'F' }],
    macroByPeriod: [], decisionsByPeriod: [], confirmedByPeriod: [], results: [] } as League);
  league.decisionsByPeriod[0].f = { firmId: 'f', price: 25, production: 420,
    marketing, capexGross: 24050, rnd: 1000 };
  const opening = initialOpeningState(league);
  Object.assign(opening.f, { machines: 1100, cash: 8216, loan: 44856, employees: 84 });
  useLeagueStore.setState({ currentLeagueId: league.id, leagues: { [league.id]: { league, opening } } });
  return renderToStaticMarkup(createElement(PeriodScreen));
}

it('renders native budget, depreciation credit, net investment, and cash/credit split without lower-bound claims', () => {
  const html = renderBudget();
  expect(html).toContain('Остаток бюджета ввода');
  expect(html).toContain('Амортизация (возврат в бюджет)');
  expect(html).toContain('Инвестиции (нетто)');
  expect(html).toContain('Остаток наличных');
  expect(html).toContain('Остаток кредита');
  expect(html).toContain('11,108');
  expect(html).not.toContain('нижняя граница');
  expect(html).not.toContain('Остаток средств (мин.)');
  expect(html).not.toContain('Штраф за увольнения:');
  expect(html).toContain('не гарантирует');
  expect(html).not.toMatch(/class="primary"[^>]*disabled/);
});

it('blocks calculation for native entry-budget deficit', () => {
  const html = renderBudget(100000);
  expect(html).toMatch(/class="primary"[^>]*disabled/);
  expect(html).toContain('Отрицательный бюджет ввода');
});

it('marks explicitly edited denominators custom so later reload cannot migrate them', () => {
  renderBudget();
  useLeagueStore.getState().updateLeagueConfig({ costCuUp: 145, costCuDown: 72.5 });
  const config = useLeagueStore.getState().leagues['ui-budget'].league.config;
  expect(config.costDenominatorsCustom).toBe(true);
  expect(config.costCuUp).toBe(145);
});
