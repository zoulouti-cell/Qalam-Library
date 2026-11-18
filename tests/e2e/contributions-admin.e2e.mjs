/* اختبار شامل لفرع «إضافات وملاحظات المستخدمين» في لوحة المدير، في متصفح حقيقي وبقاعدة Mongo محلية وDrive محاكٍ:
   QALAM_TEST_MONGODB_URI=… SHOTS=/مسار node tests/e2e/contributions-admin.e2e.mjs */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer, sessionCookie } from '../fixtures/boot-server.mjs';
import { startFakeDrive, ROOT_ID } from '../fixtures/fake-drive.mjs';

const require = createRequire(import.meta.url), { chromium } = require('playwright');
const SHOTS = process.env.SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-admin-shots-')), USER = 'avocat@example.com';
fs.mkdirSync(SHOTS, { recursive: true });
const drive = await startFakeDrive();
/* المكتبة لا تنشئ المجلدات تلقائيًا: المجلد الفرعي معدّ سلفًا في Drive */
{ const sec = [...drive.files.values()].find(f => f.name === 'الاجتهادات القضائية'); drive.files.set('sub_seed_2021', { id: 'sub_seed_2021', name: 'اجتهادات 2021', mimeType: 'application/vnd.google-apps.folder', parents: [sec.id] }); }
const server = await bootServer({ env: { NODE_ENV: 'test', QALAM_TEST_GOOGLE_ORIGIN: drive.origin, GOOGLE_SERVICE_ACCOUNT_JSON: drive.serviceAccountJson, DRIVE_ROOT_FOLDER_ID: ROOT_ID } });
await server.seedUser(USER);
const browser = await chromium.launch();
const results = [];
const check = (name, ok, extra = '') => { results.push([ok, name, extra]); console.log(ok ? 'PASS' : 'FAIL', name, ok ? '' : extra); };

/* أصل حقيقي (PDF) تُولّده الصفحة نفسها */
const FR = 'Le tribunal de premiere instance a rendu la decision suivante : la demande est recevable en la forme et dans le fond.';
const pdfPath = path.join(server.dir, 'decision.pdf');
{ const p = await browser.newPage(); await p.setContent(`<html><body style="font:26px sans-serif;padding:30px"><p>${FR}</p></body></html>`); await p.pdf({ path: pdfPath, format: 'A4' }); await p.close(); }
const PDF = fs.readFileSync(pdfPath);

const userCookie = sessionCookie('reader', USER);
async function userCall(method, route, { json, raw, headers = {} } = {}) {
  const init = { method, headers: { cookie: userCookie, ...headers } };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] = 'application/json'; }
  if (raw !== undefined) { init.body = raw; init.headers['content-type'] = 'application/octet-stream'; }
  const r = await fetch(server.base + route, init); return { status: r.status, body: await r.json().catch(() => ({})) };
}
const TEXT = n => `حيث إن الطاعن يعيب على القرار المطعون فيه خرق القانون وانعدام التعليل في النازلة رقم ${n} المعروضة على المحكمة.\n`.repeat(4);
async function makeAddition(title, { kind = 'jurisprudence', issuer = 'محكمة النقض', n = 1 } = {}) {
  const up = await userCall('POST', '/api/contributions/file', { raw: PDF, headers: { 'x-file-name': encodeURIComponent('أصل-' + n + '.pdf') } });
  const add = await userCall('POST', '/api/contributions/addition', { json: { kind, title, issuedAt: '04/03/2021', source: 'مجلة قضاء محكمة النقض', issuer, text: TEXT(n), note: 'الصفحة الأخيرة باهتة في الأصل.', fileIds: [up.body.id] } });
  if (add.status !== 201) throw new Error('addition failed ' + JSON.stringify(add));
  return add.body.id;
}
async function makeNote(message, documentId = 'law_fixture_1') {
  const r = await userCall('POST', '/api/contributions/note', { json: { documentId, noteType: 'missing', message, excerpt: 'تحدَّد كيفيات التطبيق بنص تنظيمي' } });
  if (r.status !== 201) throw new Error('note failed ' + JSON.stringify(r));
  return r.body.id;
}
const additionA = await makeAddition('قرار محكمة النقض عدد 25 الصادر في الملف التجريبي', { n: 1 });
const additionB = await makeAddition('بحث في الالتزامات المدنية (للرفض)', { kind: 'research', issuer: '', n: 2 });
const additionC = await makeAddition('قرار ثانٍ لاختبار فشل النقل', { n: 3 });
const noteAccept = await makeNote('المادة 2 تحيل إلى نص تنظيمي دون ذكر رقمه، يرجى استكمال الإحالة.');
const noteDecline = await makeNote('أقترح حذف المادة 1 كاملة من النص.');

