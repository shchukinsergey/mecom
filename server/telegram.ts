import { timingSafeEqual } from 'node:crypto';
import type { RoomDatabase } from './roomDatabase.ts';
import { HttpError } from './accounts.ts';
import { reminderMessage, roomPeriod } from './telegramMessages.ts';

export interface TelegramOptions { token: string; username: string; secret: string; publicOrigin: string }
class TelegramError extends Error {
  constructor(readonly code: number, readonly retryAfter = 0, readonly migrateTo?: number) { super(`Telegram API error ${code}`); }
}
type TelegramUpdate = {
  update_id: number;
  message?: { text?: string; sender_chat?: unknown; from?: { id: number }; chat: { id: number; type: string; title?: string }; migrate_to_chat_id?: number };
  my_chat_member?: { chat: { id: number }; new_chat_member: { status: string } };
};

export class TelegramBot {
  private running = false;
  private stopped = false;
  private processing = new Set<number>();
  private drain: Promise<void> = Promise.resolve();
  private rateUntil = 0;
  private timer?: ReturnType<typeof setInterval>;
  constructor(private db: RoomDatabase, readonly options: TelegramOptions, private fetcher: typeof fetch = fetch) {
    if (!/^[A-Za-z0-9_]{5,32}$/.test(options.username) || !/^[A-Za-z0-9_-]{16,256}$/.test(options.secret)) throw new Error('Invalid Telegram username or webhook secret');
    if (new URL(options.publicOrigin).protocol !== 'https:') throw new Error('Telegram requires an HTTPS MECOM_PUBLIC_ORIGIN');
  }
  private async call<T>(method: string, body: unknown): Promise<T> {
    const response = await this.fetcher(`https://api.telegram.org/bot${this.options.token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const data = await response.json() as { ok: boolean; result: T; error_code?: number; parameters?: { retry_after?: number; migrate_to_chat_id?: number } };
    if (!data.ok) throw new TelegramError(data.error_code ?? response.status, data.parameters?.retry_after, data.parameters?.migrate_to_chat_id);
    return data.result;
  }
  async configure() {
    await this.call('setWebhook', { url: `${new URL(this.options.publicOrigin).origin}/api/telegram/webhook`, secret_token: this.options.secret, allowed_updates: ['message', 'my_chat_member'] });
    await this.call('setMyCommands', { commands: [{ command: 'connect', description: 'Подключить чат к МЭКОМ: /connect код с сайта' }, { command: 'help', description: 'Как подключить игры' }] });
  }
  authorized(secret: string | string[] | undefined) {
    if (typeof secret !== 'string') return false;
    const a = Buffer.from(secret), b = Buffer.from(this.options.secret);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  async verifyManager(userId: string, chatId: string) {
    const telegramId = this.db.telegram.managerTelegramId(userId, chatId);
    if (!telegramId) throw new HttpError(403, 'Подключите этот чат с помощью своего кода.');
    const admins = await this.call<Array<{ user: { id: number } }>>('getChatAdministrators', { chat_id: chatId });
    if (!admins.some(admin => String(admin.user.id) === telegramId)) throw new HttpError(403, 'Настраивать уведомления может только администратор Telegram-чата.');
  }
  private send(chatId: string, text: string, roomId?: string) {
    return this.call('sendMessage', {
      chat_id: chatId, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
      ...(roomId ? { reply_markup: { inline_keyboard: [[{ text: 'Открыть игру', url: `${new URL(this.options.publicOrigin).origin}/#room/${roomId}` }]] } } : {}),
    });
  }
  async update(input: unknown) {
    if (!input || typeof input !== 'object' || !Number.isSafeInteger((input as TelegramUpdate).update_id)) throw new HttpError(400, 'Invalid Telegram update');
    const update = input as TelegramUpdate;
    if (this.db.telegram.seen(update.update_id) || this.processing.has(update.update_id)) return;
    this.processing.add(update.update_id);
    try {
      const membership = update.my_chat_member;
      if (membership && ['left', 'kicked'].includes(membership.new_chat_member.status)) this.db.telegram.inactive(String(membership.chat.id), 'Бот удалён из чата. Подключите чат заново.');
      const message = update.message;
      if (message?.migrate_to_chat_id) this.db.telegram.inactive(String(message.chat.id), 'Чат преобразован в супергруппу. Подключите его заново.');
      if (message?.text) {
        const chatId = String(message.chat.id);
        const match = /^\/connect(?:@[A-Za-z0-9_]+)?(?:\s+([a-f0-9]{36}))?\s*$/.exec(message.text);
        if (match) {
          if (!['group', 'supergroup'].includes(message.chat.type) || !message.from || message.sender_chat) {
            await this.send(chatId, 'Отправьте команду от своего имени в групповом чате, где вы администратор.');
          } else if (!match[1]) {
            await this.send(chatId, 'Откройте раздел «Telegram» на сайте МЭКОМ, создайте код и отправьте сюда /connect код.');
          } else {
            const admins = await this.call<Array<{ user: { id: number } }>>('getChatAdministrators', { chat_id: chatId });
            if (!admins.some(a => a.user.id === message.from!.id)) await this.send(chatId, 'Подключить чат может только его администратор.');
            else {
              const connected = this.db.transaction(() => this.db.telegram.connect(match[1]!, chatId, message.chat.title ?? 'Telegram-чат', String(message.from!.id)));
              await this.send(chatId, connected ? 'Чат подключён. Откройте раздел «Telegram» на сайте МЭКОМ и выберите игры для уведомлений.' : 'Код истёк или уже использован. Создайте новый код на сайте МЭКОМ.');
            }
          }
        } else if (/^\/(help|start)(?:@[A-Za-z0-9_]+)?(?:\s|$)/.test(message.text)) {
          await this.send(chatId, 'Я сообщаю о новых периодах с рейтингом РИФ и напоминаю о решениях за час до дедлайна. Для подключения: раздел «Telegram» на сайте МЭКОМ → создать код → /connect код в групповом чате → выбрать игры на сайте.');
        }
      }
      this.db.telegram.mark(update.update_id);
    } finally { this.processing.delete(update.update_id); }
  }
  start() {
    this.stopped = false;
    const run = () => { if (!this.running) this.drain = this.tick().catch(() => { console.error('Telegram notification sweep failed; will retry.'); }); };
    run();
    this.timer = setInterval(run, 30000);
    this.timer.unref();
  }
  async stop() { this.stopped = true; clearInterval(this.timer); await this.drain; }
  async tick(now = Date.now()) {
    if (this.running || this.stopped || now < this.rateUntil) return;
    this.running = true;
    try {
      this.db.transaction(() => {
        for (const link of this.db.telegram.links()) {
          const room = this.db.room(link.roomId);
          if (room) {
            const text = reminderMessage(room, now);
            if (text) this.db.telegram.enqueue(link.id, room, 'reminder', text);
          }
        }
      });
      for (const job of this.db.telegram.due(now)) {
        if (this.stopped) break;
        const room = this.db.room(job.roomId);
        if (!room || room.phase === 'closed' || roomPeriod(room) !== job.period || (job.kind === 'period' && room.phase !== 'collecting') || (job.kind === 'complete' && room.phase !== 'complete')) { this.db.telegram.done(job.id); continue; }
        // Read the latest submitted flags before every attempt, including retries.
        const text = job.kind === 'reminder' ? reminderMessage(room, Math.max(now, Date.now())) : job.text;
        if (!text) { this.db.telegram.done(job.id); continue; }
        try {
          await this.send(job.chatId, text, room.id);
          this.db.telegram.done(job.id);
        } catch (error) {
          if (error instanceof TelegramError && (error.code === 403 || error.code === 400)) {
            this.db.telegram.inactive(job.chatId, error.migrateTo ? 'Чат преобразован в супергруппу. Подключите его заново.' : 'Бот не может отправлять сообщения. Проверьте права и подключите чат заново.');
          } else {
            const delay = error instanceof TelegramError && error.retryAfter ? error.retryAfter * 1000 : Math.min(3600000, 30000 * 2 ** Math.min(job.attempts, 7));
            this.db.telegram.retry(job.id, Date.now() + delay);
            // Respect Telegram throttling across all jobs, not just this message.
            if (error instanceof TelegramError && error.code === 429) { this.rateUntil = Date.now() + delay; break; }
          }
        }
      }
    } finally { this.running = false; }
  }
}
