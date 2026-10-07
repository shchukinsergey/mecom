import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright-core';

// Real browser + real built server. All accounts and saves are disposable.
const directory = await mkdtemp(join(process.env.MECOM_SMOKE_DIR ?? tmpdir(), 'mecom-rooms-'));
const root = resolve('.');
const errors = [];
const checks = [];
let server;
let browser;
let base;
let serverLog = '';
function checked(name) { checks.push(name); console.log(`PASS ${name}`); }
async function start() {
  server = spawn(process.execPath, ['dist-server/index.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'development', MECOM_MODE: 'accounts', MECOM_SERVER_PORT: '0', PORT: '0', MECOM_DATA_DIR: directory, MECOM_PUBLIC_ORIGIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', data => { serverLog += data; });
  base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server startup timeout: ${serverLog}`)), 15000);
    server.on('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${serverLog}`)); });
    server.stdout.on('data', data => {
      serverLog += data;
      const match = /account server listening on port (\d+)/.exec(String(data));
      if (match) { clearTimeout(timer); resolve(`http://127.0.0.1:${match[1]}`); }
    });
  });
  const response = await fetch(`${base}/health`); assert.equal(response.status, 200);
}
async function stop() {
  if (!server || server.exitCode !== null) return;
  const child = server;
  await new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
  server = undefined;
}
async function newPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) errors.push(message.text()); });
  page.on('dialog', dialog => void dialog.accept());
  return { context, page };
}
async function register(page, login, target = base) {
  await page.goto(target);
  await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
  await page.locator('#account-login').fill('invalid!');
  assert.equal(await page.locator('#account-login').evaluate(input => input.validity.patternMismatch), true);
  await page.locator('#account-login').fill(login);
  assert.equal(await page.locator('#account-login').evaluate(input => input.validity.patternMismatch), false);
  await page.locator('#account-password').fill('Disposable-test-password-42');
  await page.getByRole('button', { name: 'Зарегистрироваться', exact: true }).click();
  await page.locator('.badge').filter({ hasText: login }).waitFor();
}
async function joinFirm(page, firm, owner = false) {
  await page.getByRole('button', { name: owner ? 'Играть самому' : 'Присоединиться', exact: true }).click();
  await page.locator('#join-firm').fill(firm);
  await page.getByRole('button', { name: 'Создать фирму', exact: true }).click();
  await page.getByRole('heading', { name: 'Кабинет участника', exact: true }).waitFor();
}
async function openPlayer(page) {
  const button = page.getByRole('button', { name: 'Открыть мой кабинет', exact: true });
  if (await button.count()) await button.click();
  await page.locator('#player-price:not(:disabled)').waitFor();
}
async function decision(page, submit) {
  await openPlayer(page);
  for (const [key, value] of Object.entries({ price: 30, production: 0, marketing: 0, capexGross: 0, rnd: 0 })) await page.locator(`#player-${key}`).fill(String(value));
  const button = page.getByRole('button', { name: submit ? 'Отправить решение' : 'Сохранить черновик', exact: true });
  await button.click();
  if (submit) await page.locator('#player-price:disabled').waitFor();
  else await button.waitFor({ state: 'visible' });
}
async function api(context, path, method = 'GET', data) {
  const response = await context.request.fetch(`${base}/api${path}`, { method, ...(data === undefined ? {} : { data }) });
  return { status: response.status(), body: await response.json() };
}
try {
  await mkdir(directory, { recursive: true });
  await start();
  browser = await chromium.launch({ headless: true, channel: process.env.MECOM_BROWSER_CHANNEL ?? 'msedge' });
  const a = await newPage(); const b = await newPage(); const outsider = await newPage();
  await register(a.page, 'smoke_owner');
  await a.page.locator('#room-name').fill('Smoke friends');
  await a.page.getByRole('button', { name: 'Создать комнату', exact: true }).click();
  await a.page.waitForURL(/#room\//);
  const id = new URL(a.page.url()).hash.slice('#room/'.length);
  const link = `${base}/#room/${id}`;
  await joinFirm(a.page, 'Owner Firm', true);
  await register(b.page, 'smoke_friend', link);
  await b.page.getByRole('heading', { name: 'Smoke friends', exact: true }).waitFor();
  await joinFirm(b.page, 'Friend Firm');
  checked('Registration, public room, invitation deep link and owner playing own firm');
  await a.page.reload();
  await a.page.getByRole('button', { name: 'Начать игру (нужно минимум 2 фирмы)' }).click();
  await a.page.getByRole('button', { name: 'Принудительный расчёт…', exact: true }).waitFor();
  await b.page.reload();
  await decision(a.page, true); await decision(b.page, false);
  assert.equal(await a.page.getByRole('button', { name: 'Рассчитать период — все готовы', exact: true }).isDisabled(), true);
  checked('Period zero reports, own decisions, normal calculation blocked while friend is not ready');
  await a.page.getByRole('button', { name: 'Принудительный расчёт…', exact: true }).click();
  const dialog = a.page.getByRole('dialog');
  await dialog.getByText('Сохранённый черновик', { exact: false }).waitFor();
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal((await api(a.context, `/rooms/${id}`)).body.currentPeriodIndex, 1);
  checked('Force preview identifies unready firm and saved draft; cancel makes no change');
  await a.page.getByRole('button', { name: 'Принудительный расчёт…', exact: true }).click();
  await dialog.getByRole('button', { name: 'Да, рассчитать принудительно', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal((await api(a.context, `/rooms/${id}`)).body.currentPeriodIndex, 2);
  checked('Explicit forced calculation advances exactly one period');
  await a.page.reload(); await b.page.reload();
  await decision(a.page, true); await decision(b.page, true);
  // Readiness is intentionally polled. Reload to avoid timing assumptions.
  await a.page.reload();
  await a.page.getByRole('button', { name: 'Рассчитать период — все готовы', exact: true }).click();
  await a.page.waitForFunction(() => document.body.innerText.includes('период 3'));
  const ownerMe = (await api(a.context, `/rooms/${id}/me`)).body;
  const friendMe = (await api(b.context, `/rooms/${id}/me`)).body;
  assert.equal(ownerMe.reports.length, 3); assert.equal(friendMe.reports.length, 3);
  assert(ownerMe.recentResults.every(result => result.firmId === ownerMe.firmId));
  assert(friendMe.recentResults.every(result => result.firmId === friendMe.firmId));
  const roomData = (await api(a.context, `/rooms/${id}`)).body;
  assert(!('snapshot' in roomData)); assert(roomData.firms.every(firm => !('decision' in firm)));
  checked('Normal calculation and private report histories; no rival private data in owner DTO');
  await register(outsider.page, 'smoke_outsider');
  assert.equal((await api(outsider.context, `/rooms/${id}/me`)).status, 403);
  assert.equal((await api(b.context, `/rooms/${id}/calculate`, 'POST', { periodIndex: 3, force: true })).status, 403);
  assert.equal((await api(a.context, '/state')).status, 404);
  assert.equal((await api(a.context, '/admin/games/'+id)).status, 404);
  checked('Member/owner isolation and legacy APIs absent');
  const hidden = await api(a.context, '/rooms', 'POST', { name: 'Hidden friends', visibility: 'link' });
  assert.equal(hidden.status, 201);
  assert(!(await api(outsider.context, '/rooms?scope=open')).body.rooms.some(room => room.id === hidden.body.id));
  assert.equal((await api(outsider.context, `/rooms/${hidden.body.id}`)).status, 200);
  checked('Link-only room excluded from public catalogue and accessible by shared link');
  await b.page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await b.page.locator('#account-login').fill('SMOKE_FRIEND');
  await b.page.locator('#account-password').fill('Disposable-test-password-42');
  await b.page.getByRole('button', { name: 'Войти', exact: true }).click();
  await b.page.getByRole('heading', { name: 'Smoke friends', exact: true }).waitFor();
  checked('Logout and case-insensitive login restore existing firm on deep link');
  // Use the same port after restart to preserve browser cookies and origin.
  const oldPort = new URL(base).port;
  await stop();
  server = spawn(process.execPath, ['dist-server/index.js'], { cwd: root, env: { ...process.env, NODE_ENV: 'development', MECOM_MODE: 'accounts', PORT: oldPort, MECOM_DATA_DIR: directory, MECOM_PUBLIC_ORIGIN: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('restart timed out')), 15000); server.once('exit', code => { clearTimeout(t); reject(new Error(`restart exit ${code}`)); }); server.stdout.on('data', data => { if (String(data).includes('account server listening')) { clearTimeout(t); resolve(); } }); server.stderr.on('data', data => { serverLog += data; }); });
  await b.page.reload(); await b.page.getByRole('heading', { name: 'Smoke friends', exact: true }).waitFor();
  assert.equal((await api(b.context, `/rooms/${id}/me`)).body.reports.length, 3);
  assert.equal((await api(a.context, '/auth/me')).status, 200);
  assert((await readdir(join(directory, 'backups'))).some(name => name.endsWith('.sqlite')));
  checked('Server restart preserves accounts, cookies, firms, periods and online SQLite backups');
  await a.page.setViewportSize({ width: 390, height: 844 });
  await a.page.reload(); await a.page.getByRole('heading', { name: 'Smoke friends', exact: true }).waitFor();
  assert(await a.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await a.page.screenshot({ path: join(directory, 'mobile-room.png'), fullPage: true });
  await b.page.screenshot({ path: join(directory, 'desktop-room.png'), fullPage: true });
  checked('Mobile room layout stays within viewport');
  await a.page.getByRole('button', { name: 'Локальная игра', exact: true }).click();
  await a.page.waitForURL(/#local$/); await a.page.getByRole('button', { name: 'Онлайн-комнаты', exact: true }).click();
  await a.page.getByRole('button', { name: 'Мои игры', exact: true }).click();
  await a.page.getByRole('heading', { name: 'Smoke friends', exact: true }).waitFor();
  checked('Local mode and return to online My Games preserve account');
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'result.json'), JSON.stringify({ success: true, checks, errors }, null, 2));
  console.log(`Verified ${checks.length} real-browser checks. Evidence: ${directory}`);
} catch (error) {
  console.error(error);
  if (browser) for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) { try { await page.screenshot({ path: join(directory, `failure-${index}.png`), fullPage: true }); } catch {} }
  await writeFile(join(directory, 'result.json'), JSON.stringify({ success: false, checks, errors, error: String(error), serverLog }, null, 2));
  console.error(`Evidence: ${directory}`); process.exitCode = 1;
} finally { await browser?.close(); await stop(); }
