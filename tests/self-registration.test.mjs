/* التسجيل الذاتي بموافقة المدير: بريد وكلمة مرور ← تأكيد البريد ← «جاري تفعيل حسابكم» ← قرار الإدارة (قارئ/مدير/رفض). */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
const PASSWORD = 'registration-password-123', OWNER = 'owner@example.com';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const sink = { sent: [] };
const brevo = http.createServer((req, res) => {
  let raw = ''; req.on('data', chunk => { raw += chunk; });
  req.on('end', () => { sink.sent.push(JSON.parse(raw)); res.writeHead(201, { 'content-type': 'application/json' }); res.end('{"messageId":"test"}'); });
});
await new Promise(resolve => brevo.listen(0, '127.0.0.1', resolve));
const ENV = { BREVO_API_KEY: 'test-key', BREVO_SENDER_EMAIL: 'library@example.com', BREVO_API_URL: `http://127.0.0.1:${brevo.address().port}/v3/smtp/email`, LIBRARY_PUBLIC_URL: 'http://127.0.0.1:9', LIBRARY_OWNER_EMAIL: OWNER, LIBRARY_ACCESS_PASSWORD: 'reader-access-password-for-test', QALAM_TRUST_PROXY: '1' };

let server;
const getServer = async () => server || (server = await bootServer({ env: ENV }));
after(async () => { if (server) await server.stop().catch(() => {}); brevo.close(); brevo.closeAllConnections?.(); });

