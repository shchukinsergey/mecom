import { useEffect, useState } from 'react';
import { TelegramAuth } from './TelegramAuth';
import { accountRequest } from '../online/roomsApi';

interface TelegramSettingsData {
  identity: { id: string; username: string | null; name: string; active: boolean } | null;
  enabled: boolean;
  username: string | null;
  chats: Array<{ chatId: string; title: string; active: boolean; error: string | null; roomIds: string[] }>;
  rooms: Array<{ id: string; name: string; phase: string }>;
}
export function TelegramSettings({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [data, setData] = useState<TelegramSettingsData | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selection, setSelection] = useState<Record<string, string[]>>({});
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: number;
    const poll = async () => {
      try { const result = await accountRequest<TelegramSettingsData>('/telegram', { signal: controller.signal }); if (!controller.signal.aborted) setData(result); }
      catch (e) { if (!controller.signal.aborted) { if ((e as { status?: number }).status === 401) onUnauthorized(); else setError(e instanceof Error ? e.message : 'Не удалось загрузить настройки.'); } }
      finally { if (!controller.signal.aborted) timer = window.setTimeout(() => void poll(), 10000); }
    };
    void poll(); return () => { controller.abort(); window.clearTimeout(timer); };
  }, [refresh]);
  const work = async (run: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await run(); setRefresh(v => v + 1); }
    catch (e) { if ((e as { status?: number }).status === 401) onUnauthorized(); else setError(e instanceof Error ? e.message : 'Не удалось сохранить настройки.'); }
    finally { setBusy(false); }
  };
  return <section className="online-card" aria-labelledby="telegram-title">
    <h2 id="telegram-title">Telegram</h2>
    <p>Новый период с рейтингом фирм по РИФ и напоминание за час до дедлайна со списком команд, которые ещё не отправили решения.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!data ? <p role="status">Загружаем настройки…</p> : !data.enabled ? <p className="hint">Telegram-бот ещё не настроен на сервере.</p> : <>
      {data.identity ? <div><h3>Личный Telegram</h3><p>Подключён: {data.identity.username ? '@' + data.identity.username : data.identity.name}. {data.identity.active ? 'Личные уведомления включены.' : 'Бот не может написать вам. Подключите Telegram повторно.'}</p><button disabled={busy} onClick={() => void work(async () => { await accountRequest('/telegram/personal/unlink', { method: 'POST', body: '{}' }); })}>Отключить Telegram</button>{!data.identity.active && <TelegramAuth personal onComplete={() => setRefresh(v => v + 1)}/>}</div> : <TelegramAuth personal onComplete={() => setRefresh(v => v + 1)}/>}
      <h3>Уведомления в групповые чаты</h3>
      <ol><li>Добавьте <a href={`https://t.me/${data.username}?startgroup=true`} target="_blank" rel="noreferrer">@{data.username}</a> в групповой чат и разрешите отправку сообщений.</li><li>Создайте код и отправьте команду в чат от своего имени. Вы должны быть администратором чата.</li><li>После подключения выберите игры ниже. Список обновляется автоматически.</li></ol>
      <button disabled={busy} onClick={() => void work(async () => { setCode(await accountRequest('/telegram/code', { method: 'POST', body: '{}' })); })}>Создать код подключения</button>
      {code && <div><p>Команда для чата (действует до {new Date(code.expiresAt).toLocaleTimeString('ru-RU')}):</p><input aria-label="Команда подключения Telegram" readOnly value={`/connect@${data.username} ${code.code}`} onFocus={e => e.target.select()}/><p className="hint">Каждый новый код заменяет предыдущий. После использования код недействителен.</p></div>}
      {data.chats.map(chat => {
        const selected = selection[chat.chatId] ?? chat.roomIds;
        return <fieldset key={chat.chatId} disabled={busy}><legend>{chat.title}</legend>
          {!chat.active && <p role="alert">{chat.error} Создайте новый код и отправьте его в чат.</p>}
          {data.rooms.map(room => <label className="telegram-option" key={room.id}><input type="checkbox" checked={selected.includes(room.id)} onChange={e => setSelection(old => ({ ...old, [chat.chatId]: e.target.checked ? [...selected, room.id] : selected.filter(id => id !== room.id) }))}/><span>{room.name}{room.phase === 'complete' ? ' · завершена' : room.phase === 'closed' ? ' · закрыта' : ''}</span></label>)}
          {!data.rooms.length && <p>У вас пока нет собственных игр. Создайте комнату, чтобы подключить уведомления.</p>}
          <button disabled={!chat.active || busy} onClick={() => void work(async () => { await accountRequest('/telegram/subscriptions', { method: 'PUT', body: JSON.stringify({ chatId: chat.chatId, roomIds: selected }) }); setSelection(old => { const next = { ...old }; delete next[chat.chatId]; return next; }); setNotice(`Настройки чата «${chat.title}» сохранены.`); })}>Сохранить выбор игр</button>
          <p className="hint">Чтобы отключить уведомления, снимите все отметки и сохраните. В быстром режиме и без ограничения времени напоминания за час нет.</p>
        </fieldset>;
      })}
    </>}
  </section>;
}
