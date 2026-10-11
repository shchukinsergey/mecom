import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PublicHistoryPeriod } from '../../online/roomTypes';
import './CompetitionHistoryChart.css';

export type HistoryMetric = 'rif' | 'netProfit' | 'marketShareSold' | 'revenue' | 'retainedEarnings';
const metrics: Array<{ key: HistoryMetric; label: string }> = [
  { key: 'rif', label: 'РИФ' }, { key: 'netProfit', label: 'Чистая прибыль' },
  { key: 'marketShareSold', label: 'Доля рынка' }, { key: 'revenue', label: 'Выручка' },
  { key: 'retainedEarnings', label: 'Накопленная прибыль' },
];
const palette = ['#dc414e', '#16836a', '#3469d6', '#9158bb', '#b36a13', '#16839a', '#b34287', '#657b27'];
function firmColor(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
export function formatHistoryValue(value: number, metric: HistoryMetric, delta = false) {
  if (!Number.isFinite(value)) return 'Нет данных';
  const number = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: metric === 'rif' || metric === 'marketShareSold' ? 1 : 0, maximumFractionDigits: 1 }).format(value);
  const unit = metric === 'marketShareSold' ? (delta ? ' п.п.' : ' %') : metric === 'rif' ? '' : ' $';
  return `${delta && value > 0 ? '+' : ''}${number}${unit}`;
}

/** Completed public results only; missing results never carry forward. */
export function buildHistoryChartModel(history: PublicHistoryPeriod[], metric: HistoryMetric, ownFirmId: string, width = 900) {
  width = Number.isFinite(width) ? Math.max(240, width) : 900;
  const periods = [...new Map(history.filter(p => Number.isInteger(p.periodIndex) && p.periodIndex >= 0).map(p => [p.periodIndex, p])).values()].sort((a, b) => a.periodIndex - b.periodIndex);
  const firms = new Map<string, string>();
  periods.forEach(p => p.firms.forEach(f => firms.set(f.firmId, f.firmName)));
  const values = periods.flatMap(p => p.firms.map(f => f[metric])).filter(Number.isFinite);
  let min = values.length ? Math.min(...values) : 0;
  let max = values.length ? Math.max(...values) : 1;
  const padding = max === min ? Math.max(Math.abs(max) * 0.1, 1) : (max - min) * 0.12;
  min -= padding; max += padding;
  const x = (index: number) => periods.length <= 1 ? width / 2 : 64 + index * (width - 108) / (periods.length - 1);
  const y = (value: number) => 268 - ((value - min) / (max - min)) * 236;
  const usedColors = new Set<string>();
  const series = [...firms].sort(([a], [b]) => a.localeCompare(b)).map(([firmId, firmName], index) => {
    let color = firmColor(firmId);
    if (usedColors.has(color)) color = palette.find(candidate => !usedColors.has(candidate)) ?? `hsl(${index * 137.508 % 360} 65% 40%)`;
    usedColors.add(color);
    let lastPeriod: number | null = null;
    let path = '';
    const points: Array<{ periodIndex: number; x: number; y: number; value: number }> = [];
    periods.forEach((period, index) => {
      const value = period.firms.find(f => f.firmId === firmId)?.[metric];
      if (value === undefined || !Number.isFinite(value)) { lastPeriod = null; return; }
      const point = { periodIndex: period.periodIndex, value, x: x(index), y: y(value) };
      path += `${lastPeriod !== null && period.periodIndex === lastPeriod + 1 ? 'L' : 'M'}${point.x},${point.y} `;
      points.push(point); lastPeriod = period.periodIndex;
    });
    return { firmId, firmName, color, path, points };
  });
  const latest = periods.at(-1);
  const value = latest?.firms.find(f => f.firmId === ownFirmId)?.[metric];
  const previous = periods.at(-2);
  const previousValue = previous?.firms.find(f => f.firmId === ownFirmId)?.[metric];
  const validLatest = latest?.firms.filter(f => Number.isFinite(f[metric])) ?? [];
  const own = value !== undefined && Number.isFinite(value) ? {
    value, rank: 1 + validLatest.filter(f => f[metric] > value).length, total: validLatest.length,
    delta: previous && latest && previous.periodIndex === latest.periodIndex - 1 && previousValue !== undefined && Number.isFinite(previousValue) ? value - previousValue : null,
  } : null;
  return { periods, series, min, max, x, y, own };
}

