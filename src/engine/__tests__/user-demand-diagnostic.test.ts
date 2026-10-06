import { expect, it } from 'vitest';
import { DEFAULT_LEAGUE_CONFIG } from '../config';
import { computeDemand } from '../demand';
import native from '../../../data/calibration/hermes1-original.json';

it('reproduces the user report from doubled introductory R&D, then matches native with correct history', () => {
  // Old exports used initialRnd=420 AND a period-zero decision of 420. Do not
  // silently rewrite that saved state: compare both explicitly using the same decisions.
  const inputs = native.periods[1].decisions.map(decision => ({ ...decision,
    openingInventory: 0, rndCumulativeBefore: 840, rndDecayStockBefore: 0 }));
  const doubled = computeDemand(inputs, DEFAULT_LEAGUE_CONFIG, { periodIndex: 1 });
  expect(inputs.map(f => doubled.ordersByFirm[f.firmId]))
    .toEqual([767, 340, 1160, 879, 314, 622, 500, 1670]);
  expect(doubled.totalOrders).toBe(6252);
  const correct = inputs.map(f => ({ ...f, rndCumulativeBefore: 420 }));
  const result = computeDemand(correct, DEFAULT_LEAGUE_CONFIG, { periodIndex: 1 });
  expect(correct.map(f => result.ordersByFirm[f.firmId]))
    .toEqual(native.periods[1].fields.ordersReceived);
  expect(result.totalOrders).toBe(6003);
});
