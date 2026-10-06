/**
 * Растеризация текста отчёта в PNG — общий кусок для ZIP-экспорта
 * (exportAllReports.ts) и прямой записи в папку на диске (reportsFolder.ts).
 */

import { toPng } from 'html-to-image';

/** Имя файла/папки не должно содержать символы, запрещённые в путях Windows. */
export function sanitizeFileName(name: string): string {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]+/g, '_');
  return cleaned || 'без_названия';
}

/**
 * Рендерит текст отчёта офф-экранным DOM-узлом с классами `.report`/`.report pre`
 * (тема из theme.css), растеризует в PNG — тот же приём, что и в ReportView, но
 * без видимого узла на странице.
 *
 * html-to-image клонирует именно захватываемый узел вместе с его инлайн-стилями:
 * если сместить offscreen сам `.report`-узел через `position: fixed; left: -99999px`,
 * это смещение переезжает и в клон, и итоговый снимок выходит пустым — контент
 * рендерится за пределами холста. Поэтому смещаем не сам узел, а обёртку нулевого
 * размера вокруг него (`width/height: 0; overflow: visible`), а `.report` внутри
 * остаётся обычным блоком в потоке, без своего position/offset.
 */
export async function renderReportPng(text: string): Promise<string> {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'fixed';
  wrapper.style.top = '0';
  wrapper.style.left = '-99999px';
  wrapper.style.width = '0';
  wrapper.style.height = '0';
  wrapper.style.overflow = 'visible';

  const container = document.createElement('div');
  container.className = 'report';
  container.style.width = 'max-content';

  const pre = document.createElement('pre');
  pre.textContent = text;
  container.appendChild(pre);
  wrapper.appendChild(container);
  document.body.appendChild(wrapper);

  try {
    return await toPng(container, {
      backgroundColor: getComputedStyle(container).backgroundColor,
      pixelRatio: 2,
    });
  } finally {
    document.body.removeChild(wrapper);
  }
}