export function CompetitionHistoryChart({ history, ownFirmId }: { history: PublicHistoryPeriod[]; ownFirmId: string }) {
  const [metric, setMetric] = useState<HistoryMetric>('rif');
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [selectedPeriod, setSelectedPeriod] = useState<number | null>(null);
  const id = useId();
  const chartRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const model = useMemo(() => buildHistoryChartModel(history, metric, ownFirmId, width), [history, metric, ownFirmId, width]);
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;
    const resize = () => setWidth(Math.max(240, element.clientWidth, model.periods.length > 6 ? model.periods.length * 100 : 0));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [model.periods.length]);
  const label = metrics.find(m => m.key === metric)!.label;
  const latest = model.periods.at(-1);
  const selected = model.periods.find(p => p.periodIndex === selectedPeriod) ?? latest;
  const visible = model.series.filter(s => !hidden.has(s.firmId));
  const toggle = (firmId: string) => setHidden(current => {
    const next = new Set(current);
    if (next.has(firmId)) next.delete(firmId); else next.add(firmId);
    return next;
  });
  return <section className="online-card competition-history" aria-labelledby={`${id}-heading`}>
    <header className="competition-history__header">
      <div><span className="competition-history__eyebrow">РЕЗУЛЬТАТЫ ВСЕХ КОМАНД</span><h2 id={`${id}-heading`}>Как идёт игра</h2>
        <p>{latest ? `Рассчитанные периоды ${model.periods[0].periodIndex}–${latest.periodIndex} · последние результаты: период ${latest.periodIndex}` : 'История появится после расчёта первого периода'}</p></div>
      <span className="competition-history__completed">Только рассчитанные периоды</span>
    </header>
    <div className="competition-history__metrics" role="group" aria-label="Показатель графика">
      {metrics.map(m => <button type="button" key={m.key} aria-pressed={m.key === metric} onClick={() => setMetric(m.key)}>{m.label}</button>)}
    </div>
    {latest && <div className="competition-history__summary">
      <div><span className="competition-history__badge">Вы</span><span>{label} · период {latest.periodIndex}</span><strong>{model.own ? formatHistoryValue(model.own.value, metric) : 'Нет данных'}</strong></div>
      <div><span>Место среди команд</span><strong>{model.own ? `${model.own.rank} из ${model.own.total}` : '—'}</strong></div>
      <div><span>К предыдущему периоду</span><strong className={model.own?.delta == null ? '' : model.own.delta > 0 ? 'competition-history__positive' : model.own.delta < 0 ? 'competition-history__negative' : ''}>{model.own?.delta == null ? 'Нет сравнения' : formatHistoryValue(model.own.delta, metric, true)}</strong></div>
    </div>}
    {!latest ? <div className="competition-history__empty"><strong>Пока нет рассчитанных периодов</strong><p>Здесь будут линии всех команд — от периода 0 до последних результатов.</p></div> : <>
      <div ref={chartRef} className="competition-history__chart" onMouseLeave={() => setSelectedPeriod(null)}>
        <svg viewBox={`0 0 ${width} 320`} preserveAspectRatio="none" style={{ minWidth: model.periods.length > 6 ? model.periods.length * 100 : 0 }} role="group" aria-label={`История результатов: ${label}`}>
          <text x="64" y="17" className="competition-history__axis-title">{label}{metric === 'marketShareSold' ? ', %' : metric === 'rif' ? '' : ', $'}</text>
          {Array.from({ length: 5 }, (_, index) => {
            const value = model.min + (model.max - model.min) * index / 4;
            const y = model.y(value);
            return <g key={index}><line x1="64" x2={width - 44} y1={y} y2={y} className="competition-history__grid" /><text x="54" y={y + 4} textAnchor="end">{new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}</text></g>;
          })}
          {model.min < 0 && model.max > 0 && <line x1="64" x2={width - 44} y1={model.y(0)} y2={model.y(0)} className="competition-history__zero" />}
          {visible.filter(s => s.firmId !== ownFirmId).concat(visible.filter(s => s.firmId === ownFirmId)).map(s => <g key={s.firmId} data-firm-id={s.firmId}>
            <path d={s.path} fill="none" stroke={s.color} strokeWidth={s.firmId === ownFirmId ? 4 : 2.5} vectorEffect="non-scaling-stroke" />
            {s.points.map(point => <circle key={point.periodIndex} cx={point.x} cy={point.y} r={s.firmId === ownFirmId ? 5 : 4} fill="var(--bg-panel, #fff)" stroke={s.color} strokeWidth={s.firmId === ownFirmId ? 3 : 2} vectorEffect="non-scaling-stroke" />)}
          </g>)}
          {selected && <line x1={model.x(model.periods.indexOf(selected))} x2={model.x(model.periods.indexOf(selected))} y1="26" y2="274" className="competition-history__cursor" />}
          {model.periods.map((period, index) => <g key={period.periodIndex}>
            <text x={model.x(index)} y="299" textAnchor="middle">Период {period.periodIndex}</text>
            <rect x={model.x(index) - (model.periods.length > 1 ? Math.min(40, (width - 108) / (2 * (model.periods.length - 1))) : 40)} y="25" width={model.periods.length > 1 ? Math.min(80, (width - 108) / (model.periods.length - 1)) : 80} height="250" fill="transparent" tabIndex={0} role="button" aria-label={`Показать значения за период ${period.periodIndex}`} aria-describedby={`${id}-values`} onMouseEnter={() => setSelectedPeriod(period.periodIndex)} onFocus={() => setSelectedPeriod(period.periodIndex)} onClick={() => setSelectedPeriod(period.periodIndex)} onKeyDown={event => {
              if (event.key === 'Escape') { setSelectedPeriod(null); return; }
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedPeriod(period.periodIndex); return; }
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const targets = event.currentTarget.ownerSVGElement?.querySelectorAll<SVGRectElement>('rect[tabindex]');
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? model.periods.length - 1 : Math.max(0, Math.min(model.periods.length - 1, index + (event.key === 'ArrowLeft' ? -1 : 1)));
                targets?.[next]?.focus();
              }
            }}><title>{`Период ${period.periodIndex}: ${visible.map(s => `${s.firmName}: ${formatHistoryValue(period.firms.find(f => f.firmId === s.firmId)?.[metric] ?? NaN, metric)}`).join('; ')}`}</title></rect>
          </g>)}
        </svg>
      </div>
      <div className="competition-history__legend" role="group" aria-label="Показать или скрыть команды">
        {model.series.map(s => <button type="button" key={s.firmId} aria-pressed={!hidden.has(s.firmId)} onClick={() => toggle(s.firmId)} className={hidden.has(s.firmId) ? 'competition-history__hidden-team' : ''}>
          <span className="competition-history__swatch" style={{ backgroundColor: s.color }} />{s.firmName}{s.firmId === ownFirmId && <span className="competition-history__badge">Вы</span>}
        </button>)}
      </div>
      <div id={`${id}-values`} className="competition-history__values" aria-live="polite" aria-atomic="true">
        <strong>Период {selected?.periodIndex} <span>· {label}</span></strong>
        <dl>{visible.map(s => <div key={s.firmId}><dt><span className="competition-history__swatch" style={{ backgroundColor: s.color }} />{s.firmName}{s.firmId === ownFirmId && ' · Вы'}</dt><dd>{formatHistoryValue(selected?.firms.find(f => f.firmId === s.firmId)?.[metric] ?? NaN, metric)}</dd></div>)}</dl>
        {visible.length === 0 && <p>Все команды скрыты. Выберите команду в легенде.</p>}
      </div>
      <p className="competition-history__hint">Наведите на период или выберите его клавишей Tab. ← → — соседний период. Нажмите на команду, чтобы скрыть её линию.</p>
      <details className="competition-history__table"><summary>Все значения в таблице</summary><div><table><caption>История результатов: {label}</caption><thead><tr><th scope="col">Период</th>{visible.map(s => <th scope="col" key={s.firmId}>{s.firmName}{s.firmId === ownFirmId && ' · Вы'}</th>)}</tr></thead><tbody>{model.periods.map(p => <tr key={p.periodIndex}><th scope="row">{p.periodIndex}</th>{visible.map(s => <td key={s.firmId}>{formatHistoryValue(p.firms.find(f => f.firmId === s.firmId)?.[metric] ?? NaN, metric)}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </section>;
}
