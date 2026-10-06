/**
 * Состояние приложения ведущего.
 *
 * Автосохранение в localStorage после каждого расчёта периода и после правки
 * настроек — ведущий не должен терять партию при перезагрузке страницы.
 */

import { create } from 'zustand';
import {
  computePeriod,
  initialOpeningState,
  nextOpeningState,
} from '../engine/computePeriod';
import { DEFAULT_LEAGUE_CONFIG, makeFirmDecision, makeFirmStart, makeMacroParams } from '../engine/config';
import type {
  FirmDecision,
  League,
  LeagueConfig,
  PeriodMacroParams,
} from '../engine/types';
import {
  deleteLeague as removeStoredLeague,
  loadAll,
  saveSnapshot,
  type LeagueSnapshot,
} from './persistence';

export type Screen = 'leagues' | 'setup' | 'period' | 'history';

interface LeagueState {
  screen: Screen;
  leagues: Record<string, LeagueSnapshot>;
  currentLeagueId: string | null;
  /** Ошибка последнего расчёта — показывается ведущему, а не уходит в консоль. */
  computeError: string | null;

  setScreen: (screen: Screen) => void;
  openLeague: (id: string, screen?: Screen) => void;
  createLeague: (name: string, firmNames: string[]) => string;
  deleteLeague: (id: string) => void;
  importSnapshot: (snapshot: LeagueSnapshot) => void;

  updateLeagueConfig: (patch: Partial<LeagueConfig>) => void;
  updateFeatureFlags: (patch: Partial<LeagueConfig['featureFlags']>) => void;
  renameLeague: (name: string) => void;
  updateFirm: (firmId: string, patch: Partial<League['firms'][number]>) => void;
  addFirm: (name: string) => void;
  removeFirm: (firmId: string) => void;

  updateMacro: (patch: Partial<PeriodMacroParams>) => void;
  updateDecision: (firmId: string, patch: Partial<FirmDecision>) => void;
  setConfirmed: (firmId: string, value: boolean) => void;
  computeCurrentPeriod: () => void;
  recomputeLastPeriod: () => void;
}

function newId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Решение фирмы на новый период: наследуется с прошлого периода, если он был,
 * иначе — масштабированные под размер лиги дефолты периода 0 (см. makeFirmDecision).
 */
function carryDecision(
  firmId: string,
  previousSlot: Record<string, FirmDecision> | undefined,
  firmCount: number,
): FirmDecision {
  const previous = previousSlot?.[firmId];
  return previous ? { ...previous, firmId } : makeFirmDecision(firmId, firmCount);
}

/** Индекс периода, который сейчас редактируется. */
export function currentPeriodIndex(league: League): number {
  return league.results.length;
}

/** Макропараметры и решения текущего периода; создаются лениво. */
export function ensurePeriodSlots(league: League): League {
  const index = currentPeriodIndex(league);
  const macroByPeriod = [...league.macroByPeriod];
  const decisionsByPeriod = [...league.decisionsByPeriod];
  const confirmedByPeriod = [...(league.confirmedByPeriod ?? [])];

  while (macroByPeriod.length <= index) {
    const previous = macroByPeriod[macroByPeriod.length - 1];
    macroByPeriod.push(
      previous
        ? // Макропараметры переносятся с прошлого периода, кроме циклов —
          // ДС/ВМ/ВН ведущий задаёт заново под сценарий каждого периода.
          { ...previous, periodIndex: macroByPeriod.length, scenarioNewsText: '' }
        : makeMacroParams(macroByPeriod.length),
    );
  }

  while (decisionsByPeriod.length <= index) {
    // Поля по умолчанию — решения фирмы за прошлый период: ведущему не нужно
    // вводить их с нуля, только поправить то, что изменилось.
    const previousSlot = decisionsByPeriod[decisionsByPeriod.length - 1];
    const slot: Record<string, FirmDecision> = {};
    for (const f of league.firms) slot[f.id] = carryDecision(f.id, previousSlot, league.firms.length);
    decisionsByPeriod.push(slot);
  }

  while (confirmedByPeriod.length <= index) {
    const slot: Record<string, boolean> = {};
    for (const f of league.firms) slot[f.id] = false;
    confirmedByPeriod.push(slot);
  }

  return { ...league, macroByPeriod, decisionsByPeriod, confirmedByPeriod };
}

