import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAGUE_CONFIG, makeMacroParams } from '../config';
import { computePnl, type PnlInput } from '../pnl';

const input: PnlInput = {
  price: 30, sold: 615, produced: 520, unitCost: 18,
  inventoryOpening: 95, inventoryOpeningUnitCost: 18, inventoryAgedUnits: 95,
  marketing: 0, rnd: 0, depreciation: 0,
  employeesPrevious: 0, employeesCurrent: 0, bankInterest: 0,
};

/** Literal inventory decisions/results from native MECOM v2.07 HERMES1.
 * Period 3 / firm 1 report SHA-256:
 * 190692aae35326bc09f42d7c05dd4cd5bef163a6088b7a42e17f6a413748ea03.
 * Storage dollars were confirmed in read-only original runs; the fixture
 * independently records opening (prior closing), production, sales and closing.
 */
describe('Original MECOM storage charges', () => {
  it('does not charge opening stock that is completely sold this period', () => {
    const result = computePnl(input, makeMacroParams(3), DEFAULT_LEAGUE_CONFIG);
    expect(result.storageCost).toBe(0);
    expect(result.profitBeforeTax).toBe(7380);
  });

  // Period 4 / firm 2 and firm 5: original closing inventories 111 and 0.
  it.each([
    { opening: 138, produced: 500, sold: 527, storage: 111 },
    { opening: 976, produced: 500, sold: 1476, storage: 0 },
    // Period 3 / firm 5: rising closing inventory 976 cannot increase the
    // charge beyond the opening inventory 433.
    { opening: 433, produced: 570, sold: 27, storage: 433 },
  ])('matches native storage with opening $opening, produced $produced, sold $sold',
    ({ opening, produced, sold, storage }) => {
      expect(computePnl({ ...input, inventoryOpening: opening, inventoryAgedUnits: opening,
        produced, sold }, makeMacroParams(4), DEFAULT_LEAGUE_CONFIG).storageCost).toBe(storage);
    });

  it.each([
    { opening: 0, aged: 0, produced: 100, sold: 0, storage: 0 },
    { opening: 138, aged: 50, produced: 500, sold: 527, storage: 100 },
    { opening: 138, aged: 200, produced: 500, sold: 0, storage: 276 },
    { opening: 138, aged: -5, produced: 500, sold: 0, storage: 0 },
    { opening: 95, aged: 95, produced: 520, sold: 700, storage: 0 },
  ])('bounds custom aged inventory and applies configured rate: %j',
    ({ opening, aged, produced, sold, storage }) => {
      expect(computePnl({ ...input, inventoryOpening: opening, inventoryAgedUnits: aged,
        produced, sold }, makeMacroParams(4), {
        ...DEFAULT_LEAGUE_CONFIG, storageCostPerUnit: 2,
      }).storageCost).toBe(storage);
    });
});
