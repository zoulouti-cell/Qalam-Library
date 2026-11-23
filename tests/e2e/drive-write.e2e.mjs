/* رحلة «ربط Drive للكتابة» في متصفح حقيقي: من الإعدادات إلى Google (محاكى) ثم العودة، فنافذة النشر، ثم فك الربط.
   QALAM_TEST_MONGODB_URI=… SHOTS=/مسار node tests/e2e/drive-write.e2e.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer, sessionCookie } from '../fixtures/boot-server.mjs';
import { startFakeDrive, ROOT_ID } from '../fixtures/fake-drive.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-dw-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const USER = 'avocat@example.com', CLIENT_ID = 'test-client.apps.googleusercontent.com';
const drive = await startFakeDrive({ serviceQuota: true });
const server = await bootServer({ env: { NODE_ENV: 'test', QALAM_TEST_GOOGLE_ORIGIN: drive.origin, GOOGLE_SERVICE_ACCOUNT_JSON: drive.serviceAccountJson, DRIVE_ROOT_FOLDER_ID: ROOT_ID, GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret', LIBRARY_PUBLIC_URL: 'https://library.example' } });
await server.seedUser(USER);
const browser = await chromium.launch();
const check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };
const results = [];
drive.state.serviceCanWrite = false; /* الواقع الحالي: حساب الخدمة قارئ فقط */
drive.state.callbackBase = server.base; drive.state.account = { email: 'zoulouti@gmail.com', sub: 'sub-1' };

/* إضافة مستخدم بأصل PDF ثم تحويلها إلى مسودة ليظهر المحرر مع وجهة Drive */
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n' + 'x'.repeat(300));
const userCookie = sessionCookie('reader', USER), adminCookie = sessionCookie('admin');
const api = async (cookie, method, route, { json, raw, headers = {} } = {}) => {
  const init = { method, headers: { cookie, ...headers } };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] = 'application/json'; }
  if (raw !== undefined) { init.body = raw; init.headers['content-type'] = 'application/octet-stream'; }
  const r = await fetch(server.base + route, init); return { status: r.status, body: await r.json().catch(() => ({})) };
};
const up = await api(userCookie, 'POST', '/api/contributions/file', { raw: PDF, headers: { 'x-file-name': encodeURIComponent('أصل.pdf') } });
const add = await api(userCookie, 'POST', '/api/contributions/addition', { json: { kind: 'research', title: 'بحث تجريبي لربط Drive', issuedAt: '01/02/2020', source: 'مجلة القانون', issuer: '', text: 'يتناول هذا البحث شروط اتفاق التحكيم وآثاره القانونية بين الأطراف. '.repeat(6), fileIds: [up.body.id] } });
if (add.status !== 201) throw new Error('addition failed ' + JSON.stringify(add));
const draft = await api(adminCookie, 'POST', '/api/admin/contributions/draft', { json: { id: add.body.id } });

