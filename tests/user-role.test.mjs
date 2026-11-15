/* تغيير صلاحية حساب قائم (قارئ ⇄ مدير) من لوحة الإدارة، وسريانه الفوري على الجلسات المفتوحة. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
const OWNER = 'zoulouti@gmail.com', SECOND = 'second.admin@example.com', READER = 'plain.reader@example.com', BANNED = 'banned@example.com';
let server;
const shared = sessionCookie('admin'); /* كلمة الإدارة المشتركة: لا حساب لها في القاعدة */

async function call(method, path, { cookie, json } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}) } };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] = 'application/json'; }
  const r = await fetch(server.base + path, init), type = r.headers.get('content-type') || '';
  return { status: r.status, body: type.includes('json') ? await r.json() : null };
}
const setRole = (cookie, email, role) => call('POST', '/api/admin/users/role', { cookie, json: { email, role } });
const roleInDb = email => server.mongo(db => db.collection('libraryUsers').findOne({ email }, { projection: { role: 1 } })).then(u => u?.role);

before(async () => {
  if (skip) return;
  server = await bootServer();
  await server.seedUser(OWNER, 'reader'); await server.seedUser(READER, 'reader');
  await server.mongo(db => db.collection('libraryUsers').updateOne({ email: BANNED }, { $set: { email: BANNED, role: 'reader', active: false, accountStatus: 'permanent' } }, { upsert: true }));
});
after(async () => { if (server) await server.stop(); });

test('للمدير فقط، وبصلاحية صالحة وحساب موجود وغير موقوف نهائيًا', { skip }, async () => {
  assert.equal((await setRole(sessionCookie('reader', READER), READER, 'admin')).status, 403, 'القارئ لا يرقّي نفسه');
  assert.equal((await setRole(undefined, READER, 'admin')).status, 403);
  assert.equal((await setRole(shared, READER, 'owner')).status, 400);
  assert.equal((await setRole(shared, 'nobody@example.com', 'admin')).status, 404);
  assert.equal((await setRole(shared, BANNED, 'admin')).status, 409, 'الموقوف نهائيًا لا يُرقّى');
  assert.equal(await roleInDb(READER), 'reader'); assert.equal(await roleInDb(BANNED), 'reader');
});

test('الترقية: تُسجَّل في التدقيق ولا تمنح الجلسة القديمة شيئًا قبل الدخول من جديد', { skip }, async () => {
  const oldReaderSession = sessionCookie('reader', OWNER);
  const up = await setRole(shared, OWNER, 'admin');
  assert.equal(up.status, 200); assert.equal(up.body.role, 'admin'); assert.equal(up.body.from, 'reader');
  assert.equal(await roleInDb(OWNER), 'admin');
  const audit = await server.mongo(db => db.collection('adminAudit').find({ action: 'user_role_changed' }).toArray());
  assert.equal(audit.length, 1); assert.deepEqual([audit[0].target, audit[0].details.from, audit[0].details.to, audit[0].actor], [OWNER, 'reader', 'admin', 'admin']);
  assert.equal((await call('GET', '/api/admin/users', { cookie: oldReaderSession })).status, 403, 'الجلسة القديمة تبقى جلسة قارئ');
  assert.equal((await call('GET', '/api/admin/users', { cookie: sessionCookie('admin', OWNER) })).status, 200, 'بعد الدخول من جديد تُمنح الإدارة');
  const again = await setRole(shared, OWNER, 'admin');
  assert.equal(again.status, 200); assert.equal(again.body.unchanged, true);
  assert.equal((await server.mongo(db => db.collection('adminAudit').countDocuments({ action: 'user_role_changed' }))), 1, 'لا تدقيق عند عدم التغيير');
});

test('حماية آخر مدير وحماية الحساب المستعمل', { skip }, async () => {
  const owner = sessionCookie('admin', OWNER);
  assert.equal((await setRole(owner, OWNER, 'reader')).status, 409, 'لا يخفض المدير حسابه بنفسه');
  const last = await setRole(shared, OWNER, 'reader');
  assert.equal(last.status, 409); assert.match(last.body.error, /آخر مدير/);
  assert.equal(await roleInDb(OWNER), 'admin');
});

test('خفض الدور يسري فورًا على الجلسة المفتوحة (لا ننتظر 7 أيام)', { skip }, async () => {
  await server.seedUser(SECOND, 'admin');
  const second = sessionCookie('admin', SECOND);
  assert.equal((await call('GET', '/api/admin/users', { cookie: second })).status, 200);
  assert.equal((await call('GET', '/api/session', { cookie: second })).body.canAdmin, true);
  const down = await setRole(sessionCookie('admin', OWNER), SECOND, 'reader');
  assert.equal(down.status, 200); assert.equal(await roleInDb(SECOND), 'reader');
  assert.equal((await call('GET', '/api/admin/users', { cookie: second })).status, 403, 'الجلسة ذاتها لم تعد تدير');
  const session = (await call('GET', '/api/session', { cookie: second })).body;
  assert.equal(session.canAdmin, false); assert.equal(session.role, 'reader'); assert.equal(session.authenticated, true);
  const page = await fetch(server.base + '/admin', { headers: { cookie: second }, redirect: 'manual' });
  assert.equal(page.status, 302); assert.match(page.headers.get('location'), /\/login\?next=admin/);
});

test('إيقاف حساب مدير يقطع جلسته فورًا (سلوك قائم لم يتأثر)', { skip }, async () => {
  await server.seedUser(SECOND, 'admin');
  const second = sessionCookie('admin', SECOND);
  assert.equal((await call('GET', '/api/admin/users', { cookie: second })).status, 200);
  assert.equal((await call('POST', '/api/admin/users/status', { cookie: sessionCookie('admin', OWNER), json: { email: SECOND, action: 'suspend' } })).status, 200);
  assert.ok([401, 403].includes((await call('GET', '/api/admin/users', { cookie: second })).status));
});

test('كلمة الإدارة المشتركة لا تتأثر، والآن مع مديرَين يصح خفض أحدهما', { skip }, async () => {
  assert.equal((await call('GET', '/api/admin/users', { cookie: shared })).status, 200);
  await server.seedUser(SECOND, 'admin');
  assert.equal((await setRole(shared, SECOND, 'reader')).status, 200);
  assert.equal((await setRole(shared, SECOND, 'admin')).status, 200, 'والعودة ممكنة');
  assert.equal(await roleInDb(SECOND), 'admin');
});
