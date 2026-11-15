import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';
import { startFakeDrive, ROOT_ID } from './fixtures/fake-drive.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
const USER = 'avocat@example.com', OTHER = 'autre@example.com';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n' + 'x'.repeat(300));
let server, drive;
const userCookie = sessionCookie('reader', USER), otherCookie = sessionCookie('reader', OTHER), adminCookie = sessionCookie('admin');

async function call(method, path, { cookie, json, raw, headers = {} } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}), ...headers } };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] = 'application/json'; }
  if (raw !== undefined) { init.body = raw; init.headers['content-type'] = 'application/octet-stream'; }
  const r = await fetch(server.base + path, init);
  const type = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
const upload = (cookie, bytes = PDF, name = 'أصل القرار.pdf') => call('POST', '/api/contributions/file', { cookie, raw: bytes, headers: { 'x-file-name': encodeURIComponent(name) } });
const additionBody = (fileIds, extra = {}) => ({ kind: 'jurisprudence', title: 'قرار محكمة النقض رقم 25', issuedAt: '04/03/2021', source: 'مجلة قضاء محكمة النقض', issuer: 'محكمة النقض', text: 'حيث إن الطاعن يعيب على القرار المطعون فيه ضعف التعليل. ' .repeat(6), fileIds, ...extra });

before(async () => {
  if (skip) return;
  drive = await startFakeDrive();
  server = await bootServer({ env: { NODE_ENV: 'test', QALAM_TEST_GOOGLE_ORIGIN: drive.origin, GOOGLE_SERVICE_ACCOUNT_JSON: drive.serviceAccountJson, DRIVE_ROOT_FOLDER_ID: ROOT_ID } });
  await server.seedUser(USER); await server.seedUser(OTHER);
});
after(async () => { if (server) await server.stop(); if (drive) await drive.stop(); });

test('الإضافات تتطلب حسابًا فرديًا؛ الجلسات العامة تُمنع', { skip }, async () => {
  const anon = await call('GET', '/api/contributions/config', { cookie: sessionCookie('reader') });
  assert.equal(anon.status, 200); assert.equal(anon.body.canSubmit, false);
  assert.equal((await call('POST', '/api/contributions/file', { cookie: sessionCookie('reader'), raw: PDF })).status, 403);
  const ok = await call('GET', '/api/contributions/config', { cookie: userCookie });
  assert.equal(ok.body.canSubmit, true); assert.equal(ok.body.kinds.length, 4); assert.equal(ok.body.limits.originalBytes, 8 * 1024 * 1024);
});

test('رفع الأصل: أنواع خطرة مرفوضة وفحص الحدود', { skip }, async () => {
  assert.equal((await upload(userCookie, Buffer.from('MZ\x90\x00 virus'), 'a.exe')).status, 415);
  assert.equal((await upload(userCookie, Buffer.from('<html><script>alert(1)</script>'), 'a.html')).status, 415);
  assert.equal((await call('POST', '/api/contributions/file', { cookie: userCookie, raw: Buffer.alloc(0) })).status, 400);
  assert.equal((await upload(userCookie, Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(8 * 1024 * 1024 + 10)]))).status, 413);
  const up = await upload(userCookie);
  assert.equal(up.status, 201); assert.match(up.body.id, /^f_[0-9a-f]{20}$/); assert.equal(up.body.ext, 'pdf'); assert.equal(up.body.size, PDF.length);
  assert.equal((await call('GET', '/api/contributions/file?id=' + up.body.id, { cookie: otherCookie })).status, 404, 'مستخدم آخر لا يرى الملف');
  const mine = await call('GET', '/api/contributions/file?id=' + up.body.id, { cookie: userCookie });
  assert.equal(mine.status, 200); assert.equal(mine.headers.get('x-content-type-options'), 'nosniff'); assert.equal(mine.headers.get('content-type'), 'application/pdf'); assert.deepEqual(mine.body, PDF);
  assert.equal((await call('POST', '/api/contributions/file/delete', { cookie: otherCookie, json: { id: up.body.id } })).body.deleted, 0);
  assert.equal((await call('POST', '/api/contributions/file/delete', { cookie: userCookie, json: { id: up.body.id } })).body.deleted, 1);
});

