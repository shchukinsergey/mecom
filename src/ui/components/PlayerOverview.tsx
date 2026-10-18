import type { GameStatus, PlayerMe } from '../../online/api';
import { getPlayerInsights, type PlayerInsightKind } from '../../online/playerInsights';
import { CompetitionHistoryChart } from './CompetitionHistoryChart';
import { formatPlayerValue, playerPublicPeriods, playerPublicRank, PlayerRankChange, PlayerMarket } from './PlayerMarket';

const signalTitles: Record<PlayerInsightKind, string> = {
  'unfulfilled-orders': 'Не все заказы выполнены',
  'ending-inventory': 'Остаток на складе',
  'price-near-unit-cost': 'Цена близка к себестоимости',
  'bank-interest-burden': 'Расходы на кредит',
  'investment-capacity-change': 'Мощность снижается',
  'net-loss': 'Убыток за период',
  'above-economical-utilization': 'Загрузка и себестоимость',
};

function MetricChange({ value, previous, unit = '', inverse = false }: { value: number | undefined; previous: number | undefined; unit?: string; inverse?: boolean }) {
  const delta = typeof value === 'number' && Number.isFinite(value) && typeof previous === 'number' && Number.isFinite(previous) ? value - previous : null;
  const tone = delta === null || delta === 0 ? 'pc-muted' : inverse ? delta > 0 ? 'pc-warning' : 'pc-positive' : delta > 0 ? 'pc-positive' : 'pc-negative';
  return <small className={`pc-metric-change ${tone}`}>{delta === null ? 'Нет сравнения' : `${formatPlayerValue(delta, unit, true)} к прошлому периоду`}</small>;
}