async function run(label, viewport, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
  await context.addCookies([{ name: 'qalam_session', value: adminCookie.split('=')[1], url: server.base }]);
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  /* «Google» المحاكى يقدّمه خادم Drive الوهمي (/authorize) فيعيد المتصفح إلى callback الخادم برمز صالح */
  drive.state.authorizeRequests.length = 0;

  /* 1) المحرر قبل الربط: يظهر السبب ورابط الربط */
  await page.goto(server.base + '/admin'); await page.waitForSelector('.admin-tabs');
  await page.evaluate(id => window.dispatchEvent(new CustomEvent('qalam:open-draft', { detail: { id } })), draft.body.documentId);
  await page.waitForSelector('#editor:not([hidden]) #docTitle');
  await page.waitForFunction(() => /ربط Drive للكتابة/.test(document.getElementById('destStatus').textContent));
  const dest0 = await page.locator('#destStatus').innerText(), link0 = page.locator('#destStatus a');
  check(`${label}: قبل الربط: المحرر يشرح العجز ويعرض رابط الربط في تبويب جديد`, /غير جاهز للكتابة/.test(dest0) && (await link0.getAttribute('href')) === '/api/admin/drive/connect' && (await link0.getAttribute('target')) === '_blank' && /noopener/.test(await link0.getAttribute('rel')), dest0);
  await page.screenshot({ path: path.join(SHOTS, `${label}-0-editor-before.png`) });

  /* 2) بطاقة الإعدادات قبل الربط */
  await page.click('[data-panel="settingsPanel"]'); await page.waitForSelector('#driveWriteCard');
  await page.waitForFunction(() => document.getElementById('driveWriteState').textContent !== 'جارٍ التحقق');
  check(`${label}: قبل الربط: الحالة «غير متصل» وزر الربط ظاهر`, (await page.locator('#driveWriteState').innerText()).includes('غير متصل') && await page.locator('#driveWriteConnect').isVisible() && await page.locator('#driveWriteDisconnect').isHidden());
  check(`${label}: رابط الربط يشير إلى مسار الخادم`, (await page.getAttribute('#driveWriteConnect', 'href')) === '/api/admin/drive/connect');
  await page.screenshot({ path: path.join(SHOTS, `${label}-1-before.png`) });

  /* 3) الرحلة: ضغط الزر ← Google ← callback ← /admin?drive=connected */
  await page.click('#driveWriteConnect');
  await page.waitForSelector('#driveWriteMsg:not([hidden])');
  const authUrl = drive.state.authorizeRequests.at(-1) || '', u = new URL(authUrl || 'http://x/');
  check(`${label}: طُلبت صلاحية Drive ورمز تحديث من Google`, /auth\/drive$/.test(u.searchParams.get('scope').split(' ').pop()) && u.searchParams.get('access_type') === 'offline' && /consent/.test(u.searchParams.get('prompt')), authUrl);
  check(`${label}: بعد العودة تُفتح الإعدادات وتظهر رسالة النجاح`, await page.locator('#settingsPanel').isVisible() && /تم ربط Drive/.test(await page.locator('#driveWriteMsg').innerText()) && await page.locator('#driveWriteMsg.ok').count() === 1);
  check(`${label}: يُمسح ‎?drive=‎ من العنوان`, !page.url().includes('drive='), page.url());
  await page.waitForFunction(() => document.getElementById('driveWriteState').textContent.includes('جاهز للكتابة'));
  const account = await page.locator('#driveWriteAccount').innerText();
  check(`${label}: يظهر الحساب المتصل`, account.includes('zoulouti@gmail.com'), account);
  check(`${label}: زر فك الربط ظاهر وزر الربط صار «إعادة الربط»`, await page.locator('#driveWriteDisconnect').isVisible() && /إعادة الربط/.test(await page.locator('#driveWriteConnect').innerText()));
  await page.screenshot({ path: path.join(SHOTS, `${label}-2-connected.png`) });
  if (mobile || viewport.width < 600) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${label}: لا تمرير أفقي في البطاقة`, overflow <= 1, String(overflow));
    const box = await page.locator('#driveWriteConnect').boundingBox(); check(`${label}: هدف اللمس لا يقل عن 40px`, box.height >= 40, JSON.stringify(box));
  }

  /* 4) المحرر بعد الربط يذكر الحساب */
  await page.click('[data-panel="contentPanel"]');
  await page.evaluate(id => window.dispatchEvent(new CustomEvent('qalam:open-draft', { detail: { id } })), draft.body.documentId);
  await page.waitForSelector('#editor:not([hidden]) #docTitle');
  await page.waitForFunction(() => /zoulouti@gmail\.com/.test(document.getElementById('destStatus').textContent), null, { timeout: 8000 }).catch(() => {});
  check(`${label}: المحرر يذكر الحساب المتصل`, /zoulouti@gmail\.com/.test(await page.locator('#destStatus').innerText()), await page.locator('#destStatus').innerText());

  /* 5) فك الربط بخطوتين */
  await page.click('[data-panel="settingsPanel"]'); await page.waitForSelector('#driveWriteDisconnect:not([hidden])');
  await page.click('#driveWriteDisconnect');
  check(`${label}: الضغطة الأولى تطلب التأكيد ولا تفك الربط`, /تأكيد/.test(await page.locator('#driveWriteDisconnect').innerText()) && (await page.locator('#driveWriteState').innerText()).includes('متصل'));
  await page.click('#driveWriteDisconnect');
  await page.waitForFunction(() => document.getElementById('driveWriteState').textContent.includes('غير متصل'));
  check(`${label}: بعد التأكيد يُفك الربط ويُلغى الرمز`, /فُكّ الربط/.test(await page.locator('#driveWriteMsg').innerText()) && drive.revoked.has(drive.REFRESH_TOKEN) && await page.locator('#driveWriteDisconnect').isHidden());
  check(`${label}: لا أخطاء في الكونسول`, errors.length === 0, errors.join(' | '));
  await context.close();
  drive.revoked.clear();
}
await run('desktop', { width: 1280, height: 860 }, false);
await run('mobile', { width: 390, height: 844 }, true);

/* عودة برمز خطأ: كل رسالة تظهر وتُمسح من العنوان */
{
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, locale: 'ar-MA' });
  await context.addCookies([{ name: 'qalam_session', value: adminCookie.split('=')[1], url: server.base }]);
  const page = await context.newPage();
  for (const [code, re] of [['scope', /صلاحية Drive كاملة/], ['folder', /لا يملك صلاحية الكتابة/], ['cancelled', /أُلغيت/], ['denied', /انتهت جلسة/], ['bogus', /تعذر إتمام الربط/]]) {
    await page.goto(server.base + '/admin?drive=' + code); await page.waitForSelector('#driveWriteMsg:not([hidden])');
    check(`رمز العودة «${code}» يعرض رسالته ويُمسح`, re.test(await page.locator('#driveWriteMsg').innerText()) && !page.url().includes('drive=') && await page.locator('#settingsPanel').isVisible(), await page.locator('#driveWriteMsg').innerText());
  }
  await context.close();
}
await browser.close(); await server.stop(); await drive.stop();
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} نجحت`); console.log('اللقطات:', SHOTS);
process.exit(failed ? 1 : 0);
