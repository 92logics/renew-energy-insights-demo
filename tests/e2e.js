// Headless end-to-end checks (puppeteer-core + local Chrome). Usage: node tests/e2e.js https://92logics.github.io/renew-energy-insights-demo/
const puppeteer = require('puppeteer-core');
const BASE = process.argv[2];
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage(); const errors = [];
  p.on('pageerror', e => errors.push('pageerror ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console ' + m.text()); });
  p.on('requestfailed', r => errors.push('reqfail ' + r.url()));
  const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(BASE + '#home', { waitUntil: 'networkidle0' });
  ok((await p.$eval('#demoBanner', e => e.textContent)).includes('Demo by 92 Logics'), 'banner present');
  ok(/kWh/.test(await p.$eval('[data-testid=kpi-kwh]', e => e.textContent)), 'home KPIs: ' + await p.$eval('[data-testid=kpi-kwh]', e => e.textContent) + ' ' + await p.$eval('[data-testid=kpi-cost]', e => e.textContent));
  ok(await p.$eval('[data-testid=green-window]', e => e.textContent.length > 4), 'green window shown');
  const html = await p.content(); ok(!/maynooth|renew project/i.test(html.replace(/renew-energy-insights-demo|renew-demo|RENEW_|ei\//g, '')), 'no Maynooth/RENEW-project mentions');
  // tenants theming
  const prim = async () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim());
  const c1 = await prim(); await p.select('[data-testid=tenant]', 'meitheal'); const c2 = await prim();
  ok(c1 !== c2, `theme switches per tenant ${c1} -> ${c2}`);
  await p.select('[data-testid=tenant]', 'harbour');
  ok(await p.evaluate(() => document.documentElement.lang) === 'pl', 'harbour defaults to Polish');
  ok((await p.$eval('.tabs', e => e.textContent)).includes('Oszczędzaj'), 'Polish nav');
  await p.select('[data-testid=lang]', 'en');
  // save view
  await p.goto(BASE + '#save', { waitUntil: 'networkidle0' }); await p.select('[data-testid=tenant]', 'brightwatt');
  const n = await p.$$eval('[data-testid=rec]', e => e.length); ok(n > 0, 'recommendations: ' + n + ' total ' + await p.$eval('[data-testid=total-saving]', e => e.textContent));
  ok((await p.$eval('[data-testid=model-card]', e => e.textContent)).includes('MAPE'), 'model card with MAPE');
  await p.click('[data-accept]'); await new Promise(r => setTimeout(r, 300));
  ok((await p.content()).includes('Reminder set'), 'accept recommendation');
  await p.click('#dynToggle'); await new Promise(r => setTimeout(r, 200)); ok(await p.$eval('#dynToggle', e => e.checked), 'dynamic toggle');
  // live
  await p.goto(BASE + '#live', { waitUntil: 'networkidle0' });
  await p.click('[data-testid=stream]'); await new Promise(r => setTimeout(r, 4500));
  const acc = +(await p.$eval('[data-testid=accepted]', e => e.textContent)); ok(acc > 10, 'mqtt accepted msgs: ' + acc);
  await p.click('[data-testid=spoof]'); await new Promise(r => setTimeout(r, 300));
  ok(+(await p.$eval('[data-testid=blocked]', e => e.textContent)) >= 1, 'cross-tenant spoof blocked');
  await p.click('[data-testid=stream]');
  // admin
  await p.goto(BASE + '#admin', { waitUntil: 'networkidle0' });
  ok((await p.$eval('[data-testid=portfolio-potential]', e => e.textContent)).includes('€'), 'portfolio analytics');
  await p.$eval('[data-testid=color]', e => { e.value = '#aa00aa'; e.dispatchEvent(new Event('input')); });
  await p.click('[data-testid=save-config]'); await new Promise(r => setTimeout(r, 200));
  ok(await prim() === '#aa00aa', 'tenant colour saved');
  await p.select('[data-testid=tenant]', 'meitheal'); ok(await prim() !== '#aa00aa', 'other tenant unaffected');
  await p.select('[data-testid=tenant]', 'brightwatt'); await p.click('#resetCfg');
  // api
  await p.goto(BASE + '#api', { waitUntil: 'networkidle0' });
  await p.select('[data-testid=endpoint]', '/households/{hh}/recommendations'); await p.click('[data-testid=run-api]');
  ok((await p.$eval('#reqLine', e => e.textContent)).includes('200'), 'api 200: ' + await p.$eval('#reqLine', e => e.textContent));
  await p.select('[data-testid=token-tenant]', 'harbour'); await p.click('[data-testid=run-api]');
  ok((await p.$eval('#reqLine', e => e.textContent)).includes('403'), 'api 403 cross-tenant');
  // PWA
  const sw = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); return !!r; }); ok(sw, 'service worker registered');
  // mobile
  await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await p.goto(BASE + '#home', { waitUntil: 'networkidle0' });
  const pos = await p.$eval('.tabs', e => getComputedStyle(e).position); ok(pos === 'fixed', 'mobile bottom nav');
  const ow = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1); ok(ow, 'no horizontal overflow on mobile');
  await p.screenshot({ path: '/tmp/renew-mobile.png' });
  await p.setViewport({ width: 1280, height: 900 }); await p.goto(BASE + '#save', { waitUntil: 'networkidle0' }); await p.screenshot({ path: '/tmp/renew-save.png', fullPage: true });
  await p.goto(BASE + '#home', { waitUntil: 'networkidle0' }); await p.screenshot({ path: '/tmp/renew-home.png', fullPage: true });
  // offline reload
  await p.setOfflineMode(true); await p.reload({ waitUntil: 'domcontentloaded' }); await new Promise(r => setTimeout(r, 800));
  ok(await p.$('[data-testid=kpi-kwh]') !== null, 'works offline after reload'); await p.setOfflineMode(false);
  ok(errors.filter(e => !e.includes('favicon')).length === 0, 'no JS errors ' + JSON.stringify(errors.slice(0, 5)));
  await b.close();
})().catch(e => { console.error(e); process.exit(2); });
