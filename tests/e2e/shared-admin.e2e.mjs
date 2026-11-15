/* إنهاء الإدارة المشتركة في المتصفح: صفحة الدخول، تنبيه اللوحة، ووسم حساب الطوارئ.
   QALAM_TEST_MONGODB_URI=… SHOTS=/مسار node tests/e2e/shared-admin.e2e.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer, sessionCookie } from '../fixtures/boot-server.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-shared-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const BOOT = 'boot.admin@example.com', OTHER = 'other.admin@example.com', READER = 'plain.reader@example.com';
const enabled = await bootServer(), disabled = await bootServer({ env: { LIBRARY_ADMIN_PASSWORD: '', LIBRARY_BOOTSTRAP_ADMIN_EMAIL: BOOT } });
await enabled.seedUser(OTHER, 'admin'); await disabled.seedUser(OTHER, 'admin'); await disabled.seedUser(READER, 'reader');
const browser = await chromium.launch();
const results = [], check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };

async function adminPage(server, viewport, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
  await context.addCookies([{ name: 'qalam_session', value: sessionCookie('admin', OTHER).split('=')[1], url: server.base }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  await page.goto(server.base + '/admin'); await page.waitForSelector('#usersList .user-row');
  return { context, page, errors };
}

async function run(label, viewport, mobile) {
  /* 1) الإدارة المشتركة ما زالت مفعّلة: يظهر التنبيه */
  { const { context, page, errors } = await adminPage(enabled, viewport, mobile);
    const notice = page.locator('#sharedAdminNotice');
    check(`${label}: التنبيه ظاهر والمتغير مذكور`, await notice.isVisible() && /LIBRARY_ADMIN_PASSWORD/.test(await notice.innerText()));
    await page.screenshot({ path: path.join(SHOTS, `${label}-1-notice.png`) });
    if (mobile) { const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); check(`${label}: لا تمرير أفقي مع التنبيه`, overflow <= 1, String(overflow)); }
    check(`${label}: لا أخطاء في الكونسول (مفعّلة)`, errors.length === 0, errors.join(' | '));
    await context.close(); }
  /* 2) معطّلة مع مدير طوارئ: لا تنبيه، والصف موسوم بلا أزرار الخفض والإيقاف والحذف */
  { const { context, page, errors } = await adminPage(disabled, viewport, mobile);
    check(`${label}: التنبيه مخفي عند التعطيل`, !(await page.locator('#sharedAdminNotice').isVisible()));
    const row = page.locator('#usersList .user-row', { hasText: BOOT });
    check(`${label}: صف الطوارئ موسوم`, /حساب الطوارئ/.test(await row.innerText()));
    check(`${label}: لا أزرار خفض/إيقاف/حذف على حساب الطوارئ`, (await row.locator('[data-role-user],[data-delete-user],[data-user-action]').count()) === 0);
    check(`${label}: يبقى زر كلمة مؤقتة جديدة`, (await row.locator('[data-reset-user]').count()) === 1);
    const other = page.locator('#usersList .user-row', { hasText: READER });
    check(`${label}: الحسابات الأخرى تحتفظ بأزرارها`, (await other.locator('[data-role-user]').count()) === 1 && (await other.locator('[data-delete-user]').count()) === 1);
    await page.screenshot({ path: path.join(SHOTS, `${label}-2-bootstrap-row.png`) });
    check(`${label}: لا أخطاء في الكونسول (معطّلة)`, errors.length === 0, errors.join(' | '));
    await context.close(); }
  /* 3) صفحة الدخول: لا ذكر للدخول بلا بريد، والحقل مطلوب */
  { const context = await browser.newContext({ viewport, isMobile: mobile, locale: 'ar-MA' }), page = await context.newPage();
    await page.goto(disabled.base + '/admin-login.html'); await page.waitForSelector('#adminLogin');
    const text = await page.locator('main').innerText();
    check(`${label}: صفحة الدخول بلا «الدخول الأولي» ولا «كلمة الإدارة الأولية»`, !/اتركه فارغ|الدخول الأولي|كلمة مرور الإدارة الأولية/.test(text), text);
    check(`${label}: حقل البريد مطلوب`, await page.locator('#email').evaluate(e => e.required));
    await page.fill('#password', 'anything-at-all');
    await page.click('#adminLogin button[type=submit], #adminLogin button:not([type])');
    check(`${label}: النموذج بلا بريد يُرفض قبل الإرسال (تحقق المتصفح)`, await page.locator('#email').evaluate(e => !e.validity.valid) && !/جار/.test(await page.locator('#message').innerText()));
    await page.screenshot({ path: path.join(SHOTS, `${label}-3-login.png`) });
    await context.close(); }
}
await run('desktop', { width: 1280, height: 860 }, false);
await run('mobile', { width: 390, height: 844 }, true);
await browser.close(); await enabled.stop(); await disabled.stop();
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} نجحت`); console.log('اللقطات:', SHOTS);
process.exit(failed ? 1 : 0);
