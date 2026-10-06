import { useState } from 'react';
import { useCurrentSnapshot } from '../../state/leagueStore';
import { money, num, percent, deltaPercent } from '../../report/format';

type Metric = 'price' | 'revenue' | 'netProfit' | 'retainedEarnings' | 'orders' | 'rif' | 'cash';

const METRICS: { key: Metric; label: string; format: (v: number) => string }[] = [
  { key: 'price', label: 'Цена', format: (v) => money(v, 2) },
  { key: 'orders', label: 'Заказы', format: (v) => num(v) },
  { key: 'revenue', label: 'Выручка', format: (v) => money(v) },
  { key: 'netProfit', label: 'Чистая прибыль', format: (v) => money(v) },
  { key: 'retainedEarnings', label: 'Накопленная прибыль', format: (v) => money(v) },
  { key: 'cash', label: 'Наличные', format: (v) => money(v) },
  { key: 'rif', label: 'РИФ', format: (v) => num(v, 1) },
];

export function HistoryScreen() {
  const snapshot = useCurrentSnapshot();
  const [metric, setMetric] = useState<Metric>('rif');

  if (!snapshot) return <p className="hint">Лига не выбрана.</p>;

  const { league } = snapshot;
  if (league.results.length === 0) {
    return <p className="hint">Ещё ни один период не рассчитан.</p>;
  }

  const chosen = METRICS.find((m) => m.key === metric)!;

  const valueOf = (periodIndex: number, firmId: string): number | null => {
    const firm = league.results[periodIndex]?.firms.find((f) => f.firmId === firmId);
    if (!firm) return null;
    switch (metric) {
      case 'price':
        return firm.decision.price;
      case 'orders':
        return firm.ordersReceived;
      case 'revenue':
        return firm.revenue;
      case 'netProfit':
        return firm.netProfit;
      case 'retainedEarnings':
        return firm.retainedEarnings;
      case 'cash':
        return firm.cash;
      case 'rif':
        return firm.rif.total;
    }
  };

  return (
    <div>
      <div className="panel">
        <h2>История лиги «{league.name}»</h2>
        <div className="row" style={{ marginBottom: 14 }}>
          <span className="hint">Показатель:</span>
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={metric === m.key ? 'active' : ''}
              style={metric === m.key ? { borderColor: 'var(--accent)', color: 'var(--accent)' } : undefined}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>

        <table>
          <thead>
            <tr>
              <th>Период</th>
              {league.firms.map((f) => (
                <th key={f.id} className="num">
                  {f.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {league.results.map((period, i) => (
              <tr key={period.periodIndex}>
                <td>{period.periodIndex}</td>
                {league.firms.map((f) => {
                  const value = valueOf(i, f.id);
                  const result = period.firms.find((r) => r.firmId === f.id);
                  return (
                    <td key={f.id} className="num" style={result?.isBankrupt ? { color: 'var(--danger)' } : undefined}>
                      {value === null ? '—' : chosen.format(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>Индустрия по периодам</h2>
        <table>
          <thead>
            <tr>
              <th>Период</th>
              <th className="num">Заказы</th>
              <th className="num">Произв.</th>
              <th className="num">Продано</th>
              <th className="num">Склад</th>
              <th className="num">Мощность</th>
              <th className="num">Выручка</th>
              <th className="num">Средняя цена</th>
              <th className="num">Загрузка</th>
            </tr>
          </thead>
          <tbody>
            {league.results.map((p) => (
              <tr key={p.periodIndex}>
                <td>{p.periodIndex}</td>
                <td className="num">
                  {num(p.industry.totalOrders)}{' '}
                  <span className="hint">{deltaPercent(p.industry.deltas.totalOrders)}</span>
                </td>
                <td className="num">{num(p.industry.totalProduced)}</td>
                <td className="num">{num(p.industry.totalSold)}</td>
                <td className="num">{num(p.industry.totalInventory)}</td>
                <td className="num">{num(p.industry.totalCapacity)}</td>
                <td className="num">{money(p.industry.industryRevenue)}</td>
                <td className="num">{money(p.industry.avgPrice, 2)}</td>
                <td className="num">{percent(p.industry.industryUtilization)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
