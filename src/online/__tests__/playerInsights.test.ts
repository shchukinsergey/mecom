import { describe, expect, it } from 'vitest';
import type { FirmPeriodResult } from '../../engine/types';
import { getPlayerInsights } from '../playerInsights';

const result = (overrides: Partial<FirmPeriodResult> = {}): FirmPeriodResult => ({
  firmId: 'private-firm', firmName: 'Private Firm', periodIndex: 2,
  decision: {} as FirmPeriodResult['decision'],
  ordersReceived: 100, produced: 100, sold: 100, unfulfilledOrders: 0, inventoryEnd: 0,
  marketShareSold: 0, unitCost: 10, inventoryUnitCostEnd: 10, fullCapacity: 100,
  capexAdditions: 0, newMachines: 0, capacityNextPeriod: 100, capacityUtilization: 0.8,
  employed: 0, revenue: 1000, cogs: 1000, grossProfit: 0, marketingExpense: 0,
  rndExpense: 0, depreciation: 0, firingPenalty: 0, storageCost: 0, bankInterest: 0,
  profitBeforeTax: 0, tax: 0, netProfit: 0, cash: 0, inventoryValue: 0,
  capexBookValue: 0, totalAssets: 0, loan: 0, retainedEarnings: 0, capital: 0,
  totalLiabEquity: 0, newBorrowing: 0, amortFundRemainder: 0, rndCumulative: 0,
  rndDecayStock: 0, isBankrupt: false, unfundedShortfall: 0, rif: {} as FirmPeriodResult['rif'],
  ...overrides,
});

