import { describe, expect, it } from 'vitest';
import corpus from '../../../data/calibration/test2-original.json';
import evidence from './fixtures/native-demand.json';
import { DEFAULT_LEAGUE_CONFIG } from '../config';
import { computeDemand, computeShares, nativeRound } from '../demand';
import { computePeriod, initialOpeningState } from '../computePeriod';
import { makeFirmStart, makeMacroParams } from '../config';
import type { League } from '../types';

/** Native predecessor counters supplied explicitly: NOT a financial-engine replay. */
describe('EXE-recovered native default demand', () => {
  it('transcribes K scaling and optional macro controls (not empirically proven outside the corpus)', () => {
    const inputs = Array.from({ length: 8 }, (_, i) => ({ firmId: `f${i}`, price: 30,
      production: 420, openingInventory: 0, marketing: 1050, rnd: 420,
      rndCumulativeBefore: 0, rndDecayStockBefore: 0 }));
    const defaultMacro = computeDemand(inputs, DEFAULT_LEAGUE_CONFIG);
    const explicitZero = computeDemand(inputs, DEFAULT_LEAGUE_CONFIG,
      { periodIndex: 0, demandOS: 0, demandVM: 0, demandVN: 0 });
    expect(defaultMacro).toEqual(explicitZero);
    const doubleLeague = [...inputs, ...inputs.map(f => ({ ...f, firmId: `${f.firmId}b` }))];
    // Doubling N at the K=1→2 boundary doubles thresholds/reference AND sqrt scaling.
    expect(computeDemand(doubleLeague, DEFAULT_LEAGUE_CONFIG).latentMarketDemand)
      .toBe(defaultMacro.latentMarketDemand * 2);
    for (const modifier of ['demandOS', 'demandVM', 'demandVN'] as const) {
      expect(computeDemand(inputs, DEFAULT_LEAGUE_CONFIG, { periodIndex: 0, [modifier]: 1 })
        .latentMarketDemand).toBeGreaterThan(defaultMacro.latentMarketDemand);
    }
    const configured = { ...DEFAULT_LEAGUE_CONFIG, nativeDemand: {
      ...DEFAULT_LEAGUE_CONFIG.nativeDemand, demandScale: 1000 } };
    expect(computeDemand(inputs, configured).latentMarketDemand).toBe(defaultMacro.latentMarketDemand * 2);
  });
  it('distinguishes native latent volume from rounded high-price orders', () => {
    const report = corpus.records.find(r => r.path === 'прогнал\\TEST2_all_50.Z01')!;
    const f = report.fields;
    const result = computeDemand(f.price.map((price, i) => ({ firmId: `f${i}`, price,
      production: f.production[i], openingInventory: f.inventoryOpening[i],
      marketing: f.marketing[i], rnd: f.rnd[i],
      rndCumulativeBefore: f.rndCumulative[i] - f.rnd[i], rndDecayStockBefore: 0 })),
      DEFAULT_LEAGUE_CONFIG, { periodIndex: 1 });
    expect(result.latentMarketDemand).toBe(2216);
    expect(result.totalOrders).toBe(1776);
  });

  it('documents conservative empty/zero-supply guards, not proven native trajectories', () => {
    expect(computeDemand([], DEFAULT_LEAGUE_CONFIG).totalOrders).toBe(0);
    const firm = { firmId: 'zero', price: 0, production: 0, marketing: 0, rnd: 0,
      rndCumulativeBefore: 0, rndDecayStockBefore: 123 };
    const result = computeDemand([firm], DEFAULT_LEAGUE_CONFIG);
    expect(result.totalOrders).toBe(0);
    expect(result.latentMarketDemand).toBe(0);
    expect(result.breakdown.rndDecayStockByFirm.zero).toBe(123);
    expect(computeShares([firm], DEFAULT_LEAGUE_CONFIG).zero.marketing).toBe(0);
    expect(computeShares([firm], DEFAULT_LEAGUE_CONFIG).zero.rnd).toBe(0);
  });

  it('rounds float32 stores half away from zero', () => {
    expect(nativeRound(1.5)).toBe(2);
    expect(nativeRound(-1.5)).toBe(-2);
    expect(nativeRound(1.49999999)).toBe(2);
  });
  it('matches all 11 saves and their 64 independent HERMES orders through computePeriod', () => {
    let independent = 0;
    for (const saved of evidence.saves) {
      const firms = saved.firms.map((f, i) => ({ ...makeFirmStart(saved.firmCount),
        id: `f${i}`, name: `Firm ${i}`, initialInventory: f.openingInventory,
        initialRnd: f.rndCumulativeBefore }));
      const opening = initialOpeningState({ firms } as League);
      const decisions = Object.fromEntries(saved.firms.map((f, i) => [`f${i}`, { ...f, firmId: `f${i}` }]));
      const result = computePeriod({ periodIndex: saved.periodIndex, config: DEFAULT_LEAGUE_CONFIG,
        macro: makeMacroParams(saved.periodIndex), firms, opening, decisions });
      expect(result.firms.map(f => f.ordersReceived), saved.name).toEqual(saved.firms.map(f => f.orders));
      expect(result.firms.map(f => f.rndCumulative), saved.name).toEqual(saved.firms.map(f => f.rndCumulative));
      const demand = computeDemand(saved.firms.map((f, i) => ({ ...f, firmId: `f${i}`, rndDecayStockBefore: 999 })),
        DEFAULT_LEAGUE_CONFIG, { periodIndex: saved.periodIndex });
      expect(demand.latentMarketDemand, saved.name).toBe(saved.latentMarketDemand);
      expect(demand.breakdown.avgPrice, saved.name).toBe(saved.weightedPrice);
      if (saved.name.startsWith('HERMES')) independent += firms.length;
    }
    expect(evidence.saves).toHaveLength(11);
    expect(independent).toBe(64);
  });
  it('matches all 44 TEST2 decision-driven reports exactly, including period-two held-out states', () => {
    const reports = corpus.records.filter(r => r.periodIndex > 0);
    expect(reports).toHaveLength(44);
    let count = 0;
    for (const report of reports) {
      const f = report.fields;
      const firms = f.price.map((price, i) => ({ firmId: `f${i}`, price,
        production: f.production[i], openingInventory: f.inventoryOpening[i],
        marketing: f.marketing[i], rnd: f.rnd[i],
        rndCumulativeBefore: f.rndCumulative[i] - f.rnd[i], rndDecayStockBefore: 0 }));
      const result = computeDemand(firms, DEFAULT_LEAGUE_CONFIG, { periodIndex: report.periodIndex });
      expect(firms.map(firm => result.ordersByFirm[firm.firmId]), report.path).toEqual(f.ordersReceived);
      expect(result.totalOrders, report.path).toBe(report.industry.totalOrders);
      expect(result.latentMarketDemand, report.path).toBe(evidence.reports.find(r => r.path === report.path)?.latentMarketDemand);
      count += firms.length;
    }
    expect(count).toBe(352);
  });
});