export function PlayerOverview({ me, status, onDecisions }: { me: PlayerMe; status: GameStatus | null; onDecisions: () => void }) {
  const results = (me.recentResults ?? []).filter(r => r.firmId === me.firmId).slice().sort((a, b) => a.periodIndex - b.periodIndex);
  const latest = results.at(-1);
  const candidate = results.at(-2);
  const previous = latest && candidate?.periodIndex === latest.periodIndex - 1 ? candidate : undefined;
  const periods = playerPublicPeriods(status);
  const latestPublic = periods.at(-1);
  const candidatePublic = periods.at(-2);
  const previousPublic = latestPublic && candidatePublic?.periodIndex === latestPublic.periodIndex - 1 ? candidatePublic : undefined;
  const rank = playerPublicRank(latestPublic, me.firmId);
  const oldRank = playerPublicRank(previousPublic, me.firmId);
  const rankDelta = rank !== null && oldRank !== null ? oldRank - rank : null;
  const insights = latest ? getPlayerInsights(latest, previous ?? null, me.config?.costOptimalCu) : [];
  const macro = me.periodMacro;
  const phases = { lobby: 'Ожидаем начала игры', collecting: 'Приём решений', complete: 'Период завершён', closed: 'Игра закрыта' };
  const salesKnown = latest && Number.isFinite(latest.unfulfilledOrders) && Number.isFinite(latest.inventoryEnd);
  const salesCopy = !salesKnown ? 'Данные неполные' : latest.unfulfilledOrders > 0 && latest.inventoryEnd > 0 ? 'Есть невыполненные заказы и остаток'
    : latest.unfulfilledOrders > 0 ? 'Спрос удовлетворён не полностью' : latest.inventoryEnd > 0 ? 'Часть товаров осталась на складе' : 'Все заказы выполнены, склад пуст';
  return <section className="pc-overview">
    <header className="pc-section-head"><div><h2>Ваша компания</h2><p className="pc-muted">{latest ? `Итоги периода ${latest.periodIndex}` : 'Завершённых результатов компании пока нет.'}</p></div></header>
    <div className="pc-company-summary">
      <div className="pc-company-position"><span className="pc-label">Место по РИФ</span>
        <strong className="pc-rank-position">{rank ?? '—'}<PlayerRankChange delta={rankDelta} period={previousPublic?.periodIndex} /></strong>
        {rank !== null && <span className="pc-muted">из {latestPublic?.firms.filter(f => !f.excluded && Number.isFinite(f.rif)).length} · период {latestPublic?.periodIndex}</span>}
        {rankDelta === null && <small className="pc-muted">Нет предыдущего места для сравнения</small>}
      </div>
      <div className="pc-kpis">{latest ? <>
        {[
          { label: 'РИФ', value: latest.rif?.total, previous: previous?.rif?.total, unit: '' },
          { label: 'Чистая прибыль', value: latest.netProfit, previous: previous?.netProfit, unit: '$' },
          { label: 'Денежные средства', value: latest.cash, previous: previous?.cash, unit: '$' },
        ].map(metric => <div className="pc-kpi" key={metric.label}><span className="pc-label">{metric.label}</span><strong className={metric.value < 0 ? 'pc-negative' : undefined}>{formatPlayerValue(metric.value, metric.unit)}</strong><MetricChange value={metric.value} previous={metric.previous} unit={metric.unit} /></div>)}
        <div className="pc-kpi pc-sales-balance"><span className="pc-label">Заказы и склад</span><div className="pc-balance-values">
          {([{ key: 'unfulfilledOrders', label: 'Невыполненные заказы' }, { key: 'inventoryEnd', label: 'На складе' }] as const).map(item => <div className="pc-balance-item" key={item.key}><span className="pc-balance-label">{item.label}</span><strong className={latest[item.key] > 0 ? 'pc-warning' : undefined}>{formatPlayerValue(latest[item.key], 'шт.')}</strong><MetricChange value={latest[item.key]} previous={previous?.[item.key]} unit="шт." inverse /></div>)}
        </div><p className={`pc-balance-status ${salesKnown && (latest.unfulfilledOrders > 0 || latest.inventoryEnd > 0) ? 'pc-warning' : 'pc-muted'}`}>{salesCopy}</p></div>
      </> : <p className="pc-empty">Показатели появятся после расчёта.</p>}</div>
    </div>
    <div className="pc-overview-bottom">
      <section className={`pc-attention${insights.length ? ' pc-attention-warning' : ''}`}><h2>На что обратить внимание</h2>

        {insights.length ? <ul className="pc-signals">{insights.map(insight => <li key={insight.kind}><h3 className="pc-signal-title">{signalTitles[insight.kind]}</h3><p>{insight.text.replace(/^⚠️?\s*/, '')}</p></li>)}</ul>
          : <p className="pc-muted">{latest ? 'Нет сигналов, требующих внимания.' : 'Сигналы появятся после расчёта.'}</p>}
      </section>
      <section className="pc-next-step"><h2>{me.phase === 'collecting' ? me.submitted ? 'Решение уже отправлено' : `Решение на период ${me.currentPeriodIndex}` : phases[me.phase]}</h2>
        <p>{me.phase === 'closed' ? 'Решения больше не принимаются. Результаты и отчёты остаются доступны.' : me.phase === 'lobby' ? 'Решения будут доступны после начала игры.' : me.phase === 'complete' ? 'Период рассчитан. Дождитесь следующего этапа игры.' : me.submitted ? 'Параметры отправлены. Ожидаем остальных участников.' : 'Подготовьте выпуск, цену и инвестиции.'}</p>
        <button className="pc-primary" type="button" onClick={onDecisions}>{me.phase === 'collecting' && !me.submitted ? 'Открыть параметры решения' : 'Посмотреть решение'}</button>
        <div className="pc-macro"><h3>Условия периода {macro?.periodIndex ?? me.currentPeriodIndex}</h3>
          {macro ? <><p>Налог {formatPlayerValue(macro.taxRate * 100, '%')}; базовая ставка банка {formatPlayerValue(macro.bankRateBase * 100, '%')}.</p>{macro.scenarioNewsText && <p className="pc-news">{macro.scenarioNewsText}</p>}</> : <p className="pc-muted">Условия периода недоступны.</p>}
        </div>
      </section>
    </div>
    <PlayerMarket me={me} status={status} />
    <div className="pc-market-history"><h2>Компания на фоне рынка</h2><CompetitionHistoryChart history={periods} ownFirmId={me.firmId} /></div>
  </section>;
}
