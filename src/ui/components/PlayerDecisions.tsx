import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PlayerMe } from '../../online/api';
import { decisionFields, type DecisionForm } from '../../online/playerDecisionForm';
import type { DecisionBudget } from '../../engine/decisionBudget';
import { buildFundingView } from '../../online/playerFundingView';
import { PlayerDecisionHelp } from './PlayerDecisionHelp';
import { ProductionCapacityButton } from './ProductionCapacityButton';

export interface PlayerDecisionsProps {
  me: PlayerMe;
  form: DecisionForm;
  loading: boolean;
  fieldErrors: Partial<Record<keyof DecisionForm, string>>;
  budget: DecisionBudget | null;
  capexCapacity: number | undefined;
  invalidDecision: boolean;
  onChange: (key: keyof DecisionForm, value: string) => void;
  onSave: () => void;
  onSubmit: () => void;
}
const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const decimalFormat = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: 2 });
const roundedMoney = (value: number) => Number(decimalFormat.format(value));
const money = (value: number) => `${format.format(value)} $`;
const quantity = (value: number) => `${format.format(value)} шт.`;
const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const numberInput = (value: string) => value.trim() && Number.isFinite(Number(value)) ? Number(value) : null;

function CapacityCard({ production, capacity }: { production: number | null; capacity: number | null | undefined }) {
  const known = production != null && production >= 0 && Number.isInteger(production) && capacity != null && Number.isFinite(capacity) && capacity >= 0;
  const over = known && production > capacity;
  const actual = known ? (capacity > 0 ? production / capacity * 100 : production > 0 ? Infinity : 0) : null;
  const percentText = actual == null ? '—' : Number.isFinite(actual) ? `${format.format(actual)} %` : 'Нет мощности';
  const status = !known ? 'Укажите корректный выпуск' : over ? 'Выше лимита' : 'В пределах мощности';
  return <section className={`pc-capacity${over ? ' pc-over' : ''}`} aria-label="Производственная мощность">
    <div className="pc-capacity-metrics pc-metrics"><div><span>План производства</span><strong>{production == null || production < 0 ? '—' : quantity(production)}</strong></div><div><span>Доступная мощность</span><strong>{capacity == null || !Number.isFinite(capacity) ? '—' : quantity(capacity)}</strong></div></div>
    <div className="pc-capacity-load pc-row"><span>Загрузка <strong>{percentText}</strong></span><span className={`pc-status ${over ? 'pc-text-bad' : known ? 'pc-text-good' : 'pc-muted'}`}>{status}</span></div>
    <div className="pc-track pc-capacity-track pc-capacity-bar" role="progressbar" aria-label="Загрузка производственной мощности" aria-valuemin={0} aria-valuemax={100} aria-valuenow={actual == null ? 0 : clamp(actual)} aria-valuetext={`${percentText}; ${status}`}><span className={`pc-segment ${over ? 'pc-extra' : 'pc-production'}`} style={{ width: `${actual == null ? 0 : clamp(actual)}%` }} /></div>
    <div className="pc-capacity-free pc-capacity-foot pc-row"><span>Свободная мощность</span><strong>{known ? quantity(Math.max(0, capacity - production)) : '—'}</strong></div>
    {over && <p className="pc-capacity-warning pc-text-bad">Превышение на {quantity(production - capacity)}.</p>}
  </section>;
}

