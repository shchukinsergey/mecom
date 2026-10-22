import { test, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { buildOnlineGameSnapshot } from '../src/online/gameSettings';
import { scenarioFirmStart } from '../src/engine/originalScenarios';
import { computePeriod, initialOpeningState, nextOpeningState } from '../src/engine/computePeriod';

// Opt-in research runner; normal tests do not overwrite comparison artifacts.
test.skipIf(process.env.MECOM_COMPARE_ORIGINAL !== '1')('compare supplied original tractors reports without modifying games', () => {
  const reports = JSON.parse(readFileSync('data/scenario-research/tractors-three-periods.json', 'utf8'));
  const { league: l } = buildOnlineGameSnapshot('Comparison', undefined, 'tractors-v2');
  l.firms = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: String(i + 1), ...scenarioFirmStart(l, 8) }));
  let opening = initialOpeningState(l);
  const comparison: unknown[] = [];
  const mapping = { 'Заказы': 'ordersReceived', 'Сбыт': 'sold', 'Н/Склд': 'inventoryEnd', 'НовМощ': 'capacityNextPeriod',
    'Себест': 'unitCost', 'Выручк': 'revenue', 'Ч.Приб': 'netProfit', 'Н.Приб': 'retainedEarnings', 'Займ': 'loan', 'Наличн': 'cash', 'РИФ': 'rif' } as const;
  for (const report of reports) {
    const r = report.rows;
    expect(r['Цена']).toHaveLength(8);
    const decisions = Object.fromEntries(l.firms.map((f, i) => [f.id, { firmId: f.id, price: r['Цена'][i], production: r['Произв'][i], marketing: r['Маркет'][i], capexGross: r['Инвест'][i], rnd: r['НИОКР'][i] }]));
    const result = computePeriod({ periodIndex: report.period, config: l.config, macro: l.macroByPeriod[report.period], firms: l.firms, opening, decisions,
      previousIndustry: l.results.at(-1)?.industry, previousNativeIndustryState: l.results.at(-1)?.nativeIndustryState });
    const differences: unknown[] = [];
    for (const [label, field] of Object.entries(mapping)) for (let i = 0; i < 8; i++) {
      const firm = result.firms[i];
      const raw = field === 'rif' ? firm.rif.total : firm[field as keyof typeof firm] as number;
      const actual = field === 'unitCost' ? Math.round(raw * 100) / 100 : Math.round(raw);
      if (actual !== r[label][i]) differences.push({ firm: i + 1, field, original: r[label][i], actual, delta: actual - r[label][i] });
    }
    comparison.push({ period: report.period, differences, orders: result.industry.totalOrders, sold: result.industry.totalSold,
      details: result.firms.map(f => ({ firm: Number(f.firmId) + 1, unitCost: f.unitCost,
        productionCost: f.produced * f.unitCost, cogs: f.cogs, bankInterest: f.bankInterest,
        storageCost: f.storageCost, firingPenalty: f.firingPenalty, profitBeforeTax: f.profitBeforeTax, tax: f.tax })) });
    l.results.push(result); opening = nextOpeningState(opening, result);
  }
  writeFileSync('data/scenario-research/tractors-comparison.json', JSON.stringify(comparison, null, 2));
});
