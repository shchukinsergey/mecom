import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlayerMe, GameStatus } from '../../online/api';
import type { FirmPeriodResult } from '../../engine/types';
import type { PublicHistoryPeriod } from '../../online/roomTypes';
import { DEFAULT_LEAGUE_CONFIG } from '../../engine/config';
import { PlayerMarket } from './PlayerMarket';
import { PlayerOverview } from './PlayerOverview';
import { PlayerReports } from './PlayerReports';

const me: PlayerMe = { gameId: 'game', firmId: 'mine', firmName: 'Моя компания', phase: 'collecting', currentPeriodIndex: 3, submitted: false };
const publicFirm = (firmId: string, firmName: string, rif: number): PublicHistoryPeriod['firms'][number] => ({ firmId, firmName, rif, netProfit: 100, marketShareSold: 25, revenue: 1000, retainedEarnings: 200 });
const history: PublicHistoryPeriod[] = [
  { periodIndex: 1, firms: [publicFirm('mine', 'Моя компания', 10), publicFirm('rival', 'Конкурент', 20), publicFirm('gone', 'Бывшая команда', 30)] },
  { periodIndex: 2, firms: [publicFirm('mine', 'Моя компания', 30), publicFirm('rival', 'Конкурент', 30), publicFirm('third', 'Третья компания', 10)] },
];
const status: GameStatus = { gameId: 'game', phase: 'collecting', currentPeriodIndex: 3, history, firms: [
  { firmId: 'mine', firmName: 'Моя компания', submitted: false },
  { firmId: 'rival', firmName: 'Конкурент', submitted: true },
  { firmId: 'third', firmName: 'Третья компания', submitted: false },
] };
const table = (html: string) => html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? '';

// Explicit own-company figures: no casted empty decisions/results or invented server responses.
const result = (overrides: Partial<FirmPeriodResult> = {}): FirmPeriodResult => ({
  firmId: 'mine', firmName: 'Моя компания', periodIndex: 2,
  decision: { firmId: 'mine', price: 20, production: 80, marketing: 20, capexGross: 200, rnd: 10 },
  ordersReceived: 90, produced: 80, sold: 80, unfulfilledOrders: 10, inventoryEnd: 0,
  marketShareSold: 25, unitCost: 10, inventoryUnitCostEnd: 10, fullCapacity: 100,
  capexAdditions: 0, newMachines: 0, capacityNextPeriod: 100, capacityUtilization: 0.8,
  employed: 1, revenue: 1600, cogs: 800, grossProfit: 800, marketingExpense: 20,
  rndExpense: 10, depreciation: 200, firingPenalty: 0, storageCost: 0, bankInterest: 0,
  profitBeforeTax: 570, tax: 182.4, netProfit: 387.6, cash: 1387.6, inventoryValue: 0,
  capexBookValue: 4000, totalAssets: 5387.6, loan: 0, retainedEarnings: 387.6, capital: 5000,
  totalLiabEquity: 5387.6, newBorrowing: 0, amortFundRemainder: 0, rndCumulative: 10,
  rndDecayStock: 0, isBankrupt: false, unfundedShortfall: 0,
  rif: { retainedProfitScore: 0, demandPotential: 0, supplyPotential: 0, efficiency80: 9.88, marketShareScore: 25, growthScore: 0, total: 30 },
  ...overrides,
});

// Own fixtures are shared across the view behavior tests.

