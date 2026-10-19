import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

// Real built UI/server; Telegram settings responses are mocked, no real bot needed.
const directory = await mkdtemp(join(tmpdir(), 'mecom-telegram-ui-'));
const server = spawn(process.execPath, ['dist-server/index.js'], {
  env: { ...process.env, NODE_ENV: 'development', PORT: '0', MECOM_MODE: 'accounts', MECOM_DATA_DIR: directory, MECOM_PUBLIC_ORIGIN: '', MECOM_TELEGRAM_BOT_TOKEN: '', MECOM_TELEGRAM_BOT_USERNAME: '', MECOM_TELEGRAM_WEBHOOK_SECRET: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser, log = '';
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timeout: ${log}`)), 15000);
    server.stderr.on('data', data => { log += data; });
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited: ${code}, ${log}`)); });
    server.stdout.on('data', data => { const match = /listening on port (\d+)/.exec(String(data)); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const response = await page.request.post(`${base}/api/auth/register`, { data: { login: 'TelegramOwner', password: 'Disposable-password-42' } });
  assert.equal(response.status(), 201);
  await page.goto(base);
  await page.getByRole('button', { name: 'Telegram · уведомления' }).click();
  await page.getByText('Telegram-бот ещё не настроен на сервере.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Telegram · уведомления' }).click();
  let selected = ['first']; let saved;
  await page.route('**/api/telegram**', async route => {
    const path = new URL(route.request().url()).pathname;
    let body;
    if (path.endsWith('/code')) body = { code: 'a'.repeat(36), expiresAt: Date.now() + 600000 };
    else if (path.endsWith('/subscriptions')) { saved = route.request().postDataJSON(); selected = saved.roomIds; body = { ok: true }; }
    else body = { enabled: true, username: 'mecom_test_bot', chats: [{ chatId: '-123', title: 'Участники', active: true, error: null, roomIds: selected }], rooms: [{ id: 'first', name: 'Первая лига', phase: 'lobby' }, { id: 'second', name: 'Вторая лига', phase: 'collecting' }] };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.getByRole('button', { name: 'Telegram · уведомления' }).click();
  await page.getByRole('button', { name: 'Создать код подключения' }).click();
  assert.equal(await page.getByLabel('Команда подключения Telegram').inputValue(), `/connect@mecom_test_bot ${'a'.repeat(36)}`);
  assert.equal(await page.getByRole('checkbox', { name: 'Первая лига' }).isChecked(), true);
  await page.getByRole('checkbox', { name: 'Вторая лига' }).check();
  await page.getByRole('button', { name: 'Сохранить выбор игр' }).click();
  await page.getByText('Настройки чата «Участники» сохранены.', { exact: true }).waitFor();
  assert.deepEqual(saved, { chatId: '-123', roomIds: ['first', 'second'] });
  await page.getByRole('checkbox', { name: 'Первая лига' }).uncheck();
  await page.getByRole('checkbox', { name: 'Вторая лига' }).uncheck();
  const savedResponse = page.waitForResponse(response => response.url().endsWith('/api/telegram/subscriptions'));
  await page.getByRole('button', { name: 'Сохранить выбор игр' }).click();
  await savedResponse;
  assert.deepEqual(saved.roomIds, []);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS Telegram disabled state, connection code, game selection, disconnect and mobile layout');
} finally {
  await browser?.close();
  if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
  await rm(directory, { recursive: true, force: true });
}
