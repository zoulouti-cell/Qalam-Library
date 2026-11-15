/* حذف حساب فردي نهائيًا من لوحة الإدارة: الحمايات، سياسة البيانات، وسقوط الجلسات فورًا. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
const OWNER = 'owner.admin@example.com', SECOND = 'second.admin@example.com', LEAVER = 'leaver@example.com', OTHER = 'other.reader@example.com', BANNED = 'banned@example.com', SUSPENDED_ADMIN = 'old.admin@example.com';
let server;
const shared = sessionCookie('admin'); /* كلمة الإدارة المشتركة: لا حساب لها في القاعدة */

async function call(method, path, { cookie, json } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}) } };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] = 'application/json'; }
  const r = await fetch(server.base + path, init), type = r.headers.get('content-type') || '';
  return { status: r.status, body: type.includes('json') ? await r.json() : null };
}
const del = (cookie, email, extra = {}) => call('POST', '/api/admin/users/delete', { cookie, json: { email, confirmEmail: email, ...extra } });
const userInDb = email => server.mongo(db => db.collection('libraryUsers').findOne({ email }));
const col = (name, filter = {}) => server.mongo(db => db.collection(name).find(filter).toArray());

before(async () => {
  if (skip) return;
  server = await bootServer();
  for (const [email, role] of [[OWNER, 'admin'], [SECOND, 'admin'], [LEAVER, 'reader'], [OTHER, 'reader']]) await server.seedUser(email, role);
  await server.mongo(async db => {
    const users = db.collection('libraryUsers');
    await users.updateOne({ email: BANNED }, { $set: { email: BANNED, role: 'reader', active: false, accountStatus: 'permanent' } }, { upsert: true });
    await users.updateOne({ email: SUSPENDED_ADMIN }, { $set: { email: SUSPENDED_ADMIN, role: 'admin', active: false, accountStatus: 'suspended' } }, { upsert: true });
    const now = new Date();
    await db.collection('userContributions').insertMany([
      { id: 'c-open', type: 'addition', status: 'pending', userEmail: LEAVER, title: 'قيد المراجعة', draftDocumentId: 'managed_open', createdAt: now },
      { id: 'c-open2', type: 'note', status: 'pending', userEmail: LEAVER, title: 'ملاحظة', createdAt: now },
      { id: 'c-pub', type: 'addition', status: 'published', userEmail: LEAVER, title: 'منشورة', createdAt: now },
      { id: 'c-dec', type: 'note', status: 'declined', userEmail: LEAVER, title: 'مرفوضة', createdAt: now },
      { id: 'c-other', type: 'addition', status: 'pending', userEmail: OTHER, title: 'لمستخدم آخر', createdAt: now }
    ]);
    await db.collection('managedContent').insertOne({ documentId: 'managed_open', status: 'draft', title: 'مسودة الإضافة المفتوحة' });
    await db.collection('contributionFiles').insertMany([
      { id: 'f-orphan', ownerEmail: LEAVER, name: 'orphan.pdf', size: 3, createdAt: now },
      { id: 'f-open', ownerEmail: LEAVER, contributionId: 'c-open', name: 'open.pdf', size: 3, createdAt: now },
      { id: 'f-pub', ownerEmail: LEAVER, contributionId: 'c-pub', name: 'pub.pdf', size: 3, createdAt: now },
      { id: 'f-other', ownerEmail: OTHER, contributionId: 'c-other', name: 'other.pdf', size: 3, createdAt: now }
    ]);
  });
});
after(async () => { if (server) await server.stop(); });

test('للمدير فقط، مع تأكيد البريد كتابةً وحساب موجود', { skip }, async () => {
  assert.equal((await del(sessionCookie('reader', OTHER), LEAVER)).status, 403, 'القارئ لا يحذف');
  assert.equal((await del(undefined, LEAVER)).status, 403);
  assert.equal((await call('POST', '/api/admin/users/delete', { cookie: shared, json: { email: LEAVER } })).status, 400, 'بلا تأكيد');
  assert.equal((await call('POST', '/api/admin/users/delete', { cookie: shared, json: { email: LEAVER, confirmEmail: OTHER } })).status, 400, 'تأكيد لبريد آخر');
  assert.equal((await call('POST', '/api/admin/users/delete', { cookie: shared, json: { email: LEAVER, confirmEmail: '  ' + LEAVER.toUpperCase() + ' ' } })).status, 409, 'المطابقة بلا حساسية لحالة الأحرف تصل إلى فحص الإضافات المفتوحة');
  assert.equal((await del(shared, 'nobody@example.com')).status, 404);
  assert.ok(await userInDb(LEAVER), 'لم يُحذف شيء');
});

