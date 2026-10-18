export interface NativeLiquidationInput {
  inventory: number;
  inventoryUnitCost: number;
  cash: number;
  capexBookValue: number;
  loan: number;
  initialCapital: number;
}

export interface NativeLiquidation {
  assets: number;
  bankLoss: number;
  shareholderLoss: number;
}

// Error-free TwoSum: reject any rounded binary64 addition instead of
// silently treating it as the native x87 extended-precision intermediate.
function exactSum(a: number, b: number): number {
  const sum = a + b;
  const bVirtual = sum - a;
  const error = (a - (sum - bVirtual)) + (b - bVirtual);
  if (error !== 0) {
    throw new RangeError('Native liquidation requires unsupported extended precision');
  }
  return sum;
}

/**
 * Pure liquidation snapshot transcribed from STATIC recovered instructions,
 * declaration.asm S22:5952..5b50; NOT native runtime-confirmed.
 *
 * Native dword operands: R18 inventory, R9 inventory unit cost, R28 cash,
 * R4 capex book value, R13 loan, C71 initial capital. Normalize all six inputs
 * with Math.fround because those result/configuration arrays store float32;
 * this deliberately models their native stored values, not arbitrary JS reals.
 * The product and sums have NO intervening float32 store: native temporaries
 * are x87 extended values. A float32 product is exact in binary64 (<=48
 * significant bits); exactSum rejects additions/subtractions that binary64
 * cannot represent exactly. This conservative supported subset avoids falsely
 * claiming full float80 parity, even when an inexact operation might be benign.
 *
 * S22:59d6 truncates total assets to signed int32; 5af6 separately truncates
 * max(assets-loan, 0). R46/5a74 and R47/5b4e are float32 output stores.
 * Shareholder loss is signed: negative means gain, zero is non-loss. There is
 * no declaration trigger, threshold, state clearing or exclusion flag here.
 *
 * @throws RangeError for nonfinite float32 inputs, unsupported intermediate
 * precision, or an assets/residual conversion outside signed int32 range.
 */
export function computeNativeLiquidation(input: NativeLiquidationInput): NativeLiquidation {
  const inventory = Math.fround(input.inventory);
  const inventoryUnitCost = Math.fround(input.inventoryUnitCost);
  const cash = Math.fround(input.cash);
  const capexBookValue = Math.fround(input.capexBookValue);
  const loan = Math.fround(input.loan);
  const initialCapital = Math.fround(input.initialCapital);
  for (const value of [inventory, inventoryUnitCost, cash, capexBookValue, loan, initialCapital]) {
    if (!Number.isFinite(value)) {
      throw new RangeError('Native liquidation requires finite float32 inputs');
    }
  }
  const assets = Math.trunc(exactSum(exactSum(inventory * inventoryUnitCost, cash), capexBookValue)) || 0;
  if (assets < -2147483648 || assets > 2147483647) {
    throw new RangeError('Native liquidation assets exceed signed int32 range');
  }
  const residual = Math.trunc(Math.max(exactSum(assets, -loan), 0));
  if (residual > 2147483647) {
    throw new RangeError('Native liquidation residual exceeds signed int32 range');
  }
  return {
    assets,
    bankLoss: Math.fround(Math.max(exactSum(loan, -assets), 0)),
    shareholderLoss: Math.fround(exactSum(initialCapital, -residual)),
  };
}
