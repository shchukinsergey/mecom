# Native decision-entry budget

This preview reproduces the original entry dialog, not settled cashflow or the native auto-reduction/acceptance routine. Production, marketing, net investment and R&D are the only deductions. Firing, storage, interest and taxes remain period-engine expenses; a positive entry budget does not guarantee end-period liquidity.

## Arithmetic

- Raw unit-cost polynomial uses default percent denominators `10000/69` above optimal utilization and `10000/138` below, rather than the old approximations `145/72.5`. Explicit scenario values remain configurable.
- Depreciation: half-away-from-zero after float32 conversion of opening book value divided by lifespan; book value includes the amortization remainder.
- Available credit: half-away-from-zero after float32 conversion of absolute loan limit minus debt, without clamping negative credit.
- Signed rows: `trunc(-q*rawUnitCost)`, `trunc(-marketing)`, `trunc(depreciation-grossCapex)`, `trunc(-rnd)`. Sum these integers before splitting funds. No unit-cost cent rounding in the preview.
- Opening total: `trunc(cash+availableCredit)`. Residual cash: `trunc(max(0,cash+signedSum))`; residual credit: `trunc(availableCredit+min(0,cash+signedSum))`. Remaining is the sum of residual cash and credit.

HERMES1 firm8 entering p2: capacity1100, baseline525, cash8216, debt44856, production420, marketing15000, grossCapex24050, R&D1000. Production14402, depreciation2200, netInvestment21850, outflow52252, remaining11108 = cash0 + credit11108.

## Persistence

JSON/localStorage loading upgrades the complete old standard145/72.5 pair only with standard costK1=15, costK2=3, optimalCU=80, no custom archived demand curve and no legacy demand model. Partial/custom pairs and nonstandard cost settings remain untouched. `costDenominatorsCustom: true` preserves even an explicitly chosen145/72.5 pair; editing either denominator in setup sets this marker. Historical unmarked values identical to old defaults cannot reveal whether they were intentionally reselected. Saved results and financial opening balances are not recalculated.

## Evidence and scope

Read-only recovery artifacts: Hermes scratch `mecom-funds-decoding/NOTES.md`, `verify.py`, `verification.json`. Native EXE SHA256 `59127ff0fd88d89c437160c2a11f3cf3a6481aea9ac55b101714b90129290407`. Dialog S02 signed conversion sites0x1d432/0x1d444/0x1d469/0x1d47b; four-row sum0x1d486..0x1d4a1. Supplied screenshot has11 matching fields. The505 SAVE comparisons corroborate **settled cost arithmetic only**, not505 preview observations. No original game execution or writes are needed for these tests.

JS double is not a general x87 float80 emulator; adversarial extreme/near-integer boundaries, native overflow and invalid capacities are outside verified parity. This patch does not implement or change settled finance rounding.
