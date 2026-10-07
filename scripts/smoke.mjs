/**
 * Дымовой прогон приложения в реальном браузере: создание лиги, ввод решений,
 * расчёт периода, вкладки отчётов и переживание перезагрузки страницы.
 *
 * Запуск: node scripts/smoke.mjs  (dev-сервер должен быть поднят на :5173)
 */

import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync } from 'node:fs';
import JSZip from 'jszip';

const URL = (process.env.MECOM_URL ?? 'http://127.0.0.1:5173/').replace(/#.*$/, '') + '#local';
const SHOTS = process.env.MECOM_SHOTS ?? 'scripts/screenshots';
mkdirSync(SHOTS, { recursive: true });

const errors = [];
let step = 0;

async function shot(page, name) {
  step += 1;
  await page.screenshot({ path: `${SHOTS}/${String(step).padStart(2, '0')}-${name}.png`, fullPage: true });
}

function check(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
  } else {
    console.log(`  ✗ ${message}`);
    errors.push(message);
  }
}

function contrastRatio(foreground, background) {
  const luminance = (color) => {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
    if (!channels || channels.length !== 3) throw new Error(`Неизвестный цвет: ${color}`);
    const linear = channels.map((value) => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const browser = await chromium.launch({
  channel: process.env.MECOM_BROWSER_CHANNEL ?? 'chrome',
  args: ['--no-sandbox'],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('response', (r) => {
  if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`);
});

try {
  console.log('\n1. Открываю приложение');
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=М Э К О М');
  check(await page.isVisible('text=Новая лига'), 'экран списка лиг отрисовался');
  await shot(page, 'leagues');

  console.log('\n2. Создаю лигу из 5 фирм');
  await page.fill('input[placeholder="Северный рынок"]', 'Дымовая лига');
  const countInput = page.locator('.panel', { hasText: 'Новая лига' }).locator('input[type="number"]');
  await countInput.fill('5');
  await page.click('button:has-text("Создать")');
  await page.waitForSelector('text=Фирмы и стартовые условия');
  const firmRows = await page.locator('table tbody tr').count();
  check(firmRows === 5, `в настройках 5 фирм (получено ${firmRows})`);
  check(!(await page.isVisible('text=Стартовый баланс не сходится')), 'стартовый баланс сходится');
  await shot(page, 'setup');

  console.log('\n3. Ввожу решения периода 0');
  await page.click('button:has-text("К вводу решений")');
  await page.waitForSelector('text=Период 0 — решения фирм');

  // По одной строке на фирму: цена, производство, маркетинг, инвестиции, НИОКР.
  const plan = [
    { production: 420, capex: 1050, rnd: 700, marketing: 3000, price: 32 },
    { production: 400, capex: 5000, rnd: 500, marketing: 2500, price: 36 },
    { production: 450, capex: 1050, rnd: 300, marketing: 4000, price: 30 },
    { production: 380, capex: 21050, rnd: 900, marketing: 1500, price: 38 },
    { production: 300, capex: 0, rnd: 100, marketing: 800, price: 45 },
  ];

  const rows = page.locator('table tbody tr');
  for (let i = 0; i < plan.length; i++) {
    const inputs = rows.nth(i).locator('input[type="number"]');
    const { production, capex, rnd, marketing, price } = plan[i];
    for (const [index, value] of [price, production, marketing, capex, rnd].entries()) {
      await inputs.nth(index).fill(String(value));
    }
  }
  await page.fill('textarea', 'Рынок открылся спокойно. Ставки без изменений.');
  await shot(page, 'decisions');

  console.log('\n4. Считаю период 0');
  await page.click('button:has-text("Рассчитать период 0")');
  await page.waitForSelector('text=Отчёты за период 0', { timeout: 10000 });
  check(!(await page.isVisible('text=Расчёт не выполнен')), 'расчёт прошёл без ошибок');
  check(await page.isVisible('text=И Н Д У С Т Р И Я'), 'отраслевой отчёт отрисован');
  await shot(page, 'industry-report');

  const reportText = await page.locator('.report pre').innerText();
  check(reportText.includes('Всего заказов'), 'в отраслевом отчёте есть агрегаты');
  check(reportText.includes('Дымовая лига'), 'в отчёте указано название лиги');

  console.log('\n5. Проверяю вкладки отчётов фирм');
  await page.click('.tabs button:has-text("Фирма 1")');
  await page.waitForSelector('text=Отчёт о прибыли и убытках');
  const firmReport = await page.locator('.report pre').innerText();
  check(firmReport.includes('"Фирма 1"'), 'открыт отчёт именно Фирмы 1');
  check(firmReport.includes('Чистая прибыль'), 'в отчёте фирмы есть P&L');
  check(firmReport.includes('Суммарный актив'), 'в отчёте фирмы есть баланс');
  // Приватность: уникальный маркетинг Фирмы 5 ($800) не должен утечь.
  const privateBlock = firmReport.split('И Н Д У С Т Р И Я')[0];
  check(!privateBlock.includes('Фирма 5'), 'приватный блок не раскрывает другие фирмы');
  const reportColors = await page.locator('.report pre').evaluate((element) => ({
    foreground: getComputedStyle(element).color,
    background: getComputedStyle(element.parentElement).backgroundColor,
    fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
  }));
  const reportContrast = contrastRatio(reportColors.foreground, reportColors.background);
  check(reportColors.background !== 'rgb(255, 255, 255)', 'отчёт не на белом фоне');
  check(reportColors.fontSize >= 15, `шрифт отчёта не меньше 15 px (${reportColors.fontSize}px)`);
  check(reportContrast >= 7, `текст отчёта имеет высокий контраст (${reportContrast.toFixed(2)}:1)`);
  await shot(page, 'firm-report');

  console.log('\n6. Считаю период 1');
  await page.click('button:has-text("Период")');
  await page.waitForSelector('text=Период 1 — решения фирм');
  // Фирма 4 (индекс 3) в периоде 0 вложила по максимуму ($21 050) — повторить это
  // в периоде 1 ей уже не по карману. Планка на период 1 у неё ниже: инвестиции
  // ровно на амортизацию, без роста мощности, — новый предпросмотр ликвидности
  // корректно блокирует расчёт, если этого не сделать.
  const plan1 = plan.map((p, i) => (i === 3 ? { ...p, capex: 2050 } : p));
  const rows1 = page.locator('table tbody tr');
  for (let i = 0; i < plan1.length; i++) {
    const inputs = rows1.nth(i).locator('input[type="number"]');
    const { production, capex, rnd, marketing, price } = plan1[i];
    for (const [index, value] of [price, production, marketing, capex, rnd].entries()) {
      await inputs.nth(index).fill(String(value));
    }
  }
  check(await page.isEnabled('button:has-text("Рассчитать период 1")'), 'средств хватает — расчёт периода 1 разблокирован');
  await page.click('button:has-text("Рассчитать период 1")');
  await page.waitForSelector('text=Отчёты за период 1', { timeout: 10000 });
  check(!(await page.isVisible('text=Расчёт не выполнен')), 'период 1 посчитан без ошибок');

  console.log('\n7. Скачиваю архив со всеми отчётами фирм');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('button:has-text("Скачать все отчёты фирм")'),
  ]);
  const zipPath = await download.path();
  check(zipPath !== null, 'архив скачался');
  check(download.suggestedFilename() === 'Дымовая лига.zip', `имя архива — по названию лиги (${download.suggestedFilename()})`);
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const filePaths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
  // 5 фирм × 2 посчитанных периода (0 и 1) = 10 картинок.
  check(filePaths.length === 10, `в архиве 10 картинок — 5 фирм × 2 периода (получено ${filePaths.length})`);
  check(filePaths.every((p) => p.startsWith('Дымовая лига/')), 'все файлы лежат в папке с названием лиги');
  check(filePaths.some((p) => p.startsWith('Дымовая лига/0/')), 'есть подпапка периода 0');
  check(filePaths.some((p) => p.startsWith('Дымовая лига/1/')), 'есть подпапка периода 1');
  check(filePaths.every((p) => p.endsWith('.png')), 'все файлы в архиве — PNG-картинки');

  console.log('\n8. Перезагружаю страницу — состояние должно пережить reload');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=Дымовая лига');
  check(await page.isVisible('text=рассчитано периодов: 2'), 'после reload оба периода на месте');
  await shot(page, 'after-reload');

  console.log('\n9. История лиги');
  await page.click('.league-card button:has-text("Открыть")');
  await page.waitForSelector('text=Период 2 — решения фирм');
  await page.click('.topbar button:has-text("История")');
  await page.waitForSelector('text=История лиги');
  const historyRows = await page.locator('table tbody tr').count();
  check(historyRows >= 2, `в истории есть строки по периодам (${historyRows})`);
  check(await page.isVisible('text=Индустрия по периодам'), 'таблица индустрии по периодам есть');
  await shot(page, 'history');

  console.log('\n10. Проверяю ошибки консоли и сетевые запросы');
  const realErrors = consoleErrors.filter((e) => !e.includes('Download the React DevTools'));
  // favicon браузер запрашивает сам; своей иконки у приложения нет — это не дефект.
  const realFailures = failedRequests.filter((r) => !r.includes('favicon'));
  check(realFailures.length === 0, `нет неудачных запросов${realFailures.length ? ': ' + realFailures.join(' | ') : ''}`);
  const unexplained = realErrors.filter((e) => !e.includes('404'));
  check(unexplained.length === 0, `консоль без ошибок${unexplained.length ? ': ' + unexplained.join(' | ') : ''}`);
  if (failedRequests.length) console.log(`  (сетевые 4xx/5xx: ${failedRequests.join(', ')})`);
} catch (error) {
  errors.push(`Исключение: ${error.message}`);
  console.error('\nПрогон прерван:', error.message);
  await shot(page, 'failure');
} finally {
  await browser.close();
}

console.log('\n' + '─'.repeat(60));
if (errors.length === 0) {
  console.log('ДЫМОВОЙ ПРОГОН ПРОЙДЕН');
} else {
  console.log(`ПРОВАЛЕНО ПРОВЕРОК: ${errors.length}`);
  for (const e of errors) console.log(`  • ${e}`);
  process.exitCode = 1;
}
