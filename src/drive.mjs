import { createSign } from 'node:crypto';

const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || '1-Bcn4VPhTjoW-z6ZERbd_mGMEy1KZ1-K';
let tokenCache = { value: '', expiresAt: 0 };

function base64url(value) { return Buffer.from(value).toString('base64url'); }

function credentials() {
  let value;
  try { value = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || ''); }
  catch { throw new Error('بيانات ربط Drive غير صالحة؛ أعد ضبط سر GOOGLE_SERVICE_ACCOUNT_JSON في Render.'); }
  if (!value?.client_email || !value?.private_key) throw new Error('لم يُضبط حساب خدمة Drive في Render. أضف GOOGLE_SERVICE_ACCOUNT_JSON.');
  return value;
}

async function accessToken() {
  if (tokenCache.value && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const account = credentials(), now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  }))}`;
  const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) throw new Error('تعذر تفويض حساب خدمة Drive. تحقق من مشاركة مجلد الأصول معه وتفعيل Drive API.');
  tokenCache = { value: data.access_token, expiresAt: Date.now() + Math.min(Number(data.expires_in) || 3600, 3500) * 1000 };
  return tokenCache.value;
}

async function driveFetch(url, options = {}) {
  const token = await accessToken();
  const response = await fetch(url, { ...options, headers: { authorization: `Bearer ${token}`, ...options.headers }, signal: options.signal || AbortSignal.timeout(30_000) });
  if (response.status === 404 || response.status === 403) throw new Error('الملف غير متاح لحساب المكتبة أو لم يعد موجوداً في مجلد الأصول.');
  if (!response.ok) throw new Error(`تعذر الوصول إلى Drive (HTTP ${response.status}).`);
  return response;
}

const fields = 'id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink,parents';
async function metadata(id) {
  const query = new URLSearchParams({ fields, supportsAllDrives: 'true' });
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?${query}`);
  return response.json();
}

async function withinLibrary(id) {
  if (!id || id.length > 200) throw new Error('معرف ملف Drive غير صالح.');
  const target = await metadata(id);
  let item = target;
  const seen = new Set();
  for (let depth = 0; depth < 16; depth += 1) {
    if (item.id === DRIVE_ROOT_FOLDER_ID) return target;
    const parent = item.parents?.[0];
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    item = await metadata(parent);
  }
  throw new Error('هذا العنصر خارج مجلد أصول المكتبة.');
}

export async function listDriveFolder(folderId = DRIVE_ROOT_FOLDER_ID) {
  const folder = await withinLibrary(folderId);
  if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('المجلد المحدد غير صالح.');
  const files = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`, pageSize: '1000',
      fields: `nextPageToken,files(${fields})`, supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
    });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`);
    const data = await response.json();
    files.push(...(data.files || []).filter((item) => item.mimeType === 'application/pdf' || item.mimeType === 'application/vnd.google-apps.folder'));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  files.sort((a, b) => Number(b.mimeType === 'application/vnd.google-apps.folder') - Number(a.mimeType === 'application/vnd.google-apps.folder') || a.name.localeCompare(b.name, 'ar'));
  return { folder: { id: folder.id, name: folder.name }, parentId: folder.id === DRIVE_ROOT_FOLDER_ID ? '' : (folder.parents?.[0] || ''), files: files.map(({ id, name, mimeType, size, modifiedTime, md5Checksum }) => ({ id, name, mimeType, size: Number(size) || 0, modifiedTime: modifiedTime || '', md5Checksum: md5Checksum || '' })) };
}

export async function openDrivePdf(id) {
  const item = await withinLibrary(id);
  if (item.mimeType !== 'application/pdf') throw new Error('المعاينة والتحميل متاحان لملفات PDF في الأرشيف فقط.');
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
  return { item, response };
}

export async function readDrivePdf(id, maxBytes = 20 * 1024 * 1024) {
  const { item, response } = await openDrivePdf(id);
  const announced = Number(item.size) || Number(response.headers.get('content-length')) || 0;
  if (announced > maxBytes) { await response.body?.cancel(); throw new Error(`حجم الملف ${Math.ceil(announced / 1024 / 1024)} ميغابايت؛ الحد لهذه المعالجة ${Math.floor(maxBytes / 1024 / 1024)} ميغابايت.`); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) { await response.body.cancel(); throw new Error('تجاوز الملف حد الحجم أثناء النقل؛ أوقفنا المعالجة قبل الاحتفاظ به.'); }
    chunks.push(chunk);
  }
  return { item, buffer: Buffer.concat(chunks) };
}

export function libraryDriveRoot() { return DRIVE_ROOT_FOLDER_ID; }
