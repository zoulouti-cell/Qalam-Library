/* استعادة كلمة المرور في المكتبة: طلب بالبريد، رابط بالرمز بعد #، تعيين كلمة جديدة، وإسقاط الجلسات القديمة.
   خادم Brevo وهمي يلتقط الرسائل (BREVO_API_URL مسموح خارج الإنتاج فقط). */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';
import { hashPassword } from '../src/admin-store.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
const OLD = 'old-password-12345', NEW = 'brand-new-password-678';
const sha = value => createHash('sha256').update(value).digest('hex');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const sink = { sent: [], status: 201 };
const brevo = http.createServer((req, res) => {
  let raw = ''; req.on('data', chunk => { raw += chunk; });
  req.on('end', () => { if (sink.status < 300) sink.sent.push(JSON.parse(raw)); res.writeHead(sink.status, { 'content-type': 'application/json' }); res.end('{"messageId":"test"}'); });
});
await new Promise(resolve => brevo.listen(0, '127.0.0.1', resolve));
const BREVO_URL = `http://127.0.0.1:${brevo.address().port}/v3/smtp/email`;
const MAIL_ENV = { BREVO_API_KEY: 'test-key', BREVO_SENDER_EMAIL: 'library@example.com', BREVO_API_URL: BREVO_URL, LIBRARY_PUBLIC_URL: 'http://127.0.0.1:9', LIBRARY_ACCESS_PASSWORD: 'reader-access-password-for-test', QALAM_TRUST_PROXY: '1' };

const servers = [];
const start = async env => { const server = await bootServer({ env: { ...MAIL_ENV, ...env } }); servers.push(server); return server; };
after(async () => { for (const server of servers) await server.stop().catch(() => {}); brevo.close(); brevo.closeAllConnections?.(); });

