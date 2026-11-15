/* زر «حذف الحساب» في تبويب «حسابات المستخدمين»، في متصفح حقيقي.
   QALAM_TEST_MONGODB_URI=… SHOTS=/مسار node tests/e2e/user-delete.e2e.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer, sessionCookie } from '../fixtures/boot-server.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-delete-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const ONLY_ADMIN = 'only.admin@example.com';
const server = await bootServer();
await server.seedUser(ONLY_ADMIN, 'admin');
const browser = await chromium.launch();
const results = [], check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };
const exists = email => server.mongo(db => db.collection('libraryUsers').findOne({ email }, { projection: { _id: 1 } })).then(Boolean);

async function seedLeaver(label) {
  const leaver = `${label}.leaver@example.com`, banned = `${label}.banned@example.com`, now = new Date();
  await server.seedUser(leaver, 'reader');
  await server.mongo(async db => {
    await db.collection('libraryUsers').updateOne({ email: banned }, { $set: { email: banned, role: 'reader', active: false, accountStatus: 'permanent', createdAt: now } }, { upsert: true });
    await db.collection('userContributions').insertMany([
      { id: `${label}-open`, type: 'note', status: 'pending', userEmail: leaver, title: 'ملاحظة قيد المراجعة', createdAt: now, updatedAt: now },
      { id: `${label}-pub`, type: 'addition', status: 'published', userEmail: leaver, title: 'إضافة منشورة', createdAt: now, updatedAt: now }
    ]);
  });
  return { leaver, banned };
}

async function run(label, viewport, mobile) {
  const { leaver, banned } = await seedLeaver(label);
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
  await context.addCookies([{ name: 'qalam_session', value: sessionCookie('admin').split('=')[1], url: server.base }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  await page.goto(server.base + '/admin'); await page.waitForSelector('#usersList .user-row');
  const row = email => page.locator('#usersList .user-row', { hasText: email });
  const del = email => row(email).locator('[data-delete-user]');
  const input = email => row(email).locator('[data-delete-input]');
  const ok = email => row(email).locator('[data-delete-confirm]');

  check(`${label}: زر «حذف الحساب» ظاهر على صف القارئ`, (await del(leaver).innerText()).includes('حذف الحساب'));
  await del(leaver).click();
  check(`${label}: يفتح لوحة تأكيد وزر الحذف معطّل وخانة حذف المفتوحة مخفية`, await row(leaver).locator('.delete-panel').isVisible() && await ok(leaver).isDisabled() && !(await row(leaver).locator('label.discard').isVisible()));
  await input(leaver).fill('someone.else@example.com');
  check(`${label}: بريد غير مطابق يبقي الزر معطّلًا`, await ok(leaver).isDisabled());
  await page.screenshot({ path: path.join(SHOTS, `${label}-1-panel.png`) });
  await input(leaver).fill(leaver.toUpperCase());
  check(`${label}: المطابقة بلا حساسية لحالة الأحرف تفعّل الزر`, await ok(leaver).isEnabled());

  await ok(leaver).click();
  await page.waitForFunction(() => /قيد المراجعة/.test(document.getElementById('error')?.textContent || ''));
  check(`${label}: الإضافة المفتوحة تمنع الحذف وتظهر خانة حذفها`, (await exists(leaver)) && await row(leaver).locator('label.discard').isVisible() && (await row(leaver).locator('[data-delete-open]').innerText()).trim() === '1');
  await page.screenshot({ path: path.join(SHOTS, `${label}-2-open-contrib.png`) });
  await row(leaver).locator('[data-delete-discard]').check();
  await ok(leaver).click();
  await page.waitForFunction(() => /حُذف الحساب نهائيًا/.test(document.getElementById('notice')?.textContent || ''));
  const gone = !(await exists(leaver)) && (await row(leaver).count()) === 0;
  const left = await server.mongo(db => db.collection('userContributions').find({ id: { $regex: '^' + label } }).toArray());
  check(`${label}: الحذف ينجح ويختفي الصف وتُحذف المفتوحة وتُفصل المبتوت فيها`, gone && left.length === 1 && left[0].id === `${label}-pub` && left[0].userEmail === '' && left[0].userDeleted === true, JSON.stringify(left));
  check(`${label}: رسالة النجاح تذكر ما جرى للإضافات`, /إضافة قيد المراجعة/.test(await page.locator('#notice').innerText()) && /مبتوت فيها/.test(await page.locator('#notice').innerText()));
  await page.screenshot({ path: path.join(SHOTS, `${label}-3-deleted.png`) });

  /* الموقوف نهائيًا: تنبيه رفع الحظر + إلغاء بلا أثر */
  await del(banned).click();
  check(`${label}: حساب موقوف نهائيًا: تنبيه رفع الحظر ظاهر`, /يرفع الحظر/.test(await row(banned).locator('.delete-panel').innerText()));
  await page.screenshot({ path: path.join(SHOTS, `${label}-4-banned.png`) });
  await row(banned).locator('[data-delete-cancel]').click();
  check(`${label}: الإلغاء يغلق اللوحة ولا يحذف`, (await row(banned).locator('.delete-panel').count()) === 0 && (await exists(banned)));
  await del(banned).click(); await input(banned).fill(banned); await ok(banned).click();
  await page.waitForFunction(() => /حُذف الحساب نهائيًا/.test(document.getElementById('notice')?.textContent || ''));
  check(`${label}: يُحذف الموقوف نهائيًا بعد التأكيد`, !(await exists(banned)));

  /* حماية آخر مدير */
  await del(ONLY_ADMIN).click(); await input(ONLY_ADMIN).fill(ONLY_ADMIN); await ok(ONLY_ADMIN).click();
  await page.waitForFunction(() => /آخر مدير/.test(document.getElementById('error')?.textContent || ''));
  check(`${label}: رفض حذف آخر مدير برسالة واضحة وبقاء الحساب`, await exists(ONLY_ADMIN));

  /* الإضافة المبتوت فيها تظهر في لوحة الإضافات بلا بريد */
  await page.evaluate(() => scrollTo(0, 0)); /* شريط التبويبات لاصق؛ نبدأ من أعلى الصفحة كما يفعل المستخدم */
  await page.locator('[data-panel="contribPanel"]').click();
  await page.waitForSelector('#contribList .cr-row');
  await page.waitForFunction(() => /حساب محذوف/.test(document.getElementById('contribList')?.innerText || ''), null, { timeout: 8000 }).catch(() => {}); /* القائمة تُعاد رسمها بعد أول تحميل */
  check(`${label}: لوحة الإضافات تعرض «حساب محذوف» بدل البريد`, /حساب محذوف/.test(await page.locator('#contribList').innerText()), await page.locator('#contribList').innerText());

  if (mobile) {
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('[data-panel="usersPanel"]').click();
    await del(ONLY_ADMIN).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${label}: لا تمرير أفقي مع لوحة التأكيد`, overflow <= 1, String(overflow));
    const box = await ok(ONLY_ADMIN).boundingBox(); check(`${label}: هدف اللمس مناسب`, box.height >= 36, JSON.stringify(box));
    await page.screenshot({ path: path.join(SHOTS, `${label}-5-mobile-panel.png`) });
  }
  check(`${label}: لا أخطاء في الكونسول`, errors.length === 0, errors.join(' | '));
  await context.close();
}

/* حساب مدير فردي لا يرى زر حذف على صفه */
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ar-MA' });
  await context.addCookies([{ name: 'qalam_session', value: sessionCookie('admin', ONLY_ADMIN).split('=')[1], url: server.base }]);
  const page = await context.newPage();
  await page.goto(server.base + '/admin'); await page.waitForSelector('#usersList .user-row');
  const own = page.locator('#usersList .user-row', { hasText: ONLY_ADMIN });
  check('المدير الفردي: لا زر حذف على حسابه نفسه', (await own.locator('[data-delete-user]').count()) === 0);
  await context.close();
}
await run('desktop', { width: 1280, height: 860 }, false);
await run('mobile', { width: 390, height: 844 }, true);
await browser.close(); await server.stop();
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} نجحت`); console.log('اللقطات:', SHOTS);
process.exit(failed ? 1 : 0);
