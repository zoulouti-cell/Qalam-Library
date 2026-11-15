/* إنهاء الدخول بكلمة الإدارة المشتركة: يصير اختياريًا ومعطّلًا بحذف LIBRARY_ADMIN_PASSWORD،
   ويحلّ محلّه مدير طوارئ يُعاد عند الإقلاع (LIBRARY_BOOTSTRAP_ADMIN_EMAIL). */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
const BOOT = 'boot.admin@example.com', SECOND = 'second.admin@example.com', READER = 'plain.reader@example.com';
const servers = [];
const start = async options => {
  const s = await bootServer(options), stop = s.stop; let stopped = false;
  s.stop = async () => { if (stopped) return; stopped = true; await stop(); }; /* stop() الأصلي يعلّق إن استُدعي ثانيةً بعد خروج العملية */
  servers.push(s); return s;
};
after(async () => { for (const s of servers) await s.stop().catch(() => {}); });
const call = (server, method, path, { cookie, json } = {}) => {
  const init = { method, headers: { ...(cookie ? { cookie } : {}) } };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] = 'application/json'; }
  return fetch(server.base + path, init).then(async r => ({ status: r.status, body: (r.headers.get('content-type') || '').includes('json') ? await r.json() : null }));
};
const userDoc = (server, email) => server.mongo(db => db.collection('libraryUsers').findOne({ email }));
const audits = (server, action) => server.mongo(db => db.collection('adminAudit').find({ action }).toArray());

test('الوضع الافتراضي القديم: الكلمة المشتركة مفعّلة، واللوحة تنبّه إلى ذلك', { skip }, async () => {
  const s = await start();
  const wrong = await call(s, 'POST', '/api/admin/login', { json: { password: 'not-the-password' } });
  assert.equal(wrong.status, 401);
  const list = await call(s, 'GET', '/api/admin/users', { cookie: sessionCookie('admin') });
  assert.equal(list.status, 200); assert.equal(list.body.sharedAdminEnabled, true);
});

test('بحذف LIBRARY_ADMIN_PASSWORD: يُرفض الدخول المشترك وتسقط جلساته القائمة فورًا', { skip }, async () => {
  const s = await start({ env: { LIBRARY_ADMIN_PASSWORD: '' } });
  const login = await call(s, 'POST', '/api/admin/login', { json: { password: 'test-shared-admin-password' } });
  assert.equal(login.status, 410); assert.match(login.body.error, /أُلغي/);
  const oldSharedSession = sessionCookie('admin'); /* كوكي بحساب legacy/env كالذي أصدره الدخول المشترك */
  assert.equal((await call(s, 'GET', '/api/admin/users', { cookie: oldSharedSession })).status, 403);
  assert.equal((await call(s, 'GET', '/api/session', { cookie: oldSharedSession })).body.authenticated, false);
  const sharedReader = await call(s, 'GET', '/api/session', { cookie: sessionCookie('reader') });
  assert.equal(sharedReader.body.authenticated, true, 'كلمة دخول القراء المشتركة لا تتأثر');
  await s.seedUser(SECOND, 'admin');
  const list = await call(s, 'GET', '/api/admin/users', { cookie: sessionCookie('admin', SECOND) });
  assert.equal(list.status, 200, 'حساب المدير الفردي يعمل'); assert.equal(list.body.sharedAdminEnabled, false);
});

test('الإقلاع في وضع production لا يشترط كلمة الإدارة المشتركة', { skip }, async () => {
  const s = await start({ env: { NODE_ENV: 'production', LIBRARY_ACCESS_PASSWORD: 'reader-access-password-for-test', LIBRARY_ADMIN_PASSWORD: '' } });
  const health = await fetch(s.base + '/api/health');
  assert.equal(health.status, 200);
});

