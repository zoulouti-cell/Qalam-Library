/* زر البيت في صفحة دخول المكتبة (يعيد إلى بوابة الاختيار) وترتيب «المحفوظات» ثم «إضافات» في الشريط الجانبي.
   QALAM_TEST_MONGODB_URI=… SHOTS=/مسار node tests/e2e/login-home-nav.e2e.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer, sessionCookie } from '../fixtures/boot-server.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-home-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const USER = 'avocat@example.com';
const server = await bootServer();
await server.seedUser(USER);
const browser = await chromium.launch();
const results = [], check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };
const quiet = (page, errors) => {
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|Content Security Policy|cdn\./i.test(m.text())) errors.push(m.text()); });
};

for (const [label, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['mobile', { width: 390, height: 800 }, true]]) {
  /* ---- صفحة الدخول: زر البيت ---- */
  {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
    const page = await context.newPage(), errors = []; quiet(page, errors);
    await page.goto(server.base + '/login'); await page.waitForSelector('#homeLink');
    const home = page.locator('#homeLink'), theme = page.locator('#themeToggle');
    const [hb, tb] = [await home.boundingBox(), await theme.boundingBox()];
    check(`${label}: زر البيت ظاهر بمقاس زر المظهر وفي صفه، ويسار الشاشة`, hb && tb && hb.width === tb.width && hb.height === tb.height && Math.abs(hb.y - tb.y) <= 1 && hb.x < 120 && tb.x < 120, JSON.stringify({ hb, tb }));
    check(`${label}: زر البيت بجوار زر المظهر (لا يتراكبان)`, Math.abs(hb.x - tb.x) >= hb.width - 1, JSON.stringify({ hb, tb }));
    check(`${label}: للرابط اسم إتاحة ووجهته الصفحة الرئيسية`, (await home.getAttribute('aria-label')) === 'الصفحة الرئيسية' && (await home.getAttribute('href')) === '/');
    check(`${label}: لا تمرير أفقي`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
    await page.screenshot({ path: path.join(SHOTS, `1-login-${label}.png`) });
    /* الوضع الداكن: لون الرابط كلون زر المظهر */
    await theme.click();
    const [hc, tc] = [await home.evaluate(el => getComputedStyle(el).color), await theme.evaluate(el => getComputedStyle(el).color)];
    check(`${label}: في الوضع الداكن لون البيت كلون زر المظهر`, hc === tc, `${hc} vs ${tc}`);
    await page.screenshot({ path: path.join(SHOTS, `2-login-dark-${label}.png`), clip: { x: 0, y: 0, width: viewport.width, height: 120 } });
    await Promise.all([page.waitForURL(u => new URL(u).pathname === '/'), home.click()]);
    await page.waitForSelector('.gateway-card');
    check(`${label}: الضغط يعيد إلى بوابة الاختيار (بطاقتان)`, (await page.locator('.gateway-card').count()) === 2, String(await page.locator('.gateway-card').count()));
    await page.screenshot({ path: path.join(SHOTS, `3-gateway-${label}.png`) });
    check(`${label}: لا أخطاء في الكونسول`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
  /* ---- الشريط الجانبي: المحفوظات ثم إضافات ---- */
  {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
    await context.addCookies([{ name: 'qalam_session', value: sessionCookie('reader', USER).split('=')[1], url: server.base }]);
    const page = await context.newPage(), errors = []; quiet(page, errors);
    await page.goto(server.base + '/'); await page.waitForSelector('#navContrib', { state: 'attached' });
    if (mobile) await page.click('#menuToggle');
    await page.waitForSelector('#navContrib', { state: 'visible' });
    const order = await page.locator('.main-nav > .nav-item').evaluateAll(els => els.map(el => (el.id || el.dataset.view || '')));
    check(`${label}: الترتيب المحفوظات ثم إضافات ثم سجل القراءة`, order[0] === 'saved' && order[1] === 'navContrib' && order[2] === 'history', JSON.stringify(order));
    const [sb, cb] = [await page.locator('.main-nav [data-view="saved"]').boundingBox(), await page.locator('#navContrib').boundingBox()];
    check(`${label}: «المحفوظات» على اليمين و«إضافات» على يسارها في الصف نفسه`, sb && cb && Math.abs(sb.y - cb.y) <= 2 && sb.x > cb.x, JSON.stringify({ sb, cb }));
    await page.screenshot({ path: path.join(SHOTS, `4-nav-${label}.png`) });
    /* الوظيفة سليمة بعد التبديل */
    await page.click('#navContrib'); await page.waitForSelector('#contribDialog[open]');
    check(`${label}: زر «إضافات» يفتح نافذته`, true);
    await page.keyboard.press('Escape');
    check(`${label}: لا أخطاء في الكونسول`, errors.length === 0, errors.join(' | '));
    await context.close();
  }
}
await browser.close(); await server.stop();
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} نجحت`); console.log('اللقطات:', SHOTS);
process.exit(failed ? 1 : 0);
