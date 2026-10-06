/**
 * Привязка лиги к папке на диске (File System Access API — Chrome/Edge) для
 * автосохранения PNG-отчётов при каждом расчёте периода: `<папка>/<лига>/
 * <период>/<фирма>.png`. Права доступа и сам хендл папки браузер не отдаёт в
 * localStorage (не сериализуется в JSON) — хендлы лежат в IndexedDB, по одному
 * на лигу. В браузерах без этого API (Firefox, Safari) остаётся ZIP-экспорт
 * (см. ui/exportAllReports.ts).
 */

import type { League, PeriodResults } from '../engine/types';
import { renderFirmExport } from '../report';
import { renderReportPng, sanitizeFileName } from '../ui/reportImage';

const DB_NAME = 'mecom-reports-dirs';
const STORE_NAME = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error as unknown as Error);
  });
}

async function idbGet(key: string): Promise<FileSystemDirectoryHandle | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as FileSystemDirectoryHandle | undefined);
    req.onerror = () => reject(req.error as unknown as Error);
  });
}

async function idbSet(key: string, value: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error as unknown as Error);
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error as unknown as Error);
  });
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export type FolderPermission = 'granted' | 'prompt-needed' | 'denied';

/** Хендл на папку лиги, привязанную ранее — без запроса прав (см. checkPermission). */
export async function getStoredFolder(leagueId: string): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await idbGet(leagueId)) ?? null;
  } catch {
    return null;
  }
}

export async function checkPermission(handle: FileSystemDirectoryHandle): Promise<FolderPermission> {
  const state = await handle.queryPermission({ mode: 'readwrite' });
  if (state === 'granted') return 'granted';
  if (state === 'denied') return 'denied';
  return 'prompt-needed';
}

/** Должен вызываться напрямую из обработчика клика — иначе браузер молча откажет. */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const state = await handle.requestPermission({ mode: 'readwrite' });
  return state === 'granted';
}

/**
 * Открывает системный диалог выбора папки, создаёт в ней подпапку с именем
 * лиги и сохраняет привязку в IndexedDB. Должен вызываться напрямую из
 * обработчика клика (жест пользователя).
 */
export async function connectReportsFolder(
  leagueId: string,
  leagueName: string,
): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error('Браузер не поддерживает сохранение отчётов в папку (нужен Chrome или Edge).');
  }
  const picked = await window.showDirectoryPicker({ mode: 'readwrite' });
  const leagueDir = await picked.getDirectoryHandle(sanitizeFileName(leagueName), { create: true });
  await idbSet(leagueId, leagueDir);
  return leagueDir;
}

export async function disconnectReportsFolder(leagueId: string): Promise<void> {
  await idbDelete(leagueId);
}

async function writeReportFile(
  periodDir: FileSystemDirectoryHandle,
  fileName: string,
  dataUrl: string,
): Promise<void> {
  const blob = await (await fetch(dataUrl)).blob();
  const fileHandle = await periodDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

/** Сохраняет отчёты всех фирм одного периода в `<папка лиги>/<период>/<фирма>.png`. */
export async function saveReportsForPeriod(
  dirHandle: FileSystemDirectoryHandle,
  league: League,
  period: PeriodResults,
  includeIndustry: boolean,
): Promise<void> {
  const periodDir = await dirHandle.getDirectoryHandle(String(period.periodIndex), { create: true });
  for (const firm of period.firms) {
    const text = renderFirmExport(firm, period, league.config, league.name, includeIndustry);
    const dataUrl = await renderReportPng(text);
    await writeReportFile(periodDir, `${sanitizeFileName(firm.firmName)}.png`, dataUrl);
  }
}

/**
 * Досохраняет отчёты за все посчитанные периоды лиги — вызывается сразу после
 * подключения папки, чтобы прошлые периоды не остались без картинок.
 */
export async function saveAllReports(
  dirHandle: FileSystemDirectoryHandle,
  league: League,
  includeIndustry: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = league.results.reduce((sum, period) => sum + period.firms.length, 0);
  let done = 0;
  onProgress?.(done, total);
  for (const period of league.results) {
    await saveReportsForPeriod(dirHandle, league, period, includeIndustry);
    done += period.firms.length;
    onProgress?.(done, total);
  }
}