let ipCounter = 0;
const freshIp = () => `10.30.${Math.floor(++ipCounter / 250)}.${ipCounter % 250 + 1}`;
async function post(path, json, { cookie, ip = freshIp() } = {}) {
  const response = await fetch((await getServer()).base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(json) });
  const type = response.headers.get('content-type') || '';
  return { status: response.status, body: type.includes('json') ? await response.json() : null };
}
const get = async (path, cookie) => { const response = await fetch((await getServer()).base + path, { headers: { 'x-forwarded-for': freshIp(), ...(cookie ? { cookie } : {}) } }); return { status: response.status, body: await response.json().catch(() => null) }; };
const userDoc = async email => (await getServer()).mongo(db => db.collection('libraryUsers').findOne({ email }));
const admin = sessionCookie('admin');
async function mailTo(email, { since = 0, wait = 3000, match } = {}) {
  const until = Date.now() + wait;
  while (Date.now() < until) { const found = sink.sent.slice(since).find(message => message.to?.[0]?.email === email && (!match || match.test(message.subject))); if (found) return found; await sleep(50); }
  return null;
}
const tokenFrom = message => { const found = /#token=([A-Za-z0-9_-]{43})/.exec(message.htmlContent || message.textContent || ''); assert.ok(found, 'رابط التأكيد في الرسالة'); return found[1]; };
async function registerAndConfirm(email) {
  const since = sink.sent.length;
  assert.equal((await post('/api/register', { email, password: PASSWORD })).status, 200);
  const mail = await mailTo(email, { since });
  assert.ok(mail, 'وصلت رسالة التأكيد');
  const confirmed = await post('/api/register/confirm', { token: tokenFrom(mail) });
  assert.equal(confirmed.status, 200); assert.equal(confirmed.body.state, 'review');
}

test('التسجيل: يتحقق من البريد وكلمة المرور، ولا يفتح المكتبة قبل تأكيد البريد', { skip }, async () => {
  const email = 'new.member@example.com';
  assert.equal((await post('/api/register', { email: 'not-an-email', password: PASSWORD })).status, 400);
  assert.equal((await post('/api/register', { email, password: 'short' })).status, 400);
  const since = sink.sent.length;
  const created = await post('/api/register', { email, password: PASSWORD });
  assert.equal(created.status, 200); assert.match(created.body.message, /تأكيد/);
  const user = await userDoc(email);
  assert.equal(user.accountStatus, 'unconfirmed'); assert.equal(user.active, false); assert.equal(user.role, 'reader');
  assert.ok(user.passwordHash && !JSON.stringify(user).includes(PASSWORD), 'كلمة المرور مجزّأة');
  const mail = await mailTo(email, { since });
  assert.ok(mail, 'رسالة التأكيد وصلت'); assert.match(mail.htmlContent, /confirm-registration#token=/);
  assert.equal(sink.sent.slice(since).filter(message => message.to?.[0]?.email === OWNER).length, 0, 'لا إشعار للمالك قبل تأكيد البريد');
  const attempt = await post('/api/login', { email, password: PASSWORD });
  assert.equal(attempt.status, 403); assert.equal(attempt.body.state, 'unconfirmed');
});

test('تأكيد البريد: يُدخل الطلب مرحلة المراجعة مرة واحدة، ويُشعَر المالك، ويظهر «جاري التفعيل» عند الدخول', { skip }, async () => {
  const email = 'confirmed.member@example.com', since = sink.sent.length;
  assert.equal((await post('/api/register/confirm', { token: 'x'.repeat(43) })).status, 400);
  assert.equal((await post('/api/register', { email, password: PASSWORD })).status, 200);
  const token = tokenFrom(await mailTo(email, { since }));
  assert.equal((await post('/api/register/confirm', { token })).body.state, 'review');
  assert.equal((await post('/api/register/confirm', { token })).status, 400, 'الرمز يُستعمل مرة واحدة');
  const notice = await mailTo(OWNER, { since, match: /بانتظار قرارك/ });
  assert.ok(notice, 'وصل المالك إشعار الطلب بعد التأكيد'); assert.match(notice.htmlContent, /\/admin/);
  const pending = await post('/api/login', { email, password: PASSWORD });
  assert.equal(pending.status, 403); assert.equal(pending.body.state, 'review'); assert.match(pending.body.error, /جاري تفعيل حسابكم/);
  assert.ok((await userDoc(email)).firstReviewLoginAt, 'سُجّل أول دخول أثناء المراجعة');
  assert.equal((await post('/api/login', { email, password: 'wrong-password-123' })).status, 401);
  assert.equal((await get('/api/session')).body.authenticated, false);
});

test('إعادة التسجيل ببريد غير مؤكَّد تبطل الرابط القديم وتحترم فاصل الدقيقة', { skip }, async () => {
  const email = 'retry.member@example.com', since = sink.sent.length;
  await post('/api/register', { email, password: PASSWORD });
  const first = tokenFrom(await mailTo(email, { since }));
  await post('/api/register', { email, password: PASSWORD });
  assert.equal(sink.sent.slice(since).filter(message => message.to?.[0]?.email === email).length, 1, 'لا إرسال ثانٍ خلال دقيقة');
  await (await getServer()).mongo(db => db.collection('libraryUsers').updateOne({ email }, { $set: { confirmationSentAt: new Date(Date.now() - 120000) } }));
  await post('/api/register', { email, password: PASSWORD });
  const second = tokenFrom(await mailTo(email, { since: since + 1 }));
  assert.notEqual(first, second);
  assert.equal((await post('/api/register/confirm', { token: first })).status, 400, 'الرابط القديم لا يعمل');
  assert.equal((await post('/api/register/confirm', { token: second })).status, 200);
  await (await getServer()).mongo(db => db.collection('libraryUsers').updateOne({ email: 'expired.member@example.com' }, { $set: { email: 'expired.member@example.com', accountStatus: 'unconfirmed', active: false, activationTokenHash: 'a'.repeat(64), activationExpiresAt: new Date(Date.now() - 1000) } }, { upsert: true }));
  assert.equal((await post('/api/register/confirm', { token: 'b'.repeat(43) })).status, 400);
});

test('القرار: للمدير فقط، والقبول كقارئ يفتح الدخول ويرسل رسالة الترحيب', { skip }, async () => {
  const email = 'approved.reader@example.com';
  await registerAndConfirm(email);
  await (await getServer()).seedUser('someone@example.com', 'reader');
  assert.equal((await post('/api/admin/users/decision', { email, decision: 'reader' }, { cookie: sessionCookie('reader', 'someone@example.com') })).status, 403);
  assert.equal((await post('/api/admin/users/decision', { email, decision: 'owner' }, { cookie: admin })).status, 400);
  assert.equal((await post('/api/admin/users/decision', { email: 'nobody@example.com', decision: 'reader' }, { cookie: admin })).status, 404);
  const since = sink.sent.length;
  const approved = await post('/api/admin/users/decision', { email, decision: 'reader' }, { cookie: admin });
  assert.equal(approved.status, 200); assert.equal(approved.body.mailSent, true);
  const welcome = await mailTo(email, { since });
  assert.ok(welcome); assert.match(welcome.subject, /مرحباً بكم/); assert.match(welcome.htmlContent, /Bienvenue/); assert.match(welcome.htmlContent, /جولة مفيدة وممتعة بين رفوفها/);
  assert.doesNotMatch(welcome.htmlContent, /صلاحية الإدارة/);
  const user = await userDoc(email);
  assert.deepEqual([user.accountStatus, user.active, user.role], ['active', true, 'reader']);
  const entered = await post('/api/login', { email, password: PASSWORD });
  assert.equal(entered.status, 200); assert.equal(entered.body.role, 'reader');
  assert.equal((await post('/api/admin/users/decision', { email, decision: 'reject' }, { cookie: admin })).status, 409, 'لا قرار على حساب فعّال');
  const audit = await (await getServer()).mongo(db => db.collection('adminAudit').find({ action: 'registration_approved', target: email }).toArray());
  assert.equal(audit.length, 1); assert.equal(audit[0].details.role, 'reader');
});

test('التفعيل المباشر: المدير يفعّل حساباً لم يؤكد بريده، ويبطل رابط التأكيد', { skip }, async () => {
  const email = 'unconfirmed.direct@example.com', since = sink.sent.length;
  assert.equal((await post('/api/register', { email, password: PASSWORD })).status, 200);
  const token = tokenFrom(await mailTo(email, { since }));
  assert.equal((await userDoc(email)).accountStatus, 'unconfirmed');
  const approved = await post('/api/admin/users/decision', { email, decision: 'reader' }, { cookie: admin });
  assert.equal(approved.status, 200);
  const user = await userDoc(email);
  assert.deepEqual([user.accountStatus, user.active, user.role, user.emailConfirmedBy], ['active', true, 'reader', 'admin']);
  assert.ok(!user.activationTokenHash, 'لا يبقى رابط تأكيد صالح');
  assert.equal((await post('/api/register/confirm', { token })).status, 400);
  assert.equal((await post('/api/login', { email, password: PASSWORD })).status, 200);
});

test('القبول كمدير يمنح الدور ويضيف سطر صلاحية الإدارة', { skip }, async () => {
  const email = 'approved.admin@example.com';
  await registerAndConfirm(email);
  const since = sink.sent.length;
  assert.equal((await post('/api/admin/users/decision', { email, decision: 'admin' }, { cookie: admin })).body.role, 'admin');
  assert.match((await mailTo(email, { since })).htmlContent, /صلاحية الإدارة/);
  assert.equal((await post('/api/login', { email, password: PASSWORD })).body.role, 'admin');
});

test('الرفض: رسالة الرفض، ومنع إعادة الطلب 7 أيام، وخانات التسجيل تعود برسالة، ورفع المنع من الإدارة', { skip }, async () => {
  const email = 'rejected.member@example.com';
  await registerAndConfirm(email);
  const since = sink.sent.length;
  const rejected = await post('/api/admin/users/decision', { email, decision: 'reject' }, { cookie: admin });
  assert.equal(rejected.status, 200); assert.equal(rejected.body.mailSent, true);
  const mail = await mailTo(email, { since });
  assert.ok(mail); assert.match(mail.subject, /بشأن طلب التسجيل/); assert.match(mail.htmlContent, /الاتصال بإدارة المنصة/);
  const user = await userDoc(email);
  assert.equal(user.accountStatus, 'rejected'); assert.equal(user.active, false);
  assert.ok(new Date(user.rejectedUntil).getTime() > Date.now() + 6 * 86400000, 'منع 7 أيام');
  const denied = await post('/api/login', { email, password: PASSWORD });
  assert.equal(denied.status, 403); assert.equal(denied.body.state, 'rejected'); assert.match(denied.body.error, /إدارة المنصة/);
  const again = await post('/api/register', { email, password: PASSWORD });
  assert.equal(again.status, 403); assert.equal(again.body.state, 'rejected');
  assert.equal((await post('/api/admin/users/decision', { email, decision: 'unblock' }, { cookie: admin })).status, 200);
  assert.equal(await userDoc(email), null);
  assert.equal((await post('/api/register', { email, password: PASSWORD })).status, 200, 'بعد رفع المنع يُقبل طلب جديد');
  assert.equal((await post('/api/admin/users/decision', { email: 'approved.reader@example.com', decision: 'unblock' }, { cookie: admin })).status, 409);
});

test('لوحة الإدارة: قائمة الطلبات بانتظار القرار وعددها', { skip }, async () => {
  const email = 'queue.member@example.com';
  await registerAndConfirm(email);
  const listing = await get('/api/admin/users', admin);
  assert.equal(listing.status, 200);
  assert.ok(listing.body.requests.some(request => request.email === email));
  assert.equal(listing.body.stats.review, listing.body.requests.length);
  await post('/api/admin/users/decision', { email, decision: 'reject' }, { cookie: admin });
  assert.ok(!(await get('/api/admin/users', admin)).body.requests.some(request => request.email === email));
});

test('الحساب الموجود فعّالًا لا يتأثر بالتسجيل، والجواب عام', { skip }, async () => {
  const email = 'existing.active@example.com', server = await getServer();
  await server.seedUser(email, 'reader');
  const before = await userDoc(email), since = sink.sent.length;
  const response = await post('/api/register', { email, password: PASSWORD });
  assert.equal(response.status, 200);
  await sleep(300);
  assert.equal(sink.sent.slice(since).filter(message => message.to?.[0]?.email === email).length, 0);
  const after = await userDoc(email);
  assert.deepEqual([after.accountStatus, after.active, after.passwordHash], [before.accountStatus, before.active, before.passwordHash]);
});