describe('getPlayerInsights', () => {
  it('uses the actual league cost optimum rather than warning about textbook defaults', () => {
    const current = result({ produced: 85, capacityUtilization: 0.85 });
    expect(getPlayerInsights(current, null, 90)).toEqual([]);
    expect(getPlayerInsights(current, null, 75)[0].text).toContain('при 75%');
  });
  it('does not round a small real loss down to a misleading zero-dollar loss', () => {
    expect(getPlayerInsights(result({ netProfit: -0.01 }), null)[0].text).toContain('-0,01 $');
  });
  it('reports a current net loss with its actual value and a cautious expense check', () => {
    const insights = getPlayerInsights(result({ netProfit: -125 }), null);
    expect(insights).toEqual([{
      kind: 'net-loss', value: -125,
      text: '⚠️ Чистая прибыль за период отрицательная: -125 $. Возможно, стоит сопоставить выручку, себестоимость продаж и прочие расходы в отчёте компании.',
    }]);
  });

  it('reports actual production and utilization above the workbook cost optimum without prescribing a cut', () => {
    expect(getPlayerInsights(result({ produced: 85, capacityUtilization: 0.85 }), null)).toEqual([{
      kind: 'above-economical-utilization', value: 0.85,
      text: '⚠️ Загрузка мощности — 85,0% при выпуске 85 шт.; минимум себестоимости единицы — при 80%. Возможно, стоит сопоставить пользу дополнительного выпуска со спросом и ростом себестоимости единицы.',
    }]);
  });

  it.each([0, 1, NaN, Infinity, -Infinity, undefined, null])('does not invent a loss for netProfit %s', netProfit => {
    expect(getPlayerInsights(result({ netProfit: netProfit as number }), null)).toEqual([]);
  });

  it('does not carry a previous loss or previous high utilization into current observations', () => {
    expect(getPlayerInsights(result(), result({ netProfit: -125, capacityUtilization: 0.9 }))).toEqual([]);
  });

  it.each([0, 0.79, 0.8, 0.80001, NaN, Infinity, -Infinity, undefined, null])('does not flag missing or displayed-at-most-80.0%% utilization %s', capacityUtilization => {
    expect(getPlayerInsights(result({ capacityUtilization: capacityUtilization as number }), null)).toEqual([]);
  });

  it.each([0, -1, NaN, Infinity, -Infinity, undefined, null])('requires finite positive production, not %s', produced => {
    expect(getPlayerInsights(result({ produced: produced as number, capacityUtilization: 0.9 }), null)).toEqual([]);
  });

  it('shows a one-decimal utilization value at 90% and at the display boundary', () => {
    const insights = getPlayerInsights(result({ produced: 90, capacityUtilization: 0.9 }), null);
    expect(insights[0]).toMatchObject({ kind: 'above-economical-utilization', value: 0.9 });
    expect(insights[0].text).toContain('90,0%');
    expect(getPlayerInsights(result({ capacityUtilization: 0.80049 }), null)).toEqual([]);
    expect(getPlayerInsights(result({ capacityUtilization: 0.80051 }), null)[0].text).toContain('80,1%');
  });

  it('keeps shortages and inventory ahead of a loss, and caps all competing signals at three', () => {
    const current = result({ unfulfilledOrders: 12, inventoryEnd: 30, inventoryValue: 300,
      netProfit: -125, capacityUtilization: 0.9, decision: { price: 10 } as FirmPeriodResult['decision'],
      bankInterest: 40, profitBeforeTax: 100, newMachines: -5, capacityNextPeriod: 95 });
    const previous = result({ periodIndex: 1, capacityNextPeriod: 100 });
    expect(getPlayerInsights(current, previous).map(item => item.kind)).toEqual([
      'unfulfilled-orders', 'ending-inventory', 'net-loss',
    ]);
  });

  it('prioritizes a loss over the softer utilization reminder without mutating either result', () => {
    const current = result({ netProfit: -125, capacityUtilization: 0.9 });
    const previous = result({ periodIndex: 1 });
    const before = structuredClone({ current, previous });
    Object.freeze(current.decision);
    Object.freeze(current);
    Object.freeze(previous);
    expect(getPlayerInsights(current, previous).map(item => item.kind)).toEqual(['net-loss', 'above-economical-utilization']);
    expect({ current, previous }).toEqual(before);
  });

  it('reports factual current-period observations in priority order, capped at three', () => {
    const current = result({ unfulfilledOrders: 12, inventoryEnd: 30, inventoryUnitCostEnd: 10,
      decision: { price: 10 } as FirmPeriodResult['decision'], bankInterest: 40,
      profitBeforeTax: 100, capexAdditions: 200, newMachines: 5, fullCapacity: 100,
      capacityNextPeriod: 105 });
    const previous = result({ periodIndex: 1, capacityNextPeriod: 100 });
    const insights = getPlayerInsights(current, previous);
    expect(insights).toHaveLength(3);
    expect(insights.map(item => item.kind)).toEqual(['unfulfilled-orders', 'ending-inventory', 'price-near-unit-cost']);
    expect(insights.every(item => typeof item.text === 'string' && item.text.length > 0)).toBe(true);
    expect(insights.every(item => /[А-Яа-яЁё]/.test(item.text))).toBe(true);
    expect(insights.every(item => item.text.startsWith('⚠️'))).toBe(true);
    expect(insights.every(item => item.text.includes('Возможно, стоит'))).toBe(true);
    expect(insights[0].text).toContain('12');
    expect(insights[0].text).toContain('ценовую политику');
  });

  it('includes financial and capacity observations when higher-priority signals are absent', () => {
    const current = result({ bankInterest: 40, profitBeforeTax: 100, capexAdditions: 200,
      newMachines: -5, capacityNextPeriod: 105 });
    const previous = result({ periodIndex: 1, capacityNextPeriod: 110 });
    expect(getPlayerInsights(current, previous).map(item => item.kind)).toEqual([
      'bank-interest-burden', 'investment-capacity-change',
    ]);
  });

  it('still reports current-period facts without a previous result', () => {
    const insights = getPlayerInsights(result({ unfulfilledOrders: 8, inventoryEnd: 12,
      inventoryValue: 120, bankInterest: 40, profitBeforeTax: 100 }), null);
    expect(insights.map(item => item.kind)).toEqual([
      'unfulfilled-orders', 'ending-inventory', 'bank-interest-burden',
    ]);
    expect(insights.every(item => !item.text.includes('undefined'))).toBe(true);
    expect(insights.every(item => item.text.startsWith('⚠️') && item.text.includes('Возможно, стоит'))).toBe(true);
  });

  it('reports declining next-period capacity when investment does not replace depreciation', () => {
    const current = result({ newMachines: -4, capacityNextPeriod: 96 });
    const previous = result({ periodIndex: 1, capacityNextPeriod: 100 });
    expect(getPlayerInsights(current, previous).map(item => item.kind)).toContain('investment-capacity-change');
  });
});