function FundingVisual({ view, budget, capexCapacity }: { view: ReturnType<typeof buildFundingView>; budget: DecisionBudget; capexCapacity: number | undefined }) {
  // Allocate displayed rounding to the residual, not to both credit parts.
  // Native amounts and bar proportions remain untouched.
  const ordinaryAvailable = roundedMoney(view.ordinaryRemaining);
  const expressAvailable = view.availableCredit - ordinaryAvailable;
  const ordinaryNeeded = roundedMoney(view.ordinaryUsed);
  const expressNeeded = roundedMoney(view.ordinaryUsed + view.expressUsed) - ordinaryNeeded;
  const fundingSegments = view.fundingSegments.map(segment => ({ ...segment, value: segment.key === 'base' ? ordinaryNeeded : segment.key === 'extra' ? expressNeeded : segment.value }));
  return <div className={`pc-funding pc-funding-state-${view.classification}`} data-funding-status={view.classification}>
    <div className="pc-metrics pc-budget-metrics"><div><span>Расходы по решению</span><strong>{money(view.totalSpending)}</strong></div><div><span>Всего доступно с кредитами</span><strong>{money(view.resourcesAvailable)}</strong></div></div>
    <dl className="pc-budget-resources pc-budget-list pc-financial-list">
      {([
        ['Свои деньги на начало периода', view.openingCash],
        ['Доступный обычный кредит', ordinaryAvailable],
        ['Доступный экспресс-кредит', expressAvailable],
      ] as const).map(([label, value]) => <div key={label} className="pc-row"><dt>{label}</dt><dd>{money(value)}</dd></div>)}
    </dl>
    <p className="pc-budget-note">Доступные кредиты — потенциальные новые заимствования, а не уже взятый долг. Всего доступно = свои деньги + доступный обычный кредит + доступный экспресс-кредит.</p>
    {(!Number.isInteger(view.ordinaryRemaining) || !Number.isInteger(view.expressRemaining)) && <p className="pc-budget-note">Доступный кредит округляется до целых долларов в проверке бюджета; остаток обычного кредита ограничен базовым лимитом без округления. Поэтому дробный остаток, в том числе при равных лимитах, может попасть в экспресс-часть. Это не прогноз итогового долга. Суммы показаны до двух знаков; округление частей согласовано с итогом.</p>}
    <h4>Потребность в покрытии входного бюджета</h4>
    <div className="pc-track pc-funding-track" role="progressbar" aria-label="Покрытие входного бюджета" aria-valuemin={0} aria-valuemax={100} aria-valuenow={view.coveragePercent} aria-valuetext={`${view.status}; свои средства ${money(view.cashUsed)}; потребность в новом обычном кредите ${money(ordinaryNeeded)}; потребность в новом экспресс-кредите ${money(expressNeeded)}; недостаток ${money(view.shortage)}`}>
      {view.fundingSegments.filter(segment => segment.value > 0).map(segment => <span key={segment.key} className={`pc-segment pc-${segment.key} pc-funding-${segment.key}`} style={{ width: `${segment.percent}%` }} aria-hidden="true" />)}
    </div>
    <div className="pc-legend pc-funding-legend">{fundingSegments.map(segment => <div key={segment.key} className="pc-legend-item"><span className={`pc-dot pc-finance-dot pc-${segment.key} pc-funding-${segment.key}`} aria-hidden="true" /><span>{segment.label}</span><strong>{money(segment.value)}</strong></div>)}</div>
    {view.openingCash < 0 && <p className="pc-budget-note">Дефицит денег на начало периода: {money(-view.openingCash)}. Потребность в покрытии учитывает этот дефицит; это не дополнительные расходы по решению.</p>}
    <h4>Расходы</h4>
    <div className="pc-track pc-expense-track" role="img" aria-label={`Структура положительных расходов; всего ${money(view.positiveExpenseTotal)}`}>
      {view.expenses.filter(expense => expense.value > 0).map(expense => <span key={expense.key} className={`pc-segment pc-${expense.key} pc-expense-${expense.key}`} style={{ width: `${expense.percent}%` }} aria-hidden="true" />)}
    </div>
    <dl className="pc-budget-list pc-financial-list">{view.expenses.map(expense => <div key={expense.key} className="pc-row"><dt>{expense.label}</dt><dd>{expense.key === 'investment' ? signedMoney(expense.value) : money(expense.value)}</dd></div>)}
      <div className="pc-row"><dt>Амортизация</dt><dd>{money(budget.depreciation)}</dd></div>
      <div className="pc-row pc-total pc-budget-total"><dt>Остаток входного бюджета</dt><dd className={budget.overspend ? 'pc-text-bad' : ''}>{money(view.remainingBudget)}</dd></div>
    </dl>
    {view.cashRelease > 0 && <p className="pc-budget-note">Амортизация превышает инвестиции: расходы входного бюджета уменьшены на {money(view.cashRelease)}. Шкала показывает только положительные расходы; это не поступление денег.</p>}
    {capexCapacity != null && Number.isFinite(capexCapacity) && <div className="pc-budget-next pc-row"><span>Мощность следующего периода</span><strong>{quantity(capexCapacity)}</strong></div>}
    <h4>Уже взятые кредиты</h4>
    <dl className="pc-budget-list pc-financial-list">
      {([
        ['Текущий долг', view.currentDebt], ['Уже взятый обычный кредит', view.existingOrdinaryDebt], ['Уже взятый экспресс-кредит', view.existingExpressDebt],
      ] as const).map(([label, value]) => <div key={label} className="pc-row"><dt>{label}</dt><dd>{money(value)}</dd></div>)}
    </dl>
    {view.existingExpressDebt > 0 && <p className="pc-budget-note">Уже взятый экспресс-кредит — часть текущего долга, не новое заимствование.</p>}
    <p className="pc-budget-note">Проверка входного бюджета, не прогноз прибыли. Будущая выручка не включена; итоговый долг определяется расчётом периода.</p>
  </div>;
}

