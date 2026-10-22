import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { chromium } from 'playwright-core';

// Only disposable local data; never points to the downloaded backup or live DB.
const directory = resolve('.local-backups/scenario-browser-' + Date.now());
await mkdir(directory, { recursive: true });
const server = spawn(process.execPath, ['dist-server/index.js'], {
  env: { ...process.env, NODE_ENV: 'development', PORT: '0', MECOM_MODE: 'accounts',
    MECOM_DATA_DIR: directory, MECOM_PUBLIC_ORIGIN: '', MECOM_TELEGRAM_BOT_TOKEN: '',
    MECOM_TELEGRAM_BOT_USERNAME: '', MECOM_TELEGRAM_WEBHOOK_SECRET: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let browser;
let log = '';
server.stderr.on('data', chunk => { log += chunk; });
try {
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server timeout: ' + log)), 15000);
    server.once('exit', code => { clearTimeout(timer); reject(new Error('Server exited ' + code)); });
    server.stdout.on('data', chunk => {
      const match = /listening on port (\d+)/.exec(String(chunk));
      if (match) { clearTimeout(timer); resolve('http://127.0.0.1:' + match[1]); }
    });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const owner = await browser.newContext();
  const second = await browser.newContext();
  for (const [context, login] of [[owner, 'scenario_owner'], [second, 'scenario_player']]) {
    const response = await context.request.post(base + '/api/auth/register', { data: { login, password: 'Disposable-password-42' } });
    assert.equal(response.status(), 201);
  }
  const page = await owner.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.locator('.rooms-page-heading button').click();
  await page.locator('#room-name').fill('Проверка сценария');
  const type = page.getByRole('combobox', { name: 'Тип игры', exact: true });
  const select = page.getByRole('combobox', { name: 'Сценарий', exact: true });
  assert.equal(await type.inputValue(), 'ordinary');
  assert.equal(await select.count(), 0);
  await type.selectOption('scenario');
  assert.equal(await select.locator('option').count(), 3);
  await select.selectOption('ipad-v2');
  await page.getByText('Бум продаж планшетов', { exact: false }).waitFor();
  await select.selectOption('emobile-v2');
  await page.getByText('Запуск нового автомобиля', { exact: false }).waitFor();
  await type.selectOption('ordinary');
  assert.equal(await select.count(), 0);
  await page.getByText('Финансовые настройки', { exact: true }).waitFor();
  await type.selectOption('scenario');
  await select.selectOption('tractors-v2');
  assert.equal(await page.getByText('Финансовые настройки', { exact: true }).count(), 0);
  await page.screenshot({ path: join(directory, 'scenario-create-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(directory, 'scenario-create-mobile.png'), fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Создать комнату', exact: true }).click();
  await page.waitForURL(/#room\//);
  const route = '/api/rooms/' + new URL(page.url()).hash.slice('#room/'.length);
  for (const [context, firmName] of [[owner, 'Трактор А'], [second, 'Трактор Б']]) {
    assert.equal((await context.request.post(base + route + '/join', { data: { firmName } })).status(), 200);
  }
  assert.equal((await owner.request.post(base + route + '/start', { data: {} })).status(), 200);
  await page.reload();
  await page.getByRole('button', { name: 'Открыть мой кабинет', exact: true }).click();
  await page.getByText('Модернизация невозможна', { exact: false }).waitFor();
  await page.screenshot({ path: join(directory, 'scenario-player-mobile.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Решения', exact: true }).click();
  assert.equal(await page.locator('#player-price').getAttribute('min'), '10');
  assert.equal(await page.locator('#player-price').getAttribute('max'), '200');
  await page.locator('#player-price').fill('201');
  await page.getByText('Цена по сценарию: от 10 до 200 $.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Отправить решение', exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  await writeFile(join(directory, 'result.json'), JSON.stringify({ success: true, errors }, null, 2));
  console.log('Scenario creation, mobile UI, current news and price validation passed. Evidence: ' + directory);
} finally {
  await browser?.close();
  if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill('SIGTERM'); });
}
