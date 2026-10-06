/**
 * Блок отчёта с кнопками «Копировать текст» и «Скачать как изображение».
 */

import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';

interface Props {
  text: string;
  fileName: string;
  /** Дополнительные элементы управления справа от кнопок экспорта. */
  extra?: React.ReactNode;
}

export function ReportView({ text, fileName, extra }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<string | null>(null);

  const flash = (message: string) => {
    setStatus(message);
    setTimeout(() => setStatus(null), 2500);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      flash('Скопировано в буфер обмена');
    } catch {
      // Clipboard API недоступен без https/разрешения — честно говорим об этом,
      // текст всегда можно выделить мышью прямо из блока.
      flash('Не удалось скопировать — выделите текст вручную');
    }
  };

  const downloadPng = async () => {
    if (!ref.current) return;
    try {
      flash('Готовлю изображение…');
      const dataUrl = await toPng(ref.current, {
        backgroundColor: getComputedStyle(ref.current).backgroundColor,
        pixelRatio: 2,
      });
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `${fileName}.png`;
      link.click();
      flash('Изображение скачано');
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Не удалось создать изображение');
    }
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button onClick={copy}>Копировать текст</button>
        <button onClick={downloadPng}>Скачать как изображение</button>
        {extra}
        {status && <span className="hint">{status}</span>}
      </div>
      <p className="report-scroll-hint">На узком экране сдвигайте отчёт влево/вправо, чтобы увидеть все колонки.</p>
      <div className="report" ref={ref}>
        <pre>{text}</pre>
      </div>
    </div>
  );
}
