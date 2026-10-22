import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { getGameStatus, getPlayerMe, joinGame, saveDecision, submitDecision, type GameStatus, type PlayerMe, type JoinResult } from '../../online/api';
import { readPlayerSessions, savePlayerSession, type StoredPlayerSession } from '../../online/playerSessions';
import { decisionFields as fields, emptyDecision, syncDecisionForm, type DecisionForm } from '../../online/playerDecisionForm';
import { reconcileSelectedReportPeriod, sortPlayerReports } from '../../online/playerReports';
import { checkDecisionBudget } from '../../engine/decisionBudget';
import { computeCapex } from '../../engine/capex';
import { CompetitionHistoryChart } from '../components/CompetitionHistoryChart';
import { PlayerMarket, playerPublicPeriods } from '../components/PlayerMarket';
import { PlayerOverview } from '../components/PlayerOverview';
import { PlayerDecisions } from '../components/PlayerDecisions';

import { PlayerReports } from '../components/PlayerReports';
import '../components/PlayerCabinet.css';

export interface OnlinePlayerProps { initialInviteToken?: string; initialRejoinToken?: string; accountRoomId?: string; onUnauthorized?: () => void; onBack: () => void; onLeave?: () => Promise<void>; leaveBusy?: boolean; }
const quantity = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value) + ' шт.';
const phaseLabels = { lobby: 'Ожидаем начала игры', collecting: 'Приём решений', complete: 'Период завершён', closed: 'Игра закрыта' } as const;
const tabs = [
  ['overview', 'Обзор'], ['decisions', 'Решения'],
] as const;
type PlayerTab = typeof tabs[number][0];
export function OnlinePlayer({ initialInviteToken, initialRejoinToken, accountRoomId, onUnauthorized, onBack, onLeave, leaveBusy }: OnlinePlayerProps) {
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
  const [tab, setTab] = useState<PlayerTab>('overview');
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
  const excluded = !!me?.openingState?.nativeBankruptcy;
  const decision = Object.fromEntries(fields.map(([key]) => [key, Number(form[key])])) as {
    price: number; production: number; marketing: number; capexGross: number; rnd: number;
  };
  const fieldErrors: Partial<Record<keyof typeof decision, string>> = {};
  for (const [key] of fields) {
    if (!form[key].trim()) fieldErrors[key] = 'Заполните поле.';
    else if (!Number.isFinite(decision[key])) fieldErrors[key] = 'Укажите число.';
    else if (decision[key] < 0) fieldErrors[key] = 'Значение не может быть отрицательным.';
  }
  if (me?.openingState && decision.production > me.openingState.machines)
    fieldErrors.production = `Не больше текущей мощности: ${quantity(me.openingState.machines)}.`;
  if (!Number.isInteger(decision.production)) fieldErrors.production = 'Укажите целое количество штук.';
  for (const key of ['marketing', 'capexGross', 'rnd'] as const) {
    const rules = me?.periodMacro?.scenarioRules;
    const max = (key === 'marketing' ? rules?.marketingMax : key === 'capexGross' ? rules?.capexMax : rules?.rndMax) ?? 50000;
    if (decision[key] > max) fieldErrors[key] = `Не больше ${max} $.`;
  }
  if (decision.price <= 0) fieldErrors.price = 'Укажите цену больше нуля.';
  const priceLimits = me?.periodMacro?.scenarioRules;
  if (priceLimits && (decision.price < priceLimits.priceMin || decision.price > priceLimits.priceMax)) {
    fieldErrors.price = `Цена по сценарию: от ${priceLimits.priceMin} до ${priceLimits.priceMax} $.`;
  }
  const invalidFields = Object.keys(fieldErrors).length > 0;
  const budget = !excluded && !invalidFields && me?.openingState && me.periodMacro && me.config
    ? checkDecisionBudget(me.openingState, decision, me.periodMacro, me.config) : null;
  const capexPreview = !excluded && !invalidFields && me?.openingState && me.config
    ? computeCapex({ machines: me.openingState.machines, capexGross: decision.capexGross, amortFundRemainder: me.openingState.amortFundRemainder }, me.config) : null;
  const invalidDecision = invalidFields || Boolean(budget?.overspend);

  const doJoin = async (e: FormEvent) => { e.preventDefault(); setLoading(true); setError(''); try { acceptSession(await joinGame(invite, firmName)); setInvite(''); setFirmName(''); } catch (e) { setError(e instanceof Error ? e.message : 'Не удалось войти.'); } finally { busyRef.current = false; setLoading(false); } };
  const doSave = async () => { if (excluded || !active || invalidDecision || busyRef.current || me?.phase !== 'collecting' || me.submitted) return; busyRef.current = true; setLoading(true); try { await saveDecision(active.rejoinToken, decision, accountRoomId ? me?.currentPeriodIndex : undefined); dirtyRef.current = false; await refresh(active, true); } catch(e) { handleError(e); } finally { busyRef.current = false; setLoading(false); } };
  const doSubmit = async () => { if (excluded || !active || invalidDecision || busyRef.current || me?.phase !== 'collecting' || me.submitted) return; const recap = fields.map(([key,label]) => `${label}: ${form[key] || '0'}`).join('\n'); if (!window.confirm(`Проверьте решение перед отправкой:\n\n${recap}\n\nОтправить ведущему?`)) return; busyRef.current = true; setLoading(true); try { await saveDecision(active.rejoinToken, decision, accountRoomId ? me?.currentPeriodIndex : undefined); dirtyRef.current = false; await submitDecision(active.rejoinToken, accountRoomId ? me?.currentPeriodIndex : undefined); await refresh(active, true); } catch(e) { handleError(e); } finally { busyRef.current = false; setLoading(false); } };
  const changeTab = (next: PlayerTab) => {
    setTab(next);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  return <main className="online-page player-cabinet">
    <header className="pc-header">
      <div className="pc-identity"><span className="pc-brand">МЭКОМ</span><h1>{me?.firmName || active?.firmName || 'Кабинет участника'}</h1></div>
      <div className="pc-header-actions">
        {me && <div className="pc-period"><strong>Период {me.currentPeriodIndex}</strong><span role="status">{excluded ? 'Фирма исключена' : me.submitted ? 'Решение отправлено' : phaseLabels[me.phase]}</span></div>}
        <button type="button" onClick={onBack}>На главную</button>
        {me?.phase === 'lobby' && onLeave && <button type="button" disabled={loading || leaveBusy} onClick={() => void onLeave()}>Выйти из комнаты</button>}
      </div>
    </header>
    {error && <div className="error" role="alert">{error}</div>}
    {!accountRoomId && sessions.length > 1 && <section className="pc-card"><label htmlFor="player-session">Мои партии</label><select id="player-session" value={active ? `${active.gameId}/${active.firmId}` : ''} onChange={e => { setSelected(e.target.value); setTab('overview'); }}>{sessions.map((s, index) => <option key={`${s.gameId}/${s.firmId}`} value={`${s.gameId}/${s.firmId}`}>{s.firmName} · партия {index + 1}</option>)}</select></section>}
    {!accountRoomId && (!active || invite) && <form className="pc-card pc-join" onSubmit={doJoin}>
      <h2>{initialInviteToken ? 'Создать фирму' : 'Войти в игру'}</h2>
      {!initialInviteToken && <div className="pc-field"><label htmlFor="invite-token">Код приглашения</label><input id="invite-token" type="password" autoComplete="off" value={invite} onChange={e => setInvite(e.target.value)} required /></div>}
      <div className="pc-field"><label htmlFor="firm-name">Название фирмы</label><input id="firm-name" value={firmName} onChange={e => setFirmName(e.target.value)} placeholder="Например, Север" required /></div>
      <button className="primary" disabled={loading}>{initialInviteToken ? 'Создать фирму' : 'Войти в игру'}</button>
    </form>}
    {active && !me && <p className="pc-loading" role="status">Загружаем вашу компанию…</p>}
    {active && me && excluded && <>
      <section className="pc-card" role="status"><h2>Фирма исключена после банкротства</h2><p>Участие в дальнейших решениях и расчётах прекращено навсегда. История не откатывается; отчёты и публичные результаты остаются доступны.</p></section>
      <PlayerMarket me={me} status={status} />
      <div className="pc-market-history"><h2>Компания на фоне рынка</h2><CompetitionHistoryChart history={playerPublicPeriods(status)} ownFirmId={me.firmId} /></div>
      <PlayerReports me={me} selectedPeriod={selectedReportPeriod} onSelect={setSelectedReportPeriod} onBackToDecision={() => window.scrollTo({ top: 0, behavior: 'instant' })} />
    </>}
    {active && me && !excluded && <>
      <nav className="pc-nav" role="tablist" aria-label="Кабинет компании">{tabs.map(([key, label]) => <button key={key} type="button" role="tab" id={`pc-tab-${key}`} aria-controls={`pc-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => changeTab(key)} onKeyDown={e => {
        const keys = tabs.map(([value]) => value);
        const index = keys.indexOf(key);
        const target = e.key === 'ArrowRight' ? keys[(index + 1) % keys.length] : e.key === 'ArrowLeft' ? keys[(index + keys.length - 1) % keys.length] : e.key === 'Home' ? keys[0] : e.key === 'End' ? keys.at(-1) : undefined;
        if (target) { e.preventDefault(); changeTab(target); document.getElementById(`pc-tab-${target}`)?.focus(); }
      }}>{label}</button>)}</nav>
      <section className="pc-section" id="pc-panel-overview" role="tabpanel" aria-labelledby="pc-tab-overview" hidden={tab !== 'overview'}><PlayerOverview me={me} status={status} onDecisions={() => changeTab('decisions')} /></section>
      <section className="pc-section pc-decision-workspace" id="pc-panel-decisions" role="tabpanel" aria-labelledby="pc-tab-decisions" hidden={tab !== 'decisions'}>
        <div className="pc-report-jump"><button type="button" onClick={() => document.getElementById('pc-company-reports')?.scrollIntoView({ block: 'start', behavior: 'auto' })}>К отчёту ↓</button></div>
        <PlayerDecisions me={me} form={form} loading={loading} fieldErrors={fieldErrors} budget={budget} capexCapacity={capexPreview?.capacityNext} invalidDecision={invalidDecision} onChange={(key, value) => { dirtyRef.current = true; setForm(v => ({ ...v, [key]: value })); }} onSave={() => void doSave()} onSubmit={() => void doSubmit()} />
        <PlayerReports me={me} selectedPeriod={selectedReportPeriod} onSelect={setSelectedReportPeriod} onBackToDecision={() => document.getElementById('pc-panel-decisions')?.scrollIntoView({ block: 'start', behavior: 'auto' })} />
      </section>
    </>}
  </main>;
}
