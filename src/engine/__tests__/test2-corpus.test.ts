import { describe, expect, it } from 'vitest';
import corpus from '../../../data/calibration/test2-original.json';
import { DEFAULT_LEAGUE_CONFIG, makeFirmStart, makeFirmDecision, makeMacroParams } from '../config';
import { computePeriod, initialOpeningState, nextOpeningState } from '../computePeriod';
import { computeShares } from '../demand';
import type { League, FirmDecision } from '../types';

/** Read-only measurements from native TEST2 reports; filenames are not scenario IDs. */
describe('Original TEST2 corpus', () => {
  it('retains every report and validates inventory and revenue identities', () => {
    expect(corpus.records).toHaveLength(corpus.fileCount);
    for (const report of corpus.records) {
      const f = report.fields;
      expect(f.price).toHaveLength(report.firmCount);
      for (let i = 0; i < report.firmCount; i++) {
        expect(f.sold[i] + f.inventoryEnd[i]).toBe(f.production[i] + f.inventoryOpening[i]);
        expect(f.revenue[i]).toBe(f.price[i] * f.sold[i]);
      }
    }
  });

  it('measures the current engine against independent period-one runs', () => {
    const rows = corpus.records.filter(r => r.periodIndex === 1).map(report => {
      const n = report.firmCount;
      const firms = Array.from({ length: n }, (_, i) => ({ ...makeFirmStart(n), id: `f${i}`, name: `Фирма ${i + 1}` }));
      const decisions0 = Object.fromEntries(firms.map(f => [f.id, makeFirmDecision(f.id, n)]));
      const league: League = { id: 'comparison', name: 'comparison', createdAt: '', config: DEFAULT_LEAGUE_CONFIG, firms, macroByPeriod: [], decisionsByPeriod: [], confirmedByPeriod: [], results: [] };
      const initial = initialOpeningState(league);
      const baseline = computePeriod({ periodIndex: 0, config: league.config, macro: makeMacroParams(0), firms, opening: initial, decisions: decisions0 });
      const opening = nextOpeningState(initial, baseline);
      const fields = report.fields;
      const decisions: Record<string, FirmDecision> = Object.fromEntries(firms.map((f, i) => [f.id, { firmId: f.id, price: fields.price[i], production: fields.production[i], marketing: fields.marketing[i], capexGross: fields.capexGross[i], rnd: fields.rnd[i] }]));
      const result = computePeriod({ periodIndex: 1, config: league.config, macro: makeMacroParams(1), firms, opening, decisions, previousIndustry: baseline.industry });
      // Isolate share allocation from volume and initialization: use the native N.Пот row.
      const shares = computeShares(firms.map((f, i) => ({ firmId: f.id, price: fields.price[i], marketing: fields.marketing[i], rnd: fields.rnd[i], rndCumulativeBefore: fields.rndCumulative[i] - fields.rnd[i], rndDecayStockBefore: 0 })), league.config);
      const shareMae = firms.reduce((s, f, i) => s + Math.abs(report.industry.totalOrders * shares[f.id].total - fields.ordersReceived[i]), 0) / n;
      const orderMae = result.firms.reduce((s, f, i) => s + Math.abs(f.ordersReceived - fields.ordersReceived[i]), 0) / n;
      expect(result.firms).toHaveLength(n);
      return { file: report.path, originalOrders: report.industry.totalOrders, cloneOrders: result.industry.totalOrders, orderMae: +orderMae.toFixed(2), sharesOnlyMae: +shareMae.toFixed(2), originalRevenue: fields.revenue.reduce((a,b) => a+b,0), cloneRevenue: result.industry.industryRevenue };
    });
    expect(rows.length).toBeGreaterThan(30);
    console.log('TEST2_CURRENT_ENGINE_COMPARISON', JSON.stringify(rows));
    console.log('TEST2_SUMMARY', JSON.stringify({ runs: rows.length, meanOrderMae: rows.reduce((s,r)=>s+r.orderMae,0)/rows.length, meanSharesOnlyMae: rows.reduce((s,r)=>s+r.sharesOnlyMae,0)/rows.length }));
  });
});
