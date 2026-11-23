/* ربط Drive للكتابة بحساب المدير (OAuth): حساب الخدمة لا يملك مساحة تخزين، فتُرفع الأصول بحساب المدير المتصل. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, sessionCookie } from './fixtures/boot-server.mjs';
import { startFakeDrive, ROOT_ID } from './fixtures/fake-drive.mjs';

const MONGO = process.env.QALAM_TEST_MONGODB_URI;
const skip = MONGO ? false : 'QALAM_TEST_MONGODB_URI غير مضبوط';
import { beginGoogleLogin, googleLoginConfig } from '../src/google-login.mjs';
const USER = 'avocat@example.com', CLIENT_ID = 'test-client.apps.googleusercontent.com';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n' + 'x'.repeat(300));
let server, drive;
const userCookie = sessionCookie('reader', USER), adminCookie = sessionCookie('admin');

async function call(method, path, { cookie, json, raw, headers = {}, redirect = 'manual' } = {}) {
  const init = { method, redirect, headers: { ...(cookie ? { cookie } : {}), ...headers } };
  if (json !== undefined) { init.body = JSON.stringify(json); init.headers['content-type'] = 'application/json'; }
  if (raw !== undefined) { init.body = raw; init.headers['content-type'] = 'application/octet-stream'; }
  const r = await fetch(server.base + path, init);
  const type = r.headers.get('content-type') || '';
  return { status: r.status, headers: r.headers, location: r.headers.get('location') || '', body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}
/* يبدأ الربط كمدير ثم يعود من «Google» برمز تفويض ويُرجع استجابة الـcallback. */
async function connectFlow({ session = adminCookie, grant = {}, state } = {}) {
  const start = await call('GET', '/api/admin/drive/connect', { cookie: adminCookie });
  assert.equal(start.status, 302);
  const flowCookie = start.headers.get('set-cookie').split(';')[0], authUrl = new URL(start.location);
  const code = drive.issueCode(start.location, grant);
  const back = await call('GET', `/api/auth/google/callback?code=${code}&state=${encodeURIComponent(state ?? authUrl.searchParams.get('state'))}`, { cookie: `${session}; ${flowCookie}` });
  return { start, authUrl, back };
}
const linkDoc = () => server.mongo(db => db.collection('librarySettings').findOne({ _id: 'library' }, { projection: { driveWrite: 1 } }));
const upload = (cookie, bytes, name) => call('POST', '/api/contributions/file', { cookie, raw: bytes, headers: { 'x-file-name': encodeURIComponent(name) } });
async function publishedAddition(title) {
  const up = await upload(userCookie, Buffer.from('%PDF-1.4 ' + title + 'y'.repeat(300)), title + '.pdf');
  const add = await call('POST', '/api/contributions/addition', { cookie: userCookie, json: { kind: 'research', title, issuedAt: '01/02/2020', source: 'مجلة القانون', issuer: '', text: 'يتناول هذا البحث شروط اتفاق التحكيم وآثاره القانونية بين الأطراف. '.repeat(6), fileIds: [up.body.id], originalIds: [up.body.id] } });
  assert.equal(add.status, 201, JSON.stringify(add.body));
  const documentId = (await call('POST', '/api/admin/contributions/draft', { cookie: adminCookie, json: { id: add.body.id } })).body.documentId;
  const pub = await call('POST', '/api/admin/content/publish', { cookie: adminCookie, json: { documentId, confirmReviewed: true } });
  assert.equal(pub.status, 200, JSON.stringify(pub.body));
  return { documentId, pub: pub.body };
}

before(async () => {
  if (skip) return;
  /* serviceQuota: يحاكي حساب الخدمة الحقيقي الذي يرفضه Google بسبب انعدام مساحة التخزين */
  drive = await startFakeDrive({ serviceQuota: true });
  server = await bootServer({ env: { NODE_ENV: 'test', QALAM_TEST_GOOGLE_ORIGIN: drive.origin, GOOGLE_SERVICE_ACCOUNT_JSON: drive.serviceAccountJson, DRIVE_ROOT_FOLDER_ID: ROOT_ID, GOOGLE_OAUTH_CLIENT_ID: CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET: 'test-secret', LIBRARY_PUBLIC_URL: 'https://library.example' } });
  await server.seedUser(USER);
});
after(async () => { if (server) await server.stop(); if (drive) await drive.stop(); });

