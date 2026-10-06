import { chromium } from 'playwright-core';

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', String(e)));

await page.addInitScript(() => {
  window.showDirectoryPicker = async () => navigator.storage.getDirectory();
});

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });

const info = await page.evaluate(async () => {
  const root = await navigator.storage.getDirectory();
  const out = { hasQueryPermission: typeof root.queryPermission, hasRequestPermission: typeof root.requestPermission };
  try {
    out.queryResult = await root.queryPermission({ mode: 'readwrite' });
  } catch (e) {
    out.queryError = String(e);
  }
  try {
    out.requestResult = await root.requestPermission({ mode: 'readwrite' });
  } catch (e) {
    out.requestError = String(e);
  }
  return out;
});
console.log('OPFS handle info:', info);

await browser.close();
