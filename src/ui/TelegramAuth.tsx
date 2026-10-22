import { useEffect, useState } from 'react';
import { accountRequest } from '../online/roomsApi';
import type { AccountUser } from '../online/roomTypes';

export function TelegramAuth({ personal = false, onComplete }: { personal?: boolean; onComplete: (user?: AccountUser) => void }) {
  const [bot, setBot] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<{ token: string; code: string; expiresAt: number } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const endpoint = personal ? '/telegram/personal' : '/auth/telegram';
  useEffect(() => { const controller = new AbortController(); void accountRequest<{ enabled: boolean; username: string | null }>('/auth/telegram', { signal: controller.signal }).then(data => { if (!controller.signal.aborted && data.enabled) setBot(data.username); }).catch(() => {}); return () => controller.abort(); }, []);
  useEffect(() => {
    if (!challenge) return;
    const controller = new AbortController(); let timer: number;
    const poll = async () => {
      try {
        if (Date.now() >= challenge.expiresAt) throw new Error('Код истёк. Начните заново.');
        const result = await accountRequest<{ pending?: boolean; user?: AccountUser }>(endpoint + '/finish', { method: 'POST', body: JSON.stringify({ token: challenge.token }), signal: controller.signal });
        if (controller.signal.aborted) return;
        if (result.user) { setChallenge(null); onComplete(result.user); }
        else timer = window.setTimeout(() => void poll(), 2500);
      } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : 'Ошибка входа'); setChallenge(null); } }
    };
    timer = window.setTimeout(() => void poll(), 2500);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [challenge, endpoint]);
  if (!bot) return null;
  return <section className="online-card"><h3>{personal ? 'Подключить личный Telegram' : 'Вход через Telegram'}</h3>
    <p>{personal ? 'Получайте личные уведомления и входите через бота. Обычный вход сохранится.' : 'Если аккаунт уже есть, сначала войдите по паролю и подключите Telegram в разделе «Уведомления». Иначе будет создан новый аккаунт.'}</p>
    {error && <p role="alert" className="error">{error}</p>}
    {!challenge ? <button type="button" disabled={busy} onClick={() => { setBusy(true); setError(''); void accountRequest<{ token: string; code: string; expiresAt: number }>(endpoint + '/start', { method: 'POST', body: '{}' }).then(setChallenge).catch(e => setError(e.message)).finally(() => setBusy(false)); }}>{personal ? 'Подключить Telegram' : 'Войти через Telegram'}</button> : <>
      <p>Откройте <a href={`https://t.me/${bot}`} target="_blank" rel="noreferrer">@{bot}</a> и отправьте ему эту команду в личном чате:</p>
      <input aria-label="Команда личного входа Telegram" readOnly value={`/login ${challenge.code}`} onFocus={e => e.target.select()}/>
      <p className="hint">Код действует 5 минут. Используйте только код с самостоятельно открытой страницы. После ответа бота вернитесь сюда — подключение завершится автоматически.</p>
      <button type="button" onClick={() => setChallenge(null)}>Отмена</button>
    </>}
  </section>;
}