async function adminFlow(label, viewport, mobile) {
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, locale: 'ar-MA' });
  await context.addCookies([{ name: 'qalam_session', value: sessionCookie('admin').split('=')[1], url: server.base }]);
  const page = await context.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e))); page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_|Failed to load resource|Content Security Policy/i.test(m.text())) errors.push(m.text()); });
  await page.goto(server.base + '/admin'); await page.waitForSelector('.admin-tabs');
  if (!mobile) await page.waitForFunction(() => !document.getElementById('contribBadge').hidden);
  const tabs = await page.locator('.admin-tabs button').allInnerTexts();
  check(`${label}: الفرع «إضافات وملاحظات المستخدمين» هو الثالث`, /إضافات وملاحظات المستخدمين/.test(tabs[2] || '') && (await page.locator('.admin-tabs .tab-n').allInnerTexts()).join() === '1,2,3,4,5,6,7,8', tabs.join(' | '));
  const badge = (await page.locator('#contribBadge').innerText()).trim();
  if (!mobile) check(`${label}: وسم العدد يبيّن ما ينتظر الدرس`, badge === '5', badge);
  await page.click('[data-panel="contribPanel"]'); await page.waitForSelector('.cr-row');
  const tiles = await page.locator('#contribStats article strong').allInnerTexts();
  if (!mobile) check(`${label}: الحصيلة`, tiles.join(',') === '3,0,0,2,0', tiles.join(','));
  check(`${label}: الوارد يعرض كل العناصر`, (await page.locator('.cr-row').count()) >= 5);
  await page.screenshot({ path: path.join(SHOTS, `${label}-1-inbox.png`) });
  await page.click('[data-ctype="note"]'); await page.waitForFunction(() => document.querySelectorAll('.cr-row').length === 2);
  check(`${label}: فرز الملاحظات`, true);
  await page.click('[data-ctype="addition"]'); await page.waitForFunction(() => document.querySelectorAll('.cr-row').length === 3);
  await page.selectOption('#contribStatus', 'reviewing'); await page.waitForFunction(() => document.querySelector('#contribList .empty'));
  check(`${label}: فرز الحالة والفراغ`, /لا نتائج/.test(await page.locator('#contribList').innerText()));
  await page.selectOption('#contribStatus', ''); await page.click('[data-ctype=""]'); await page.waitForFunction(() => document.querySelectorAll('.cr-row').length === 5);
  await page.fill('#contribQuery', 'الالتزامات'); await page.waitForFunction(() => document.querySelectorAll('.cr-row').length === 1);
  check(`${label}: البحث بالعنوان`, true); await page.fill('#contribQuery', ''); await page.waitForFunction(() => document.querySelectorAll('.cr-row').length === 5);

  return { context, page, errors };
}

/* ───────── المسار الكامل على الحاسوب ───────── */
const { context, page, errors } = await adminFlow('desktop', { width: 1366, height: 860 }, false);
await page.locator('.cr-row', { hasText: 'قرار محكمة النقض عدد 25' }).click(); await page.waitForSelector('.cd-head');
const detail = await page.locator('#contribDetail').innerText();
check('desktop: التفاصيل تعرض النص والأصل والمرسل', /حيث إن الطاعن/.test(detail) && /أصل-1\.pdf/.test(detail) && /avocat@example\.com/.test(detail) && /الصفحة الأخيرة باهتة/.test(detail) && /على الخادم مؤقتًا/.test(detail));
await page.screenshot({ path: path.join(SHOTS, 'desktop-2-detail.png') });
await page.click('[data-compare="0"]'); await page.waitForSelector('#originalDock:not([hidden])');
check('desktop: لوحة مقابلة الأصل مفتوحة بجانب المحتوى', (await page.getAttribute('#dockFrame', 'src')).includes('/api/admin/contributions/file?id=f_') && await page.evaluate(() => document.body.classList.contains('dock-open')));
await page.waitForTimeout(800); await page.screenshot({ path: path.join(SHOTS, 'desktop-3-dock.png') });
await page.click('#dockClose'); check('desktop: إغلاق لوحة المقابلة', await page.locator('#originalDock').isHidden());