test('المسار الكامل: إضافة بأصلها ← مسودة ← نشر ← نقل الأصل إلى Drive وحذفه من الخادم', { skip }, async () => {
  const noOrig = await call('POST', '/api/contributions/addition', { cookie: userCookie, json: additionBody([]) });
  assert.equal(noOrig.status, 400); assert.match(noOrig.body.error, /الأصلية/);
  const foreign = await upload(otherCookie);
  assert.equal((await call('POST', '/api/contributions/addition', { cookie: userCookie, json: additionBody([foreign.body.id]) })).status, 400, 'أصل غيره لا يُرفق');

  const up = await upload(userCookie);
  const add = await call('POST', '/api/contributions/addition', { cookie: userCookie, json: additionBody([up.body.id]) });
  assert.equal(add.status, 201, JSON.stringify(add.body)); assert.equal(add.body.status, 'pending');
  const id = add.body.id;
  assert.equal((await call('POST', '/api/contributions/addition', { cookie: userCookie, json: additionBody([(await upload(userCookie, PDF.subarray(0, 200))).body.id]) })).status, 409, 'النص المكرر قيد الدرس');

  const mine = await call('GET', '/api/contributions/mine', { cookie: userCookie });
  const row = mine.body.items.find(x => x.id === id);
  assert.equal(row.originals, 1); assert.equal(row.statusLabel.length > 0, true); assert.ok(!JSON.stringify(mine.body).includes('حيث إن الطاعن'), 'لا يعاد نص الإضافة للمستخدم');

  assert.equal((await call('GET', '/api/admin/contributions', { cookie: userCookie })).status, 403, 'القارئ لا يدخل لوحة المدير');
  const list = await call('GET', '/api/admin/contributions?type=addition', { cookie: adminCookie });
  assert.equal(list.status, 200); assert.ok(list.body.items.some(x => x.id === id)); assert.ok(list.body.counts.additions.pending >= 1);
  const item = await call('GET', '/api/admin/contributions/item?id=' + id, { cookie: adminCookie });
  assert.equal(item.body.originalFiles.length, 1); assert.match(item.body.text, /ضعف التعليل/);
  const fileId = item.body.originalFiles[0].id;
  const orig = await call('GET', `/api/admin/contributions/file?id=${fileId}&mode=preview`, { cookie: adminCookie });
  assert.equal(orig.status, 200); assert.deepEqual(orig.body, PDF);

  const draft = await call('POST', '/api/admin/contributions/draft', { cookie: adminCookie, json: { id } });
  assert.equal(draft.status, 201); const documentId = draft.body.documentId;
  assert.equal((await call('POST', '/api/admin/contributions/draft', { cookie: adminCookie, json: { id } })).body.existing, true);
  const doc = await call('GET', '/api/admin/document?id=' + documentId, { cookie: adminCookie });
  assert.equal(doc.body.origin, 'contribution'); assert.equal(doc.body.originalFiles.length, 1);
  assert.equal((await call('GET', '/api/contributions/mine', { cookie: userCookie })).body.items.find(x => x.id === id).status, 'reviewing');

  const saved = await call('POST', '/api/admin/content/save', { cookie: adminCookie, json: { documentId, title: doc.body.title, text: doc.body.text + '\nتصحيح من المدير.', reason: 'مراجعة المدير وتصحيح الأخطاء المادية', date: doc.body.date, sourceLabel: doc.body.sourceLabel, sourceUrl: '' } });
  assert.equal(saved.status, 201, JSON.stringify(saved.body));
  const again = await call('GET', '/api/admin/document?id=' + documentId, { cookie: adminCookie });
  assert.equal(again.body.originalFiles.length, 1, 'الأصل يبقى بعد حفظ المسودة'); assert.equal(again.body.origin, 'contribution');
  assert.equal((await call('POST', '/api/admin/content/publish', { cookie: adminCookie, json: { documentId } })).status, 400, 'النشر يتطلب تأكيد المراجعة');

  const pub = await call('POST', '/api/admin/content/publish', { cookie: adminCookie, json: { documentId, confirmReviewed: true, driveSubfolder: 'إضافات 2026' } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body)); assert.equal(pub.body.originals.moved, 1, JSON.stringify(pub.body)); assert.equal(pub.body.originals.failed, 0);
  assert.match(pub.body.originals.folder, /الاجتهادات القضائية \/ إضافات 2026/);

  // Drive: قسم «الاجتهادات القضائية» لم يكن قائمًا فأُنشئ، ثم مجلد فرعي بعنوان جديد، ثم الملف نفسه
  const section = [...drive.files.values()].find(f => f.name === 'الاجتهادات القضائية' && f.parents?.includes(ROOT_ID));
  assert.ok(section, 'أُنشئ القسم المخصص');
  const sub = drive.childrenOf(section.id).find(f => f.name === 'إضافات 2026'); assert.ok(sub);
  const stored = drive.childrenOf(sub.id); assert.equal(stored.length, 1);
  assert.equal(stored[0].name, 'قرار محكمة النقض رقم 25 (2021-03-04).pdf'); assert.deepEqual(stored[0].data, PDF); assert.match(stored[0].description, /المصدر/);

  // الخادم: لا يبقى إلا النص؛ الأصل حُذف وصار مرجع Drive
  const left = await server.mongo(db => db.collection('contributionFiles').countDocuments({ contributionId: id }));
  assert.equal(left, 0, 'حُذف الأصل من الخادم بعد نقله');
  const lib = await call('GET', '/api/document?id=' + documentId, { cookie: userCookie });
  assert.equal(lib.status, 200); assert.equal(lib.body.originalFiles[0].driveId, stored[0].id); assert.match(lib.body.text, /تصحيح من المدير/);
  assert.equal((await call('GET', `/api/original?doc=${documentId}&file=${fileId}`, { cookie: userCookie })).status, 404, 'لا نسخة على الخادم بعد النقل');

  const after = (await call('GET', '/api/contributions/mine', { cookie: userCookie })).body;
  const done = after.items.find(x => x.id === id); assert.equal(done.status, 'published'); assert.ok(after.unread >= 1);
  await call('POST', '/api/contributions/seen', { cookie: userCookie, json: {} });
  assert.equal((await call('GET', '/api/contributions/unread', { cookie: userCookie })).body.unread, 0);
});