describe('PlayerOverview', () => {
  it('renders loss and utilization observations only when actual own results justify them', () => {
    const current = result({ unfulfilledOrders: 0, netProfit: -125.55, produced: 90, capacityUtilization: 0.9 });
    const html = renderToStaticMarkup(<PlayerOverview me={{ ...me, recentResults: [current] }} status={status} onDecisions={() => {}} />);
    expect(html).toContain('Убыток за период');
    expect(html).toContain('-125,55 $');
    expect(html).toContain('Загрузка и себестоимость');
    expect(html).toContain('90,0%');
    const customized = renderToStaticMarkup(<PlayerOverview me={{ ...me, recentResults: [current], config: { ...DEFAULT_LEAGUE_CONFIG, costOptimalCu: 90 } }} status={status} onDecisions={() => {}} />);
    expect(customized).toContain('Убыток за период');
    expect(customized).not.toContain('Загрузка и себестоимость');
  });
  it.each([
    [0, 0, 'Все заказы выполнены, склад пуст'],
    [10, 0, 'Спрос удовлетворён не полностью'],
    [0, 12, 'Часть товаров осталась на складе'],
    [10, 12, 'Есть невыполненные заказы и остаток'],
  ])('shows both orders (%s) and inventory (%s), including zero and independent deltas', (unfulfilledOrders, inventoryEnd, copy) => {
    const html = renderToStaticMarkup(<PlayerOverview me={{ ...me, recentResults: [result({ unfulfilledOrders, inventoryEnd }), result({ periodIndex: 1, unfulfilledOrders: 5, inventoryEnd: 4 })] }} status={status} onDecisions={() => {}} />);
    const sales = html.match(/<div class="pc-kpi pc-sales-balance"[\s\S]*?<\/div><\/div><p[\s\S]*?<\/p><\/div>/)?.[0] ?? '';
    expect(sales).toContain('Заказы и склад');
    expect(sales).toContain('Невыполненные заказы');
    expect(sales).toContain('На складе');
    expect(sales).toContain(`${unfulfilledOrders} шт.`);
    expect(sales).toContain(`${inventoryEnd} шт.`);
    expect(sales).toContain(copy);
    expect(sales).toContain(`${unfulfilledOrders - 5 > 0 ? '+' : ''}${unfulfilledOrders - 5} шт. к прошлому периоду`);
    expect(sales).toContain(`${inventoryEnd - 4 > 0 ? '+' : ''}${inventoryEnd - 4} шт. к прошлому периоду`);
    expect(html.indexOf('pc-kpis')).toBeLessThan(html.indexOf('pc-attention'));
    expect(html.indexOf('pc-attention')).toBeLessThan(html.indexOf('competition-history'));
    expect(html).toContain('↑2');
  });
  it('uses only own results, preserves money precision and does not compare across gaps', () => {
    const html = renderToStaticMarkup(<PlayerOverview me={{ ...me, recentResults: [result({ cash: 1387.62, netProfit: -17.45 }), result({ periodIndex: 0 }), result({ firmId: 'other', periodIndex: 99, cash: 987654.32 })] }} status={status} onDecisions={() => {}} />);
    expect(html).toContain('1 387,62 $');
    expect(html).toContain('-17,45 $');
    expect(html).not.toContain('987');
    expect(html.split('pc-attention')[0]).toContain('Нет сравнения');
    expect(html).toContain('Возможно, стоит');
    expect(html).toContain('pc-attention-warning');
  });
  it('handles lobby, missing macro and closed phase without fabricated metrics', () => {
    const lobby = renderToStaticMarkup(<PlayerOverview me={{ ...me, phase: 'lobby' }} status={null} onDecisions={() => {}} />);
    expect(lobby).toContain('Ожидаем начала игры');
    expect(lobby).toContain('Показатели появятся после расчёта');
    expect(lobby).toContain('Условия периода недоступны');
    expect(lobby).not.toContain('pc-attention-warning');
    const closed = renderToStaticMarkup(<PlayerOverview me={{ ...me, phase: 'closed', submitted: true }} status={null} onDecisions={() => {}} />);
    expect(closed).toContain('Игра закрыта');
    expect(closed).toContain('Решения больше не принимаются');
    expect(closed).not.toContain('Подготовьте выпуск');
  });
});

