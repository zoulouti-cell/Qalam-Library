/* التسجيل بموافقة المدير في المتصفح: تسجيل ← تأكيد البريد ← «جاري تفعيل حسابكم» ← قبول/رفض من الإدارة.
   QALAM_TEST_MONGODB_URI=… SHOTS=/مسار node tests/e2e/registration-approval.e2e.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { bootServer, sessionCookie } from '../fixtures/boot-server.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-reg-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const PASSWORD = 'registration-password-123';
const sent = [];
const brevo = http.createServer((req, res) => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => { sent.push(JSON.parse(raw)); res.writeHead(201, { 'content-type': 'application/json' }); res.end('{}'); }); });
await new Promise(r => brevo.listen(0, '127.0.0.1', r));
const server = await bootServer({ env: { BREVO_API_KEY: 'k', BREVO_SENDER_EMAIL: 'library@example.com', BREVO_API_URL: `http://127.0.0.1:${brevo.address().port}/v3/smtp/email`, LIBRARY_PUBLIC_URL: 'http://127.0.0.1:9', LIBRARY_OWNER_EMAIL: 'owner@example.com', LIBRARY_ACCESS_PASSWORD: 'reader-access-password-for-test' } });
const browser = await chromium.launch();
const results = [], check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };
const quiet = (page, errors) => {
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|Content Security Policy|cdn\.|status of 40[0-9]/i.test(m.text())) errors.push(m.text()); });
};
const confirmLink = async email => { for (let i = 0; i < 60; i++) { const mail = sent.find(m => m.to?.[0]?.email === email && /تأكيد/.test(m.subject)); if (mail) return /#token=([A-Za-z0-9_-]{43})/.exec(mail.htmlContent)[1]; await new Promise(r => setTimeout(r, 100)); } throw new Error('no confirm mail'); };
const status = email => server.mongo(db => db.collection('libraryUsers').findOne({ email }, { projection: { accountStatus: 1, role: 1 } }));

for (const [label, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['mobile', { width: 390, height: 800 }, true]]) {
  const OK = `ok.${label}@example.com`, NO = `no.${label}@example.com`;
  for (const [email, decision] of [[OK, 'reader'], [NO, 'reject']]) {
    const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
    const page = await context.newPage(), errors = []; quiet(page, errors);
    await page.goto(server.base + '/login'); await page.waitForSelector('#registrationArea:not([hidden])');
    await page.click('#showRegistration'); await page.fill('#registerEmail', email); await page.fill('#registerPassword', PASSWORD);
    await page.click('#registerForm .submit-button');
    await page.waitForFunction(() => /تأكيد/.test(document.getElementById('registerMessage').textContent));
    check(`${label}/${decision}: بعد التسجيل حساب غير مؤكَّد ولا دخول`, (await status(email))?.accountStatus === 'unconfirmed');
    const token = await confirmLink(email);
    await page.goto(server.base + '/confirm-registration#token=' + token);
    await page.waitForURL(u => new URL(u).pathname === '/login');
    await page.waitForSelector('#pendingPanel:not([hidden])');
    check(`${label}/${decision}: بعد التأكيد تظهر «جاري تفعيل حسابكم» مكان نموذج الدخول`, (await page.locator('#pendingPanel h3').innerText()) === 'جاري تفعيل حسابكم' && !(await page.locator('#login').isVisible()));
    check(`${label}/${decision}: حالة الحساب «review»`, (await status(email))?.accountStatus === 'review');
    if (decision === 'reader') await page.screenshot({ path: path.join(SHOTS, `1-pending-${label}.png`) });
    check(`${label}/${decision}: لا تمرير أفقي`, (await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 1);
    /* الدخول أثناء المراجعة */
    await page.click('#pendingBack'); await page.fill('#email', email); await page.fill('#password', PASSWORD); await page.click('#login .submit-button');
    await page.waitForSelector('#pendingPanel:not([hidden])');
    check(`${label}/${decision}: الدخول أثناء المراجعة يعيد رسالة التفعيل ولا يدخل`, new URL(page.url()).pathname === '/login');
    /* الإدارة */
    const adminContext = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
    await adminContext.addCookies([{ name: 'qalam_session', value: sessionCookie('admin').split('=')[1], url: server.base }]);
    const admin = await adminContext.newPage(); quiet(admin, errors);
    await admin.goto(server.base + '/admin'); await admin.waitForSelector('#registrationRequests:not([hidden])');
    const row = admin.locator('#registrationRequests .request-row', { hasText: email });
    check(`${label}/${decision}: الطلب ظاهر في قسم طلبات التسجيل بثلاثة أزرار`, (await row.locator('[data-decision]').count()) === 3);
    if (decision === 'reader' && !mobile) await admin.screenshot({ path: path.join(SHOTS, `2-admin-requests-${label}.png`), clip: { x: 0, y: 0, width: viewport.width, height: 700 } });
    await row.locator(`[data-decision="${decision}"]`).click();
    await admin.waitForFunction(() => /قُبل|رُفض/.test(document.getElementById('notice')?.textContent || ''));
    check(`${label}/${decision}: القرار سُجّل`, (await status(email))?.accountStatus === (decision === 'reject' ? 'rejected' : 'active'));
    /* بعد القرار */
    await page.reload(); await page.fill('#email', email); await page.fill('#password', PASSWORD); await page.click('#login .submit-button');
    if (decision === 'reader') {
      await page.waitForURL(u => new URL(u).pathname === '/', { timeout: 9000 });
      check(`${label}/${decision}: بعد القبول يدخل بالدخول العادي`, true);
    } else {
      await page.waitForFunction(() => /إدارة المنصة/.test(document.getElementById('message').textContent));
      check(`${label}/${decision}: بعد الرفض تظهر خانات التسجيل مع رسالة الرفض`, await page.locator('#registerForm').isVisible() && !(await page.locator('#pendingPanel').isVisible()));
      await page.screenshot({ path: path.join(SHOTS, `3-rejected-${label}.png`) });
    }
    check(`${label}/${decision}: لا أخطاء في الكونسول`, errors.length === 0, errors.join(' | '));
    await context.close(); await adminContext.close();
  }
}
await browser.close(); await server.stop(); brevo.close(); brevo.closeAllConnections?.();
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} passed`); console.log('SHOTS=' + SHOTS);
process.exit(failed ? 1 : 0);