export const useLeagueStore = create<LeagueState>((set, get) => ({
  screen: 'leagues',
  leagues: loadAll().leagues,
  currentLeagueId: null,
  computeError: null,

  setScreen: (screen) => set({ screen }),

  openLeague: (id, screen = 'period') => set({ currentLeagueId: id, screen, computeError: null }),

  createLeague: (name, firmNames) => {
    const id = newId('league');
    const league: League = {
      id,
      name: name.trim() || 'Новая лига',
      createdAt: new Date().toISOString(),
      config: structuredClone(DEFAULT_LEAGUE_CONFIG),
      firms: firmNames.map((firmName, i) => ({
        ...makeFirmStart(firmNames.length, DEFAULT_LEAGUE_CONFIG.machineCost),
        id: newId('firm'),
        name: firmName.trim() || `Фирма ${i + 1}`,
      })),
      macroByPeriod: [],
      decisionsByPeriod: [],
      confirmedByPeriod: [],
      results: [],
    };

    const prepared = ensurePeriodSlots(league);
    const snapshot: LeagueSnapshot = {
      league: prepared,
      opening: initialOpeningState(prepared),
    };

    saveSnapshot(snapshot);
    set((s) => ({
      leagues: { ...s.leagues, [id]: snapshot },
      currentLeagueId: id,
      screen: 'setup',
      computeError: null,
    }));
    return id;
  },

  deleteLeague: (id) => {
    removeStoredLeague(id);
    set((s) => {
      const leagues = { ...s.leagues };
      delete leagues[id];
      return {
        leagues,
        currentLeagueId: s.currentLeagueId === id ? null : s.currentLeagueId,
        screen: s.currentLeagueId === id ? 'leagues' : s.screen,
      };
    });
  },

  importSnapshot: (snapshot) => {
    saveSnapshot(snapshot);
    set((s) => ({
      leagues: { ...s.leagues, [snapshot.league.id]: snapshot },
      currentLeagueId: snapshot.league.id,
      screen: 'period',
      computeError: null,
    }));
  },

  updateLeagueConfig: (patch) =>
    mutate(set, get, (snap) => ({
      ...snap,
      league: { ...snap.league, config: { ...snap.league.config,
        ...((patch.costCuUp !== undefined || patch.costCuDown !== undefined)
          ? { costDenominatorsCustom: true } : {}), ...patch } },
    })),

  updateFeatureFlags: (patch) =>
    mutate(set, get, (snap) => ({
      ...snap,
      league: {
        ...snap.league,
        config: {
          ...snap.league.config,
          featureFlags: { ...snap.league.config.featureFlags, ...patch },
        },
      },
    })),

  renameLeague: (name) =>
    mutate(set, get, (snap) => ({ ...snap, league: { ...snap.league, name } })),

  updateFirm: (firmId, patch) =>
    mutate(set, get, (snap) => {
      const league = {
        ...snap.league,
        firms: snap.league.firms.map((f) => (f.id === firmId ? { ...f, ...patch } : f)),
      };
      // Пока партия не началась, правка стартовых условий меняет и состояние
      // на начало периода 0 — иначе настройки разъехались бы с расчётом.
      const opening =
        league.results.length === 0 ? initialOpeningState(league) : snap.opening;
      return { league, opening };
    }),

  addFirm: (name) =>
    mutate(set, get, (snap) => {
      if (snap.league.results.length > 0) return snap; // партия уже идёт
      const firmCount = snap.league.firms.length + 1;
      const firm = {
        ...makeFirmStart(firmCount, snap.league.config.machineCost),
        id: newId('firm'),
        name,
      };
      const league = ensurePeriodSlots({
        ...snap.league,
        firms: [...snap.league.firms, firm],
        decisionsByPeriod: snap.league.decisionsByPeriod.map((slot) => ({
          ...slot,
          [firm.id]: makeFirmDecision(firm.id, firmCount),
        })),
        confirmedByPeriod: snap.league.confirmedByPeriod.map((slot) => ({
          ...slot,
          [firm.id]: false,
        })),
      });
      return { league, opening: initialOpeningState(league) };
    }),

  removeFirm: (firmId) =>
    mutate(set, get, (snap) => {
      if (snap.league.results.length > 0) return snap;
      const league = {
        ...snap.league,
        firms: snap.league.firms.filter((f) => f.id !== firmId),
        decisionsByPeriod: snap.league.decisionsByPeriod.map((slot) => {
          const next = { ...slot };
          delete next[firmId];
          return next;
        }),
        confirmedByPeriod: snap.league.confirmedByPeriod.map((slot) => {
          const next = { ...slot };
          delete next[firmId];
          return next;
        }),
      };
      return { league, opening: initialOpeningState(league) };
    }),

  updateMacro: (patch) =>
    mutate(set, get, (snap) => {
      const index = currentPeriodIndex(snap.league);
      const macroByPeriod = [...snap.league.macroByPeriod];
      macroByPeriod[index] = { ...macroByPeriod[index], ...patch, periodIndex: index };
      return { ...snap, league: { ...snap.league, macroByPeriod } };
    }),

  updateDecision: (firmId, patch) =>
    mutate(set, get, (snap) => {
      const index = currentPeriodIndex(snap.league);
      const decisionsByPeriod = [...snap.league.decisionsByPeriod];
      const slot = { ...decisionsByPeriod[index] };
      slot[firmId] = {
        ...(slot[firmId] ?? makeFirmDecision(firmId, snap.league.firms.length)),
        ...patch,
        firmId,
      };
      decisionsByPeriod[index] = slot;

      // Правка любого поля — знак, что ведущий пересмотрел решение фирмы.
      const confirmedByPeriod = [...snap.league.confirmedByPeriod];
      confirmedByPeriod[index] = { ...confirmedByPeriod[index], [firmId]: true };

      return { ...snap, league: { ...snap.league, decisionsByPeriod, confirmedByPeriod } };
    }),

  setConfirmed: (firmId, value) =>
    mutate(set, get, (snap) => {
      const index = currentPeriodIndex(snap.league);
      const confirmedByPeriod = [...snap.league.confirmedByPeriod];
      confirmedByPeriod[index] = { ...confirmedByPeriod[index], [firmId]: value };
      return { ...snap, league: { ...snap.league, confirmedByPeriod } };
    }),

  computeCurrentPeriod: () => {
    const snap = currentSnapshot(get());
    if (!snap) return;

    const league = ensurePeriodSlots(snap.league);
    const index = currentPeriodIndex(league);

    try {
      const results = computePeriod({
        periodIndex: index,
        config: league.config,
        macro: league.macroByPeriod[index],
        firms: league.firms.map((f) => ({ id: f.id, name: f.name })),
        opening: snap.opening,
        decisions: league.decisionsByPeriod[index],
        previousIndustry: league.results[index - 1]?.industry,
      });

      const updated: LeagueSnapshot = {
        league: ensurePeriodSlots({ ...league, results: [...league.results, results] }),
        opening: nextOpeningState(snap.opening, results),
      };

      saveSnapshot(updated);
      set((s) => ({
        leagues: { ...s.leagues, [updated.league.id]: updated },
        computeError: null,
      }));
    } catch (error) {
      set({
        computeError:
          error instanceof Error ? error.message : 'Неизвестная ошибка расчёта периода.',
      });
    }
  },

  /** Откат последнего периода — если ведущий ошибся при вводе решений. */
  recomputeLastPeriod: () => {
    const snap = currentSnapshot(get());
    if (!snap || snap.league.results.length === 0) return;

    const league = { ...snap.league, results: snap.league.results.slice(0, -1) };

    // Состояние на начало периода восстанавливаем прогоном с нуля: хранить
    // историю opening-состояний ради одного отката было бы избыточно.
    let opening = initialOpeningState(league);
    for (const past of league.results) {
      opening = nextOpeningState(opening, past);
    }

    const updated: LeagueSnapshot = { league: ensurePeriodSlots(league), opening };
    saveSnapshot(updated);
    set((s) => ({
      leagues: { ...s.leagues, [updated.league.id]: updated },
      computeError: null,
    }));
  },
}));

// ---------------------------------------------------------------------------

function currentSnapshot(state: LeagueState): LeagueSnapshot | null {
  return state.currentLeagueId ? (state.leagues[state.currentLeagueId] ?? null) : null;
}

/** Обновление текущей лиги с автосохранением. */
function mutate(
  set: (fn: (s: LeagueState) => Partial<LeagueState>) => void,
  get: () => LeagueState,
  updater: (snap: LeagueSnapshot) => LeagueSnapshot,
): void {
  const snap = currentSnapshot(get());
  if (!snap) return;

  const updated = updater(snap);
  const withSlots: LeagueSnapshot = { ...updated, league: ensurePeriodSlots(updated.league) };

  saveSnapshot(withSlots);
  set((s) => ({ leagues: { ...s.leagues, [withSlots.league.id]: withSlots } }));
}

/** Хук текущей лиги. */
export function useCurrentSnapshot(): LeagueSnapshot | null {
  return useLeagueStore((s) => (s.currentLeagueId ? (s.leagues[s.currentLeagueId] ?? null) : null));
}

export type { LeagueSnapshot };
