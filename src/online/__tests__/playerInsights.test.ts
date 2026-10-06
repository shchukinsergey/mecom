import { describe, expect, it } from 'vitest';
import type { FirmPeriodResult } from '../../engine/types';
import { getPlayerInsights } from '../playerInsights';

const result = (overrides: Partial<FirmPeriodResult> = {}): FirmPeriodResult => ({
  firmId: 'private-firm', firmName: 'Private Firm', periodIndex: 2,
  decision: {} as FirmPeriodResult['decision'],
  ordersReceived: 100, produced: 100, sold: 100, unfulfilledOrders: 0, inventoryEnd: 0,
  marketShareSold: 0, unitCost: 10, inventoryUnitCostEnd: 10, fullCapacity: 100,
  capexAdditions: 0, newMachines: 0, capacityNextPeriod: 100, capacityUtilization: 1,
  employed: 0, revenue: 1000, cogs: 1000, grossProfit: 0, marketingExpense: 0,
  rndExpense: 0, depreciation: 0, firingPenalty: 0, storageCost: 0, bankInterest: 0,
  profitBeforeTax: 0, tax: 0, netProfit: 0, cash: 0, inventoryValue: 0,
  capexBookValue: 0, totalAssets: 0, loan: 0, retainedEarnings: 0, capital: 0,
  totalLiabEquity: 0, newBorrowing: 0, amortFundRemainder: 0, rndCumulative: 0,
  rndDecayStock: 0, isBankrupt: false, unfundedShortfall: 0, rif: {} as FirmPeriodResult['rif'],
  ...overrides,
});

describe('getPlayerInsights', () => {
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
