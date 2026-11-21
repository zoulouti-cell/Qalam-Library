/* وضع «عرض كقارئ»: المدير يرى المكتبة بعين القارئ فعلًا (على الخادم)، دون إنشاء حساب، ودون أي صلاحية إضافية. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
const ADMIN = 'view.admin@example.com', READER = 'view.reader@example.com';
let server;

async function call(method, path, { cookie, json } = {}) {
  const init = { method, headers: { ...(cookie ? { cookie } : {}) } };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] = 'application/json'; }
  const r = await fetch(server.base + path, init), type = r.headers.get('content-type') || '';
  return { status: r.status, setCookie: r.headers.getSetCookie?.() || [], body: type.includes('json') ? await r.json() : null };
}
const pair = setCookie => setCookie.map(c => c.split(';')[0]).filter(c => !/=$/.test(c)).join('; ');

before(async () => { if (skip) return; server = await bootServer(); await server.seedUser(ADMIN, 'admin'); await server.seedUser(READER, 'reader'); });
after(async () => { if (server) await server.stop(); });

test('المدير يدخل وضع القارئ فيفقد الخادم أدوات الإدارة عن جلسته، ويعود بنقرة', { skip }, async () => {
  const admin = sessionCookie('admin', ADMIN);
  const before = await call('GET', '/api/session', { cookie: admin });
  assert.equal(before.body.canAdmin, true); assert.equal(before.body.canToggleReader, true); assert.equal(before.body.viewAsReader, false);
  assert.equal((await call('GET', '/api/admin/users', { cookie: admin })).status, 200);

  const on = await call('POST', '/api/view-as', { cookie: admin, json: { mode: 'reader' } });
  assert.equal(on.status, 200); assert.equal(on.body.viewAsReader, true);
  const viewing = admin + '; ' + pair(on.setCookie);
  const s = await call('GET', '/api/session', { cookie: viewing });
  assert.equal(s.body.canAdmin, false, 'لا صلاحية إدارة في وضع القارئ'); assert.equal(s.body.role, 'reader'); assert.equal(s.body.viewAsReader, true); assert.equal(s.body.canToggleReader, true, 'يبقى زر العودة');
  assert.equal((await call('GET', '/api/admin/users', { cookie: viewing })).status, 403, 'المسارات الإدارية ترفضه كأي قارئ');
  assert.equal((await call('POST', '/api/admin/legal-monitor/items/action', { cookie: viewing, json: { id: 'x', action: 'delete' } })).status, 403);

  const off = await call('POST', '/api/view-as', { cookie: viewing, json: { mode: 'admin' } });
  assert.equal(off.status, 200); assert.equal(off.body.viewAsReader, false);
  assert.equal((await call('GET', '/api/admin/users', { cookie: admin })).status, 200, 'العودة إلى المدير دون إعادة تسجيل الدخول');
  const audit = await server.mongo(db => db.collection('adminAudit').find({ action: { $in: ['view_as_reader_on', 'view_as_reader_off'] } }).toArray());
  assert.equal(audit.length, 2);
});

test('لا يرفع الوضع صلاحية أحد: القارئ والزائر مرفوضان، ووسم قديم لا يسري على جلسة جديدة', { skip }, async () => {
  const reader = sessionCookie('reader', READER);
  assert.equal((await call('POST', '/api/view-as', { cookie: reader, json: { mode: 'reader' } })).status, 403);
  assert.equal((await call('POST', '/api/view-as', { json: { mode: 'reader' } })).status, 403);
  assert.equal((await call('GET', '/api/session', { cookie: reader })).body.canToggleReader, false, 'لا يرى القارئ زر الوضع');
  const admin = sessionCookie('admin', ADMIN);
  const on = await call('POST', '/api/view-as', { cookie: admin, json: { mode: 'reader' } });
  const forged = 'qalam_view=' + 'a'.repeat(24);
  assert.equal((await call('GET', '/api/session', { cookie: admin + '; ' + forged })).body.canAdmin, true, 'وسم مزوَّر لا أثر له');
  await new Promise(r => setTimeout(r, 15));
  const newer = sessionCookie('admin', ADMIN), stale = pair(on.setCookie);
  assert.notEqual(newer, admin, 'جلسة جديدة بتوقيع مختلف');
  assert.equal((await call('GET', '/api/session', { cookie: newer + '; ' + stale })).body.canAdmin, true, 'الوسم مربوط ببصمة الجلسة القديمة فلا يسري على الجديدة');
});
