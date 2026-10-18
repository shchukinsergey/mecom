import { describe, expect, it } from 'vitest';
import { computeNativeLiquidation, type NativeLiquidationInput } from '../bankruptcy';

// Static recovery only: declaration.asm S22:5952..5b50 and
// instruction-checks.json (mode: "static interpreter, NOT native execution").
// These fixtures are NOT native runtime replay confirmation.
describe('computeNativeLiquidation (static native evidence)', () => {
  it('copies the debt-exceeds-assets integer instruction fixture', () => {
    expect(computeNativeLiquidation({
      inventory: 0, inventoryUnitCost: 0, cash: 100, capexBookValue: 0,
      loan: 150, initialCapital: 80,
    })).toEqual({ assets: 100, bankLoss: 50, shareholderLoss: 80 });
  });

  it('copies the partial-shareholder-recovery integer instruction fixture', () => {
    expect(computeNativeLiquidation({
      inventory: 0, inventoryUnitCost: 0, cash: 150, capexBookValue: 0,
      loan: 100, initialCapital: 80,
    })).toEqual({ assets: 150, bankLoss: 0, shareholderLoss: 30 });
  });

  // Exact remaining liquidation rows from instruction-checks.json. That file
  // records aggregate assets, not their decomposition; cash carries the total.
  it.each([
    { assets: 200, loan: 100, capital: 80, bankLoss: 0, shareholderLossSigned: -20 },
    { assets: 100, loan: 100, capital: 80, bankLoss: 0, shareholderLossSigned: 80 },
    { assets: 100, loan: 100, capital: 0, bankLoss: 0, shareholderLossSigned: 0 },
  ])('copies static integer fixture $assets/$loan/$capital', (fixture) => {
    expect(computeNativeLiquidation({
      inventory: 0, inventoryUnitCost: 0, cash: fixture.assets, capexBookValue: 0,
      loan: fixture.loan, initialCapital: fixture.capital,
    })).toEqual({
      assets: fixture.assets, bankLoss: fixture.bankLoss,
      shareholderLoss: fixture.shareholderLossSigned,
    });
  });

  it('truncates fractional residual equity before subtracting capital (S22:5af6)', () => {
    expect(computeNativeLiquidation({
      inventory: 2.5, inventoryUnitCost: 3.5, cash: 10.5, capexBookValue: 20.25,
      loan: 10.75, initialCapital: 80,
    })).toEqual({ assets: 39, bankLoss: 0, shareholderLoss: 52 });
  });

  it.each([
    { inventory: 16777217, inventoryUnitCost: 1, cash: 0, capexBookValue: 0, loan: 0, initialCapital: 0, assets: 16777216, bankLoss: 0, shareholderLoss: -16777216 },
    { inventory: 1, inventoryUnitCost: 16777217, cash: 0, capexBookValue: 0, loan: 0, initialCapital: 0, assets: 16777216, bankLoss: 0, shareholderLoss: -16777216 },
    { inventory: 0, inventoryUnitCost: 0, cash: 16777217, capexBookValue: 0, loan: 0, initialCapital: 0, assets: 16777216, bankLoss: 0, shareholderLoss: -16777216 },
    { inventory: 0, inventoryUnitCost: 0, cash: 0, capexBookValue: 16777217, loan: 0, initialCapital: 0, assets: 16777216, bankLoss: 0, shareholderLoss: -16777216 },
    { inventory: 0, inventoryUnitCost: 0, cash: 16777216, capexBookValue: 0, loan: 16777217, initialCapital: 0, assets: 16777216, bankLoss: 0, shareholderLoss: 0 },
    { inventory: 0, inventoryUnitCost: 0, cash: 1, capexBookValue: 0, loan: 0, initialCapital: 16777217, assets: 1, bankLoss: 0, shareholderLoss: 16777215 },
  ])('normalizes dword input loads to float32: %j', (fixture) => {
    const { assets, bankLoss, shareholderLoss, ...input } = fixture;
    expect(computeNativeLiquidation(input)).toEqual({ assets, bankLoss, shareholderLoss });
  });

  const zero: NativeLiquidationInput = {
    inventory: 0, inventoryUnitCost: 0, cash: 0, capexBookValue: 0,
    loan: 0, initialCapital: 0,
  };
  const fields = Object.keys(zero) as (keyof NativeLiquidationInput)[];
  it.each(fields)('rejects nonfinite/float32-overflow input in %s', (field) => {
    for (const value of [NaN, Infinity, -Infinity, Number.MAX_VALUE]) {
      expect(() => computeNativeLiquidation({ ...zero, [field]: value })).toThrow(RangeError);
    }
  });

  it.each([
    { cash: 2147483648 },
    { cash: -2147483648, capexBookValue: -1 },
    { cash: 2147483520, capexBookValue: 128 },
    { inventory: 65536, inventoryUnitCost: 65536 },
    { loan: -2147483648 },
  ])('rejects unsupported signed-int32 asset/residual conversion: %j', (input) => {
    expect(() => computeNativeLiquidation({ ...zero, ...input })).toThrow(RangeError);
  });

  it.each([
    { cash: 2147483520, capexBookValue: 127, assets: 2147483647 },
    { cash: -2147483648, capexBookValue: 0, assets: -2147483648 },
  ])('accepts exact signed-int32 asset endpoint $assets', ({ assets, ...input }) => {
    expect(computeNativeLiquidation({ ...zero, ...input }).assets).toBe(assets);
  });

  it('returns integer zero, not negative zero, after negative fractional truncation', () => {
    expect(computeNativeLiquidation({ ...zero, cash: -0.75 })).toEqual({
      assets: 0, bankLoss: 0, shareholderLoss: 0,
    });
  });

  it.each([
    { inventory: 1, inventoryUnitCost: 1, cash: -(2 ** -54) },
    { cash: 1, capexBookValue: -(2 ** -54) },
    { cash: 1, loan: 2 ** -54 },
    { cash: 16777219, initialCapital: 2 ** -54 },
  ])('rejects unrepresented extended-precision arithmetic rather than claiming parity: %j', (input) => {
    expect(() => computeNativeLiquidation({ ...zero, ...input })).toThrow(/precision/i);
  });

  it('truncates only the aggregate assets, toward zero (S22:59d6)', () => {
    expect(computeNativeLiquidation({
      ...zero, inventory: 0.5, inventoryUnitCost: 0.5, cash: 0.75, capexBookValue: 0.75,
    })).toEqual({ assets: 1, bankLoss: 0, shareholderLoss: -1 });
    expect(computeNativeLiquidation({
      ...zero, inventory: -0.5, inventoryUnitCost: 0.5, cash: -0.75, capexBookValue: -0.75,
    })).toEqual({ assets: -1, bankLoss: 1, shareholderLoss: 0 });
  });

  it('keeps the product extended instead of inserting a float32 store', () => {
    expect(computeNativeLiquidation({
      ...zero, inventory: 4097, inventoryUnitCost: 4097,
    })).toEqual({ assets: 16785409, bankLoss: 0, shareholderLoss: -16785408 });
  });

  it('does not truncate a fractional bank loss (R46 float32 store)', () => {
    expect(computeNativeLiquidation({ ...zero, cash: 10.75, loan: 10.75 })).toEqual({
      assets: 10, bankLoss: 0.75, shareholderLoss: 0,
    });
  });

  it('rounds losses at their float32 stores, without truncating them to integers', () => {
    expect(computeNativeLiquidation({ ...zero, cash: -1, loan: 16777218 }).bankLoss).toBe(16777220);
    expect(computeNativeLiquidation({ ...zero, cash: 1, initialCapital: 16777220 }).shareholderLoss).toBe(16777220);
    expect(computeNativeLiquidation({ ...zero, initialCapital: 0.1 }).shareholderLoss).toBe(Math.fround(0.1));
  });

  it('retains zero shareholder loss at exact capital recovery (non-loss)', () => {
    const result = computeNativeLiquidation({ ...zero, cash: 180, loan: 100, initialCapital: 80 });
    expect(result).toEqual({ assets: 180, bankLoss: 0, shareholderLoss: 0 });
    expect(result.shareholderLoss > 0).toBe(false);
  });

  it('does not mutate its input or retain state between calls', () => {
    const input = Object.freeze({
      inventory: 2.5, inventoryUnitCost: 3.5, cash: 10.5, capexBookValue: 20.25,
      loan: 10.75, initialCapital: 80,
    });
    const before = { ...input };
    const first = computeNativeLiquidation(input);
    first.bankLoss = 999;
    expect(computeNativeLiquidation(input)).toEqual({ assets: 39, bankLoss: 0, shareholderLoss: 52 });
    expect(input).toEqual(before);
  });
});
