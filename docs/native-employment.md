# Native employment and firing

New leagues use `employmentModel: 'native'` and `staffingSizeDivisor: 100`.
For executed production `q` and capacity available **this period** `K` (`opening.machines`):

```text
employees = f32(ceil(q * (100 + ceil(q / staffingSizeDivisor)) / K))
value = f32(max(0, previousEmployees - employees) * firingPenaltyPerEmployee)
firingPenalty = f32(sign(value) * floor(abs(value) + 0.5))
```

The fixed base is 100; both staffing operations use ceiling. Positive capacity and size divisor are required; zero production is supported. Capex changes next period's capacity, not current employment. Greater capacity can cause layoffs even with unchanged production. The default penalty remains **$10 per dismissed employee**. P&L and the funds preview share the same firing helper.

## Evidence and limits

Read-only recovery of EXE employment block S22:34cd–359a and firing block S22:359d–368e; EXE SHA256 `59127ff0fd88d89c437160c2a11f3cf3a6481aea9ac55b101714b90129290407`. Previous-result slots 5/10 are current capacity/employees; current-result slots 10/11 are employees/firing expense. Both ceiling arguments have binary64 stores; employment and the firing-rounding argument/result have float32 stores. Multiplication before division avoids premature binary64 quotient rounding; this is not a general x87 emulator.

`data/calibration/native-employment.json` contains exact native inputs/expected outputs for **505 firm rows from 91 unique SAVE files**, including 146 initialization rows and 18 positive firing charges. Hashes, scratch-cohort-relative source paths, row offsets, period/firm indices and next capacities retain provenance. Generate the portable fixture from the verified scratch corpus:

```sh
node scripts/import-employment-corpus.mjs /path/to/verified/fixtures.json
npm test -- src/engine/__tests__/employment.test.ts src/engine/__tests__/employment-original.test.ts
```

HERMES1 firm 5: initial `q=420, K=525` gives 84 employees; period 1 `q=400, K=525` gives 80 and $40 firing, not $200. N5 initialization `q=672, K=840` gives 86. The divisor was 100 throughout the observed corpus; custom divisor behavior comes from recovered code, not a custom native cohort. Fractional/extreme inputs, invalid-input handling, inactive transitions and nonzero $30-rate firings were not corpus-verified. Synthetic boundary tests are not additional native evidence. Other financial mismatches remain unresolved.

## Archived leagues

`employmentModel: 'legacy'` retains `round(baseStaff + max(0,q) * staffPerUnit)` and the old unrounded linear firing expense. Explicit model selections are preserved. JSON imports and localStorage loads without a model select legacy if either archived linear staffing coefficient differs from its old default (`baseStaff=0`, `staffPerUnit=1`); standard old configurations select native. Missing size divisor receives 100. Inactive staffing controls are hidden in League Setup, not discarded.

**Saved results, histories and opening employees are never silently rewritten or recomputed.** Switching a model only changes subsequent calculations and can mix old/new staffing histories. To correct an old history, start a fresh league or replay all original decisions from the beginning; recalculating only the last period does not repair prior staffing. Keep an export of the archived party before replaying.
