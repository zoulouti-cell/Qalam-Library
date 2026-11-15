/* استعادة كلمة المرور في المتصفح: من صفحة الدخول إلى «نسيت كلمة المرور؟» ثم الرابط في البريد ثم كلمة جديدة ثم الدخول بها.
   خادم Brevo وهمي يلتقط الرسالة. QALAM_TEST_MONGODB_URI=… SHOTS=/مسار node tests/e2e/password-recovery.e2e.mjs */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer } from '../fixtures/boot-server.mjs';
import { hashPassword } from '../../src/admin-store.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-recovery-shots-'));
fs.mkdirSync(SHOTS, { recursive: true });
const OLD = 'old-password-12345', NEW = 'brand-new-password-678';

const sent = [];
const brevo = http.createServer((req, res) => { let raw = ''; req.on('data', c => { raw += c; }); req.on('end', () => { sent.push(JSON.parse(raw)); res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"messageId":"t"}'); }); });
await new Promise(resolve => brevo.listen(0, '127.0.0.1', resolve));
const server = await bootServer({ env: { BREVO_API_KEY: 'test-key', BREVO_SENDER_EMAIL: 'library@example.com', BREVO_API_URL: `http://127.0.0.1:${brevo.address().port}/v3/smtp/email`, LIBRARY_PUBLIC_URL: 'http://127.0.0.1:9', LIBRARY_ACCESS_PASSWORD: 'reader-access-password-for-test' } });
const browser = await chromium.launch();
const results = [], check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };
const quiet = (page, errors) => {
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|Content Security Policy|cdn\./i.test(m.text())) errors.push(m.text()); });
};
const seed = email => { const saved = hashPassword(OLD); return server.mongo(db => db.collection('libraryUsers').updateOne({ email }, { $set: { email, role: 'reader', active: true, accountStatus: 'active', mustChangePassword: false, passwordSalt: saved.salt, passwordHash: saved.hash } }, { upsert: true })); };
const waitMail = async (email, since) => { for (let i = 0; i < 60; i++) { const found = sent.slice(since).find(m => m.to?.[0]?.email === email); if (found) return found; await new Promise(r => setTimeout(r, 100)); } return null; };
const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

