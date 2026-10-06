import type { FirmPeriodResult } from '../../engine/types';
import type { PlayerInsight } from '../../online/playerInsights';

interface OnlinePeriodSummaryProps {
  result: FirmPeriodResult;
  insights: readonly PlayerInsight[];
}

const money = (value: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value)} $`;
const quantity = (value: number) => `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)} шт.`;

export function OnlinePeriodSummary({ result, insights }: OnlinePeriodSummaryProps) {
  const items: Array<[string, string]> = [
    ['Получено заказов', quantity(result.ordersReceived)],
    ['Продано', quantity(result.sold)],
    ['Невыполненных заказов', quantity(result.unfulfilledOrders)],
    ['На складе', quantity(result.inventoryEnd)],
    ['Чистая прибыль', money(result.netProfit)],
    ['Наличные средства', money(result.cash)],
    ['Займы', money(result.loan)],
    ['Цена', money(result.decision.price)],
    ['Ст. производства ед.прод', money(result.unitCost)],
    ['Полная мощность', quantity(result.fullCapacity)],
    ['Мощность след. период', quantity(result.capacityNextPeriod)],
  ];

  return <section className="online-card online-period-summary" aria-label={`Итоги периода ${result.periodIndex}`}>
    <span className="online-step">КРАТКАЯ СВОДКА</span>
    <h2>Итоги периода {result.periodIndex}</h2>
    <dl className="online-period-summary-grid">
      {items.map(([label, value]) => <div key={label}>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>)}
    </dl>
    <p className="online-muted online-period-capacity-note">«Полная мощность» действует в этом периоде. «Мощность след. период» — после учёта инвестиций.</p>
    {insights.length > 0 && <aside className="online-player-insights" aria-label="Важные наблюдения по периоду">
      <h3>⚠️ Обратите внимание</h3>
      <ul>{insights.map((insight, index) => <li key={`${insight.kind}-${index}`}>{insight.text}</li>)}</ul>
    </aside>}
  </section>;
}
