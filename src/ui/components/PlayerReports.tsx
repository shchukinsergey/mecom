import { useId } from 'react';
import type { PlayerMe } from '../../online/api';
import { getVisiblePlayerReport, sortPlayerReports } from '../../online/playerReports';

export function PlayerReports({ me, selectedPeriod, onSelect, onBackToDecision }: { me: PlayerMe; selectedPeriod: number | null; onSelect: (period: number) => void; onBackToDecision?: () => void }) {
  const selectId = useId();
  const reports = sortPlayerReports(me.reports ?? []);
  const visible = getVisiblePlayerReport(reports, selectedPeriod);
  const text = visible?.report ?? (reports.length === 0 ? me.report : null);
  return <section className="pc-reports" id="pc-company-reports" aria-labelledby={`${selectId}-heading`}>
    <header className="pc-section-head"><div><h2 id={`${selectId}-heading`}>Отчёты компании и отрасли</h2></div>
      <div className="pc-report-controls"><label htmlFor={selectId}>Период<select id={selectId} value={visible?.periodIndex ?? ''} disabled={!reports.length} onChange={event => onSelect(Number(event.target.value))}>
        {!reports.length && <option value="">Нет доступных периодов</option>}
        {reports.map(report => <option key={report.periodIndex} value={report.periodIndex}>Период {report.periodIndex}</option>)}
      </select></label>
        {onBackToDecision && <button type="button" onClick={onBackToDecision}>К решению ↑</button>}
      </div>
    </header>
    {text != null ? <div className="pc-original-wrap"><pre className="pc-original" tabIndex={0} aria-label="Полный исходный отчёт">{text}</pre></div>
      : <p className="pc-empty">Отчёты появятся после расчёта периода.</p>}
  </section>;
}
