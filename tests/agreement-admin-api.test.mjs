/* مسار تعديل الاتفاقيات للمدير: صلاحية وتحقق ومنع الاستعمال العشوائي. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
const ADMIN = 'agr.admin@example.com', READER = 'agr.reader@example.com';
let server;
const post = (cookie, json) => fetch(server.base + '/api/admin/agreements/item', { method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(json) }).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));
before(async () => { if (skip) return; server = await bootServer(); await server.seedUser(ADMIN, 'admin'); await server.seedUser(READER, 'reader'); });
after(async () => { if (server) await server.stop(); });

test('للمدير وحده، ويرفض الطلب غير الصالح', { skip }, async () => {
  assert.equal((await post(undefined, { treatyId: '1', action: 'hide' })).status, 403);
  assert.equal((await post(sessionCookie('reader', READER), { treatyId: '1', action: 'hide' })).status, 403);
  const admin = sessionCookie('admin', ADMIN);
  assert.equal((await post(admin, { treatyId: 'abc', action: 'hide' })).status, 400);
  assert.equal((await post(admin, { treatyId: '1', action: 'drop' })).status, 400);
  assert.ok([404, 503].includes((await post(admin, { treatyId: '999999999', action: 'hide' })).status), 'اتفاقية غير موجودة أو Drive غير متاح');
  const restore = await post(admin, { treatyId: '999999999', action: 'restore' });
  assert.equal(restore.status, 200); assert.equal(restore.body.restored, false);
});