test('تعذّر Drive لا يُسقط النشر: يبقى الأصل على الخادم ويُعاد النقل لاحقًا', { skip }, async () => {
  const up = await upload(userCookie, Buffer.from('%PDF-1.4 second ' + 'y'.repeat(300)), 'بحث.pdf');
  const add = await call('POST', '/api/contributions/addition', { cookie: userCookie, json: additionBody([up.body.id], { kind: 'research', title: 'بحث في التحكيم التجاري', text: 'يتناول هذا البحث شروط اتفاق التحكيم وآثاره القانونية بين الأطراف. '.repeat(6) }) });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const documentId = (await call('POST', '/api/admin/contributions/draft', { cookie: adminCookie, json: { id: add.body.id } })).body.documentId;
  drive.fail({ status: 403, reason: 'insufficientFilePermissions' });
  const pub = await call('POST', '/api/admin/content/publish', { cookie: adminCookie, json: { documentId, confirmReviewed: true } });
  assert.equal(pub.status, 200); assert.equal(pub.body.originals.moved, 0); assert.equal(pub.body.originals.failed, 1); assert.match(pub.body.originals.error, /محرر/);
  assert.equal((await call('GET', '/api/contributions/mine', { cookie: userCookie })).body.items.find(x => x.id === add.body.id).status, 'published', 'النص نُشر رغم تعذّر Drive');
  const fileId = (await call('GET', '/api/admin/document?id=' + documentId, { cookie: adminCookie })).body.originalFiles[0].id;
  const viaServer = await call('GET', `/api/original?doc=${documentId}&file=${fileId}`, { cookie: userCookie });
  assert.equal(viaServer.status, 200, 'القارئ يرى الأصل من الخادم مؤقتًا'); assert.equal(viaServer.headers.get('content-type'), 'application/pdf');
  assert.equal((await call('GET', `/api/original?doc=${documentId}&file=${'f_' + '0'.repeat(20)}`, { cookie: userCookie })).status, 404);

  drive.fail(null);
  const status = await call('GET', '/api/admin/originals/drive', { cookie: adminCookie });
  assert.equal(status.body.ready, true); assert.equal(status.body.root.id, ROOT_ID);
  const retry = await call('POST', '/api/admin/originals/transfer', { cookie: adminCookie, json: { documentId } });
  assert.equal(retry.status, 200); assert.equal(retry.body.originals.moved, 1);
  const section = [...drive.files.values()].find(f => f.name === 'الأبحاث و الدراسات' && f.parents?.includes(ROOT_ID));
  assert.equal(drive.childrenOf(section.id).filter(f => f.name.startsWith('بحث في التحكيم التجاري')).length, 1, 'استُعمل القسم القائم دون إنشاء نسخة ثانية');
  assert.equal([...drive.files.values()].filter(f => f.name === 'الأبحاث و الدراسات').length, 1);
  const lib = await call('GET', '/api/document?id=' + documentId, { cookie: userCookie });
  assert.ok(lib.body.originalFiles[0].driveId);
  assert.equal((await call('POST', '/api/admin/originals/transfer', { cookie: adminCookie, json: { documentId } })).body.originals.moved, 0, 'إعادة النقل لا تكرّر الرفع');
  assert.equal((await call('POST', '/api/admin/originals/transfer', { cookie: userCookie, json: { documentId } })).status, 403);
});

