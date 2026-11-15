/* اختبار شامل في متصفح حقيقي: واجهة المستخدم ثم لوحة المدير. يتطلب Playwright وMongo محليًا:
   QALAM_TEST_MONGODB_URI=… node tests/e2e/contributions.e2e.mjs  (لقطات الشاشة في SHOTS أو مجلد مؤقت) */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { bootServer, sessionCookie } from '../fixtures/boot-server.mjs';
import { startFakeDrive, ROOT_ID } from '../fixtures/fake-drive.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-shots-')), USER = 'avocat@example.com';
fs.mkdirSync(SHOTS, { recursive: true });
const drive = await startFakeDrive();
const server = await bootServer({ env: { QALAM_TEST_GOOGLE_ORIGIN: drive.origin, GOOGLE_SERVICE_ACCOUNT_JSON: drive.serviceAccountJson, DRIVE_ROOT_FOLDER_ID: ROOT_ID } });
await server.seedUser(USER);
const browser = await chromium.launch();
/* Chromium لا يحترم الوسيط المحلي لـ localhost، فنجلب مكتبات jsdelivr وبيانات اللغة عبر curl (الذي يحترم الوسيط) ونمرّرها للصفحة. */
const { execFile } = await import('node:child_process'), { promisify } = await import('node:util'), run = promisify(execFile), cdnCache = new Map();
const mimeOf = url => /\.(m?js)(\?|$)/.test(url) ? 'application/javascript' : /\.wasm/.test(url) ? 'application/wasm' : 'application/octet-stream';
async function routeCdn(context) {
  await context.route(/^https:\/\/(cdn\.jsdelivr\.net|tessdata\.projectnaptha\.com)\//, async route => {
    const url = route.request().url();
    try {
      if (!cdnCache.has(url)) cdnCache.set(url, (await run('curl', ['-sSfL', '--max-time', '120', url], { encoding: 'buffer', maxBuffer: 200 * 1024 * 1024 })).stdout);
      await route.fulfill({ status: 200, body: cdnCache.get(url), headers: { 'content-type': mimeOf(url), 'access-control-allow-origin': '*' } });
    } catch (error) { await route.abort(); }
  });
}
const results = [];
const check = (name, ok, extra = '') => { results.push([ok, name, extra]); console.log(ok ? 'PASS' : 'FAIL', name, extra); };
const TEXT = 'المادة 1\nيسري هذا القانون على جميع الوثائق التجريبية المعتمدة في المكتبة وفي مختلف المحاكم.\nالمادة 2\nتُحدَّد كيفيات تطبيق هذا القانون بنص تنظيمي يصدر عن السلطة الحكومية المختصة.\n'.repeat(3);
const txtFile = path.join(server.dir, 'قرار-تجريبي.txt'); fs.writeFileSync(txtFile, TEXT);
const FR = 'Le tribunal de premiere instance a rendu la decision suivante : la demande est recevable en la forme et dans le fond, et le defendeur est condamne a payer au demandeur la somme due avec les interets legaux, ainsi que les depens de la presente instance.';
const html = `<html><body style="font:28px sans-serif;width:900px;padding:30px;line-height:1.7"><p>${FR}</p></body></html>`;
const pdfFile = path.join(server.dir, 'decision.pdf'), pngFile = path.join(server.dir, 'scan.png');
{ const p = await browser.newPage(); await p.setContent(html); await p.pdf({ path: pdfFile, format: 'A4' }); await p.setViewportSize({ width: 960, height: 380 }); await p.screenshot({ path: pngFile }); await p.close(); }

