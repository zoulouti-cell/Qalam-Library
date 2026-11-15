/* ترويسة HSTS: تُرسل في الإنتاج وعلى اتصال HTTPS فقط، ولا تُرسل على HTTP ولا في التطوير ولا في النسخة المكتبية المحلية. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer } from './fixtures/boot-server.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
const PRODUCTION = { NODE_ENV: 'production', LIBRARY_ACCESS_PASSWORD: 'reader-access-password-for-test', LIBRARY_ADMIN_PASSWORD: '' };
const servers = [];
const start = async env => { const s = await bootServer({ env }); servers.push(s); return s; };
after(async () => { for (const s of servers) await s.stop().catch(() => {}); });
const hsts = async (server, path, headers = {}) => (await fetch(server.base + path, { headers })).headers.get('strict-transport-security');

test('الإنتاج خلف وسيط HTTPS: HSTS لسنة بلا includeSubDomains ولا preload، على كل أنواع الردود', { skip }, async () => {
  const s = await start(PRODUCTION);
  const https = { 'x-forwarded-proto': 'https' };
  assert.equal(await hsts(s, '/api/health', https), 'max-age=31536000');
  assert.equal(await hsts(s, '/login', https), 'max-age=31536000', 'صفحة ثابتة');
  assert.equal(await hsts(s, '/api/no-such-route', https), 'max-age=31536000', 'خطأ 404/401 أيضًا');
  assert.equal(await hsts(s, '/api/health', { 'x-forwarded-proto': 'https, http' }), 'max-age=31536000', 'أول قيمة في سلسلة الوسطاء');
  const response = await fetch(s.base + '/api/health', { headers: https });
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', 'بقية ترويسات الأمان باقية');
  assert.ok(response.headers.get('content-security-policy'));
});

test('الإنتاج على HTTP صريح: لا HSTS', { skip }, async () => {
  const s = await start(PRODUCTION);
  assert.equal(await hsts(s, '/api/health'), null);
  assert.equal(await hsts(s, '/api/health', { 'x-forwarded-proto': 'http' }), null);
});

test('خارج الإنتاج وفي النسخة المكتبية المحلية: لا HSTS ولو ادّعى الطلب HTTPS', { skip }, async () => {
  const https = { 'x-forwarded-proto': 'https' };
  assert.equal(await hsts(await start({}), '/api/health', https), null, 'تطوير/اختبار');
  assert.equal(await hsts(await start({ ...PRODUCTION, QALAM_DESKTOP_MODE: '1' }), '/api/health', https), null, 'النسخة المكتبية');
});
