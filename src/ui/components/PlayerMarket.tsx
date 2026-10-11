import type { GameStatus, PlayerMe } from '../../online/api';
import type { PublicHistoryPeriod } from '../../online/roomTypes';
import { CompetitionHistoryChart } from './CompetitionHistoryChart';

/** Missing results stay missing; ranking always refers to one calculated period. */
export function playerPublicPeriods(status: GameStatus | null): PublicHistoryPeriod[] {
  return [...new Map((status?.history ?? []).filter(p => Number.isInteger(p.periodIndex) && p.periodIndex >= 0).map(p => [p.periodIndex, p])).values()]
    .sort((a, b) => a.periodIndex - b.periodIndex);
}

export function playerPublicRank(period: PublicHistoryPeriod | undefined, firmId: string): number | null {
  const value = period?.firms.find(f => f.firmId === firmId)?.rif;
  return typeof value === 'number' && Number.isFinite(value)
    ? 1 + period!.firms.filter(f => Number.isFinite(f.rif) && f.rif > value).length : null;
}

export function formatPlayerValue(value: number | null | undefined, unit = '', signed = false): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `${signed && value > 0 ? '+' : ''}${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: unit.includes('$') ? 2 : 1 }).format(value)}${unit ? ` ${unit}` : ''}`;
}

export function PlayerRankChange({ delta, period }: { delta: number | null; period: number | undefined }) {
  if (delta === null) return null;
  const label = delta === 0 ? `Позиция не изменилась относительно периода ${period}`
    : `${delta > 0 ? 'Поднялась' : 'Опустилась'} на ${Math.abs(delta)} относительно периода ${period}`;
  return <span className={`pc-rank-change ${delta > 0 ? 'pc-positive' : delta < 0 ? 'pc-negative' : 'pc-muted'}`} title={label} aria-label={label}>
    {delta === 0 ? '—' : `${delta > 0 ? '↑' : '↓'}${Math.abs(delta)}`}
  </span>;
}

export function PlayerMarket({ me, status }: { me: PlayerMe; status: GameStatus | null }) {
  const periods = playerPublicPeriods(status);
  const latest = periods.at(-1);
  const candidate = periods.at(-2);
  const previous = latest && candidate?.periodIndex === latest.periodIndex - 1 ? candidate : undefined;
  const roster = new Map<string, { firmId: string; firmName: string }>();
  periods.forEach(p => p.firms.forEach(f => roster.set(f.firmId, { firmId: f.firmId, firmName: f.firmName })));
  status?.firms.forEach(f => roster.set(f.firmId, { firmId: f.firmId, firmName: f.firmName }));
  const rows = [...roster.values()].sort((a, b) => {
    const rankA = playerPublicRank(latest, a.firmId) ?? Infinity;
    const rankB = playerPublicRank(latest, b.firmId) ?? Infinity;
    return rankA - rankB || a.firmName.localeCompare(b.firmName, 'ru');
  });
  const currentPeriod = status?.currentPeriodIndex ?? me.currentPeriodIndex;
  return <section className="pc-market">
    <header className="pc-section-head"><div><h2>Рынок и конкуренты</h2>
      <p className="pc-muted">{latest ? `Результаты периода ${latest.periodIndex}.` : 'Рейтинг появится после расчёта периода.'} Статус решений — для текущего периода {currentPeriod}.</p>
    </div></header>
    {!status && <p className="pc-empty" role="status">Данные рынка пока недоступны.</p>}
    <div className="pc-table-scroll" tabIndex={0} role="region" aria-label="Рейтинг всех компаний">
      <table className="pc-market-table"><thead><tr><th scope="col">Место</th><th scope="col">Компания</th><th scope="col" className="pc-numeric">РИФ</th><th scope="col">Решение</th></tr></thead>
        <tbody>{rows.length ? rows.map(f => {
          const rank = playerPublicRank(latest, f.firmId);
          const oldRank = playerPublicRank(previous, f.firmId);
          const delta = rank !== null && oldRank !== null ? oldRank - rank : null;
          const current = status?.firms.find(item => item.firmId === f.firmId);
          const value = latest?.firms.find(item => item.firmId === f.firmId)?.rif;
          return <tr key={f.firmId} className={f.firmId === me.firmId ? 'pc-own-row' : undefined}>
            <td><span className="pc-rank-position">{rank ?? '—'}<PlayerRankChange delta={delta} period={previous?.periodIndex} /></span></td>
            <th scope="row" className="pc-company-name">{f.firmName}{f.firmId === me.firmId && <span className="pc-own-label">Вы</span>}</th>
            <td className="pc-numeric">{formatPlayerValue(value)}</td>
            <td className="pc-decision-status"><span className={current?.submitted ? 'pc-positive' : 'pc-muted'}>{current ? current.submitted ? 'Отправлено' : 'Не отправлено' : 'Нет данных'}</span></td>
          </tr>;
        }) : <tr><td colSpan={4} className="pc-empty">Компании пока не присоединились к игре.</td></tr>}</tbody>
      </table>
    </div>
    <div className="pc-market-history"><CompetitionHistoryChart history={periods} ownFirmId={me.firmId} /></div>
  </section>;
}