await page.click('[data-act="draft"]'); await page.waitForSelector('#editor:not([hidden]) #docTitle');
await page.waitForFunction(() => document.getElementById('docTitle').value.includes('عدد 25'));
check('desktop: التحويل إلى مسودة يفتح المحرر بالنص', (await page.inputValue('#docText')).includes('حيث إن الطاعن') && await page.locator('#contentPanel').isVisible());
check('desktop: الأصول معروضة في المحرر', await page.locator('#editorOriginals').isVisible() && (await page.locator('#eoList li').count()) === 1);
check('desktop: المصدر غير مطلوب لإضافات المستخدمين', (await page.inputValue('#docSource')) === '' && !(await page.evaluate(() => document.getElementById('docSource').required)));
await page.waitForFunction(() => /القسم المخصص/.test(document.getElementById('destSection').textContent));
const destText = await page.locator('#destSection').innerText();
check('desktop: وجهة Drive تُبيَّن (الاجتهادات القضائية)', /الاجتهادات القضائية/.test(destText), destText);
check('desktop: حالة ربط Drive جاهز', /جاهز للكتابة/.test(await page.locator('#destStatus').innerText().then(t => t).catch(() => '')) || (await page.waitForFunction(() => /جاهز للكتابة/.test(document.getElementById('destStatus').textContent), null, { timeout: 5000 }).then(() => true).catch(() => false)));
await page.screenshot({ path: path.join(SHOTS, 'desktop-4-editor.png') });
/* مقابلة من المحرر ثم تصحيح النص وحفظه */
await page.click('#eoCompare'); await page.waitForSelector('#originalDock:not([hidden])');
await page.waitForTimeout(500); await page.screenshot({ path: path.join(SHOTS, 'desktop-5-editor-dock.png') });
await page.click('#dockClose');
await page.fill('#docText', (await page.inputValue('#docText')).replace('خرق القانون', 'خرق القانون (بعد المقابلة بالأصل)'));
await page.click('#saveDraft'); await page.waitForFunction(() => /حُفظت المسودة/.test(document.getElementById('docStatus').textContent));
check('desktop: حفظ التصحيح كمسودة يُبقي الأصول', await page.locator('#editorOriginals').isVisible());
/* النشر مع مجلد جديد */
await page.check('[name=destMode][value=new]'); await page.fill('#driveSubfolder', 'اجتهادات 2021');
await page.waitForFunction(() => /اجتهادات 2021/.test(document.getElementById('destSection').textContent));
check('desktop: عنوان المجلد الجديد يظهر في الوجهة', true);
await page.check('#publishConfirm'); await page.click('#publishDraft'); await page.waitForFunction(() => !document.getElementById('notice').hidden || !document.getElementById('error').hidden);
const notice = await page.locator('#notice').innerText() || await page.locator('#error').innerText();
check('desktop: رسالة النشر تذكر Drive وحذف الأصل من الخادم', /اعتُمدت الوثيقة/.test(notice) && /حُفظت 1 أصل في Drive/.test(notice) && /فبقي النص وحده/.test(notice), notice);
const folderNames = [...drive.files.values()].map(f => f.name);
const uploaded = [...drive.files.values()].find(f => f.name?.endsWith('.pdf') && f.name.includes('قرار محكمة النقض عدد 25'));
check('desktop: الأصل في Drive داخل «الاجتهادات القضائية / اجتهادات 2021»', !!uploaded && folderNames.includes('اجتهادات 2021') && folderNames.includes('الاجتهادات القضائية'), folderNames.join('|'));
const leftover = await server.mongo(db => db.collection('contributionFiles').countDocuments({ contributionId: additionA }));
check('desktop: لا أصل متبقٍّ على الخادم بعد النشر', leftover === 0, String(leftover));
await page.click('[data-panel="contribPanel"]'); await page.locator('.cr-row', { hasText: 'قرار محكمة النقض عدد 25' }).click(); await page.waitForSelector('.cd-head');
const published = await page.locator('#contribDetail').innerText();
check('desktop: الإضافة صارت «اعتُمدت ونُشرت» وأصلها في Drive', /اعتُمدت ونُشرت/.test(published) && /محفوظ في Drive/.test(published) && /اجتهادات 2021/.test(published) && (await page.locator('#contribDetail [data-act="open-published"]').count()) === 1, published.slice(0, 300));
await page.screenshot({ path: path.join(SHOTS, 'desktop-6-published.png') });
const readerMail = await userCall('GET', '/api/contributions/mine'); const mineA = (readerMail.body.items || []).find(i => i.id === additionA);
check('desktop: المستخدم يرى الحالة «نُشرت» وأصلاً محفوظًا', mineA?.status === 'published' && mineA.originals === 1, JSON.stringify(mineA).slice(0, 200));

