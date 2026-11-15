/* تصفح «الاتفاقيات متعددة الأطراف» في متصفح حقيقي على شجرة Drive محاكاة تطابق مجلدات المكتبة:
   الفرع يُعرض، عنوان الاتفاق الإقليمي الثلاثي يظهر كما طُلب، وأيقونة المعاينة تفتح الأصل عبر خدمة المكتبة.
   QALAM_TEST_MONGODB_URI=… SHOTS=/مسار node tests/e2e/agreements.e2e.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer, sessionCookie } from '../fixtures/boot-server.mjs';
import { startFakeDrive, ROOT_ID } from '../fixtures/fake-drive.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-agreements-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const REGIONAL_TITLE = 'اتفاقيات إقليمية - المغرب . الجزائر. تونس. اتفاق حول التلوث البحري';

const drive = await startFakeDrive({ sections: [] });
let seq = 0;
const folder = (name, parent) => { const id = 'f' + (++seq); drive.files.set(id, { id, name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }); return id; };
const pdf = (name, parent) => { const id = 'p' + (++seq); drive.files.set(id, { id, name, mimeType: 'application/pdf', parents: [parent], size: '100', modifiedTime: '2026-11-03T11:44:18.000Z', webViewLink: 'https://drive.google.com/file/d/' + id + '/view' }); return id; };
const treaties = folder('الاتفاقيات و المعاهدات', ROOT_ID), bilateral = folder('ثنائية الاطراف', treaties), multilateral = folder('متعددة الاطراف', treaties);
const subs = Object.fromEntries(['اتفاقيات جنيف', 'اتفاقيات منظمة العمل الدولية', 'اتفاقيات لاهاي', 'اتفاقيات حقوق الإنسان', 'اتفاقيات إقليمية', 'اتفاقيات دولية'].map(n => [n, folder(n, multilateral)]));
const regionalId = pdf('10038_ظهير شريف رقم 1.09.250 بنشر الاتفاق الموقع بالجزائر-1791386556569.pdf', subs['اتفاقيات إقليمية']);
pdf('6652_ظهير شريف رقم 1.13.11 بنشر الاتفاق الموقع بالرباط-1739454863488.pdf', subs['اتفاقيات إقليمية']);
pdf('4608_اتفاقية الأمم المتحدة في شأن النقل البحري للبضائع.pdf', subs['اتفاقيات دولية']);
pdf('6081_اتفاقية الشغل البحري لعام 2006.pdf', subs['اتفاقيات جنيف']);
pdf('2632_اتفاقية الاستيطان بين المغرب والجمهورية التونسية.pdf', folder('تونس', bilateral));
drive.files.get(regionalId).data = '%PDF-1.4\n% regional agreement original\n%%EOF\n';

const server = await bootServer({ env: { NODE_ENV: 'test', QALAM_TEST_GOOGLE_ORIGIN: drive.origin, GOOGLE_SERVICE_ACCOUNT_JSON: drive.serviceAccountJson, DRIVE_ROOT_FOLDER_ID: ROOT_ID } });
const cookie = sessionCookie('reader'), browser = await chromium.launch();
const results = [], check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };

for (const [label, viewport, mobile] of [['desktop', { width: 1280, height: 900 }, false], ['mobile', { width: 390, height: 800 }, true]]) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
  await context.addCookies([{ name: 'qalam_session', value: cookie.split('=')[1], url: server.base }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('response', r => { if (r.status() >= 400 && /\/api\/drive\//.test(r.url())) errors.push('HTTP ' + r.status() + ' ' + r.url()); });
  await page.goto(server.base + '/'); await page.waitForSelector('[data-agreement-sidebar="متعددة"]', { state: 'attached' });
  await page.evaluate(() => document.querySelector('[data-agreement-sidebar="متعددة"]').click());
  await page.waitForSelector('.agreement-search-card');
  const cards = page.locator('.agreement-search-card');
  check(`${label}: فرع متعددة الأطراف يعرض الوثائق الأربع كلها (ولا يعرض الثنائية)`, (await cards.count()) === 4, String(await cards.count()));
  const heads = await page.locator('.agreement-search-card h3').allTextContents();
  check(`${label}: عنوان الاتفاق الإقليمي الثلاثي كما طُلب`, heads.some(text => text.trim() === REGIONAL_TITLE), JSON.stringify(heads));
  check(`${label}: لا بطاقة بالعنوان القديم «الاتفاق» للاتفاق الثلاثي`, !heads.some(text => text.includes('الاتفاق —') && /التلوث/.test(text)));
  check(`${label}: الاتفاق الإقليمي الآخر يبقى بعنوانه`, heads.some(text => text.trim() === 'الاتفاق — اتفاقيات إقليمية'));
  const card = page.locator('.agreement-search-card', { hasText: 'التلوث البحري' });
  check(`${label}: القسم الإقليمي يظهر تحت العنوان`, /اتفاقيات إقليمية/.test(await card.locator('.result-snippet').textContent()));
  const eye = card.locator('a[aria-label*="معاينة"]'), href = await eye.first().getAttribute('href');
  check(`${label}: أيقونة المعاينة تمر عبر خدمة المكتبة`, /^\/api\/drive\/file\?id=.+&mode=preview$/.test(href || ''), href || '');
  const opened = await fetch(server.base + href, { headers: { cookie } }), bytes = await opened.text();
  check(`${label}: فتح الأصل يعيد PDF سليمًا`, opened.status === 200 && /pdf/.test(opened.headers.get('content-type') || '') && bytes.startsWith('%PDF') && bytes.includes('regional agreement original'), `${opened.status} ${bytes.slice(0, 30)}`);
  check(`${label}: لا تمرير أفقي`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
  await card.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, `agreements-${label}.png`) });
  check(`${label}: لا أخطاء في الصفحة ولا في مسارات Drive`, errors.length === 0, errors.join(' | '));
  await context.close();
}
await browser.close(); await server.stop(); await drive.stop();
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} نجحت`); console.log('اللقطات:', SHOTS);
process.exit(failed ? 1 : 0);
