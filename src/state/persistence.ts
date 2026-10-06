/**
 * Хранение лиг в localStorage и экспорт/импорт JSON.
 *
 * Схема версионирована: если формат когда-нибудь изменится, старые файлы можно
 * будет мигрировать, а не молча сломать партию ведущего.
 */

import { DEFAULT_LEAGUE_CONFIG } from '../engine/config';
import type { FirmOpeningState, League } from '../engine/types';

export const SCHEMA_VERSION = 2;
const STORAGE_KEY = 'mecom.leagues.v1';

/**
 * Лиги, сохранённые до появления нового поля конфига, не содержат его в
 * localStorage/файле — без доливки дефолтов арифметика упадёт в NaN
 * (schemaVersion при этом не меняется, само добавление поля — не разрыв
 * формата). Лишние поля старого конфига (например, переименованные) просто
 * игнорируются остальным кодом.
 */
function withConfigDefaults(league: League): League {
  const old = league.config;
  // Do not silently retire custom calibrated curves/tables from archived parties.
  const retired = ['priceLambda', 'priceFTable', 'priceLowExtrapolation', 'demandCoeffLow',
    'demandExpLow', 'demandCoeffHigh', 'demandExpHigh', 'demandBreakpoint',
    'demandRndPeriodNorm', 'demandRndDecayScale', 'demandRndExcessSlope',
    'demandMktgLnCoeffA', 'demandMktgLnCoeffB', 'demandMktgLnOffset', 'demandMktgLnNorm'] as const;
  const customLegacy = retired.some(key => old?.[key] !== undefined &&
    JSON.stringify(old[key]) !== JSON.stringify(DEFAULT_LEAGUE_CONFIG[key]));
  // Upgrade only the complete old standard pair in an otherwise standard cost
  // scenario. Custom/legacy scenarios and partial pairs retain their numbers.
  // Archived results and opening balances are never recomputed by this loader.
  const standardCost = !old?.costDenominatorsCustom && !customLegacy && old?.demandModel !== 'legacy' &&
    old?.costCuUp === 145 && old?.costCuDown === 72.5 &&
    old?.costK1 === 15 && old?.costK2 === 3 && old?.costOptimalCu === 80;
  return { ...league, config: { ...DEFAULT_LEAGUE_CONFIG, ...old,
    ...(standardCost ? { costCuUp: DEFAULT_LEAGUE_CONFIG.costCuUp,
      costCuDown: DEFAULT_LEAGUE_CONFIG.costCuDown } : {}),
    demandModel: old?.demandModel ?? (customLegacy ? 'legacy' : 'native'),
    employmentModel: old?.employmentModel ?? (
      (old?.baseStaff !== undefined && old.baseStaff !== DEFAULT_LEAGUE_CONFIG.baseStaff) ||
      (old?.staffPerUnit !== undefined && old.staffPerUnit !== DEFAULT_LEAGUE_CONFIG.staffPerUnit)
        ? 'legacy' : 'native'),
    featureFlags: {
      ...DEFAULT_LEAGUE_CONFIG.featureFlags,
      ...old?.featureFlags,
      // Older saved leagues defaulted to end-of-period borrowing; keep that
      // behavior when loading them instead of silently changing an active game.
      loanRepayment: old?.featureFlags?.loanRepayment ?? 'none',
    },
    nativeDemand: { ...DEFAULT_LEAGUE_CONFIG.nativeDemand, ...old?.nativeDemand },
  } };
}

/** Снимок партии: сама лига плюс состояние фирм на начало текущего периода. */
export interface LeagueSnapshot {
  league: League;
  /** Состояние на начало периода league.results.length. */
  opening: Record<string, FirmOpeningState>;
}

/** В старых снимках восстанавливаем только новые счётчики РИФ, не историю расчётов. */
function withSnapshotDefaults(snapshot: LeagueSnapshot): LeagueSnapshot {
  const league = withConfigDefaults(snapshot.league);
  const opening = { ...snapshot.opening };
  for (const [id, state] of Object.entries(opening)) {
    if (state.demandPotentialCumulative !== undefined && state.productionCumulative !== undefined) continue;
    let demand = 0;
    let production = 0;
    for (const period of league.results) {
      const result = period.firms.find(f => f.firmId === id);
      if (!result) continue;
      demand += result.marketingExpense + result.rndExpense;
      production += result.produced;
    }
    opening[id] = {
      ...state,
      demandPotentialCumulative: state.demandPotentialCumulative ?? demand,
      productionCumulative: state.productionCumulative ?? production,
    };
  }
  return { ...snapshot, league, opening };
}

export interface StoredData {
  schemaVersion: number;
  leagues: Record<string, LeagueSnapshot>;
}

function emptyData(): StoredData {
  return { schemaVersion: SCHEMA_VERSION, leagues: {} };
}

export function loadAll(): StoredData {
  if (typeof localStorage === 'undefined') return emptyData();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyData();
    const parsed = JSON.parse(raw) as StoredData;
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
      console.warn(
        `Данные сохранены схемой v${parsed.schemaVersion}, текущая v${SCHEMA_VERSION}. ` +
          'Партии оставлены как есть — проверьте их перед продолжением.',
      );
    }
    const leagues = parsed.leagues ?? {};
    for (const id of Object.keys(leagues)) {
      leagues[id] = withSnapshotDefaults(leagues[id]);
    }
    return { schemaVersion: SCHEMA_VERSION, leagues };
  } catch (error) {
    console.error('Не удалось прочитать сохранённые лиги:', error);
    return emptyData();
  }
}

export function saveAll(data: StoredData): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    console.error('Не удалось сохранить лиги:', error);
  }
}

export function saveSnapshot(snapshot: LeagueSnapshot): void {
  const data = loadAll();
  data.leagues[snapshot.league.id] = snapshot;
  saveAll(data);
}

export function deleteLeague(leagueId: string): void {
  const data = loadAll();
  delete data.leagues[leagueId];
  saveAll(data);
}

// ---------------------------------------------------------------------------
// Экспорт / импорт файлом
// ---------------------------------------------------------------------------

export interface LeagueFile {
  schemaVersion: number;
  exportedAt: string;
  snapshot: LeagueSnapshot;
}

export function serializeLeague(snapshot: LeagueSnapshot): string {
  const file: LeagueFile = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    snapshot,
  };
  return JSON.stringify(file, null, 2);
}

/** Разбор файла лиги с внятной ошибкой вместо падения интерфейса. */
export function parseLeagueFile(text: string): LeagueSnapshot {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('Файл не является корректным JSON.');
  }

  const candidate = file as Partial<LeagueFile>;
  const snapshot = candidate.snapshot;

  if (!snapshot?.league?.id || !Array.isArray(snapshot.league.firms)) {
    throw new Error('В файле нет данных лиги — похоже, это не экспорт МЭКОМ.');
  }
  if (candidate.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `Файл сохранён схемой v${candidate.schemaVersion}, приложение понимает v${SCHEMA_VERSION}.`,
    );
  }
  if (!snapshot.opening) {
    throw new Error('В файле нет состояния фирм на начало периода.');
  }

  return withSnapshotDefaults(snapshot);
}

/** Скачивание файла лиги из браузера. */
export function downloadLeagueFile(snapshot: LeagueSnapshot): void {
  const blob = new Blob([serializeLeague(snapshot)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName = snapshot.league.name.replace(/[^\p{L}\p{N}_-]+/gu, '_');
  link.href = url;
  link.download = `mecom-${safeName}-p${snapshot.league.results.length}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
