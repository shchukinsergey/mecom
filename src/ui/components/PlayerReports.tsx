import { useId, useState } from 'react';
import type { PlayerMe } from '../../online/api';
import type { FirmDecision, FirmPeriodResult } from '../../engine/types';
import { formatPlayerValue } from './PlayerMarket';

type ResultNumberKey = { [K in keyof FirmPeriodResult]-?: FirmPeriodResult[K] extends number ? K : never }[keyof FirmPeriodResult];
type DecisionNumberKey = Exclude<keyof FirmDecision, 'firmId'>;
type Row<K extends string> = { key: K; label: string; unit?: string; emphasis?: boolean; ratio?: boolean };
const pnl: Row<ResultNumberKey>[] = [
  { key: 'revenue', label: 'Выручка' }, { key: 'cogs', label: 'Себестоимость реализованной продукции' },
  { key: 'grossProfit', label: 'Валовая прибыль', emphasis: true }, { key: 'marketingExpense', label: 'Маркетинг' },
  { key: 'rndExpense', label: 'НИОКР' }, { key: 'depreciation', label: 'Амортизация' },
  { key: 'firingPenalty', label: 'Расходы на увольнение' }, { key: 'storageCost', label: 'Хранение' },
  { key: 'bankInterest', label: 'Банковские проценты' }, { key: 'profitBeforeTax', label: 'Прибыль до налога', emphasis: true },
  { key: 'tax', label: 'Налог' }, { key: 'netProfit', label: 'Чистая прибыль', emphasis: true },
];
const balance: Row<ResultNumberKey>[] = [
  { key: 'cash', label: 'Денежные средства' }, { key: 'inventoryValue', label: 'Стоимость запасов' },
  { key: 'capexBookValue', label: 'Балансовая стоимость оборудования' }, { key: 'totalAssets', label: 'Итого активы', emphasis: true },
  { key: 'loan', label: 'Займы' }, { key: 'retainedEarnings', label: 'Накопленная прибыль' },
  { key: 'capital', label: 'Капитал' }, { key: 'totalLiabEquity', label: 'Обязательства и капитал', emphasis: true },
];
const decisions: Row<DecisionNumberKey>[] = [
  { key: 'price', label: 'Цена', unit: '$ за штуку' }, { key: 'production', label: 'Объём производства', unit: 'шт.' },
  { key: 'marketing', label: 'Маркетинг' }, { key: 'capexGross', label: 'Инвестиции брутто' }, { key: 'rnd', label: 'НИОКР' },
];
const operations: Row<ResultNumberKey>[] = [
  { key: 'ordersReceived', label: 'Получено заказов', unit: 'шт.' }, { key: 'produced', label: 'Произведено', unit: 'шт.' },
  { key: 'sold', label: 'Продано', unit: 'шт.' }, { key: 'unfulfilledOrders', label: 'Невыполненные заказы', unit: 'шт.' },
  { key: 'inventoryEnd', label: 'Запас на конец периода', unit: 'шт.' }, { key: 'marketShareSold', label: 'Доля рынка по сбыту', unit: '%' },
  { key: 'unitCost', label: 'Себестоимость единицы' }, { key: 'inventoryUnitCostEnd', label: 'Себестоимость запасов' },
  { key: 'fullCapacity', label: 'Мощность периода', unit: 'шт.' }, { key: 'capacityUtilization', label: 'Загрузка мощности', unit: '%', ratio: true },
  { key: 'employed', label: 'Сотрудники', unit: 'чел.' }, { key: 'capexAdditions', label: 'Дополнительные вложения' },
  { key: 'newMachines', label: 'Изменение мощности', unit: 'шт.' }, { key: 'capacityNextPeriod', label: 'Мощность следующего периода', unit: 'шт.' },
];

function FinancialSection<K extends string>({ title, rows, current, previous, period, previousPeriod }: {
  title: string; rows: Row<K>[]; current: Record<K, number>; previous?: Record<K, number>; period: number; previousPeriod?: number;
}) {
  const id = useId();
  return <section className="pc-report-section" aria-labelledby={id}><h3 id={id}>{title}</h3>
    <div className="pc-table-scroll" tabIndex={0} role="region" aria-label={title}><table className="pc-report-table">
      <thead><tr><th scope="col">Показатель</th><th scope="col" className="pc-numeric">Период {period}</th>{previous && <><th scope="col" className="pc-numeric">Период {previousPeriod}</th><th scope="col" className="pc-numeric">Изменение</th></>}</tr></thead>
      <tbody>{rows.map(row => {
        const unit = row.unit ?? '$';
        const value = row.ratio ? current[row.key] * 100 : current[row.key];
        const oldRaw = previous?.[row.key];
        const old = row.ratio && typeof oldRaw === 'number' ? oldRaw * 100 : oldRaw;
        const delta = typeof value === 'number' && Number.isFinite(value) && typeof old === 'number' && Number.isFinite(old) ? value - old : undefined;
        return <tr key={row.key} className={row.emphasis ? 'pc-emphasis' : undefined}><th scope="row">{row.label}</th>
          <td className={`pc-numeric${value < 0 ? ' pc-negative' : ''}`}>{formatPlayerValue(value, unit)}</td>
          {previous && <><td className="pc-numeric">{formatPlayerValue(old, unit)}</td><td className="pc-numeric">{formatPlayerValue(delta, unit === '%' ? 'п.п.' : unit, true)}</td></>}
        </tr>;
      })}</tbody>
    </table></div>
  </section>;
}