async function userFlow(label, viewport, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' }); await routeCdn(context);
  await context.addCookies([{ name: 'qalam_session', value: sessionCookie('reader', USER).split('=')[1], url: server.base }]);
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/cdn\.jsdelivr|favicon|ERR_/i.test(m.text())) errors.push(m.text()); });
  await page.goto(server.base + '/'); await page.waitForSelector('#navContrib');
  if (mobile) await page.click('#menuToggle');
  check(`${label}: زر «إضافات» موجود وزر المكتبة القديم غير موجود`, (await page.locator('#navContrib').innerText()).includes('إضافات') && (await page.locator('.main-nav [data-view="library"]').count()) === 0);
  check(`${label}: مسار العودة إلى المكتبة في الشريط العلوي`, await page.locator('.breadcrumb .breadcrumb-home[data-view="library"]').count() === 1);
  if (mobile) await page.keyboard.press('Escape');
  if (mobile) await page.click('#menuToggle').catch(() => {});
  await page.click('#navContrib'); await page.waitForSelector('#contribDialog[open] .contrib-kind');
  await page.screenshot({ path: path.join(SHOTS, `${label}-1-type.png`) });
  // التحقق من الخطوة الأولى
  await page.click('[data-act="next"]'); check(`${label}: رفض الانتقال دون نوع`, await page.locator('#contribError').isVisible());
  await page.click('.contrib-kind:nth-child(2)'); // اجتهاد قضائي
  await page.fill('#fTitle', 'قرار محكمة الاستئناف رقم 100'); await page.fill('#fIssuedAt', '04/03/2021'); await page.fill('#fIssuer', 'محكمة الاستئناف بالدار البيضاء'); await page.fill('#fSource', 'مجلة قضاء محكمة الاستئناف');
  await page.click('[data-act="next"]'); await page.waitForSelector('.contrib-reader');
  check(`${label}: ألسنة القارئ الثلاثة`, (await page.locator('.contrib-read-tab').allInnerTexts()).join('|').replace(/\s+/g, ' ').includes('الماسح أو الطابعة') && (await page.locator('.contrib-read-tab').count()) === 3);
  check(`${label}: لا ذكر لـ Gemini`, !(await page.locator('#contribDialog').innerText()).includes('Gemini'));
  await page.click('[data-act="next"]'); check(`${label}: الأصل إلزامي قبل المتابعة`, /الأصل/.test(await page.locator('#contribError').innerText()));
  await page.click('[data-read-tab="folder"]'); await page.screenshot({ path: path.join(SHOTS, `${label}-2-folder.png`) });
  await page.click('[data-read-tab="camera"]'); await page.click('[data-read-tab="reader"]');
  /* حمولة في الذاكرة بدل مسار القرص: Playwright يفشل صامتًا مع المسارات العربية في بعض البيئات، ثم نتحقق من وصول الملفات فعلًا. */
  const payload = (file, mimeType) => ({ name: path.basename(file), mimeType, buffer: fs.readFileSync(file) });
  await page.setInputFiles('#readerInput', mobile ? [payload(txtFile, 'text/plain')] : [payload(txtFile, 'text/plain'), payload(pdfFile, 'application/pdf'), payload(pngFile, 'image/png')]);
  await page.waitForFunction(() => !document.querySelector('.contrib-progress') && document.querySelector('#fText')?.value.length > 40, null, { timeout: 170000 });
  const readText = await page.inputValue('#fText'); const statusText = await page.locator('.contrib-status').first().innerText().catch(() => '');
  check(`${label}: النص المقروء ظهر من الملف النصي`, readText.includes('المادة 1'), statusText);
  if (!mobile) { check(`${label}: قراءة طبقة نص PDF`, /tribunal de premiere instance/i.test(readText)); check(`${label}: التعرف الضوئي على الصورة`, (readText.match(/condamn/gi) || []).length >= 2, readText.slice(-260)); }
  check(`${label}: الأصول مرفقة`, (await page.locator('.contrib-files li').count()) === (mobile ? 1 : 3), await page.locator('.contrib-files').innerText().catch(() => ''));
  await page.screenshot({ path: path.join(SHOTS, `${label}-3-reader.png`), fullPage: false });
  await page.click('[data-act="next"]'); await page.waitForSelector('.contrib-summary');
  await page.fill('#fNote', 'تنبيه: الصفحة الأخيرة من الأصل غير واضحة.');
  await page.screenshot({ path: path.join(SHOTS, `${label}-4-review.png`) });
  await page.click('[data-act="submit"]'); await page.waitForSelector('.contrib-done');
  check(`${label}: شاشة «قيد الدرس» بعد الإرسال`, (await page.locator('.contrib-done').innerText()).includes('قيد الدرس'));
  await page.screenshot({ path: path.join(SHOTS, `${label}-5-done.png`) });
  await page.click('[data-act="goto-mine"]'); await page.waitForSelector('.contrib-item');
  check(`${label}: «إضافاتي» تعرض الحالة`, (await page.locator('.contrib-pill').first().innerText()).includes('قيد الدرس'));
  await page.screenshot({ path: path.join(SHOTS, `${label}-6-mine.png`) });
  await page.click('#contribClose');
  // ملاحظة من صفحة الاطلاع
  if (mobile) await page.keyboard.press('Escape');
  await page.evaluate(() => window.qalamBridge.openDocument('law_fixture_1')); await page.waitForSelector('#reader[open] #readerBody');
  await page.waitForFunction(() => document.querySelector('#readerTitle')?.textContent.includes('تجريبي'));
  const order = await page.evaluate(() => [...document.querySelector('.reader-header-tools').children].map(n => n.id));
  check(`${label}: زر الملاحظة بين «حفظ الوثيقة» و«المعاينة»`, order.indexOf('readerNote') === order.indexOf('readerBookmark') + 1 && order.indexOf('readerOriginalActions') === order.indexOf('readerNote') + 1, order.join(','));
  await page.screenshot({ path: path.join(SHOTS, `${label}-7-reader.png`) });
  await page.click('#readerNote'); await page.waitForSelector('#contribNoteDialog[open] #noteMessage');
  await page.fill('#noteMessage', `المادة 2 تحيل إلى نص تنظيمي دون ذكر رقمه، يرجى استكمال الإحالة (${label}).`);
  await page.screenshot({ path: path.join(SHOTS, `${label}-8-note.png`) });
  await page.click('#noteSend'); await page.waitForSelector('#contribNoteDialog .contrib-done');
  check(`${label}: إشعار «قيد الدرس» للملاحظة`, (await page.locator('#contribNoteDialog .contrib-done').innerText()).includes('قيد الدرس'));
  check(`${label}: لا أخطاء في وحدة التحكم`, errors.length === 0, errors.join(' | ').slice(0, 300));
  await context.close();
}
try {
  await userFlow('desktop', { width: 1366, height: 860 }, false);
  await userFlow('mobile', { width: 390, height: 844 }, true);
} finally {
  await browser.close(); await server.stop(); await drive.stop();
}
const failed = results.filter(r => !r[0]); console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
