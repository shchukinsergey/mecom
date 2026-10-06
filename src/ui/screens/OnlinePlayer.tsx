import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { getGameStatus, getPlayerMe, joinGame, saveDecision, submitDecision, type GameStatus, type PlayerMe, type JoinResult } from '../../online/api';
import { readPlayerSessions, savePlayerSession, type StoredPlayerSession } from '../../online/playerSessions';
import { decisionFields as fields, emptyDecision, syncDecisionForm, type DecisionForm } from '../../online/playerDecisionForm';
import { getVisiblePlayerReport, reconcileSelectedReportPeriod, sortPlayerReports } from '../../online/playerReports';

export interface OnlinePlayerProps { initialInviteToken?: string; initialRejoinToken?: string; onBack: () => void; }
const money = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(value) + ' $';
const quantity = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + ' шт.';
const phaseLabels = { lobby: 'Ожидаем начала игры', collecting: 'Приём решений', complete: 'Период завершён', closed: 'Игра закрыта' } as const;
export function OnlinePlayer({ initialInviteToken, initialRejoinToken, onBack }: OnlinePlayerProps) {
  const [sessions, setSessions] = useState<StoredPlayerSession[]>(() => readPlayerSessions());
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
  const active = useMemo(() => sessions.find(s => `${s.gameId}/${s.firmId}` === selected) ?? sessions[0], [sessions, selected]);
  const refresh = async (session: StoredPlayerSession, forceForm = false) => {
    try { const [mine, roster] = await Promise.all([getPlayerMe(session.rejoinToken), getGameStatus(session.rejoinToken, session.gameId)]); setMe(mine); setStatus(roster); setForm(old => syncDecisionForm(old, mine.decision, !forceForm && dirtyRef.current)); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Не удалось обновить данные.'); }
  };
  useEffect(() => { if (!initialInviteToken && !initialRejoinToken) return; history.replaceState(null, '', `${location.pathname}#play`); }, [initialInviteToken, initialRejoinToken]);
  useEffect(() => { dirtyRef.current = false; if (!active) { setMe(null); setStatus(null); return; } void refresh(active); const timer = window.setInterval(() => void refresh(active), 12000); return () => window.clearInterval(timer); }, [active?.gameId, active?.firmId, active?.rejoinToken]);
  const acceptSession = (result: JoinResult) => { dirtyRef.current = false; const next = {gameId:result.gameId,firmId:result.firmId,firmName:result.firmName,rejoinToken:result.rejoinToken}; savePlayerSession(next); setSessions(readPlayerSessions()); setSelected(`${next.gameId}/${next.firmId}`); };
  useEffect(() => {
    if (!initialRejoinToken) return;
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

  const doJoin = async (e: FormEvent) => { e.preventDefault(); setLoading(true); setError(''); try { acceptSession(await joinGame(invite, firmName)); setInvite(''); setFirmName(''); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось войти.'); } finally { setLoading(false); } };
  const doSave = async () => { if (!active) return; setLoading(true); try { await saveDecision(active.rejoinToken, Object.fromEntries(fields.map(([key]) => [key, Number(form[key]) || 0]))); dirtyRef.current = false; await refresh(active, true); } catch(e) { setError(e instanceof Error ? e.message : 'Не удалось сохранить черновик.'); } finally { setLoading(false); } };
  const doSubmit = async () => { if (!active) return; setLoading(true); try { await saveDecision(active.rejoinToken, Object.fromEntries(fields.map(([key]) => [key, Number(form[key]) || 0]))); dirtyRef.current = false; await submitDecision(active.rejoinToken); await refresh(active, true); } catch(e) { setError(e instanceof Error ? e.message : 'Не удалось отправить решение.'); } finally { setLoading(false); } };
  return <main className="online-page"><header className="online-header"><div><span className="online-eyebrow">МЭКОМ · УЧАСТНИК</span><h1>Кабинет участника</h1></div><button onClick={onBack}>На главную</button></header>{error && <div className="error" role="alert">{error}</div>}
    {sessions.length > 1 && <section className="online-card"><label htmlFor="player-session">Мои партии</label><select id="player-session" value={active ? `${active.gameId}/${active.firmId}` : ''} onChange={e => setSelected(e.target.value)}>{sessions.map(s => <option key={`${s.gameId}/${s.firmId}`} value={`${s.gameId}/${s.firmId}`}>{s.firmName} · {s.gameId}</option>)}</select></section>}
    {(!active || invite) && <form className="online-card online-create" onSubmit={doJoin}><span className="online-step">ПОДКЛЮЧЕНИЕ К ИГРЕ</span><h2>{initialInviteToken ? 'Создать фирму' : 'Войти в игру'}</h2><p className="online-muted">Укажите название компании. Оно будет видно ведущему и другим участникам.</p>{!initialInviteToken && <div className="field"><label htmlFor="invite-token">Код приглашения</label><input id="invite-token" type="password" autoComplete="off" value={invite} onChange={e => setInvite(e.target.value)} required /></div>}<div className="field"><label htmlFor="firm-name">Название фирмы</label><input id="firm-name" value={firmName} onChange={e => setFirmName(e.target.value)} placeholder="Например, Север" required /></div><button className="primary" disabled={loading}>{initialInviteToken ? 'Создать фирму' : 'Войти в игру'}</button></form>}
    {active && <><section className="online-card online-overview"><h2>{active.firmName}</h2><p>Игра: {active.gameId} · Период: {me?.currentPeriodIndex ?? status?.currentPeriodIndex ?? '—'}</p><p className="online-status" role="status">Этап: {me ? phaseLabels[me.phase] : 'Загружаем…'} · Ваше решение: {me?.submitted ? 'отправлено' : me?.phase === 'collecting' ? 'ещё не отправлено' : 'не принимается'}</p>{me?.phase === 'collecting' && <p className="hint">Отчёт за период 0 готов. Заполните показатели периода {me.currentPeriodIndex}, сохраните черновик или отправьте решение ведущему.</p>}{me?.phase === 'lobby' && <p className="hint">Ждём ведущего. Стартовые показатели и форма решений появятся после начала игры.</p>}{me?.openingState && !me.report && !me.reports?.length && <div className="online-card online-opening"><h3>Стартовый отчёт · период 0</h3><dl className="online-grid"><div><dt>Деньги</dt><dd>{money(me.openingState.cash)}</dd></div><div><dt>Долг</dt><dd>{money(me.openingState.loan)}</dd></div><div><dt>Полная мощность</dt><dd>{quantity(me.openingState.machines)}</dd></div><div><dt>Запас на складе</dt><dd>{quantity(me.openingState.inventory)}</dd></div><div><dt>Сотрудники</dt><dd>{new Intl.NumberFormat('ru-RU').format(me.openingState.employees)}</dd></div><div><dt>Накопленная прибыль</dt><dd>{money(me.openingState.retainedEarnings)}</dd></div></dl></div>}{me?.periodMacro && <aside className="online-card online-macro"><h3>Условия периода {me.periodMacro.periodIndex}</h3><p>Налог: {(me.periodMacro.taxRate * 100).toLocaleString('ru-RU')}% · базовая ставка банка: {(me.periodMacro.bankRateBase * 100).toLocaleString('ru-RU')}%</p>{me.periodMacro.scenarioNewsText && <p>{me.periodMacro.scenarioNewsText}</p>}</aside>}<h3>Фирмы в игре</h3><div className="online-stat"><span className="name">Фирма</span><span className="badge">Статус</span></div>{status?.firms.map(f => <div className="online-stat" key={f.firmId}><span className="name">{f.firmName}</span><span className="badge">{f.submitted ? 'отправлено' : 'ожидает'}</span></div>)}</section>
      <section className="online-card online-decision"><h2>Ваше решение{me?.phase === 'collecting' ? ` · период ${me.currentPeriodIndex}` : ''}</h2><p className="hint">Введите показатели для открытого периода. Цена и суммы — в $, производство — в штуках; черновик можно изменить до отправки.</p>{fields.map(([key,label]) => <div className="field" key={key}><label htmlFor={`player-${key}`}>{label}{key === 'price' ? ' · $ за штуку' : key === 'production' ? ' · шт.' : ' · $'}</label><input id={`player-${key}`} type="number" min="0" step="any" value={form[key]} onChange={e => { dirtyRef.current = true; setForm(v => ({...v,[key]:e.target.value})); }} disabled={me?.submitted || me?.phase !== 'collecting'} /></div>)}<div className="online-decision-grid"><button disabled={loading || me?.submitted || me?.phase !== 'collecting'} onClick={() => void doSave()}>Сохранить черновик</button><button className="primary" disabled={loading || me?.submitted || me?.phase !== 'collecting'} onClick={() => void doSubmit()}>Отправить решение</button></div></section>
      <section className="online-card"><h2>Мои отчёты</h2>{Boolean(me?.report || me?.reports?.length) && <p className="report-scroll-hint">На узком экране сдвигайте отчёт влево/вправо, чтобы увидеть все колонки.</p>}{orderedReports.length > 0 ? <><nav className="player-report-tabs" aria-label="Периоды отчётов">{orderedReports.map(r => <button key={r.periodIndex} type="button" aria-pressed={visibleReport?.periodIndex === r.periodIndex} className={visibleReport?.periodIndex === r.periodIndex ? 'active' : ''} onClick={() => setSelectedReportPeriod(r.periodIndex)}>Период {r.periodIndex}</button>)}</nav>{visibleReport && <article><h3>Период {visibleReport.periodIndex}</h3><div className="report online-report"><pre>{visibleReport.report}</pre></div></article>}</> : reportFallback ? <article><h3>Последний отчёт</h3><div className="report online-report"><pre>{reportFallback}</pre></div></article> : <p className="hint">После расчёта первого периода здесь появится итоговый отчёт. Стартовые показатели за период 0 — выше.</p>}</section></>}
  </main>;
}