export function PlayerReports({ me, selectedPeriod, onSelect }: { me: PlayerMe; selectedPeriod: number | null; onSelect: (period: number) => void }) {
  const selectId = useId();
  const [mode, setMode] = useState<'structured' | 'original'>('structured');
  const results = (me.recentResults ?? []).filter(r => r.firmId === me.firmId).slice().sort((a, b) => a.periodIndex - b.periodIndex);
  const reports = me.reports ?? [];
  const periods = [...new Set([...results.map(r => r.periodIndex), ...reports.map(r => r.periodIndex)])].sort((a, b) => b - a);
  const period = selectedPeriod !== null && periods.includes(selectedPeriod) ? selectedPeriod : periods[0] ?? null;
  const current = results.find(r => r.periodIndex === period);
  const previous = period !== null ? results.find(r => r.periodIndex === period - 1) : undefined;
  // Legacy report has no period field. Associate it only with an existing latest result,
  // or show it unindexed, never infer a fictitious period from the current phase.
  const text = reports.find(r => r.periodIndex === period)?.report
    ?? (period === results.at(-1)?.periodIndex || period === null ? me.report : null);
  const showStructured = Boolean(current && mode === 'structured');
  return <section className="pc-reports">
    <header className="pc-section-head"><div><h2>Отчёты компании</h2><p className="pc-muted">Финансовый результат, баланс и принятые решения.</p></div>
      <div className="pc-report-controls"><label htmlFor={selectId}>Период<select id={selectId} value={period ?? ''} disabled={!periods.length} onChange={event => onSelect(Number(event.target.value))}>
        {!periods.length && <option value="">Нет доступных периодов</option>}
        {periods.map(p => <option key={p} value={p}>Период {p}</option>)}
      </select></label>
        {current && <div className="pc-report-mode" role="group" aria-label="Вид отчёта"><button type="button" aria-pressed={mode === 'structured'} onClick={() => setMode('structured')}>Таблицы</button><button type="button" aria-pressed={mode === 'original'} onClick={() => setMode('original')}>Исходный отчёт</button></div>}
      </div>
    </header>
    {period === null && !text ? <p className="pc-empty">Отчёты появятся после расчёта периода.</p> : <>
      <p className="pc-report-note">{current ? showStructured ? previous ? `Изменения к периоду ${previous.periodIndex}; для долей — процентные пункты.` : 'Без сравнения с предыдущим периодом.' : 'Полный исходный отчёт.' : period === null ? 'Последний отчёт компании.' : 'За этот период доступен только исходный текст.'}</p>
      {showStructured && current && <div className="pc-report-body">
        <FinancialSection title="Прибыли и убытки" rows={pnl} current={current} previous={previous} period={current.periodIndex} previousPeriod={previous?.periodIndex} />
        <FinancialSection title="Баланс компании" rows={balance} current={current} previous={previous} period={current.periodIndex} previousPeriod={previous?.periodIndex} />
        <FinancialSection title="Принятые решения" rows={decisions} current={current.decision} previous={previous?.decision} period={current.periodIndex} previousPeriod={previous?.periodIndex} />
        <FinancialSection title="Производство и продажи" rows={operations} current={current} previous={previous} period={current.periodIndex} previousPeriod={previous?.periodIndex} />
        <p className={current.isBankrupt ? 'pc-warning' : 'pc-muted'}>Статус банкротства: {typeof current.isBankrupt === 'boolean' ? current.isBankrupt ? 'да' : 'нет' : 'нет данных'}.</p>
      </div>}
      {text != null ? <div className="pc-original-wrap" hidden={showStructured}><pre className="pc-original" tabIndex={0} aria-label="Полный исходный отчёт">{text}</pre></div>
        : <p className="pc-empty">Исходный отчёт недоступен.{current ? ' Показатели доступны в таблицах.' : ''}</p>}
    </>}
  </section>;
}
