/* خادم Drive محاكٍ في الذاكرة لاختبار نقل الأصول دون أي اتصال بـ Google. */
import http from 'node:http';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';

export const ROOT_ID = 'root_test_folder';
const SERVICE_TOKEN = 'fake-token', USER_TOKEN = 'fake-user-token', REFRESH_TOKEN = 'fake-refresh-token', KID = 'fake-key-1';
const b64 = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
export async function startFakeDrive({ sections = ['الأبحاث و الدراسات'], serviceQuota = false, userCanWrite = true } = {}) {
  const files = new Map(), sessions = new Map(), codes = new Map(), writeTokens = [], revoked = new Set(), tokenCalls = []; let seq = 0, fail = null;
  const state = { serviceQuota, userCanWrite, serviceCanWrite: true, expireUserTokenOnce: false, callbackBase: '', authorizeError: '', account: {}, authorizeRequests: [] };
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const issueCode = (location, { email = 'owner@gmail.com', sub = 'sub-owner', grantedScope = null, refresh = null } = {}) => {
    const params = new URL(location, 'http://x').searchParams, code = 'code_' + (++seq);
    codes.set(code, { clientId: params.get('client_id'), nonce: params.get('nonce'), challenge: params.get('code_challenge'), scope: grantedScope ?? params.get('scope'), email, sub, refresh: refresh ?? params.get('access_type') === 'offline' });
    return code;
  };
  files.set(ROOT_ID, { id: ROOT_ID, name: 'المكتبة', mimeType: 'application/vnd.google-apps.folder', parents: [] });
  for (const name of sections) { const id = 'sec_' + (++seq); files.set(id, { id, name, mimeType: 'application/vnd.google-apps.folder', parents: [ROOT_ID] }); }
  const json = (res, status, body, headers = {}) => { const b = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'content-type': 'application/json', 'content-length': b.length, ...headers }); res.end(b); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    /* شاشة موافقة Google المحاكاة: تعيد المتصفح فورًا إلى callback الخادم برمز صالح (أو بخطأ) مع state كما أُرسل */
    if (req.method === 'GET' && url.pathname === '/authorize') {
      const back = new URL('/api/auth/google/callback', state.callbackBase || 'http://127.0.0.1:1'); back.searchParams.set('state', url.searchParams.get('state') || '');
      if (state.authorizeError) back.searchParams.set('error', state.authorizeError); else back.searchParams.set('code', issueCode(req.url, state.account));
      state.authorizeRequests.push(url.href);
      res.writeHead(302, { location: back.href }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/certs') return json(res, 200, { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'RS256' }] }, { 'cache-control': 'public, max-age=300' });
    if (req.method === 'POST' && url.pathname === '/revoke') { const token = new URLSearchParams(body.toString()).get('token'); if (token) revoked.add(token); return json(res, 200, {}); }
    if (req.method === 'POST' && url.pathname === '/token') {
      const form = new URLSearchParams(body.toString()), grant = form.get('grant_type'); tokenCalls.push(grant);
      if (grant === 'authorization_code') {
        const issued = codes.get(form.get('code')); codes.delete(form.get('code'));
        if (!issued || form.get('client_id') !== issued.clientId || createHash('sha256').update(form.get('code_verifier') || '').digest('base64url') !== issued.challenge) return json(res, 400, { error: 'invalid_grant' });
        const now = Math.floor(Date.now() / 1000), head = b64({ alg: 'RS256', typ: 'JWT', kid: KID });
        const claims = b64({ iss: 'https://accounts.google.com', aud: issued.clientId, sub: issued.sub, email: issued.email, email_verified: true, nonce: issued.nonce, iat: now, exp: now + 3600 });
        const signer = createSign('RSA-SHA256'); signer.update(`${head}.${claims}`);
        return json(res, 200, { access_token: USER_TOKEN, expires_in: 3600, scope: issued.scope, token_type: 'Bearer', id_token: `${head}.${claims}.${signer.sign(privateKey, 'base64url')}`, ...(issued.refresh ? { refresh_token: REFRESH_TOKEN } : {}) });
      }
      if (grant === 'refresh_token') return form.get('refresh_token') === REFRESH_TOKEN && !revoked.has(REFRESH_TOKEN) ? json(res, 200, { access_token: USER_TOKEN, expires_in: 3600 }) : json(res, 400, { error: 'invalid_grant' });
      return json(res, 200, { access_token: SERVICE_TOKEN, expires_in: 3600 });
    }
    const bearer = (req.headers.authorization || '').replace(/^Bearer /, ''), isUser = bearer === USER_TOKEN && !revoked.has(REFRESH_TOKEN) && !revoked.has(USER_TOKEN);
    if (bearer !== SERVICE_TOKEN && !isUser) return json(res, 401, { error: { status: 'UNAUTHENTICATED' } });
    if (isUser && state.expireUserTokenOnce) { state.expireUserTokenOnce = false; return json(res, 401, { error: { status: 'UNAUTHENTICATED' } }); }
    if (req.method !== 'GET' || url.pathname.includes('/upload/')) writeTokens.push(isUser ? 'user' : 'service');
    if (!isUser && state.serviceQuota && (req.method !== 'GET' || url.pathname.includes('/upload/'))) return json(res, 403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } });
    if (fail && (req.method !== 'GET' || url.pathname.includes('/upload/'))) { const f = fail; if (f.once) fail = null; return json(res, f.status, { error: { errors: [{ reason: f.reason || '' }] } }); }
    const rootMatch = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (req.method === 'GET' && rootMatch) { const f = files.get(decodeURIComponent(rootMatch[1])); return f ? json(res, 200, { ...f, capabilities: { canAddChildren: isUser ? state.userCanWrite : state.serviceCanWrite } }) : json(res, 404, { error: {} }); }
    if (req.method === 'GET' && url.pathname === '/drive/v3/files') {
      const q = url.searchParams.get('q') || '', parent = q.match(/'([^']+)' in parents/)?.[1], mime = q.match(/mimeType = '([^']+)'/)?.[1], name = q.match(/name = '((?:\\'|[^'])*)'/)?.[1]?.replace(/\\'/g, "'");
      return json(res, 200, { files: [...files.values()].filter(f => f.parents?.includes(parent) && (!mime || f.mimeType === mime) && (!name || f.name === name)).map(({ data, ...f }) => f) });
    }
    if (req.method === 'POST' && url.pathname === '/drive/v3/files') { const meta = JSON.parse(body.toString()), id = 'fld_' + (++seq); files.set(id, { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents }); return json(res, 200, { id, name: meta.name }); }
    if (req.method === 'POST' && url.pathname === '/upload/drive/v3/files') { const id = 'ses_' + (++seq); sessions.set(id, JSON.parse(body.toString())); return json(res, 200, {}, { location: `http://127.0.0.1:${server.address().port}/upload/session/${id}` }); }
    const put = url.pathname.match(/^\/upload\/session\/(.+)$/);
    if (req.method === 'PUT' && put) { const meta = sessions.get(put[1]); if (!meta) return json(res, 404, {}); const id = 'file_' + (++seq); files.set(id, { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents, description: meta.description || '', size: String(body.length), md5Checksum: createHash('md5').update(body).digest('hex'), data: body }); return json(res, 200, { id, name: meta.name, size: String(body.length) }); }
    json(res, 404, { error: { message: 'not found ' + url.pathname } });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    serviceAccountJson: JSON.stringify({ client_email: 'svc@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
    files, fail: value => { fail = value; },
    /* يحاكي عودة Google من شاشة الموافقة: يُمرَّر عنوان التفويض الذي أرسله الخادم ويُعاد رمز تفويض صالح لمرة واحدة. */
    issueCode,
    state, writeTokens, tokenCalls, revoked, USER_TOKEN, REFRESH_TOKEN,
    byName: name => [...files.values()].filter(f => f.name === name),
    childrenOf: id => [...files.values()].filter(f => f.parents?.includes(id)),
    stop: () => new Promise(r => server.close(r)),
  };
}