test('الرفض يحذف الأصول من الخادم ويصل السبب إلى صاحب الإضافة', { skip }, async () => {
  const up = await upload(userCookie, Buffer.from('%PDF-1.4 third ' + 'z'.repeat(300)), 'غير معتمد.pdf');
  const add = await call('POST', '/api/contributions/addition', { cookie: userCookie, json: additionBody([up.body.id], { title: 'نص غير معتمد للاختبار', text: 'نص مختلف تماما عن النصوص السابقة ولا يحمل قيمة. '.repeat(8) }) });
  assert.equal(add.status, 201);
  assert.equal((await call('POST', '/api/admin/contributions/resolve', { cookie: adminCookie, json: { id: add.body.id, status: 'declined' } })).status, 400, 'السبب إلزامي');
  const res = await call('POST', '/api/admin/contributions/resolve', { cookie: adminCookie, json: { id: add.body.id, status: 'declined', reply: 'النص غير مطابق للأصل المرفق.' } });
  assert.equal(res.status, 200);
  assert.equal(await server.mongo(db => db.collection('contributionFiles').countDocuments({ contributionId: add.body.id })), 0);
  const row = (await call('GET', '/api/contributions/mine', { cookie: userCookie })).body.items.find(x => x.id === add.body.id);
  assert.equal(row.status, 'declined'); assert.match(row.reply, /غير مطابق/);
  assert.equal((await call('POST', '/api/admin/contributions/resolve', { cookie: adminCookie, json: { id: add.body.id, status: 'declined', reply: 'مرة ثانية' } })).status, 409);
});