test('بلا ربط: حساب الخدمة يُرفض بسبب المساحة والرسالة تدلّ على زر الربط', { skip }, async () => {
  const status = (await call('GET', '/api/admin/originals/drive', { cookie: adminCookie })).body;
  assert.equal(status.via, 'service'); assert.equal(status.connectable, true); assert.equal(status.connection, null);
  const { documentId, pub } = await publishedAddition('بحث قبل الربط');
  globalThis.__pendingDoc = documentId;
  assert.equal(pub.originals.moved, 0); assert.equal(pub.originals.failed, 1);
  assert.match(pub.originals.error, /ربط Drive للكتابة/);
  assert.ok(drive.writeTokens.includes('service') && !drive.writeTokens.includes('user'));
});

test('بدء الربط للمدير فقط، بصلاحية Drive ورمز تحديث وشاشة موافقة', { skip }, async () => {
  assert.equal((await call('GET', '/api/admin/drive/connect', { cookie: userCookie })).status, 403);
  assert.equal((await call('GET', '/api/admin/drive/connect')).status, 403);
  const start = await call('GET', '/api/admin/drive/connect', { cookie: adminCookie });
  assert.equal(start.status, 302);
  const url = new URL(start.location), q = k => url.searchParams.get(k);
  assert.equal(url.origin + url.pathname, drive.origin + '/authorize', 'في الاختبار تُوجَّه شاشة الموافقة إلى Google المحاكى');
  assert.equal(q('client_id'), CLIENT_ID); assert.equal(q('redirect_uri'), 'https://library.example/api/auth/google/callback');
  assert.equal(q('scope'), 'openid email https://www.googleapis.com/auth/drive');
  assert.equal(q('access_type'), 'offline'); assert.match(q('prompt'), /consent/); assert.equal(q('code_challenge_method'), 'S256');
  assert.match(start.headers.get('set-cookie'), /qalam_google_flow=.*HttpOnly.*Secure.*Path=\/api\/auth\/google/);
  const login = await call('GET', '/api/auth/google/start');
  const loginUrl = new URL(login.location);
  assert.equal(loginUrl.searchParams.get('scope'), 'openid email profile', 'تسجيل الدخول لا يطلب Drive');
  assert.equal(loginUrl.searchParams.get('access_type'), null);
});

test('الـcallback: رفض غير المدير والحالة الخاطئة وإلغاء الموافقة', { skip }, async () => {
  const asReader = await connectFlow({ session: userCookie });
  assert.equal(asReader.back.status, 302); assert.equal(asReader.back.location, '/admin?drive=denied');
  const bad = await connectFlow({ state: 'wrong-state' });
  assert.doesNotMatch(bad.back.location, /drive=connected/);
  assert.equal((await linkDoc())?.driveWrite, undefined, 'لا ربط بعد هذه المحاولات');
  const start = await call('GET', '/api/admin/drive/connect', { cookie: adminCookie });
  const cancelled = await call('GET', `/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(new URL(start.location).searchParams.get('state'))}`, { cookie: `${adminCookie}; ${start.headers.get('set-cookie').split(';')[0]}` });
  assert.equal(cancelled.location, '/admin?drive=cancelled');
});

test('لا يُحفظ ربط ناقص: صلاحية Drive غير ممنوحة أو الحساب لا يكتب في المجلد', { skip }, async () => {
  drive.revoked.clear();
  const noScope = await connectFlow({ grant: { grantedScope: 'openid email' } });
  assert.equal(noScope.back.location, '/admin?drive=scope'); assert.ok(drive.revoked.has(drive.REFRESH_TOKEN), 'أُلغي الرمز لدى Google');
  drive.revoked.clear();
  const noRefresh = await connectFlow({ grant: { refresh: false } });
  assert.equal(noRefresh.back.location, '/admin?drive=norefresh');
  drive.revoked.clear(); drive.state.userCanWrite = false;
  const readOnly = await connectFlow();
  assert.equal(readOnly.back.location, '/admin?drive=folder'); assert.ok(drive.revoked.has(drive.REFRESH_TOKEN));
  drive.state.userCanWrite = true; drive.revoked.clear();
  assert.equal((await linkDoc())?.driveWrite, undefined);
});

test('الربط الناجح يحفظ الرمز مشفّرًا ويظهر في الحالة', { skip }, async () => {
  const { back } = await connectFlow({ grant: { email: 'zoulouti@gmail.com' } });
  assert.equal(back.location, '/admin?drive=connected');
  const saved = (await linkDoc()).driveWrite;
  assert.equal(saved.email, 'zoulouti@gmail.com'); assert.ok(saved.connectedAt);
  assert.ok(saved.refreshTokenEncrypted && !saved.refreshTokenEncrypted.includes(drive.REFRESH_TOKEN), 'الرمز مخزَّن مشفّرًا لا نصًّا');
  const audit = await server.mongo(db => db.collection('adminAudit').find({ action: 'drive_write_connected' }).toArray());
  assert.equal(audit.length, 1); assert.equal(audit[0].target, 'zoulouti@gmail.com');
  const status = (await call('GET', '/api/admin/originals/drive', { cookie: adminCookie })).body;
  assert.equal(status.ready, true); assert.equal(status.via, 'user'); assert.equal(status.account, 'zoulouti@gmail.com'); assert.equal(status.connection.email, 'zoulouti@gmail.com');
  assert.equal(JSON.stringify(status).includes(drive.REFRESH_TOKEN), false, 'الحالة لا تكشف الرمز');
});

