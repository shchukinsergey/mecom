import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { FirmPeriodResult } from '../../engine/types';
import type { PlayerInsight } from '../../online/playerInsights';
import { OnlinePeriodSummary } from './OnlinePeriodSummary';

const result = {
  periodIndex: 2,
  ordersReceived: 120,
  sold: 100,
  unfulfilledOrders: 20,
  inventoryEnd: 15,
  netProfit: 2500,
  cash: 7000,
  loan: 9000,
  fullCapacity: 200,
  capacityNextPeriod: 220,
  decision: { price: 30 },
  unitCost: 22,
} as FirmPeriodResult;

const insights: PlayerInsight[] = [{
  kind: 'unfulfilled-orders',
  text: 'Невыполненных заказов: 20 шт.',
  value: 20,
}];

describe('OnlinePeriodSummary', () => {
  it('uses original report labels and clearly separates current and next-period capacity', () => {
    const html = renderToStaticMarkup(createElement(OnlinePeriodSummary, { result, insights }));
    for (const label of ['Получено заказов', 'Продано', 'Невыполненных заказов', 'На складе', 'Чистая прибыль', 'Наличные средства', 'Займы', 'Цена', 'Полная мощность', 'Мощность след. период']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('200 шт.');
    expect(html).toContain('220 шт.');
    expect(html).toContain('Невыполненных заказов: 20 шт.');
  });

  it('does not render an insights section when there are no observations', () => {
    const html = renderToStaticMarkup(createElement(OnlinePeriodSummary, { result, insights: [] }));
    expect(html).not.toContain('Наблюдения по периоду');
  });
});