let n = 0;
for (const [label, viewport, mobile] of [['desktop', { width: 1280, height: 800 }, false], ['mobile', { width: 390, height: 800 }, true]]) {
  const email = `recover-${label}@example.com`;
  await seed(email);
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
  const page = await context.newPage(), errors = []; quiet(page, errors);

  /* ---- صفحة الدخول فيها الرابط ---- */
  await page.goto(server.base + '/login'); await page.waitForSelector('.forgot-link a');
  const link = page.locator('.forgot-link a');
  check(`${label}: رابط «نسيت كلمة المرور؟» ظاهر تحت خانة كلمة المرور`, (await link.textContent()).trim() === 'نسيت كلمة المرور؟' && (await link.getAttribute('href')) === '/forgot-password'
    && (await link.boundingBox()).y > (await page.locator('#password').boundingBox()).y && (await link.boundingBox()).y < (await page.locator('#login .submit-button').boundingBox()).y);
  check(`${label}: لا تمرير أفقي في الدخول`, (await overflow(page)) <= 1);
  await page.screenshot({ path: path.join(SHOTS, `${++n}-login-${label}.png`) });

  /* ---- طلب الاستعادة ---- */
  await Promise.all([page.waitForURL(u => new URL(u).pathname === '/forgot-password'), link.click()]);
  await page.waitForSelector('#forgotForm');
  check(`${label}: صفحة الطلب بلا تمرير أفقي`, (await overflow(page)) <= 1);
  const mark = sent.length;
  await page.fill('#email', email); await page.screenshot({ path: path.join(SHOTS, `${++n}-forgot-${label}.png`) });
  await page.click('#forgotForm .submit-button');
  await page.waitForFunction(() => /أرسلنا/.test(document.querySelector('#message').textContent));
  check(`${label}: رسالة النجاح عامة وتذكّر بمجلد المزعج`, /مجلد الرسائل غير المرغوب فيها/.test(await page.textContent('#message')) && await page.locator('#forgotForm .submit-button').isDisabled());
  await page.screenshot({ path: path.join(SHOTS, `${++n}-forgot-sent-${label}.png`) });
  const mail = await waitMail(email, mark);
  check(`${label}: وصلت الرسالة إلى صاحب الحساب`, !!mail);
  const match = /href="([^"]+#token=[A-Za-z0-9_-]{43})"/.exec(mail?.htmlContent || '');
  check(`${label}: رابط الرسالة يحمل الرمز بعد #`, !!match);
  const resetPath = match ? match[1].replace('http://127.0.0.1:9', server.base) : server.base + '/reset-password';

  /* ---- صفحة التعيين ---- */
  await page.goto(resetPath); await page.waitForSelector('#resetForm');
  check(`${label}: الرمز أُزيل من عنوان الصفحة فور فتحها`, new URL(page.url()).hash === '' && !page.url().includes('token'), page.url());
  await page.fill('#newPassword', NEW); await page.fill('#confirmPassword', NEW + 'x'); await page.click('#resetForm .submit-button');
  await page.waitForFunction(() => /غير متطابقتين/.test(document.querySelector('#message').textContent));
  check(`${label}: عدم التطابق يُرفض دون استهلاك الرمز`, true);
  await page.fill('#confirmPassword', NEW);
  await page.screenshot({ path: path.join(SHOTS, `${++n}-reset-${label}.png`) });
  await page.click('#resetForm .submit-button');
  await page.waitForFunction(() => /تم تغيير كلمة المرور/.test(document.querySelector('#message').textContent));
  check(`${label}: نجاح التعيين وقفل النموذج`, await page.locator('#newPassword').isDisabled() && await page.locator('#resetForm .submit-button').isDisabled());
  check(`${label}: لا تمرير أفقي في صفحة التعيين`, (await overflow(page)) <= 1);
  await page.screenshot({ path: path.join(SHOTS, `${++n}-reset-done-${label}.png`) });

  /* ---- الدخول بالكلمة الجديدة والقديمة ---- */
  await Promise.all([page.waitForURL(u => new URL(u).pathname === '/login'), page.click('.registration-area a')]);
  await page.fill('#email', email); await page.fill('#password', OLD); await page.click('#login .submit-button');
  await page.waitForFunction(() => document.querySelector('#message').textContent.trim().length > 3 && !/جار/.test(document.querySelector('#message').textContent));
  check(`${label}: الكلمة القديمة لا تدخل`, /غير صحيحة/.test(await page.textContent('#message')));
  await page.fill('#password', NEW);
  await Promise.all([page.waitForURL(u => new URL(u).pathname === '/'), page.click('#login .submit-button')]);
  check(`${label}: الكلمة الجديدة تدخل إلى المكتبة`, true);

  /* ---- رابط ناقص ---- */
  const bare = await context.newPage(); quiet(bare, errors);
  await bare.goto(server.base + '/reset-password'); await bare.waitForSelector('#resetForm');
  check(`${label}: رابط بلا رمز: رسالة واضحة والنموذج مقفل`, /ناقص أو غير صالح/.test(await bare.textContent('#message')) && await bare.locator('#newPassword').isDisabled());
  /* ---- رمز مستعمل ---- */
  await bare.goto(resetPath); await bare.waitForSelector('#resetForm');
  await bare.fill('#newPassword', 'yet-another-password-99'); await bare.fill('#confirmPassword', 'yet-another-password-99'); await bare.click('#resetForm .submit-button');
  await bare.waitForFunction(() => /استُخدم سابقاً|انتهت/.test(document.querySelector('#message').textContent));
  check(`${label}: رابط مستعمل يُرفض برسالة واضحة`, true);
  /* ---- الوضع الداكن ---- */
  await bare.goto(server.base + '/forgot-password'); await bare.click('#themeToggle');
  check(`${label}: الوضع الداكن يعمل في صفحة الاستعادة`, await bare.evaluate(() => document.body.classList.contains('dark')));
  await bare.screenshot({ path: path.join(SHOTS, `${++n}-forgot-dark-${label}.png`) });
  check(`${label}: لا أخطاء في الكونسول`, errors.length === 0, errors.join(' | '));
  await context.close();
}
await browser.close(); await server.stop(); brevo.close(); brevo.closeAllConnections?.();
const failed = results.filter(r => !r).length;
console.log(`\n${results.length - failed}/${results.length} نجحت`); console.log('اللقطات:', SHOTS);
