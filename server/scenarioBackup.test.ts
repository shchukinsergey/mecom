import { expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { computePeriod } from '../src/engine/computePeriod';
import type { LeagueSnapshot } from '../src/state/persistence';

// Optional private fixture: never commit real games or user databases.
const directory = process.env.MECOM_SCENARIO_COMPAT_DIR;
test.skipIf(!directory)('existing backup games keep identical next-period calculations', () => {
  const snapshots = JSON.parse(readFileSync(join(directory!, 'snapshots.json'), 'utf8')) as LeagueSnapshot[];
  const actual = snapshots.map(({ league: l, opening }) => {
    const i = l.results.length;
    const macro = l.macroByPeriod[i] ?? { ...l.macroByPeriod.at(-1)!, periodIndex: i };
    const result = computePeriod({ periodIndex: i, config: l.config, macro, firms: l.firms, opening,
      decisions: l.decisionsByPeriod[i] ?? l.decisionsByPeriod.at(-1)!,
      previousIndustry: l.results.at(-1)?.industry,
      previousNativeIndustryState: l.results.at(-1)?.nativeIndustryState });
    return { ...result, computedAt: '' };
  });
  const baseline = join(directory!, 'baseline.json');
  if (process.env.MECOM_RECORD_SCENARIO_BASELINE === '1') writeFileSync(baseline, JSON.stringify(actual));
  expect(actual.length).toBeGreaterThan(0);
  expect(JSON.parse(JSON.stringify(actual))).toEqual(JSON.parse(readFileSync(baseline, 'utf8')));
});