describe('PlayerReports', () => {
  const original = 'Компания: Моя компания\nДата: 2026-10-01\n  ПРЕДУПРЕЖДЕНИЕ: кредит\n\nОТРАСЛЬ\nПолный отраслевой блок\n';
  it('shows only the complete original report with the industry block, even for recent periods', () => {
    const html = renderToStaticMarkup(<PlayerReports me={{ ...me, recentResults: [result(), result({ periodIndex: 1, marketShareSold: 20 })], reports: [{ periodIndex: 2, report: original }, { periodIndex: 0, report: 'Старый отчёт' }] }} selectedPeriod={2} onSelect={() => {}} />);
    expect(html).toContain(original);
    expect(html).not.toContain('<table');
    expect(html).not.toContain('hidden=""');
    expect(html).not.toContain('Вид отчёта');
    expect(html).not.toContain('Таблицы');
    expect(html).not.toContain('pc-report-section');
    expect((html.match(/<option\b/g) ?? [])).toHaveLength(2);
    expect(html.indexOf('value="2"')).toBeLessThan(html.indexOf('value="0"'));
  });
  it('shows older periods as their exact text, with no invented structured values', () => {
    const old = 'СТАРЫЙ ОТЧЁТ\n   1  2  3\n';
    const html = renderToStaticMarkup(<PlayerReports me={{ ...me, recentResults: [result()], reports: [{ periodIndex: 0, report: old }, { periodIndex: 2, report: original }] }} selectedPeriod={0} onSelect={() => {}} />);
    expect(html).toContain(old);
    expect(html).not.toContain('pc-report-section');
    expect(html).not.toContain('387,6');
    expect(html).not.toContain('hidden=""');
    expect(html).toContain('value="0" selected=""');
  });
  it('does not use another company result or create comparisons over period gaps', () => {
    const html = renderToStaticMarkup(<PlayerReports me={{ ...me, recentResults: [result(), result({ periodIndex: 0 }), result({ firmId: 'other', periodIndex: 99, cash: 987654.32 })], reports: [{ periodIndex: 2, report: original }] }} selectedPeriod={null} onSelect={() => {}} />);
    expect(html).not.toContain('987');
    expect(html).not.toContain('Период 99');
    expect(html).not.toContain('<th scope="col" class="pc-numeric">Изменение');
    expect(html).not.toContain('Изменение');
  });
  it('preserves an unindexed legacy report and handles missing report text honestly', () => {
    const legacy = renderToStaticMarkup(<PlayerReports me={{ ...me, report: original }} selectedPeriod={null} onSelect={() => {}} />);
    expect(legacy).toContain(original);
    expect(legacy).not.toContain('pc-report-section');
    const missing = renderToStaticMarkup(<PlayerReports me={{ ...me, recentResults: [result()] }} selectedPeriod={2} onSelect={() => {}} />);
    expect(missing).toContain('Отчёты появятся после расчёта периода');
    expect(missing).not.toContain('pc-report-section');
    const empty = renderToStaticMarkup(<PlayerReports me={me} selectedPeriod={null} onSelect={() => {}} />);
    expect(empty).toContain('Отчёты появятся после расчёта периода');
  });
});

describe('PlayerMarket', () => {
  it('ranks ties correctly, shows adjacent position changes and only public figures', () => {
    const html = renderToStaticMarkup(<PlayerMarket me={{ ...me, recentResults: [result({ cash: 987654.32 })] }} status={status} />);
    const ranking = table(html);
    expect((ranking.match(/<th scope="col"/g) ?? [])).toHaveLength(4);
    expect(ranking).toContain('Решение');
    expect(ranking).toContain('↑2');
    expect(ranking).toContain('↑1');
    expect(ranking).toContain('>3</span>');
    expect(ranking).toContain('Отправлено');
    expect(ranking).toContain('Не отправлено');
    expect(html).not.toContain('987');
    expect(html).toContain('периода 3');
    expect(html).toContain('Бывшая команда');
    expect(html).not.toContain('competition-history');
  });
  it('does not fabricate a rank delta across missing periods and preserves removed teams', () => {
    const html = renderToStaticMarkup(<PlayerMarket me={me} status={{ ...status, firms: [], history: [history[0], { ...history[1], periodIndex: 4 }] }} />);
    expect(table(html)).not.toContain('pc-rank-change');
    expect(table(html)).toContain('Нет данных');
    expect(html).toContain('Бывшая команда');
  });
  it('shows the lobby roster without fabricating calculated RIF or ranks', () => {
    const html = renderToStaticMarkup(<PlayerMarket me={{ ...me, phase: 'lobby' }} status={{ ...status, phase: 'lobby', history: [] }} />);
    expect(table(html)).toContain('Моя компания');
    expect(html).toContain('Рейтинг появится после расчёта периода');
    expect(table(html)).not.toContain('↑');
    expect(renderToStaticMarkup(<PlayerMarket me={me} status={null} />)).toContain('Данные рынка пока недоступны');
  });
});
