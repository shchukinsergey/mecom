import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';
const directory = await mkdtemp(join(tmpdir(), 'mecom-telegram-auth-'));
const server = spawn(process.execPath, ['dist-server/index.js'], { env: { ...process.env, NODE_ENV: 'development', PORT: '0', MECOM_MODE: 'accounts', MECOM_DATA_DIR: directory, MECOM_PUBLIC_ORIGIN: '', MECOM_TELEGRAM_BOT_TOKEN: '', MECOM_TELEGRAM_BOT_USERNAME: '', MECOM_TELEGRAM_WEBHOOK_SECRET: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Startup timeout')), 15000);
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}`)); });
    server.stdout.on('data', data => { const match = /listening on port (\d+)/.exec(String(data)); if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); } });
  });
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage(); page.setDefaultTimeout(8000); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/auth/telegram', route => route.fulfill({ json: { enabled: true, username: 'mecom_test_bot' } }));
  await page.goto(base);
  await page.getByRole('button', { name: 'Войти через Telegram', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Логин', { exact: true }).count(), 1);
  await page.getByLabel('Логин', { exact: true }).fill('SmokeUser');
  await page.getByLabel('Пароль', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.getByLabel('Пароль', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await page.getByRole('button', { name: /Уведомления/ }).waitFor().catch(async e => { console.log(await page.locator('body').innerText()); throw e; });
  let linked = false;
  await page.route('**/api/telegram', route => route.fulfill({ json: { enabled: true, username: 'mecom_test_bot', identity: linked ? { id: '42', username: 'smoke', name: 'Smoke', active: true } : null, chats: [], rooms: [] } }));
  await page.route('**/api/telegram/personal/start', route => route.fulfill({ json: { token: 'a'.repeat(64), code: 'b'.repeat(24), expiresAt: Date.now() + 300000 } }));
  await page.route('**/api/telegram/personal/finish', route => { linked = true; return route.fulfill({ json: { user: { id: 'smoke', login: 'SmokeUser' } } }); });
  await page.getByRole('button', { name: /Уведомления/ }).click();
  await page.getByRole('button', { name: 'Подключить Telegram', exact: true }).click();
  assert.equal(await page.getByLabel('Команда личного входа Telegram').inputValue(), '/login ' + 'b'.repeat(24));
  await page.getByText(/Подключён: @smoke/).waitFor();
  assert.deepEqual(errors, []);
  console.log('Telegram auth UI smoke passed');
} finally { await browser?.close(); server.kill(); await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve)); await rm(directory, { recursive: true, force: true }); }
