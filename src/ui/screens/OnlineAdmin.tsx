import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { buildAdminBootstrapLink } from '../../online/adminAccess';
import { calculateGame, closeGame, createGame, getAdminGame, kickFirm, rotateInviteToken, rotateRejoinToken, startGame, type OnlineGame } from '../../online/api';
import { buildOnlineGameSnapshot, DEFAULT_ONLINE_GAME_SETTINGS, type OnlineGameSettings } from '../../online/gameSettings';
import { buildPlayerLink } from '../../online/links';

export interface OnlineAdminProps {
  initialGameId?: string;
  initialAdminToken?: string;
  initialPublicOrigin?: string;
  onBack: () => void;
}

const ADMIN_KEY = 'mecom.online.admin-token';
const ACTIVE_GAME_KEY = 'mecom.online.active-game';
const phaseNames: Record<OnlineGame['phase'], string> = {
  lobby: 'Ожидаем игроков',
  collecting: 'Собираем решения',
  complete: 'Игра завершена',
  closed: 'Игра закрыта',
};
type NumericGameSetting = Exclude<keyof OnlineGameSettings, 'loanRepayment' | 'bankInterestFormula'>;
const numericGameSettings: { key: NumericGameSetting; label: string; step: number }[] = [
  { key: 'serviceFeePercent', label: 'Комиссия банка, % годовых', step: 0.01 },
  { key: 'periodsPerYear', label: 'Периодов в году', step: 1 },
  { key: 'depositRatePercent', label: 'Ставка по депозиту, % годовых', step: 0.01 },
  { key: 'taxRatePercent', label: 'Налог на прибыль, %', step: 0.1 },
  { key: 'bankRateBasePercent', label: 'Базовая ставка банка, % годовых', step: 0.1 },
  { key: 'bankRateExtraPercent', label: 'Ставка сверх лимита, % годовых', step: 0.1 },
  { key: 'loanLimitBase', label: 'Лимит основной кредитной линии, $', step: 1000 },
  { key: 'loanLimitAbs', label: 'Абсолютный лимит займа, $', step: 1000 },
];