let ipCounter = 0;
const freshIp = () => `10.20.${Math.floor(++ipCounter / 250)}.${ipCounter % 250 + 1}`;
async function post(server, path, json, { ip = freshIp(), cookie, headers = {} } = {}) {
  const response = await fetch(server.base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}), ...headers }, body: JSON.stringify(json) });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, body: type.includes('json') ? await response.json() : null, setCookie: response.headers.get('set-cookie') || '' };
}
const request = (server, email, options) => post(server, '/api/password-reset/request', { email }, options);
const confirm = (server, token, password, options) => post(server, '/api/password-reset/confirm', { token, password }, options);
const seedGoogleOnly = (server, email) => server.mongo(db => db.collection('libraryUsers').updateOne({ email }, { $set: { email, role: 'reader', active: true, accountStatus: 'active', mustChangePassword: false, googleSub: 'sub-' + email } }, { upsert: true }));
const seedWithPassword = async (server, email, fields = {}) => { const saved = hashPassword(OLD); await server.mongo(db => db.collection('libraryUsers').updateOne({ email }, { $set: { email, role: 'reader', active: true, accountStatus: 'active', mustChangePassword: false, passwordSalt: saved.salt, passwordHash: saved.hash, ...fields } }, { upsert: true })); };
const userDoc = (server, email) => server.mongo(db => db.collection('libraryUsers').findOne({ email }));
const login = (server, email, password) => post(server, '/api/login', { email, password });
const tokenFrom = message => { const match = /#token=([A-Za-z0-9_-]{43})/.exec(message.htmlContent || message.textContent || ''); assert.ok(match, 'الرابط في الرسالة'); return match[1]; };
async function mailTo(email, { since = 0, wait = 3000 } = {}) {
  const until = Date.now() + wait;
  while (Date.now() < until) { const found = sink.sent.slice(since).find(message => message.to?.[0]?.email === email); if (found) return found; await sleep(50); }
  return null;
}
const resetMail = async (email, since) => { const message = await mailTo(email, { since }); assert.ok(message, 'وصلت رسالة الاستعادة إلى ' + email); return message; };

test('بلا بريد مهيأ: الطلب 503 برسالة صريحة ولا يُنشأ رمز', { skip }, async () => {
  const server = await start({ BREVO_API_KEY: '' });
  await seedWithPassword(server, 'nomail@example.com');
  const response = await request(server, 'nomail@example.com');
  assert.equal(response.status, 503);
  assert.match(response.body.error, /البريد/);
  assert.equal((await userDoc(server, 'nomail@example.com')).resetTokenHash, undefined);
});

test('الطلب: جواب عام لحساب موجود وغير موجود، ورابط الرمز بعد # وبصمته فقط في القاعدة', { skip }, async () => {
  const server = await start();
  await seedWithPassword(server, 'reader@example.com');
  const before = sink.sent.length;
  const known = await request(server, 'Reader@Example.com'), unknown = await request(server, 'nobody@example.com');
  assert.equal(known.status, 200); assert.equal(unknown.status, 200);
  assert.deepEqual(known.body, unknown.body, 'الجواب نفسه فلا يُكشف وجود حساب');
  const message = await resetMail('reader@example.com', before);
  assert.match(message.subject, /استعادة كلمة المرور/);
  const text = message.htmlContent || '', token = tokenFrom(message);
  assert.ok(text.includes('http://127.0.0.1:9/reset-password#token='), 'الرمز في الجزء بعد #');
  assert.ok(!/[?&]token=/.test(text), 'لا رمز في الاستعلام');
  const user = await userDoc(server, 'reader@example.com');
  assert.equal(user.resetTokenHash, sha(token));
  assert.ok(!JSON.stringify(user).includes(token), 'الرمز الصريح لا يُخزَّن');
  assert.ok(user.resetExpiresAt.getTime() - Date.now() <= 30 * 60_000 && user.resetExpiresAt.getTime() - Date.now() > 29 * 60_000, 'صلاحية 30 دقيقة');
  await sleep(300);
  assert.equal(sink.sent.slice(before).filter(item => item.to?.[0]?.email === 'nobody@example.com').length, 0, 'لا بريد لحساب غير موجود');
  assert.equal((await request(server, 'ليس بريدا')).status, 400);
  assert.equal((await request(server, '')).status, 400);
});

test('لا رسالة لحساب غير مؤهل: معلّق، موقوف، نهائي الحذف، أو بلا كلمة مرور (دخول Google فقط)', { skip }, async () => {
  const server = await start();
  await seedWithPassword(server, 'pending@example.com', { active: false, accountStatus: 'pending' });
  await seedWithPassword(server, 'disabled@example.com', { active: false });
  await seedWithPassword(server, 'permanent@example.com', { active: false, accountStatus: 'permanent' });
  await seedGoogleOnly(server, 'google-only@example.com');
  const before = sink.sent.length;
  for (const email of ['pending@example.com', 'disabled@example.com', 'permanent@example.com', 'google-only@example.com']) assert.equal((await request(server, email)).status, 200);
  await sleep(500);
  assert.equal(sink.sent.length, before);
  for (const email of ['pending@example.com', 'disabled@example.com', 'permanent@example.com', 'google-only@example.com']) assert.equal((await userDoc(server, email)).resetTokenHash, undefined);
});

test('التعيين: كلمة قصيرة لا تحرق الرمز، ثم نجاح، والكلمة القديمة تسقط والجديدة تدخل، والرمز يُستعمل مرة واحدة', { skip }, async () => {
  const server = await start();
  const email = 'flow@example.com';
  await seedWithPassword(server, email, { mustChangePassword: true });
  assert.equal((await login(server, email, OLD)).status, 200, 'الكلمة القديمة تعمل قبل الاستعادة');
  let mark = sink.sent.length;
  await request(server, email);
  const token = tokenFrom(await resetMail(email, mark));
  assert.equal((await confirm(server, token, 'short')).status, 400, 'كلمة قصيرة');
  assert.equal((await confirm(server, 'x'.repeat(43) + 'ignored', NEW)).status, 400, 'رمز مشوّه');
  assert.ok((await userDoc(server, email)).resetTokenHash, 'الرمز بقي صالحًا بعد الرفض المبكر');
  mark = sink.sent.length;
  const done = await confirm(server, token, NEW);
  assert.equal(done.status, 200); assert.match(done.body.message, /تم تغيير كلمة المرور/);
  const user = await userDoc(server, email);
  assert.equal(user.resetTokenHash, undefined); assert.equal(user.resetExpiresAt, undefined);
  assert.equal(user.mustChangePassword, false, 'كلمة مؤقتة لم تعد مطلوبة');
  assert.ok(user.passwordChangedAt instanceof Date);
  assert.equal((await login(server, email, OLD)).status, 401, 'الكلمة القديمة سقطت');
  assert.equal((await login(server, email, NEW)).status, 200, 'الكلمة الجديدة تدخل');
  assert.equal((await confirm(server, token, 'another-password-1234')).status, 400, 'الرمز استُعمل');
  const notice = await mailTo(email, { since: mark });
  assert.ok(notice && /تم تغيير كلمة المرور/.test(notice.subject), 'إشعار تغيير كلمة المرور');
  assert.ok(notice.htmlContent && !notice.htmlContent.includes(token) && !notice.htmlContent.includes(NEW), 'الإشعار لا يحمل رمزًا ولا كلمة');
  const audit = await server.mongo(db => db.collection('adminAudit').find({ target: email }).toArray());
  const actions = audit.map(item => item.action);
  assert.ok(actions.includes('password_reset_requested') && actions.includes('password_reset'), 'التدقيق: ' + actions);
});

test('رمز منتهٍ أو لحساب أُوقف بعد الطلب: يُرفض', { skip }, async () => {
  const server = await start();
  await seedWithPassword(server, 'late@example.com'); await seedWithPassword(server, 'banned@example.com');
  const mark = sink.sent.length;
  await request(server, 'late@example.com'); await request(server, 'banned@example.com');
  const lateToken = tokenFrom(await resetMail('late@example.com', mark)), bannedToken = tokenFrom(await resetMail('banned@example.com', mark));
  await server.mongo(db => db.collection('libraryUsers').updateOne({ email: 'late@example.com' }, { $set: { resetExpiresAt: new Date(Date.now() - 1000) } }));
  await server.mongo(db => db.collection('libraryUsers').updateOne({ email: 'banned@example.com' }, { $set: { active: false } }));
  assert.equal((await confirm(server, lateToken, NEW)).status, 400, 'منتهٍ');
  assert.equal((await confirm(server, bannedToken, NEW)).status, 400, 'موقوف');
  assert.equal((await login(server, 'late@example.com', OLD)).status, 200, 'لم تتغير كلمة المرور');
});

test('الجلسات الصادرة قبل الاستعادة تسقط في كل المسارات، والصادرة بعدها تعمل', { skip }, async () => {
  const server = await start();
  const email = 'sessions@example.com';
  await seedWithPassword(server, email);
  const stolen = sessionCookie('reader', email);
  const session = async cookie => (await fetch(server.base + '/api/session', { headers: { cookie } })).json();
  assert.equal((await session(stolen)).authenticated, true, 'الجلسة تعمل قبل التغيير');
  const mark = sink.sent.length;
  await request(server, email);
  const token = tokenFrom(await resetMail(email, mark));
  assert.equal((await session(stolen)).authenticated, true, 'طلب الاستعادة وحده لا يُسقط الجلسة');
  assert.equal((await confirm(server, token, NEW)).status, 200);
  const after = await fetch(server.base + '/api/session', { headers: { cookie: stolen } });
  assert.equal((await after.json()).authenticated, false, 'سقطت الجلسة القديمة');
  assert.match(after.headers.get('set-cookie') || '', /qalam_session=;.*Max-Age=0/, 'يُمسح كوكيها من المتصفح');
  const hijack = await post(server, '/api/change-password', { password: 'attacker-chosen-password' }, { cookie: stolen });
  assert.ok([401, 403].includes(hijack.status), 'الجلسة القديمة لا تغيّر كلمة المرور: ' + hijack.status);
  assert.equal((await login(server, email, NEW)).status, 200, 'كلمة المرور لم يغيّرها المهاجم');
  const profile = await fetch(server.base + '/api/account/profile', { headers: { cookie: stolen } });
  assert.equal(profile.status, 401, 'ولا يقرأ الملف الشخصي');
  const fresh = await login(server, email, NEW);
  const cookie = fresh.setCookie.split(';')[0];
  assert.equal((await session(cookie)).authenticated, true, 'جلسة ما بعد الاستعادة تعمل');
  assert.equal((await fetch(server.base + '/api/account/profile', { headers: { cookie } })).status, 200);
});

test('فاصل 60 ثانية بين رسالتين، وثلاث رسائل في الساعة لكل حساب، دون إبطال الرمز الصالح', { skip }, async () => {
  const server = await start();
  const email = 'limits@example.com';
  await seedWithPassword(server, email);
  const mark = sink.sent.length;
  await request(server, email);
  const first = tokenFrom(await resetMail(email, mark));
  await request(server, email); await sleep(400);
  assert.equal(sink.sent.slice(mark).filter(item => item.to?.[0]?.email === email).length, 1, 'الفاصل: رسالة واحدة');
  assert.equal((await userDoc(server, email)).resetTokenHash, sha(first), 'الرمز الأول لم يُستبدل');
  for (let round = 2; round <= 4; round++) {
    await server.mongo(db => db.collection('libraryUsers').updateOne({ email }, { $set: { resetRequestedAt: new Date(Date.now() - 120_000) } }));
    const before = sink.sent.length;
    await request(server, email); await sleep(round === 4 ? 500 : 150);
    const got = sink.sent.slice(before).filter(item => item.to?.[0]?.email === email).length;
    assert.equal(got, round <= 3 ? 1 : 0, 'الطلب رقم ' + round + ' من الساعة');
  }
});

test('حد العنوان: سادس طلب يمرّ والسابع 429', { skip }, async () => {
  const server = await start();
  const ip = '203.0.113.7';
  for (let i = 0; i < 6; i++) assert.equal((await request(server, `nobody${i}@example.com`, { ip })).status, 200, 'طلب ' + (i + 1));
  assert.equal((await request(server, 'nobody7@example.com', { ip })).status, 429);
  assert.equal((await request(server, 'nobody8@example.com', { ip: '203.0.113.8' })).status, 200, 'عنوان آخر غير متأثر');
});

test('قفل المحاولات الفاشلة: بعد عشر محاولات برموز خاطئة يُحجب العنوان حتى عن رمز صالح', { skip }, async () => {
  const server = await start();
  const email = 'locked@example.com', ip = '203.0.113.50';
  await seedWithPassword(server, email);
  const mark = sink.sent.length;
  await request(server, email);
  const token = tokenFrom(await resetMail(email, mark));
  for (let i = 0; i < 10; i++) assert.equal((await confirm(server, String(i).repeat(43), NEW, { ip })).status, 400);
  assert.equal((await confirm(server, token, NEW, { ip })).status, 429, 'العنوان المحجوب');
  assert.equal((await confirm(server, token, NEW, { ip: '203.0.113.51' })).status, 200, 'صاحب الرابط من عنوان آخر ينجح');
});

test('فشل إرسال البريد: جواب عام ويُحذف الرمز', { skip }, async () => {
  const server = await start();
  const email = 'fail@example.com';
  await seedWithPassword(server, email);
  sink.status = 500;
  try {
    assert.equal((await request(server, email)).status, 200);
    for (let i = 0; i < 40 && (await userDoc(server, email)).resetTokenHash; i++) await sleep(100);
  } finally { sink.status = 201; }
  const user = await userDoc(server, email);
  assert.equal(user.resetTokenHash, undefined, 'لا رمز عالق بلا رسالة');
  assert.equal(user.resetExpiresAt, undefined);
});

test('الصفحات العامة في الإنتاج بلا جلسة: نسيت كلمة المرور وكلمة مرور جديدة، ورابط في صفحة الدخول', { skip }, async () => {
  const server = await start({ NODE_ENV: 'production', LIBRARY_ADMIN_PASSWORD: '' });
  for (const [path, needle] of [['/forgot-password', 'forgotForm'], ['/forgot-password.html', 'forgotForm'], ['/reset-password', 'resetForm'], ['/reset-password.html', 'resetForm'], ['/login', 'href="/forgot-password"']]) {
    const response = await fetch(server.base + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/, path);
    assert.ok((await response.text()).includes(needle), path + ' يحوي ' + needle);
  }
  for (const path of ['/forgot-password.js', '/reset-password.js']) { const response = await fetch(server.base + path); assert.equal(response.status, 200, path); assert.match(response.headers.get('content-type'), /javascript/); }
  const reset = await (await fetch(server.base + '/reset-password.js')).text();
  assert.ok(reset.includes('location.hash') && reset.includes('replaceState'), 'الرمز يُقرأ من # ويُزال من العنوان');
});