/* ───────── رفض إضافة: السبب إلزامي والأصل يُحذف ───────── */
await page.locator('.cr-row', { hasText: 'بحث في الالتزامات' }).click(); await page.waitForSelector('.cd-decline');
await page.click('.cd-decline summary'); await page.click('[data-act="decline"]');
check('desktop: رفض دون سبب يُمنع', /اكتبوا سبب/.test(await page.locator('#cdError').innerText()));
await page.fill('#cdReply', 'النص مكرر في المكتبة؛ يرجى مراجعة الفهرس قبل الإرسال.');
await page.click('[data-act="decline"]'); check('desktop: تأكيد ثانٍ قبل الرفض', (await page.locator('[data-act="decline"]').innerText()).includes('تأكيد'));
await page.click('[data-act="decline"]'); await page.waitForFunction(() => !document.getElementById('notice').hidden && /عدم الاعتماد/.test(document.getElementById('notice').textContent));
const purged = await server.mongo(db => db.collection('contributionFiles').countDocuments({ contributionId: additionB }));
check('desktop: رفض الإضافة يحذف أصلها من الخادم', purged === 0, String(purged));
const mineB = ((await userCall('GET', '/api/contributions/mine')).body.items || []).find(i => i.id === additionB);
check('desktop: المستخدم يرى الرفض مع السبب', mineB?.status === 'declined' && /مكرر/.test(mineB.reply || ''), JSON.stringify(mineB).slice(0, 200));

/* ───────── ملاحظتان: اعتماد ورفض ───────── */
const noteRows = page.locator('.cr-row', { hasText: 'تجريبي رقم 01.01' });
async function openNote(fragment) { for (let i = 0; i < await noteRows.count(); i++) { await noteRows.nth(i).click(); await page.waitForSelector('.cd-head'); await page.waitForTimeout(150); if ((await page.locator('#contribDetail').innerText()).includes(fragment)) return true; } return false; }
check('desktop: العثور على الملاحظة بين الوارد', await openNote('تحيل إلى نص تنظيمي'));
const noteDetail = await page.locator('#contribDetail').innerText();
check('desktop: تفاصيل الملاحظة (الوثيقة والموضع والنص)', /تحيل إلى نص تنظيمي/.test(noteDetail) && /تحدَّد كيفيات التطبيق/.test(noteDetail) && /law_fixture_1/.test(noteDetail), noteDetail.slice(0, 200));
await page.screenshot({ path: path.join(SHOTS, 'desktop-7-note.png') });
await page.click('[data-act="open-note-doc"]'); await page.waitForSelector('#editor:not([hidden])'); await page.waitForFunction(() => document.getElementById('docTitle').value.includes('تجريبي'));
check('desktop: «فتح الوثيقة» يفتح المحرر على نص الملاحظة', await page.locator('#contentPanel').isVisible() && !(await page.locator('#editorOriginals').isVisible()));
await page.click('[data-panel="contribPanel"]'); await page.waitForSelector('.cr-row');
await openNote('تحيل إلى نص تنظيمي'); await page.waitForSelector('#cdReply');
await page.fill('#cdReply', 'تم استكمال الإحالة في المادة 2. شكرًا على تنبيهكم.'); await page.click('[data-act="accept"]');
await page.waitForFunction(() => /اعتُمدت الملاحظة/.test(document.getElementById('notice').textContent));
const mineN = ((await userCall('GET', '/api/contributions/mine')).body.items || []).find(i => i.id === noteAccept);
check('desktop: اعتماد الملاحظة يصل المستخدم مع الرد', mineN?.status === 'accepted' && /استكمال الإحالة/.test(mineN.reply || ''), JSON.stringify(mineN).slice(0, 200));

