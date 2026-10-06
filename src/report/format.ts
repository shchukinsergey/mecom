/**
 * Форматирование чисел для моноширинных отчётов.
 *
 * По скриншоту реального отчёта: все денежные значения — целые доллары
 * с разделителем тысяч запятой.
 */

export function num(value: number, fractionDigits = 0): string {
  const rounded = Number(value.toFixed(fractionDigits));
  const [int, frac] = Math.abs(rounded).toFixed(fractionDigits).split('.');
  const withSeparators = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = rounded < 0 ? '-' : '';
  return frac ? `${sign}${withSeparators}.${frac}` : `${sign}${withSeparators}`;
}

/** Денежная сумма со знаком доллара: `$ 67,706`, `$ -12,293`. */
export function money(value: number, fractionDigits = 0): string {
  return `$ ${num(value, fractionDigits)}`;
}

/** Расходная строка P&L — в отчёте показывается со знаком минус. */
export function moneyExpense(value: number): string {
  return value === 0 ? '$ 0' : money(-Math.abs(value));
}

export function percent(fraction: number, fractionDigits = 1): string {
  return `${num(fraction * 100, fractionDigits)}%`;
}

/** Изменение к предыдущему периоду: `+12.3%`, `−27.3%`, пусто если данных нет. */
export function deltaPercent(value: number | null, fractionDigits = 1): string {
  if (value === null || !Number.isFinite(value)) return '';
  const sign = value >= 0 ? '+' : '−';
  return `${sign}${num(Math.abs(value) * 100, fractionDigits)}%`;
}

/** Изменение в штуках (для строки «Складировано»). */
export function deltaUnits(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '';
  const sign = value >= 0 ? '+' : '−';
  return `${sign}${num(Math.abs(value))}`;
}

export function padRight(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + ' '.repeat(width - text.length);
}

export function padLeft(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : ' '.repeat(width - text.length) + text;
}

/** Строка «подпись .......... значение» внутри колонки. */
export function labelValue(
  label: string,
  value: string,
  width: number,
  indent = 0,
): string {
  const prefix = ' '.repeat(indent) + label;
  const space = Math.max(1, width - prefix.length - value.length);
  return prefix + ' '.repeat(space) + value;
}

export function centre(text: string, width: number): string {
  if (text.length >= width) return text;
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text;
}

export function rule(width: number, char = '─'): string {
  return char.repeat(width);
}

/** Дата в формате отчёта: `09.08.2026 20:15`. */
export function reportTimestamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