/** Pure presentation and callbacks; authoritative saving/period guards stay in OnlinePlayer. */
export function PlayerDecisions({ me, form, loading, fieldErrors, budget, capexCapacity, invalidDecision, onChange, onSave, onSubmit }: PlayerDecisionsProps) {
  const [openHelp, setOpenHelp] = useState<keyof DecisionForm | null>(null);
  const closeHelp = useCallback(() => setOpenHelp(null), []);
  const [expanded, setExpanded] = useState(false);
  const [mobile, setMobile] = useState(true);
  const [panelHeight, setPanelHeight] = useState(88);
  const sheet = useRef<HTMLDetailsElement>(null);
  const section = useRef<HTMLElement>(null);
  const budgetId = useId();
  const locked = loading || me.submitted || me.phase !== 'collecting';
  const actionDisabled = locked || invalidDecision;
  const valuesValid = decisionFields.every(([key]) => {
    const value = numberInput(form[key]);
    return value != null && value >= 0 && (key !== 'price' || value > 0) && (key !== 'production' || Number.isInteger(value)) && (key === 'price' || key === 'production' || value <= 50000);
  });
  const visibleBudget = valuesValid ? budget : null;
  const view = visibleBudget && me.openingState && me.periodMacro ? buildFundingView(visibleBudget, me.openingState, me.periodMacro) : null;
  const ensureFocusVisible = useCallback(() => {
    if (!mobile || !sheet.current || !section.current) return;
    const focused = document.activeElement;
    if (!(focused instanceof HTMLInputElement) || !section.current.contains(focused)) return;
    const rect = focused.getBoundingClientRect();
    const viewportHeight = window.visualViewport ? window.visualViewport.height + window.visualViewport.offsetTop : window.innerHeight;
    const bottom = Math.min(sheet.current.getBoundingClientRect().top, viewportHeight) - 16;
    if (rect.bottom > bottom) window.scrollBy({ top: rect.bottom - bottom, behavior: 'auto' });
    else if (rect.top < 16) window.scrollBy({ top: rect.top - 16, behavior: 'auto' });
  }, [mobile]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => { setMobile(media.matches); setExpanded(false); closeHelp(); };
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [closeHelp]);
  useEffect(() => {
    const panel = sheet.current;
    if (!panel) return;
    let frame = 0;
    const measure = () => {
      setPanelHeight(panel.getBoundingClientRect().height);
      cancelAnimationFrame(frame); frame = requestAnimationFrame(ensureFocusVisible);
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(panel); measure();
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('resize', measure); window.visualViewport?.removeEventListener('scroll', measure); };
  }, [expanded, mobile, ensureFocusVisible]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (openHelp != null) { closeHelp(); event.preventDefault(); }
      else if (mobile && expanded) { setExpanded(false); event.preventDefault(); }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [openHelp, closeHelp, expanded, mobile]);
  const style = { '--pc-budget-height': `${panelHeight}px`, '--budget-height': `${panelHeight}px`, paddingBottom: mobile ? panelHeight + 24 : undefined } as CSSProperties;
  return <section ref={section} className="pc-decisions" style={style} aria-label="Ваше решение" onFocusCapture={() => { requestAnimationFrame(ensureFocusVisible); }}>
    <div className="pc-decision-layout">
      <div className="pc-decision-form">
        <div className="pc-section-heading pc-section-head"><h2>Ваше решение</h2><p className="pc-muted">Черновик можно изменить до отправки.</p></div>
        {me.submitted ? <p className="pc-decision-status" role="status">Решение отправлено. Изменения недоступны.</p> : me.phase !== 'collecting' ? <p className="pc-decision-status" role="status">{me.phase === 'lobby' ? 'Ждём начала игры.' : 'Приём решений завершён.'}</p> : null}
        <div className="pc-decision-fields">{decisionFields.map(([key, label]) => {
          const helpId = `player-${key}-help`;
          const errorId = `player-${key}-error`;
          return <div className={`pc-decision-field pc-field${fieldErrors[key] ? ' pc-invalid' : ''}`} key={key} role="group" aria-labelledby={`player-${key}-label`}>
            <div className="pc-field-heading pc-field-title"><label id={`player-${key}-label`} htmlFor={`player-${key}`}>{label}<span className="pc-field-unit">{key === 'price' ? ' · $ за штуку' : key === 'production' ? ' · шт.' : ' · $'}</span></label>
              <PlayerDecisionHelp field={key} label={label} id={helpId} open={openHelp === key} onToggle={() => setOpenHelp(current => current === key ? null : key)} onClose={closeHelp} />
            </div>
            <input id={`player-${key}`} type="number" inputMode={key === 'production' ? 'numeric' : 'decimal'} min="0" step={key === 'production' ? '1' : 'any'} max={key === 'production' ? me.openingState?.machines : key === 'price' ? undefined : 50000} required aria-invalid={Boolean(fieldErrors[key])} aria-describedby={`${helpId}${fieldErrors[key] ? ` ${errorId}` : ''}`} disabled={locked} value={form[key]} onChange={event => onChange(key, event.target.value)} style={{ scrollMarginBottom: mobile ? panelHeight + 24 : undefined }} />
            {fieldErrors[key] && <p className="pc-field-error" id={errorId}>{fieldErrors[key]}</p>}
            {key === 'production' && <><CapacityCard production={numberInput(form.production)} capacity={me.openingState?.machines} /><div className="pc-capacity-action"><ProductionCapacityButton capacity={me.openingState?.machines} disabled={locked} onSelect={value => onChange('production', String(value))} /></div></>}
          </div>;
        })}</div>
        <div className="pc-decision-actions pc-actions"><button type="button" className="pc-save" disabled={actionDisabled} onClick={onSave}>Сохранить черновик</button><button type="button" className="pc-submit primary" disabled={actionDisabled} onClick={onSubmit}>Отправить решение</button></div>
      </div>
      <details ref={sheet} open={!mobile || expanded} className={`pc-budget${expanded ? ' pc-budget-expanded' : ''}${view ? ` pc-budget-${view.classification}` : ' pc-budget-unavailable'}`} aria-label="Бюджет решения">
        <summary className="pc-budget-toggle pc-budget-summary" aria-expanded={!mobile || expanded} aria-controls={budgetId} onClick={event => { event.preventDefault(); if (mobile) setExpanded(value => !value); }}>
          <span className="pc-budget-name">Бюджет решения</span><strong className="pc-budget-remaining">{view ? money(view.remainingBudget) : '—'}</strong><span className="pc-budget-status pc-budget-funding">{view?.status ?? 'Не удалось рассчитать'}</span>
        </summary>
        <div id={budgetId} className="pc-budget-body" hidden={mobile && !expanded}>{view && visibleBudget ? <FundingVisual view={view} budget={visibleBudget} capexCapacity={capexCapacity} /> : <p className="pc-budget-empty">Не удалось рассчитать бюджет. {valuesValid ? 'Дождитесь данных текущего периода.' : 'Заполните все поля корректными значениями.'}</p>}</div>
      </details>
    </div>
  </section>;
}
