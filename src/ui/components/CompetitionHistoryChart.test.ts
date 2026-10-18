import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PublicHistoryPeriod } from '../../online/roomTypes';
import { CompetitionHistoryChart, buildHistoryChartModel, formatHistoryValue, nearestHistoryPoint } from './CompetitionHistoryChart';

const firm = (firmId: string, rif: number) => ({ firmId, firmName: firmId === 'mine' ? 'Север' : 'Юг', rif, netProfit: -120, marketShareSold: 25, revenue: 400, retainedEarnings: -40 });
const history: PublicHistoryPeriod[] = [
  { periodIndex: 0, firms: [firm('mine', 10), firm('other', 20)] },
  { periodIndex: 1, firms: [firm('mine', 30), firm('other', 30)] },
];
const render = (data: PublicHistoryPeriod[] = history) => renderToStaticMarkup(createElement(CompetitionHistoryChart, { history: data, ownFirmId: 'mine' }));

describe('CompetitionHistoryChart', () => {
  it('ends an excluded firm line without plotting its cleared zeros or changing active rankings', () => {
    const data: PublicHistoryPeriod[] = [history[0], { periodIndex: 1,
      firms: [{ ...firm('mine', 0), excluded: true }, firm('other', -10)] }];
    const model = buildHistoryChartModel(data, 'rif', 'mine');
    expect(model.series.find(s => s.firmId === 'mine')!.points).toHaveLength(1);
    expect(model.own).toBeNull();
    expect(buildHistoryChartModel(data, 'rif', 'other').own).toMatchObject({ rank: 1, total: 1 });
    expect(render(data)).toContain('Исключена');
  });
  it('selects the closest point within 40 screen pixels, not just its tiny hit circle', () => {
    const points = [{ x: 100, y: 100, firmId: 'mine' }, { x: 100, y: 120, firmId: 'other' }];
    expect(nearestHistoryPoint(points, 72, 100)).toBe(points[0]);
    expect(nearestHistoryPoint(points, 72, 118)).toBe(points[1]);
    expect(nearestHistoryPoint(points, 60, 100)).toBe(points[0]);
    expect(nearestHistoryPoint(points, 59, 100)).toBeNull();
  });
  it('keeps ties deterministic and never selects absent or nonfinite points', () => {
    const points = [{ x: 100, y: 100 }, { x: 100, y: 100 }];
    expect(nearestHistoryPoint(points, 100, 100)).toBe(points[0]);
    expect(nearestHistoryPoint([], 100, 100)).toBeNull();
    expect(nearestHistoryPoint([{ x: NaN, y: 100 }], 100, 100)).toBeNull();
  });
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
  it('does not show a persistent all-company values panel or an idle tooltip', () => {
    const html = render();
    expect(html).not.toContain('competition-history__values');
    expect(html).not.toContain('role="tooltip"');
    expect(html).toContain('<details class="competition-history__table">');
  });
  it('creates no phantom point labels for missing or nonfinite public results', () => {
    const html = render([history[0], { periodIndex: 1, firms: [firm('other', NaN)] }, { periodIndex: 2, firms: [firm('other', 42)] }]);
    expect(html.match(/role="button"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="Юг · Период 2 · РИФ: 42,0"');
    expect(html).not.toMatch(/aria-label="(?:Север|Юг) · Период 1/);
    expect(html).not.toContain('aria-label="Север · Период 2');
    expect(html).not.toMatch(/NaN|Infinity/);
  });
  it('makes individual public points keyboard accessible with company, period and metric labels', () => {
    const html = render();
    expect(html.match(/role="button"/g)).toHaveLength(4);
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('min-width:240px');
    expect(html).toContain('aria-label="Север · Период 0 · РИФ: 10,0"');
    expect(html).toContain('aria-label="Юг · Период 1 · РИФ: 30,0"');
    expect(html).not.toContain('<rect');
    expect(html).not.toContain('Показать значения за период');
    expect(html).toContain('<table');
    expect(html).toContain('История результатов: РИФ');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-firm-id="mine"');
    expect(html).toContain('stroke-width="4"');
  });
});