test('مدير الطوارئ: يُنشأ عند الإقلاع ويظهر موسومًا ولا يُخفَّض ولا يُوقَف ولا يُحذف', { skip }, async () => {
  const s = await start({ env: { LIBRARY_ADMIN_PASSWORD: '', LIBRARY_BOOTSTRAP_ADMIN_EMAIL: '  ' + BOOT.toUpperCase() + ' ' } });
  const doc = await userDoc(s, BOOT);
  assert.ok(doc); assert.deepEqual([doc.role, doc.active, doc.accountStatus, doc.createdBy], ['admin', true, 'active', 'bootstrap']);
  const made = await audits(s, 'bootstrap_admin_ensured');
  assert.equal(made.length, 1); assert.equal(made[0].details.created, true); assert.equal(made[0].actor, 'bootstrap');
  await s.seedUser(SECOND, 'admin'); await s.seedUser(READER, 'reader');
  const other = sessionCookie('admin', SECOND);
  const list = await call(s, 'GET', '/api/admin/users', { cookie: other });
  assert.equal(list.body.users.find(u => u.email === BOOT).bootstrap, true);
  assert.equal(list.body.users.find(u => u.email === READER).bootstrap, false);
  const demote = await call(s, 'POST', '/api/admin/users/role', { cookie: other, json: { email: BOOT, role: 'reader' } });
  assert.equal(demote.status, 409); assert.match(demote.body.error, /LIBRARY_BOOTSTRAP_ADMIN_EMAIL/);
  assert.equal((await call(s, 'POST', '/api/admin/users/status', { cookie: other, json: { email: BOOT, action: 'suspend' } })).status, 409);
  assert.equal((await call(s, 'POST', '/api/admin/users/status', { cookie: other, json: { email: BOOT, action: 'permanent' } })).status, 409);
  const del = await call(s, 'POST', '/api/admin/users/delete', { cookie: other, json: { email: BOOT, confirmEmail: BOOT } });
  assert.equal(del.status, 409); assert.match(del.body.error, /حساب الطوارئ/);
  assert.deepEqual((({ role, active }) => [role, active])(await userDoc(s, BOOT)), ['admin', true], 'لم يتغير شيء');
  assert.equal((await call(s, 'POST', '/api/admin/users/role', { cookie: other, json: { email: READER, role: 'admin' } })).status, 200, 'غيره يُدار كالمعتاد');
});

test('الاسترجاع: حساب موقوف نهائيًا أو محذوف يُعاد مديرًا فعّالًا، ولا شيء إن كان سليمًا', { skip }, async () => {
  const dbName = 'qalam_lib_bootstrap_' + Math.random().toString(36).slice(2, 8);
  const first = await start({ dbName });
  await first.mongo(db => db.collection('libraryUsers').updateOne({ email: BOOT }, { $set: { email: BOOT, role: 'reader', active: false, accountStatus: 'permanent' } }, { upsert: true }));
  await first.stop();
  const env = { LIBRARY_ADMIN_PASSWORD: '', LIBRARY_BOOTSTRAP_ADMIN_EMAIL: BOOT };
  const second = await start({ dbName, env });
  const restored = await userDoc(second, BOOT);
  assert.deepEqual([restored.role, restored.active, restored.accountStatus], ['admin', true, 'active']);
  const events = await audits(second, 'bootstrap_admin_ensured');
  assert.equal(events.length, 1); assert.equal(events[0].details.created, false); assert.deepEqual(events[0].details.from, { role: 'reader', active: false, accountStatus: 'permanent' });
  await second.stop();
  const third = await start({ dbName, env });
  assert.equal((await audits(third, 'bootstrap_admin_ensured')).length, 1, 'إقلاع ثالث بلا تغيير: لا تدقيق جديد');
  await third.mongo(db => db.collection('libraryUsers').deleteOne({ email: BOOT }));
  await third.stop();
  const fourth = await start({ dbName, env });
  assert.equal((await userDoc(fourth, BOOT)).role, 'admin', 'يُعاد إنشاؤه إن حُذف');
  assert.equal((await audits(fourth, 'bootstrap_admin_ensured')).length, 2);
});

test('بريد طوارئ غير صالح يُهمل والخادم يعمل', { skip }, async () => {
  const s = await start({ env: { LIBRARY_ADMIN_PASSWORD: '', LIBRARY_BOOTSTRAP_ADMIN_EMAIL: 'not-an-email' } });
  assert.equal((await fetch(s.base + '/api/health')).status, 200);
  assert.equal(await s.mongo(db => db.collection('libraryUsers').countDocuments({})), 0);
});
