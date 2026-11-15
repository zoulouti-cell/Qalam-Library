/* خادم Drive محاكٍ في الذاكرة لاختبار نقل الأصول دون أي اتصال بـ Google. */
import http from 'node:http';
import { createHash, generateKeyPairSync } from 'node:crypto';

export const ROOT_ID = 'root_test_folder';
export async function startFakeDrive({ sections = ['الأبحاث و الدراسات'] } = {}) {
  const files = new Map(), sessions = new Map(); let seq = 0, fail = null;
  files.set(ROOT_ID, { id: ROOT_ID, name: 'المكتبة', mimeType: 'application/vnd.google-apps.folder', parents: [] });
  for (const name of sections) { const id = 'sec_' + (++seq); files.set(id, { id, name, mimeType: 'application/vnd.google-apps.folder', parents: [ROOT_ID] }); }
  const json = (res, status, body, headers = {}) => { const b = Buffer.from(JSON.stringify(body)); res.writeHead(status, { 'content-type': 'application/json', 'content-length': b.length, ...headers }); res.end(b); };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x'), chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    if (req.method === 'POST' && url.pathname === '/token') return json(res, 200, { access_token: 'fake-token', expires_in: 3600 });
    if (!/^Bearer fake-token$/.test(req.headers.authorization || '')) return json(res, 401, { error: { status: 'UNAUTHENTICATED' } });
    if (fail && (req.method !== 'GET' || url.pathname.includes('/upload/'))) { const f = fail; if (f.once) fail = null; return json(res, f.status, { error: { errors: [{ reason: f.reason || '' }] } }); }
    const rootMatch = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (req.method === 'GET' && rootMatch) { const f = files.get(decodeURIComponent(rootMatch[1])); return f ? json(res, 200, { ...f, capabilities: { canAddChildren: true } }) : json(res, 404, { error: {} }); }
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
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    serviceAccountJson: JSON.stringify({ client_email: 'svc@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }),
    files, fail: value => { fail = value; },
    byName: name => [...files.values()].filter(f => f.name === name),
    childrenOf: id => [...files.values()].filter(f => f.parents?.includes(id)),
    stop: () => new Promise(r => server.close(r)),
  };
}
