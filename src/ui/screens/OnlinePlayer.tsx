import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { getGameStatus, getPlayerMe, joinGame, saveDecision, submitDecision, type GameStatus, type PlayerMe, type JoinResult } from '../../online/api';
import { readPlayerSessions, savePlayerSession, type StoredPlayerSession } from '../../online/playerSessions';
import { decisionFields as fields, emptyDecision, syncDecisionForm, type DecisionForm } from '../../online/playerDecisionForm';
import { getVisiblePlayerReport, reconcileSelectedReportPeriod, sortPlayerReports } from '../../online/playerReports';
import { checkDecisionBudget } from '../../engine/decisionBudget';
import { DecisionFieldHelp } from '../components/DecisionFieldHelp';
import { OnlinePeriodSummary } from '../components/OnlinePeriodSummary';
import { OnlineFirmRoster } from '../components/OnlineFirmRoster';
import { getPlayerInsights } from '../../online/playerInsights';
import { computeCapex } from '../../engine/capex';
import { ProductionCapacityButton } from '../components/ProductionCapacityButton';

export interface OnlinePlayerProps { initialInviteToken?: string; initialRejoinToken?: string; accountRoomId?: string; onUnauthorized?: () => void; onBack: () => void; }
const money = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' $';
const quantity = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + ' шт.';
const phaseLabels = { lobby: 'Ожидаем начала игры', collecting: 'Приём решений', complete: 'Период завершён', closed: 'Игра закрыта' } as const;
export function OnlinePlayer({ initialInviteToken, initialRejoinToken, accountRoomId, onUnauthorized, onBack }: OnlinePlayerProps) {
  const [sessions, setSessions] = useState<StoredPlayerSession[]>(() => accountRoomId ? [] : readPlayerSessions());
  const [selected, setSelected] = useState('');
  const [invite, setInvite] = useState(initialInviteToken ?? '');
  const [firmName, setFirmName] = useState('');
  const [form, setForm] = useState<DecisionForm>(emptyDecision);
  const [me, setMe] = useState<PlayerMe | null>(null);
  const [selectedReportPeriod, setSelectedReportPeriod] = useState<number | null>(null);
  const previousLatestReportPeriod = useRef<number | null>(null);
  const [status, setStatus] = useState<GameStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dirtyRef = useRef(false);
  const active = useMemo(() => accountRoomId ? { gameId: accountRoomId, firmId: 'own', firmName: '', rejoinToken: `account:${accountRoomId}` } : sessions.find(s => `${s.gameId}/${s.firmId}` === selected) ?? sessions[0], [accountRoomId, sessions, selected]);
  const generation = useRef(0);
  const periodRef = useRef<number | null>(null);
  const refreshSequence = useRef(0);
  const busyRef = useRef(false);
  const handleError = (e: unknown) => { if (accountRoomId && (e as { status?: number })?.status === 401) { setMe(null); setStatus(null); onUnauthorized?.(); } else setError(e instanceof Error ? e.message : 'Не удалось обновить данные.'); };
  const refresh = async (session: StoredPlayerSession, forceForm = false) => {
    const currentGeneration = generation.current; const sequence = ++refreshSequence.current;
        try { const [mine, roster] = await Promise.all([getPlayerMe(session.rejoinToken), getGameStatus(session.rejoinToken, session.gameId)]); if (currentGeneration !== generation.current || sequence !== refreshSequence.current) return; if (periodRef.current !== mine.currentPeriodIndex) dirtyRef.current = false; periodRef.current = mine.currentPeriodIndex; setMe(mine); setStatus(roster); setForm(old => syncDecisionForm(old, mine.decision, !forceForm && dirtyRef.current)); setError(''); }
        catch (e) { if (currentGeneration === generation.current && sequence === refreshSequence.current) handleError(e); }
  };
  useEffect(() => { if (accountRoomId || (!initialInviteToken && !initialRejoinToken)) return; history.replaceState(null, '', `${location.pathname}#play`); }, [initialInviteToken, initialRejoinToken]);
  useEffect(() => { generation.current++; dirtyRef.current = false; periodRef.current = null; setMe(null); setStatus(null); setForm(emptyDecision); setSelectedReportPeriod(null); previousLatestReportPeriod.current = null; if (!active) return; let cancelled = false; let timer: number; const poll = async () => { if (!busyRef.current) await refresh(active); if (!cancelled) timer = window.setTimeout(() => void poll(), 12000); }; void poll(); return () => { cancelled = true; generation.current++; window.clearTimeout(timer); }; }, [active?.gameId, active?.firmId, active?.rejoinToken]);
  const acceptSession = (result: JoinResult) => { dirtyRef.current = false; const next = {gameId:result.gameId,firmId:result.firmId,firmName:result.firmName,rejoinToken:result.rejoinToken}; savePlayerSession(next); setSessions(readPlayerSessions()); setSelected(`${next.gameId}/${next.firmId}`); };
  useEffect(() => {
    if (accountRoomId || !initialRejoinToken) return;
    const existing = sessions.find(s => s.rejoinToken === initialRejoinToken);
    if (existing) {
      setSelected(`${existing.gameId}/${existing.firmId}`);
      return;
    }
    let cancelled = false;
    void getPlayerMe(initialRejoinToken).then(player => {
      if (cancelled) return;
      const session = { gameId: player.gameId, firmId: player.firmId, firmName: player.firmName, rejoinToken: initialRejoinToken };
      savePlayerSession(session);
      setSessions(readPlayerSessions());
      setSelected(`${session.gameId}/${session.firmId}`);
    }).catch(() => {
      if (!cancelled) setError('Ссылка повторного входа недействительна или уже заменена. Попросите ведущего выдать новую.');
    });
    return () => { cancelled = true; };
  }, [initialRejoinToken]);
  useEffect(() => {
    const reports = sortPlayerReports(me?.reports ?? []);
    const latestPeriod = reports[0]?.periodIndex ?? null;
    const nextSelection = reconcileSelectedReportPeriod(selectedReportPeriod, reports, previousLatestReportPeriod.current);
    if (nextSelection !== selectedReportPeriod) setSelectedReportPeriod(nextSelection);
    previousLatestReportPeriod.current = latestPeriod;
  }, [me?.reports, selectedReportPeriod]);
  const orderedReports = sortPlayerReports(me?.reports ?? []);
  const visibleReport = getVisiblePlayerReport(orderedReports, selectedReportPeriod);
  const reportFallback = orderedReports.length === 0 ? me?.report : null;
  const latestResult = me?.recentResults?.at(-1);
  const previousResult = me?.recentResults?.at(-2) ?? null;
  const decision = Object.fromEntries(fields.map(([key]) => [key, Number(form[key]) || 0])) as {
    price: number; production: number; marketing: number; capexGross: number; rnd: number;
  };
  const budget = me?.openingState && me.periodMacro && me.config
    ? checkDecisionBudget(me.openingState, decision, me.periodMacro, me.config) : null;
  const capexPreview = me?.openingState && me.config
    ? computeCapex({ machines: me.openingState.machines, capexGross: decision.capexGross, amortFundRemainder: me.openingState.amortFundRemainder }, me.config) : null;
  const fieldErrors: Partial<Record<keyof typeof decision, string>> = {};
  for (const [key] of fields) {
    if (!form[key].trim()) fieldErrors[key] = 'Заполните поле.';
  }
  if (me?.openingState && decision.production > me.openingState.machines)
    fieldErrors.production = `Не больше текущей мощности: ${quantity(me.openingState.machines)}.`;
  if (!Number.isInteger(decision.production)) fieldErrors.production = 'Укажите целое количество штук.';
  for (const key of ['marketing', 'capexGross', 'rnd'] as const) {
    if (decision[key] > 50000) fieldErrors[key] = 'Не больше 50 000 $.';
  }
  if (decision.price <= 0) fieldErrors.price = 'Укажите цену больше нуля.';
  if (budget?.overspend) fieldErrors.production = 'Недостаточно средств с учётом доступного кредита.';
  const invalidDecision = Object.keys(fieldErrors).length > 0;

  const doJoin = async (e: FormEvent) => { e.preventDefault(); setLoading(true); setError(''); try { acceptSession(await joinGame(invite, firmName)); setInvite(''); setFirmName(''); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось войти.'); } finally { busyRef.current = false; setLoading(false); } };
  const doSave = async () => { if (!active || invalidDecision || busyRef.current || me?.phase !== 'collecting' || me.submitted) return; busyRef.current = true; setLoading(true); try { await saveDecision(active.rejoinToken, decision, accountRoomId ? me?.currentPeriodIndex : undefined); dirtyRef.current = false; await refresh(active, true); } catch(e) { handleError(e); } finally { busyRef.current = false; setLoading(false); } };
  const doSubmit = async () => { if (!active || invalidDecision || busyRef.current || me?.phase !== 'collecting' || me.submitted) return; const recap = fields.map(([key,label]) => `${label}: ${form[key] || '0'}`).join('\n'); if (!window.confirm(`Проверьте решение перед отправкой:\n\n${recap}\n\nОтправить ведущему?`)) return; busyRef.current = true; setLoading(true); try { await saveDecision(active.rejoinToken, decision, accountRoomId ? me?.currentPeriodIndex : undefined); dirtyRef.current = false; await submitDecision(active.rejoinToken, accountRoomId ? me?.currentPeriodIndex : undefined); await refresh(active, true); } catch(e) { handleError(e); } finally { busyRef.current = false; setLoading(false); } };
  return <main className="online-page"><header className="online-header"><div><span className="online-eyebrow">МЭКОМ · УЧАСТНИК</span><h1>Кабинет участника</h1></div><button onClick={onBack}>На главную</button></header>{error && <div className="error" role="alert">{error}</div>}
    {!accountRoomId && sessions.length > 1 && <section className="online-card"><label htmlFor="player-session">Мои партии</label><select id="player-session" value={active ? `${active.gameId}/${active.firmId}` : ''} onChange={e => setSelected(e.target.value)}>{sessions.map(s => <option key={`${s.gameId}/${s.firmId}`} value={`${s.gameId}/${s.firmId}`}>{s.firmName} · {s.gameId}</option>)}</select></section>}
    {!accountRoomId && (!active || invite) && <form className="online-card online-create" onSubmit={doJoin}><span className="online-step">ПОДКЛЮЧЕНИЕ К ИГРЕ</span><h2>{initialInviteToken ? 'Создать фирму' : 'Войти в игру'}</h2><p className="online-muted">Укажите название компании. Оно будет видно ведущему и другим участникам.</p>{!initialInviteToken && <div className="field"><label htmlFor="invite-token">Код приглашения</label><input id="invite-token" type="password" autoComplete="off" value={invite} onChange={e => setInvite(e.target.value)} required /></div>}<div className="field"><label htmlFor="firm-name">Название фирмы</label><input id="firm-name" value={firmName} onChange={e => setFirmName(e.target.value)} placeholder="Например, Север" required /></div><button className="primary" disabled={loading}>{initialInviteToken ? 'Создать фирму' : 'Войти в игру'}</button></form>}
    {active && <><section className="online-card online-overview"><h2>{me?.firmName || active.firmName || 'Ваша фирма'}</h2><p>Игра: {active.gameId} · Период: {me?.currentPeriodIndex ?? status?.currentPeriodIndex ?? '—'}</p><p className="online-status" role="status">Этап: {me ? phaseLabels[me.phase] : 'Загружаем…'} · Ваше решение: {me?.submitted ? 'отправлено' : me?.phase === 'collecting' ? 'ещё не отправлено' : 'не принимается'}</p>{me?.phase === 'collecting' && <p className="hint">Отчёт за период 0 готов. Заполните показатели периода {me.currentPeriodIndex}, сохраните черновик или отправьте решение ведущему.</p>}{me?.phase === 'lobby' && <p className="hint">Ждём ведущего. Стартовые показатели и форма решений появятся после начала игры.</p>}{me?.openingState && !me.report && !me.reports?.length && <div className="online-card online-opening"><h3>Стартовый отчёт · период 0</h3><dl className="online-grid"><div><dt>Наличные средства</dt><dd>{money(me.openingState.cash)}</dd></div><div><dt>Займы</dt><dd>{money(me.openingState.loan)}</dd></div><div><dt>Полная мощность</dt><dd>{quantity(me.openingState.machines)}</dd></div><div><dt>Запас на складе</dt><dd>{quantity(me.openingState.inventory)}</dd></div><div><dt>Сотрудники</dt><dd>{new Intl.NumberFormat('ru-RU').format(me.openingState.employees)}</dd></div><div><dt>Накопленная прибыль</dt><dd>{money(me.openingState.retainedEarnings)}</dd></div></dl></div>}{me?.periodMacro && <aside className="online-card online-macro"><h3>Условия периода {me.periodMacro.periodIndex}</h3><p>Налог: {(me.periodMacro.taxRate * 100).toLocaleString('ru-RU')}% · базовая ставка банка: {(me.periodMacro.bankRateBase * 100).toLocaleString('ru-RU')}%</p>{me.periodMacro.scenarioNewsText && <p>{me.periodMacro.scenarioNewsText}</p>}</aside>}{latestResult && <OnlinePeriodSummary result={latestResult} insights={getPlayerInsights(latestResult, previousResult)} />}<OnlineFirmRoster firms={status?.firms ?? []} ownFirmId={me?.firmId ?? ''} /></section>
      <section className="online-card online-decision"><h2>Ваше решение{me?.phase === 'collecting' ? ` · период ${me.currentPeriodIndex}` : ''}</h2><p className="hint">Введите показатели для открытого периода. Цена и суммы — в $, производство — в штуках; черновик можно изменить до отправки.</p>{fields.map(([key,label]) => {
        const labelId = `player-${key}-label`;
        const helpId = `player-${key}-help`;
        const errorId = `player-${key}-error`;
        const describedBy = [helpId, fieldErrors[key] ? errorId : null].filter(Boolean).join(' ');
        return <div className={`field online-decision-field${fieldErrors[key] ? ' invalid' : ''}`} key={key} role="group" aria-labelledby={labelId}>
          <label id={labelId} htmlFor={`player-${key}`}>{label}{key === 'price' ? ' · $ за штуку' : key === 'production' ? ' · шт.' : ' · $'}</label>
          <input id={`player-${key}`} type="number" min="0" step={key === 'production' ? '1' : 'any'} max={key === 'production' && me?.openingState ? me.openingState.machines : key === 'price' ? undefined : '50000'} required aria-invalid={Boolean(fieldErrors[key])} aria-describedby={describedBy} onChange={e => { dirtyRef.current = true; setForm(v => ({...v,[key]:e.target.value})); }} value={form[key]} disabled={loading || me?.submitted || me?.phase !== 'collecting'} />
          {key === 'production' && <ProductionCapacityButton capacity={me?.openingState?.machines} disabled={loading || Boolean(me?.submitted) || me?.phase !== 'collecting'} onSelect={production => { dirtyRef.current = true; setForm(v => ({ ...v, production: String(production) })); }} />}
          {fieldErrors[key] && <p className="decision-field-error" id={errorId}>{fieldErrors[key]}</p>}
          <DecisionFieldHelp field={key} id={helpId} />
        </div>;
      })}
        {budget && <aside className="decision-budget" aria-label="Проверка бюджета решения"><strong>Предварительная проверка бюджета</strong><p className="online-muted">Это проверка решения, не прогноз прибыли. Будущая выручка не включена.</p><dl className="decision-budget-grid"><div><dt>Полная мощность сейчас</dt><dd>{quantity(me?.openingState?.machines ?? 0)}</dd></div><div><dt>Загрузка мощности</dt><dd>{me?.openingState?.machines ? `${((decision.production / me.openingState.machines) * 100).toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%` : '—'}</dd></div><div><dt>Стоимость производства</dt><dd>{money(budget.costOfProduction)}</dd></div><div><dt>Амортизация</dt><dd>{money(budget.depreciation)}</dd></div><div><dt>Маркетинг</dt><dd>{money(budget.marketing)}</dd></div><div><dt>НИОКР</dt><dd>{money(budget.rnd)}</dd></div><div><dt>Инвестиции за вычетом амортизации</dt><dd>{money(budget.netInvestment)}</dd></div><div><dt>Расходы по решению</dt><dd>{money(budget.totalSpending)}</dd></div>{capexPreview && <div><dt>Полная мощность след. периода</dt><dd>{quantity(capexPreview.capacityNext)}</dd></div>}<div><dt>Наличные средства</dt><dd>{money(budget.openingCash)}</dd></div><div><dt>Доступный кредит</dt><dd>{money(budget.availableCredit)}</dd></div><div><dt>Остаток бюджета</dt><dd>{money(budget.remainingBudget)}</dd></div></dl></aside>}
        <div className="online-decision-grid"><button disabled={loading || invalidDecision || me?.submitted || me?.phase !== 'collecting'} onClick={() => void doSave()}>Сохранить черновик</button><button className="primary" disabled={loading || invalidDecision || me?.submitted || me?.phase !== 'collecting'} onClick={() => void doSubmit()}>Отправить решение</button></div></section>
      <section className="online-card"><h2>Мои отчёты</h2>{Boolean(me?.report || me?.reports?.length) && <p className="report-scroll-hint">На узком экране сдвигайте отчёт влево/вправо, чтобы увидеть все колонки.</p>}{orderedReports.length > 0 ? <><nav className="player-report-tabs" aria-label="Периоды отчётов">{orderedReports.map(r => <button key={r.periodIndex} type="button" aria-pressed={visibleReport?.periodIndex === r.periodIndex} className={visibleReport?.periodIndex === r.periodIndex ? 'active' : ''} onClick={() => setSelectedReportPeriod(r.periodIndex)}>Период {r.periodIndex}</button>)}</nav>{visibleReport && <article><h3>Период {visibleReport.periodIndex}</h3><div className="report online-report"><pre>{visibleReport.report}</pre></div></article>}</> : reportFallback ? <article><h3>Последний отчёт</h3><div className="report online-report"><pre>{reportFallback}</pre></div></article> : <p className="hint">После расчёта первого периода здесь появится итоговый отчёт. Стартовые показатели за период 0 — выше.</p>}</section></>}
  </main>;
}
