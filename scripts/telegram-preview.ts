// Local UI preview: isolated in-memory database and stub Telegram transport.
import { RoomDatabase } from '../server/roomDatabase.ts';
import { createAccountServer, listenAccounts } from '../server/roomsHttp.ts';
import { TelegramBot } from '../server/telegram.ts';
const db = new RoomDatabase(':memory:');
const telegram = new TelegramBot(db, { token: 'preview-only', username: 'mecom_preview_bot', secret: 'local_preview_secret_123', publicOrigin: 'https://preview.invalid' }, async () => Response.json({ ok: true, result: {} }));
const server = createAccountServer(db, { telegram });
await listenAccounts(server, 8788);
console.log('Telegram UI preview: http://127.0.0.1:8788 (no Telegram delivery)');