test('لا يحذف المدير حسابه، ولا يُحذف آخر مدير نشط', { skip }, async () => {
  const own = await del(sessionCookie('admin', OWNER), OWNER);
  assert.equal(own.status, 409); assert.match(own.body.error, /الذي تستعمله/);
  /* مديران نشطان الآن (OWNER وSECOND): حذف SECOND مسموح لكن آخر مدير لا يُحذف بعده */
  assert.equal((await del(shared, SECOND)).status, 200, 'حذف مدير ثانٍ ما دام غيره باقيًا');
  const last = await del(shared, OWNER);
  assert.equal(last.status, 409); assert.match(last.body.error, /آخر مدير/);
  assert.ok(await userInDb(OWNER));
  assert.equal(await userInDb(SECOND), null);
  await server.seedUser(SECOND, 'admin');
});

test('إضافات قيد المراجعة تمنع الحذف حتى يوافق المدير على حذفها معه', { skip }, async () => {
  const refused = await del(shared, LEAVER);
  assert.equal(refused.status, 409); assert.equal(refused.body.needsDiscard, true); assert.equal(refused.body.openContributions, 2);
  assert.ok(await userInDb(LEAVER), 'الحساب باقٍ');
  assert.equal((await col('userContributions', { userEmail: LEAVER })).length, 4, 'لا تُمسّ الإضافات عند الرفض');
  const explicit = await del(shared, LEAVER, { discardOpen: 'yes' });
  assert.equal(explicit.status, 409, 'لا تُقبل إلا true صريحة');
});

test('الحذف: يُمحى الحساب وتُنظَّف بياناته وفق السياسة، ولا يُمسّ غيره', { skip }, async () => {
  const done = await del(shared, LEAVER, { discardOpen: true });
  assert.equal(done.status, 200);
  assert.deepEqual([done.body.discardedContributions, done.body.anonymizedContributions, done.body.removedFiles], [2, 2, 2], 'مفتوحتان محذوفتان، مبتوت فيهما مفصولتان، ملفان محذوفان (مرتبط بالمفتوحة + حرّ)');
  assert.equal(await userInDb(LEAVER), null);
  const mine = await col('userContributions', { id: { $in: ['c-open', 'c-open2', 'c-pub', 'c-dec'] } });
  assert.deepEqual(mine.map(c => c.id).sort(), ['c-dec', 'c-pub']);
  for (const c of mine) { assert.equal(c.userEmail, ''); assert.equal(c.userDeleted, true); assert.ok(c.userDeletedAt); assert.equal(c.userNotifyPending, false); }
  assert.equal((await col('managedContent', { documentId: 'managed_open' })).length, 0, 'مسودة الإضافة المفتوحة تُحذف');
  const files = await col('contributionFiles');
  assert.deepEqual(files.map(f => f.id).sort(), ['f-other', 'f-pub']);
  assert.equal(files.find(f => f.id === 'f-pub').ownerEmail, '', 'أصل الإضافة المنشورة يبقى بلا بريد');
  assert.equal(files.find(f => f.id === 'f-other').ownerEmail, OTHER);
  assert.equal((await col('userContributions', { id: 'c-other' }))[0].userEmail, OTHER, 'إضافات غيره لا تُمسّ');
  assert.ok(await userInDb(OTHER));
  const audit = await col('adminAudit', { action: 'user_deleted', target: LEAVER });
  assert.equal(audit.length, 1);
  assert.deepEqual([audit[0].actor, audit[0].details.role, audit[0].details.discardedContributions, audit[0].details.anonymizedContributions, audit[0].details.removedFiles], ['admin', 'reader', 2, 2, 2]);
  assert.equal((await del(shared, LEAVER)).status, 404, 'لا حذف مكرر');
});

test('جلسة الحساب المحذوف تسقط فورًا (قارئ ومدير)', { skip }, async () => {
  const goneReader = sessionCookie('reader', LEAVER);
  const session = await call('GET', '/api/session', { cookie: goneReader });
  assert.equal(session.body.authenticated, false);
  assert.equal((await call('GET', '/api/contributions/unread', { cookie: goneReader })).status, 401);
  await server.seedUser('temp.admin@example.com', 'admin');
  const tempAdmin = sessionCookie('admin', 'temp.admin@example.com');
  assert.equal((await call('GET', '/api/admin/users', { cookie: tempAdmin })).status, 200);
  assert.equal((await del(shared, 'temp.admin@example.com')).status, 200);
  assert.ok([401, 403].includes((await call('GET', '/api/admin/users', { cookie: tempAdmin })).status), 'مدير محذوف بجلسة سارية لا يدخل الإدارة (البوابة العامة تردّ 401)');
});

test('الموقوف نهائيًا والموقوف مؤقتًا يُحذفان، وتنفيذ المدير يُسجَّل باسمه', { skip }, async () => {
  assert.equal((await del(sessionCookie('admin', OWNER), BANNED)).status, 200, 'حساب موقوف نهائيًا قابل للحذف');
  assert.equal(await userInDb(BANNED), null);
  assert.equal((await del(sessionCookie('admin', OWNER), SUSPENDED_ADMIN)).status, 200, 'مدير موقوف لا يُحتسب آخر مدير');
  const audit = await col('adminAudit', { action: 'user_deleted', target: BANNED });
  assert.equal(audit[0].actor, OWNER); assert.equal(audit[0].details.accountStatus, 'permanent');
});
