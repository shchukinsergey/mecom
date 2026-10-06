import { describe, expect, it, vi } from 'vitest';
import { loadAll, parseLeagueFile, serializeLeague, SCHEMA_VERSION } from '../persistence';
import type { LeagueSnapshot } from '../persistence';
import { computePeriod, initialOpeningState } from '../../engine/computePeriod';
import { DEFAULT_FIRM_START, DEFAULT_LEAGUE_CONFIG, makeFirmDecision, makeMacroParams } from '../../engine/config';
import type { League } from '../../engine/types';

function makeSnapshot(): LeagueSnapshot {
  const league: League = {
    id: 'league-1',
    name: 'Северный рынок',
    createdAt: '2026-08-09T10:00:00.000Z',
    config: DEFAULT_LEAGUE_CONFIG,
    firms: [
      { ...DEFAULT_FIRM_START, id: 'a', name: 'Альфа' },
      { ...DEFAULT_FIRM_START, id: 'b', name: 'Бета' },
    ],
    macroByPeriod: [],
    decisionsByPeriod: [],
    confirmedByPeriod: [],
    results: [],
  };
  return { league, opening: initialOpeningState(league) };
}

describe('Экспорт и импорт лиги', () => {
  it.each([
    [145, 72.5, undefined, 15, 'native', 10000 / 69, 10000 / 138],
    [147, 73.5, undefined, 15, 'native', 147, 73.5],
    [145, 73.5, undefined, 15, 'native', 145, 73.5],
    [145, 72.5, true, 15, 'native', 145, 72.5],
    [145, 72.5, undefined, 16, 'native', 145, 72.5],
    [145, 72.5, undefined, 15, 'legacy', 145, 72.5],
  ])('migrates only identifiable standard cost pair %s/%s (custom=%s,k1=%s,model=%s)',
    (up, down, custom, k1, model, expectedUp, expectedDown) => {
      const snapshot = makeSnapshot();
      snapshot.league.results = [computePeriod({ periodIndex: 0, config: snapshot.league.config,
        macro: makeMacroParams(0), firms: snapshot.league.firms, opening: snapshot.opening,
        decisions: Object.fromEntries(snapshot.league.firms.map(f => [f.id, makeFirmDecision(f.id, 2)])) })];
      const file = JSON.parse(serializeLeague(snapshot));
      Object.assign(file.snapshot.league.config, { costCuUp: up, costCuDown: down,
        costDenominatorsCustom: custom, costK1: k1, demandModel: model });
      const history = JSON.stringify(file.snapshot.league.results);
      const state = JSON.stringify(file.snapshot.opening);
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ schemaVersion: SCHEMA_VERSION,
        leagues: { 'league-1': file.snapshot } }) });
      try {
        for (const restored of [parseLeagueFile(JSON.stringify(file)), loadAll().leagues['league-1']]) {
          expect(restored.league.config.costCuUp).toBe(expectedUp);
          expect(restored.league.config.costCuDown).toBe(expectedDown);
          expect(JSON.stringify(restored.league.results)).toBe(history);
          expect(JSON.stringify(restored.opening)).toBe(state);
          expect(parseLeagueFile(serializeLeague(restored))).toEqual(restored);
        }
      } finally { vi.unstubAllGlobals(); }
    });
  it.each([
    [undefined, 0, 1, 'native'],
    [undefined, 5, 1, 'legacy'],
    [undefined, 0, 0.2, 'legacy'],
    ['native', 5, 0.2, 'native'],
    ['legacy', 0, 1, 'legacy'],
  ])('restores employment mode %s with base %s and slope %s as %s without rewriting employees/history', (model, base, slope, expected) => {
    const snapshot = makeSnapshot();
    snapshot.league.results = [computePeriod({ periodIndex: 0, config: snapshot.league.config,
      macro: makeMacroParams(0), firms: snapshot.league.firms, opening: snapshot.opening,
      decisions: Object.fromEntries(snapshot.league.firms.map(f => [f.id, makeFirmDecision(f.id, 2)])) })];
    const file = JSON.parse(serializeLeague(snapshot));
    const old = file.snapshot.league.config;
    delete old.employmentModel;
    delete old.staffingSizeDivisor;
    if (model) old.employmentModel = model;
    old.baseStaff = base;
    old.staffPerUnit = slope;
    file.snapshot.opening.a.employees = 123;
    const history = JSON.stringify(file.snapshot.league.results);
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ schemaVersion: SCHEMA_VERSION,
      leagues: { 'league-1': file.snapshot } }) });
    try {
      for (const restored of [parseLeagueFile(JSON.stringify(file)), loadAll().leagues['league-1']]) {
        expect(restored.league.config.employmentModel).toBe(expected);
        expect(restored.league.config.staffingSizeDivisor).toBe(100);
        expect(restored.league.config.baseStaff).toBe(base);
        expect(restored.league.config.staffPerUnit).toBe(slope);
        expect(restored.opening.a.employees).toBe(123);
        expect(JSON.stringify(restored.league.results)).toBe(history);
      }
    } finally { vi.unstubAllGlobals(); }
  });
  it('merges nested native/feature defaults in JSON and localStorage without changing history', () => {
    const snapshot = makeSnapshot();
    snapshot.league.results = [computePeriod({ periodIndex: 0, config: snapshot.league.config,
      macro: makeMacroParams(0), firms: snapshot.league.firms, opening: snapshot.opening,
      decisions: Object.fromEntries(snapshot.league.firms.map(f => [f.id, makeFirmDecision(f.id, 2)])) })];
    const file = JSON.parse(serializeLeague(snapshot));
    file.snapshot.league.config.nativeDemand = { priceCutoff: 45 };
    file.snapshot.league.config.featureFlags = { bankruptcyMode: 'freeze' };
    const history = JSON.stringify(file.snapshot.league.results);
    const json = JSON.stringify(file);
    vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ schemaVersion: SCHEMA_VERSION,
      leagues: { 'league-1': file.snapshot } }) });
    try {
      for (const restored of [parseLeagueFile(json), loadAll().leagues['league-1']]) {
        expect(restored.league.config.nativeDemand).toEqual({ ...DEFAULT_LEAGUE_CONFIG.nativeDemand, priceCutoff: 45 });
        expect(restored.league.config.featureFlags).toEqual({
          ...DEFAULT_LEAGUE_CONFIG.featureFlags,
          bankruptcyMode: 'freeze',
          loanRepayment: 'none',
        });
        expect(restored.league.results).toEqual(file.snapshot.league.results);
        expect(JSON.stringify(restored.league.results)).toBe(history);
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('preserves explicitly customized old demand tables using the legacy boundary', () => {
    const file = JSON.parse(serializeLeague(makeSnapshot()));
    delete file.snapshot.league.config.nativeDemand;
    delete file.snapshot.league.config.demandModel;
    file.snapshot.league.config.priceFTable = [[20, 9], [40, 1]];
    const restored = parseLeagueFile(JSON.stringify(file));
    expect(restored.league.config.demandModel).toBe('legacy');
    expect(restored.league.config.priceFTable).toEqual([[20, 9], [40, 1]]);
  });
  it('переживает круговой рейс без потерь', () => {
    const snapshot = makeSnapshot();
    const restored = parseLeagueFile(serializeLeague(snapshot));
    expect(restored).toEqual(snapshot);
  });

  it('сохраняет версию схемы', () => {
    const parsed = JSON.parse(serializeLeague(makeSnapshot()));
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(parsed.exportedAt).toBeTruthy();
  });

  it('внятно ругается на битый JSON', () => {
    expect(() => parseLeagueFile('{не json')).toThrow(/корректным JSON/);
  });

  it('внятно ругается на чужой файл', () => {
    expect(() => parseLeagueFile(JSON.stringify({ hello: 'world' }))).toThrow(
      /не экспорт МЭКОМ/,
    );
  });

  it('внятно ругается на другую версию схемы', () => {
    const file = JSON.parse(serializeLeague(makeSnapshot()));
    file.schemaVersion = 99;
    expect(() => parseLeagueFile(JSON.stringify(file))).toThrow(/схемой v99/);
  });

  it('не принимает файл без состояния фирм', () => {
    const file = JSON.parse(serializeLeague(makeSnapshot()));
    delete file.snapshot.opening;
    expect(() => parseLeagueFile(JSON.stringify(file))).toThrow(/состояния фирм/);
  });
});
