/* زر «ترقية إلى مدير / خفض إلى قارئ» في تبويب «حسابات المستخدمين»، في متصفح حقيقي.
   QALAM_TEST_MONGODB_URI=… SHOTS=/مسار node tests/e2e/user-role.e2e.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer, sessionCookie } from '../fixtures/boot-server.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-role-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const TARGET = 'zoulouti@gmail.com', ADMIN2 = 'only.admin@example.com';
const server = await bootServer();
await server.seedUser(TARGET, 'reader'); await server.seedUser(ADMIN2, 'admin');
const browser = await chromium.launch();
const results = [], check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };
const roleInDb = email => server.mongo(db => db.collection('libraryUsers').findOne({ email }, { projection: { role: 1 } })).then(u => u?.role);

async function run(label, viewport, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
  await context.addCookies([{ name: 'qalam_session', value: sessionCookie('admin').split('=')[1], url: server.base }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  await page.goto(server.base + '/admin'); await page.waitForSelector('#usersList .user-row');
  const row = email => page.locator('#usersList .user-row', { hasText: email });
  const btn = email => row(email).locator('[data-role-user]');

  check(`${label}: القارئ يحمل زر «ترقية إلى مدير»`, (await btn(TARGET).innerText()).includes('ترقية إلى مدير') && /قارئ/.test(await row(TARGET).innerText()));
  await page.screenshot({ path: path.join(SHOTS, `${label}-1-list.png`) });
  await btn(TARGET).click();
  check(`${label}: الضغطة الأولى تطلب التأكيد ولا تغيّر شيئًا`, /تأكيد/.test(await btn(TARGET).innerText()) && (await roleInDb(TARGET)) === 'reader');
  await page.screenshot({ path: path.join(SHOTS, `${label}-2-confirm.png`) });
  await btn(TARGET).click();
  await page.waitForFunction(() => /مُنح الحساب صلاحية المدير/.test(document.getElementById('notice')?.textContent || ''));
  check(`${label}: التأكيد يرقّي الحساب وتظهر رسالة النجاح`, (await roleInDb(TARGET)) === 'admin' && /مدير المكتبة/.test(await row(TARGET).innerText()) && /عند دخوله التالي/.test(await page.locator('#notice').innerText()));
  check(`${label}: الزر صار «خفض إلى قارئ»`, (await btn(TARGET).innerText()).includes('خفض إلى قارئ'));
  await page.screenshot({ path: path.join(SHOTS, `${label}-3-promoted.png`) });

  /* مهلة التأكيد تتراجع من تلقاء نفسها دون تغيير */
  await btn(TARGET).click(); await page.waitForFunction(() => /تأكيد/.test(document.querySelector('[data-role-user]').textContent));
  await page.waitForFunction(() => document.querySelector('[data-role-user]') && !document.querySelector('[data-role-user].confirm'), null, { timeout: 9000 });
  check(`${label}: ترك التأكيد دون ضغط يعيد الزر لحاله ولا يخفض`, (await roleInDb(TARGET)) === 'admin');

  /* خفض بخطوتين */
  await btn(TARGET).click(); await btn(TARGET).click();
  await page.waitForFunction(() => /خُفضت صلاحية الحساب/.test(document.getElementById('notice')?.textContent || ''));
  check(`${label}: الخفض يعمل ويرجع الحساب قارئًا`, (await roleInDb(TARGET)) === 'reader' && /قارئ/.test(await row(TARGET).innerText()));

  /* حماية آخر مدير: الحساب الفردي الوحيد المدير */
  await btn(ADMIN2).click(); await btn(ADMIN2).click();
  await page.waitForFunction(() => /آخر مدير/.test(document.getElementById('error')?.textContent || ''));
  check(`${label}: رفض خفض آخر مدير برسالة واضحة وبقاء الدور`, (await roleInDb(ADMIN2)) === 'admin' && !(await btn(ADMIN2).evaluate(b => b.classList.contains('confirm'))));
  if (mobile) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${label}: لا تمرير أفقي`, overflow <= 1, String(overflow));
    const box = await btn(TARGET).boundingBox(); check(`${label}: هدف اللمس مناسب`, box.height >= 36, JSON.stringify(box));
  }
  check(`${label}: لا أخطاء في الكونسول`, errors.length === 0, errors.join(' | '));
  await context.close();
}
await run('desktop', { width: 1280, height: 860 }, false);
await run('mobile', { width: 390, height: 844 }, true);
await browser.close(); await server.stop();
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} نجحت`); console.log('اللقطات:', SHOTS);
process.exit(failed ? 1 : 0);