test('بعد الربط: إعادة نقل الأصل المتعثر ثم النشر الجديد يُرفعان بحساب المدير', { skip }, async () => {
  drive.writeTokens.length = 0;
  const retry = await call('POST', '/api/admin/originals/transfer', { cookie: adminCookie, json: { documentId: globalThis.__pendingDoc } });
  assert.equal(retry.status, 200); assert.equal(retry.body.originals.moved, 1, JSON.stringify(retry.body));
  const { pub } = await publishedAddition('بحث بعد الربط');
  assert.equal(pub.originals.moved, 1); assert.equal(pub.originals.failed, 0);
  assert.ok(drive.writeTokens.length > 0 && drive.writeTokens.every(t => t === 'user'), 'كل الكتابة بحساب المدير: ' + drive.writeTokens.join());
  const stored = [...drive.files.values()].filter(f => f.data && f.name.startsWith('بحث'));
  assert.equal(stored.length, 2);
});

test('انتهاء رمز الوصول يُجدَّد تلقائيًا مرة واحدة دون فشل', { skip }, async () => {
  drive.state.expireUserTokenOnce = true;
  const status = (await call('GET', '/api/admin/originals/drive', { cookie: adminCookie })).body;
  assert.equal(status.ready, true); assert.equal(status.via, 'user');
  assert.ok(drive.tokenCalls.filter(g => g === 'refresh_token').length >= 2);
});

test('إلغاء الربط من Google يظهر كحاجة لإعادة الربط برسالة واضحة', { skip }, async () => {
  drive.revoked.add(drive.REFRESH_TOKEN);
  const status = (await call('GET', '/api/admin/originals/drive', { cookie: adminCookie })).body;
  assert.equal(status.ready, false); assert.equal(status.reauthorize, true); assert.match(status.error, /ربط Drive للكتابة/);
  drive.revoked.clear();
  assert.equal((await call('GET', '/api/admin/originals/drive', { cookie: adminCookie })).body.ready, true);
});

test('فك الربط: للمدير فقط، يُلغي الرمز ويعيد الوضع السابق', { skip }, async () => {
  assert.equal((await call('POST', '/api/admin/drive/disconnect', { cookie: userCookie, json: {} })).status, 403);
  const off = await call('POST', '/api/admin/drive/disconnect', { cookie: adminCookie, json: {} });
  assert.equal(off.status, 200); assert.equal(off.body.connected, false); assert.equal(off.body.revoked, true);
  assert.ok(drive.revoked.has(drive.REFRESH_TOKEN));
  assert.equal((await linkDoc())?.driveWrite, undefined);
  const status = (await call('GET', '/api/admin/originals/drive', { cookie: adminCookie })).body;
  assert.equal(status.via, 'service'); assert.equal(status.connection, null);
  assert.equal((await call('POST', '/api/admin/drive/disconnect', { cookie: adminCookie, json: {} })).body.connected, false, 'فكّ ما لا ربط له آمن');
  const audit = await server.mongo(db => db.collection('adminAudit').countDocuments({ action: 'drive_write_disconnected' }));
  assert.equal(audit, 1);
});

test('في الإنتاج (دون متغير الاختبار) تذهب شاشة الموافقة إلى Google نفسه', () => {
  assert.equal(process.env.QALAM_TEST_GOOGLE_ORIGIN, undefined);
  const config = { ...googleLoginConfig(), clientId: 'c', clientSecret: 's', sessionSecret: 'x'.repeat(40), redirectUri: 'https://library.example/api/auth/google/callback' };
  const drive = new URL(beginGoogleLogin(config, 'admin', { purpose: 'drive' }).url), login = new URL(beginGoogleLogin(config, 'admin').url);
  assert.equal(drive.origin + drive.pathname, 'https://accounts.google.com/o/oauth2/v2/auth'); assert.equal(login.origin, 'https://accounts.google.com');
  assert.equal(drive.searchParams.get('scope'), 'openid email https://www.googleapis.com/auth/drive'); assert.equal(login.searchParams.get('scope'), 'openid email profile');
});
