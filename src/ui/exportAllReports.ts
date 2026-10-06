/**
 * Массовая выгрузка отчётов всех фирм за все посчитанные периоды одним архивом:
 * `<лига>.zip` → `<лига>/<период>/<фирма>.png` — запасной вариант для браузеров
 * без File System Access API (см. reportsFolder.ts — там то же самое, но пишется
 * сразу в папку на диске).
 */

import JSZip from 'jszip';
import { renderFirmExport } from '../report';
import { renderReportPng, sanitizeFileName } from './reportImage';
import type { League } from '../engine/types';

function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

/**
 * Собирает архив с отчётами всех фирм за все посчитанные периоды лиги и
 * скачивает его. `onProgress` — необязательный колбэк для индикации хода
 * рендеринга (растеризация PNG по одному отчёту занимает заметное время).
 */
export async function downloadAllFirmReports(
  league: League,
  includeIndustry: boolean,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const zip = new JSZip();
  const leagueFolder = zip.folder(sanitizeFileName(league.name));
  if (!leagueFolder) throw new Error('Не удалось создать архив.');

  const total = league.results.reduce((sum, period) => sum + period.firms.length, 0);
  let done = 0;
  onProgress?.(done, total);

  for (const period of league.results) {
    const periodFolder = leagueFolder.folder(String(period.periodIndex));
    if (!periodFolder) continue;

    for (const firm of period.firms) {
      const text = renderFirmExport(firm, period, league.config, league.name, includeIndustry);
      const dataUrl = await renderReportPng(text);
      periodFolder.file(`${sanitizeFileName(firm.firmName)}.png`, dataUrlToBase64(dataUrl), {
        base64: true,
      });
      done += 1;
      onProgress?.(done, total);
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeFileName(league.name)}.zip`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