test('ملاحظات القارئ: إرسال ← قيد الدرس ← قبول مع ردّ', { skip }, async () => {
  assert.equal((await call('POST', '/api/contributions/note', { cookie: userCookie, json: { documentId: 'doc_غير_موجود', message: 'ملاحظة على وثيقة لا وجود لها' } })).status, 404);
  const note = await call('POST', '/api/contributions/note', { cookie: userCookie, json: { documentId: 'law_fixture_1', noteType: 'error', message: 'المادة 2 تحيل إلى نص تنظيمي لم يُذكر رقمه.', excerpt: 'تُحدَّد كيفيات التطبيق بنص تنظيمي' } });
  assert.equal(note.status, 201, JSON.stringify(note.body));
  assert.equal((await call('POST', '/api/contributions/note', { cookie: userCookie, json: { documentId: 'law_fixture_1', noteType: 'error', message: 'المادة 2 تحيل إلى نص تنظيمي لم يُذكر رقمه.' } })).status, 409);
  const item = await call('GET', '/api/admin/contributions/item?id=' + note.body.id, { cookie: adminCookie });
  assert.equal(item.body.documentTitle, 'قانون تجريبي رقم 01.01 بشأن الاختبار'); assert.equal(item.body.noteTypeLabel, 'تصحيح خطأ في النص');
  assert.equal((await call('POST', '/api/admin/contributions/draft', { cookie: adminCookie, json: { id: note.body.id } })).status, 404, 'الملاحظة لا تتحول إلى مسودة');
  assert.equal((await call('POST', '/api/admin/contributions/resolve', { cookie: adminCookie, json: { id: note.body.id, status: 'accepted', reply: 'شكرًا، صُحّحت الإحالة.' } })).status, 200);
  const row = (await call('GET', '/api/contributions/mine', { cookie: userCookie })).body.items.find(x => x.id === note.body.id);
  assert.equal(row.status, 'accepted'); assert.equal(row.reply, 'شكرًا، صُحّحت الإحالة.');
  assert.equal((await call('GET', '/api/contributions/mine', { cookie: otherCookie })).body.items.some(x => x.id === note.body.id), false, 'لا يرى مستخدم ملاحظات غيره');
});

test('مساعدات المحرر: خطة القسم في Drive وبيانات الإضافة في المسودة', { skip }, async () => {
  assert.equal((await call('GET', '/api/admin/originals/section?kind=law', { cookie: userCookie })).status, 403, 'القارئ لا يصل إلى مسارات الإدارة');
  const plan = q => call('GET', '/api/admin/originals/section?' + new URLSearchParams(q), { cookie: adminCookie }).then(r => r.body);
  assert.equal((await plan({ kind: 'law', type: 'national', category: 'مواد قانونية' })).id, 'law');
  assert.equal((await plan({ kind: 'study', type: 'judicial', category: 'دراسات' })).id, 'research');
  assert.equal((await plan({ kind: 'law', category: 'الاتفاقيات الدولية', title: 'اتفاقية تجارية' })).id, 'treaty');
  const court = await plan({ kind: 'jurisprudence', type: 'juriscassation', category: 'اجتهادات', issuer: 'محكمة النقض' });
  assert.equal(court.id, 'jurisprudence'); assert.equal(typeof court.court, 'boolean');
  const up = await upload(userCookie); const add = await call('POST', '/api/contributions/addition', { cookie: userCookie, json: additionBody([up.body.id], { title: 'قرار لاختبار بيانات المحرر' }) });
  assert.equal(add.status, 201);
  const draft = await call('POST', '/api/admin/contributions/draft', { cookie: adminCookie, json: { id: add.body.id } });
  const doc = await call('GET', '/api/admin/document?id=' + draft.body.documentId, { cookie: adminCookie });
  assert.equal(doc.body.origin, 'contribution'); assert.equal(doc.body.contributionId, add.body.id); assert.equal(doc.body.issuer, 'محكمة النقض'); assert.equal(doc.body.originalFiles.length, 1);
  assert.equal((await call('POST', '/api/admin/contributions/resolve', { cookie: adminCookie, json: { id: add.body.id, status: 'declined', reply: 'اختبار تنظيف.' } })).status, 200);
});
