import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicHistoryPeriod } from '../../online/roomTypes';
import { CompetitionHistoryChart, buildHistoryChartModel, formatHistoryValue } from './CompetitionHistoryChart';

const firm = (firmId: string, rif: number) => ({ firmId, firmName: firmId === 'mine' ? 'Север' : 'Юг', rif, netProfit: -120, marketShareSold: 25, revenue: 400, retainedEarnings: -40 });
const history: PublicHistoryPeriod[] = [
  { periodIndex: 0, firms: [firm('mine', 10), firm('other', 20)] },
  { periodIndex: 1, firms: [firm('mine', 30), firm('other', 30)] },
];
const render = (data: PublicHistoryPeriod[] = history) => renderToStaticMarkup(createElement(CompetitionHistoryChart, { history: data, ownFirmId: 'mine' }));

describe('CompetitionHistoryChart', () => {
  it.each([0, 1, 107, NaN])('keeps chart geometry positive while a hidden tab reports width %s', width => {
    const model = buildHistoryChartModel(history, 'rif', 'mine', width);
    expect(Number.isFinite(model.x(0))).toBe(true);
    expect(Number.isFinite(model.x(1))).toBe(true);
    expect(model.x(1)).toBeGreaterThan(model.x(0));
  });
  it('assigns distinct colors even when firm ID hashes collide', () => {
    const data = [{ periodIndex: 0, firms: [firm('a', 10), firm('i', 20), firm('q', 30)] }];
    const model = buildHistoryChartModel(data, 'rif', 'a');
    expect(new Set(model.series.map(series => series.color)).size).toBe(3);
  });
  it('renders real completed history, all teams, metric controls and own tied rank', () => {
    const html = render();
    expect(html).toContain('<svg');
    expect(html).toContain('Как идёт игра');
    for (const label of ['РИФ', 'Чистая прибыль', 'Доля рынка', 'Выручка', 'Накопленная прибыль', 'Север', 'Юг', 'Вы']) expect(html).toContain(label);
    expect(html).toContain('Период 0');
    expect(html).toContain('Период 1');
    expect(html).not.toContain('Период 2');
    expect(html).toContain('1 из 2');
    expect(html).toContain('+20,0');
    expect(html).toContain('30,0');
  });
  it('keeps all firms, stable colors and breaks paths over absent or nonfinite results', () => {
    const data: PublicHistoryPeriod[] = [history[0], { periodIndex: 1, firms: [firm('other', 20)] }, { periodIndex: 2, firms: [firm('mine', 40), firm('other', NaN)] }, { periodIndex: 4, firms: [firm('mine', 50)] }];
    const model = buildHistoryChartModel(data, 'rif', 'mine');
    expect(model.periods.map(p => p.periodIndex)).toEqual([0, 1, 2, 4]);
    expect(model.series).toHaveLength(2);
    expect(model.series.find(s => s.firmId === 'mine')!.path.match(/M/g)).toHaveLength(3);
    expect(model.series.find(s => s.firmId === 'other')!.points).toHaveLength(2);
    expect(model.series.map(s => s.color)).toEqual(buildHistoryChartModel(data.slice().reverse(), 'netProfit', 'mine').series.map(s => s.color));
    expect(render(data)).not.toMatch(/NaN|Infinity/);
  });
  it('calculates competition ranks, negative profit and percentage-point delta', () => {
    expect(buildHistoryChartModel(history, 'netProfit', 'mine').own).toMatchObject({ value: -120, rank: 1, total: 2, delta: 0 });
    const shareData = [history[0], { periodIndex: 1, firms: [{ ...firm('mine', 0), marketShareSold: 27.5 }] }];
    expect(buildHistoryChartModel(shareData, 'marketShareSold', 'mine').own?.delta).toBe(2.5);
    expect(formatHistoryValue(2.5, 'marketShareSold', true)).toBe('+2,5 п.п.');
    expect(formatHistoryValue(-120, 'netProfit')).toContain('-120');
    expect(formatHistoryValue(Infinity, 'rif')).toBe('Нет данных');
    expect(buildHistoryChartModel(history, 'rif', 'absent').own).toBeNull();
    expect(buildHistoryChartModel([history[0], { periodIndex: 3, firms: history[1].firms }], 'rif', 'mine').own?.delta).toBeNull();
  });
  it('pads single and equal ranges and excludes nonfinite values from rank and geometry', () => {
    for (const data of [[], [history[0]], [{ periodIndex: 0, firms: [firm('mine', 0), firm('other', 0)] }], [{ periodIndex: 0, firms: [firm('mine', NaN), firm('other', Infinity)] }]]) {
      const model = buildHistoryChartModel(data, 'rif', 'mine');
      expect(model.max).toBeGreaterThan(model.min);
      expect(Number.isFinite(model.min)).toBe(true);
      expect(render(data)).not.toMatch(/NaN|Infinity/);
    }
    expect(render([])).toContain('Пока нет рассчитанных периодов');
    expect(buildHistoryChartModel([history[0]], 'rif', 'mine').own?.delta).toBeNull();
  });
  it('makes every period keyboard accessible with all public values and a data table', () => {
    const html = render();
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('Показать значения за период 0');
    expect(html).toContain('<table');
    expect(html).toContain('История результатов: РИФ');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-firm-id="mine"');
    expect(html).toContain('stroke-width="4"');
  });
});