await page.click('[data-panel="contribPanel"]'); await page.waitForSelector('.cr-row');
await openNote('أقترح حذف المادة 1'); await page.waitForSelector('#cdReply');
await page.click('[data-act="decline"]'); check('desktop: رفض الملاحظة دون سبب يُمنع', /اكتبوا سبب/.test(await page.locator('#cdError').innerText()));
await page.fill('#cdReply', 'الاقتراح يخالف النص الرسمي المنشور في الجريدة الرسمية.'); await page.click('[data-act="decline"]'); await page.click('[data-act="decline"]');
await page.waitForFunction(() => /سُجّل عدم الاعتماد/.test(document.getElementById('notice').textContent));
const mineD = ((await userCall('GET', '/api/contributions/mine')).body.items || []).find(i => i.id === noteDecline);
check('desktop: رفض الملاحظة يصل المستخدم مع السبب', mineD?.status === 'declined' && /الجريدة الرسمية/.test(mineD.reply || ''), JSON.stringify(mineD).slice(0, 200));

/* ───────── فشل نقل الأصل إلى Drive ثم إعادة المحاولة ───────── */
await page.click('[data-panel="contribPanel"]'); await page.locator('.cr-row', { hasText: 'قرار ثانٍ لاختبار فشل النقل' }).click(); await page.waitForSelector('[data-act="draft"]');
await page.click('[data-act="draft"]'); await page.waitForFunction(() => document.getElementById('docTitle').value.includes('فشل النقل'));
drive.fail({ status: 403, reason: 'storageQuotaExceeded' });
await page.check('#publishConfirm'); await page.click('#publishDraft'); await page.waitForFunction(() => !document.getElementById('notice').hidden || !document.getElementById('error').hidden);
const failNotice = await page.locator('#notice').innerText() || await page.locator('#error').innerText();
check('desktop: فشل Drive لا يُسقط النشر ويُبلَّغ به', /اعتُمدت الوثيقة/.test(failNotice) && /تعذر نقل 1 أصل/.test(failNotice), failNotice);
const kept = await server.mongo(db => db.collection('contributionFiles').countDocuments({ contributionId: additionC }));
check('desktop: الأصل باقٍ على الخادم عند فشل Drive', kept === 1, String(kept));
await page.click('[data-panel="contribPanel"]'); await page.locator('.cr-row', { hasText: 'قرار ثانٍ لاختبار فشل النقل' }).click(); await page.waitForSelector('.cd-transfer');
await page.screenshot({ path: path.join(SHOTS, 'desktop-8-transfer.png') });
drive.fail(null); await page.click('[data-act="transfer"]'); await page.waitForFunction(() => /نُقلت 1 أصل إلى Drive/.test(document.getElementById('notice').textContent));
const keptAfter = await server.mongo(db => db.collection('contributionFiles').countDocuments({ contributionId: additionC }));
check('desktop: إعادة النقل تنجح وتحذف الأصل من الخادم', keptAfter === 0 && (await page.locator('.cd-transfer').count()) === 0, String(keptAfter));
check('desktop: لا أخطاء في وحدة التحكم', errors.length === 0, errors.join(' | ').slice(0, 400));
await context.close();

/* ───────── الهاتف: التخطيط وعناصر الوارد ───────── */
const mob = await adminFlow('mobile', { width: 390, height: 844 }, true);
await mob.page.screenshot({ path: path.join(SHOTS, 'mobile-1-inbox.png') });
await mob.page.locator('.cr-row').first().click(); await mob.page.waitForSelector('.cd-head');
const overflow = await mob.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check('mobile: لا تمرير أفقي', overflow <= 1, String(overflow));
await mob.page.screenshot({ path: path.join(SHOTS, 'mobile-2-detail.png') });
check('mobile: لا أخطاء في وحدة التحكم', mob.errors.length === 0, mob.errors.join(' | ').slice(0, 300));
await mob.context.close();

await browser.close(); await server.stop(); await drive.stop();
const failed = results.filter(r => !r[0]); console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots: ${SHOTS}`);
process.exit(failed.length ? 1 : 0);