export function OnlineAdmin({ initialGameId, initialAdminToken, initialPublicOrigin, onBack }: OnlineAdminProps) {
  const [token, setToken] = useState(() => initialAdminToken ?? sessionStorage.getItem(ADMIN_KEY) ?? '');
  const [name, setName] = useState('');
  const [gameSettings, setGameSettings] = useState<OnlineGameSettings>(() => ({ ...DEFAULT_ONLINE_GAME_SETTINGS }));
  const [gameId, setGameId] = useState(() => initialGameId ?? localStorage.getItem(ACTIVE_GAME_KEY) ?? '');
  const [game, setGame] = useState<OnlineGame | null>(null);
  const [publicOrigin, setPublicOrigin] = useState(() => initialPublicOrigin || location.origin);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token) sessionStorage.setItem(ADMIN_KEY, token);
    else sessionStorage.removeItem(ADMIN_KEY);
  }, [token]);

  useEffect(() => {
    if (initialAdminToken) setToken(initialAdminToken);
    if (initialPublicOrigin) setPublicOrigin(initialPublicOrigin);
    if (initialGameId) {
      setGameId(initialGameId);
      localStorage.setItem(ACTIVE_GAME_KEY, initialGameId);
    }
  }, [initialAdminToken, initialPublicOrigin, initialGameId]);

  const refresh = async (silent = false) => {
    if (!token || !gameId) return;
    try {
      const current = await getAdminGame(token, gameId);
      setGame(previous => ({ ...current, inviteToken: previous?.inviteToken ?? current.inviteToken }));
      if (!silent) setMessage('');
    } catch (error) {
      if (!silent) setMessage(error instanceof Error ? error.message : 'Не удалось обновить игру.');
    }
  };

  useEffect(() => {
    if (!token || !gameId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const current = await getAdminGame(token, gameId);
        if (!cancelled) setGame(previous => ({ ...current, inviteToken: previous?.inviteToken ?? current.inviteToken }));
      } catch (error) {
        if (!cancelled) setMessage(error instanceof Error ? error.message : 'Не удалось открыть игру.');
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [token, gameId]);

  const run = async (fn: () => Promise<unknown>, success: (result: unknown) => void = () => {}) => {
    setBusy(true);
    setMessage('');
    try { success(await fn()); }
    catch (error) {
      if ((error as { status?: number })?.status === 401) {
        setToken('');
        setMessage('Ссылка ведущего устарела. Запустите MECOM Онлайн ещё раз.');
      } else setMessage(error instanceof Error ? error.message : 'Не удалось выполнить действие.');
    } finally { setBusy(false); }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    const gameName = name.trim() || 'Новая партия';
    const snapshot = buildOnlineGameSnapshot(gameName, gameSettings);
    void run(() => createGame(token, gameName, snapshot), result => {
      const created = result as OnlineGame;
      localStorage.setItem(ACTIVE_GAME_KEY, created.gameId);
      setGameId(created.gameId);
      setGame({ gameId: created.gameId, name: created.name, inviteToken: created.inviteToken, open: true, phase: 'lobby', firms: [], snapshot: null });
      setName('');
    });
  };

  const showNewGameForm = () => {
    localStorage.removeItem(ACTIVE_GAME_KEY);
    setGameId('');
    setGame(null);
    setName('');
    setGameSettings({ ...DEFAULT_ONLINE_GAME_SETTINGS });
    setMessage('');
    if (window.location.hash.startsWith('#admin/')) window.location.hash = 'admin';
  };

  const copy = async (value: string, successMessage: string) => {
    if (!value) return;
    try { await navigator.clipboard.writeText(value); setMessage(successMessage); }
    catch { setMessage('Не удалось скопировать. Разрешите доступ к буферу обмена браузера.'); }
  };

  const inviteUrl = game?.inviteToken ? buildPlayerLink(publicOrigin, location.pathname, 'join', game.inviteToken) : '';
  const adminLink = useMemo(() => {
    if (!token) return '';
    try { return buildAdminBootstrapLink(location.origin, publicOrigin, token); }
    catch { return ''; }
  }, [token, publicOrigin]);
  const period = game?.snapshot?.league.results.length ?? 0;
  const submitted = game?.firms.filter(firm => firm.submitted).length ?? 0;
  const canCalculate = !!game && game.phase === 'collecting' && game.firms.length > 0 && submitted === game.firms.length;

  const copyInvite = () => {
    if (!game || !token) return;
    if (inviteUrl) { void copy(inviteUrl, 'Приглашение скопировано. Отправьте его игрокам.'); return; }
    void run(() => rotateInviteToken(token, game.gameId), result => {
      const nextToken = (result as { inviteToken: string }).inviteToken;
      const url = buildPlayerLink(publicOrigin, location.pathname, 'join', nextToken);
      setGame(previous => previous ? { ...previous, inviteToken: nextToken } : previous);
      void copy(url, 'Новая ссылка приглашения скопирована.');
    });
  };

  const copyFirmLink = (firmId: string, firmName: string) => {
    if (!game || !token) return;
    if (!window.confirm(`Создать новую ссылку для «${firmName}»? Предыдущая ссылка перестанет работать.`)) return;
    void run(() => rotateRejoinToken(token, game.gameId, firmId), result => {
      const nextToken = (result as { rejoinToken: string }).rejoinToken;
      const url = buildPlayerLink(publicOrigin, location.pathname, 'firm', nextToken);
      void copy(url, `Ссылка для «${firmName}» скопирована.`);
    });
  };

  const removeFirm = (firmId: string, firmName: string) => {
    if (!game || !token || !window.confirm(`Отключить фирму «${firmName}»? Она потеряет доступ к игре.`)) return;
    void run(() => kickFirm(token, game.gameId, firmId), () => { setMessage(`Фирма «${firmName}» отключена.`); void refresh(true); });
  };

  return <main className="online-page">
    <header className="online-header">
      <div><span className="online-eyebrow">МЭКОМ · ВЕДУЩИЙ</span><h1>Управление игрой</h1><p>Создайте партию, пригласите игроков и ведите периоды.</p></div>
      <div className="online-header-actions">
        {game && (game.phase === 'closed' || game.phase === 'complete') && <button className="primary" onClick={showNewGameForm} disabled={busy}>Создать новую игру</button>}
        {adminLink && <button onClick={() => void copy(adminLink, 'Личная ссылка ведущего скопирована. Не отправляйте её игрокам.')}>Ссылка ведущего</button>}
        <button onClick={onBack}>Назад</button>
      </div>
    </header>
    {message && <div className="online-alert" role="alert">{message}</div>}
    {!token ? <section className="online-card"><h2>Откройте свою ссылку ведущего</h2><p>Запустите файл «Запустить MECOM Онлайн» в папке игры — доступ ведущего откроется автоматически.</p></section> : !game ? <form className="online-card online-create" onSubmit={create}>
      <span className="online-step">НОВАЯ ПАРТИЯ</span><h2>Создать игру</h2><p className="online-muted">Партия создаётся с готовыми правилами. Игроки сами подключатся и создадут фирмы.</p>
      <div className="online-create-row"><div className="field"><label htmlFor="game-name">Название партии</label><input id="game-name" value={name} onChange={event => setName(event.target.value)} placeholder="Например, Осенний рынок" maxLength={100} /></div><button className="primary" disabled={busy}>Создать игру</button></div>
      <details className="online-settings">
        <summary>Дополнительные финансовые настройки</summary>
        <p className="hint">По умолчанию выбраны финансовые правила оригинального МЭКОМ. Настройки будут применены ко всем периодам новой игры.</p>
        <div className="online-grid online-settings-grid">
          <div className="field"><label htmlFor="game-loan-mode">Порядок финансирования</label><select id="game-loan-mode" value={gameSettings.loanRepayment} onChange={event => setGameSettings(current => ({ ...current, loanRepayment: event.target.value as OnlineGameSettings['loanRepayment'] }))}><option value="preRevenue">Оригинальный МЭКОМ · до выручки</option><option value="none">Архивный · в конце периода</option><option value="sweep">Погашение из остатка</option></select></div>
          <div className="field"><label htmlFor="game-interest-formula">Расчёт банковского процента</label><select id="game-interest-formula" value={gameSettings.bankInterestFormula} onChange={event => setGameSettings(current => ({ ...current, bankInterestFormula: event.target.value as OnlineGameSettings['bankInterestFormula'] }))}><option value="official">Официальный · по траншам</option><option value="flatLoanRate">Плоская ставка</option></select></div>
          {numericGameSettings.map(({ key, label, step }) => <div className="field" key={key}><label htmlFor={`game-setting-${key}`}>{label}</label><input id={`game-setting-${key}`} type="number" min="0" step={step} value={gameSettings[key]} onChange={event => setGameSettings(current => ({ ...current, [key]: Number(event.target.value) }))} /></div>)}
        </div>
      </details>
    </form> : <>
      <section className="online-card online-game-card">
        <div className="online-game-heading"><div><span className={`online-status ${game.phase}`}>{phaseNames[game.phase]}</span><h2>{game.name}</h2><p className="online-muted">Период {period} · {game.firms.length} фирм подключено</p></div><button onClick={() => void refresh()} disabled={busy}>Обновить</button></div>
        <div className="online-stats"><div className="online-stat"><span>Игроки</span><strong>{game.firms.length}<small> / 12</small></strong></div><div className="online-stat"><span>Решения сданы</span><strong>{submitted}<small> / {game.firms.length}</small></strong></div><div className="online-stat"><span>Период</span><strong>{period}</strong></div></div>
        <div className="online-invite-row"><div><strong>Ссылка для игроков</strong><span className="online-muted">Отправьте её участникам, чтобы они создали фирмы.</span></div><button className="primary" onClick={copyInvite} disabled={busy || game.phase !== 'lobby' && !inviteUrl}>{inviteUrl ? 'Скопировать приглашение' : 'Создать приглашение'}</button></div>
        <p className="online-footnote">Адрес игроков: <code>{publicOrigin}</code>. Ссылку ведущего не пересылайте.</p>
      </section>

      <section className="online-card">
        <div className="online-section-heading"><div><span className="online-step">01</span><h2>Фирмы</h2></div><span className="online-muted">Статус обновляется автоматически</span></div>
        {game.firms.length === 0 ? <div className="online-empty"><strong>Пока никого нет</strong><p>Скопируйте приглашение и отправьте его игрокам.</p></div> : <div className="online-roster">{game.firms.map((firm, index) => <article className="online-firm" key={firm.firmId}><span className="online-avatar">{firm.firmName.trim().slice(0, 1).toLocaleUpperCase('ru-RU') || index + 1}</span><div className="online-firm-main"><strong>{firm.firmName}</strong><span className={`online-submission ${firm.submitted ? 'done' : ''}`}>{firm.submitted ? 'Решение отправлено' : game.phase === 'lobby' ? 'Подключилась' : 'Ожидаем решение'}</span></div><div className="online-firm-actions"><button onClick={() => copyFirmLink(firm.firmId, firm.firmName)} disabled={busy || game.phase === 'closed'} title="Создать новую ссылку; предыдущая станет недействительной">Ссылка фирмы</button><button className="danger" onClick={() => removeFirm(firm.firmId, firm.firmName)} disabled={busy || game.phase === 'complete' || game.phase === 'closed'}>Отключить</button></div></article>)}</div>}
      </section>

      <section className="online-card online-control-card">
        <div><span className="online-step">02</span><h2>Ход игры</h2><p className="online-muted">{game.phase === 'lobby' ? 'Начните, когда подключатся хотя бы две фирмы.' : game.phase === 'collecting' ? 'Когда все отправят решения, рассчитайте период.' : 'Активных действий сейчас нет.'}</p></div>
        {game.phase === 'lobby' && <button className="primary" disabled={busy || game.firms.length < 2} onClick={() => void run(() => startGame(token, game.gameId), () => { setMessage('Игра началась. Отчёт за период 0 готов; участники вводят решения за период 1.'); void refresh(true); })}>Начать игру · от 2 фирм</button>}
        {game.phase === 'collecting' && <button className="primary" disabled={busy || !canCalculate} onClick={() => void run(() => calculateGame(token, game.gameId), () => { setMessage(period >= 7 ? 'Последний период рассчитан.' : `Период ${period} рассчитан. Открыт период ${period + 1}.`); void refresh(true); })}>{period >= 7 ? 'Рассчитать и завершить игру' : `Рассчитать период ${period} → ${period + 1}`}</button>}
        {game.phase !== 'closed' && game.phase !== 'complete' && <button className="danger" disabled={busy} onClick={() => { if (window.confirm('Закрыть игру? Игроки больше не смогут отправлять решения.')) void run(() => closeGame(token, game.gameId), () => { setMessage('Игра закрыта.'); void refresh(true); }); }}>Закрыть игру</button>}
        {game.phase === 'collecting' && !canCalculate && <span className="online-waiting">Ждём решения: {submitted} из {game.firms.length}</span>}
      </section>
    </>}
  </main>;
}
