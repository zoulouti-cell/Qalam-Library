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

const fields = 'id,name,mimeType,size,modifiedTime,md5Checksum,webViewLink,description,parents';
let pdfIndexCache = { at: 0, promise: null, files: [] };
let agreementIndexCache = { at: 0, promise: null, files: [] };
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

export async function listDriveFolder(folderId = DRIVE_ROOT_FOLDER_ID, includeSourceMetadata = false) {
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
  return { folder: { id: folder.id, name: folder.name }, parentId: folder.id === DRIVE_ROOT_FOLDER_ID ? '' : (folder.parents?.[0] || ''), files: files.map(({ id, name, mimeType, size, modifiedTime, md5Checksum, webViewLink, description }) => ({ id, name, mimeType, size: Number(size) || 0, modifiedTime: modifiedTime || '', md5Checksum: md5Checksum || '', ...(includeSourceMetadata ? { webViewLink: webViewLink || '', description: description || '' } : {}) })) };
}

export async function openDrivePdf(id) {
  const item = await withinLibrary(id);
  if (item.mimeType !== 'application/pdf') throw new Error('المعاينة والتحميل متاحان لملفات PDF في الأرشيف فقط.');
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
  return { item, response };
}

function normalizeDriveName(value) { return String(value||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/[ىی]/g,'ي').replace(/ک/g,'ك').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776)).replace(/\.pdf$/i,'').replace(/^pdf\.\d+[-_ ]*/i,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim(); }
function officialSourceFromDescription(description) {
  const candidate = String(description || '').match(/https:\/\/[^\s<>"']+/i)?.[0];
  if (!candidate) return '';
  try {
    const url = new URL(candidate), host = url.hostname.toLowerCase();
    return ['justice.gov.ma','adala.justice.gov.ma','sgg.gov.ma','maroc.ma'].some(domain => host === domain || host.endsWith(`.${domain}`)) ? url.href : '';
  } catch { return ''; }
}

async function allLibraryPdfs() {
  if (pdfIndexCache.files.length && Date.now()-pdfIndexCache.at < 15*60_000) return pdfIndexCache.files;
  if (pdfIndexCache.promise) return pdfIndexCache.promise;
  pdfIndexCache.promise=(async()=>{
    const files=[],queue=[{id:DRIVE_ROOT_FOLDER_ID,depth:0,path:''}],seen=new Set();
    async function children(folder){const found=[];let token='';do{const query=new URLSearchParams({q:`'${folder.id}' in parents and trashed = false`,pageSize:'1000',fields:`nextPageToken,files(${fields})`,supportsAllDrives:'true',includeItemsFromAllDrives:'true'});if(token)query.set('pageToken',token);const response=await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`),data=await response.json();found.push(...(data.files||[]));token=data.nextPageToken||'';}while(token);return found;}
    while(queue.length&&files.length<30000){const batch=queue.splice(0,4).filter(folder=>!seen.has(folder.id)&&folder.depth<=8);if(!batch.length)continue;batch.forEach(folder=>seen.add(folder.id));const pages=await Promise.all(batch.map(async folder=>({folder,items:await children(folder)})));for(const {folder,items} of pages)for(const item of items){if(item.mimeType==='application/pdf')files.push({id:item.id,name:item.name||'',size:Number(item.size)||0,modifiedTime:item.modifiedTime||'',path:folder.path||''});else if(item.mimeType==='application/vnd.google-apps.folder')queue.push({id:item.id,depth:folder.depth+1,path:[folder.path,item.name||''].filter(Boolean).join(' / ')});}}
    pdfIndexCache={at:Date.now(),promise:null,files};return files;
  })().catch(error=>{pdfIndexCache.promise=null;throw error;});
  return pdfIndexCache.promise;
}

export async function searchDrivePdfs(query,limit=12) {
  const original=String(query||'').trim().slice(0,240),normalized=normalizeDriveName(original),tokens=normalized.split(/\s+/).filter(token=>token.length>1);if(!tokens.length)return {files:[],total:0};const files=await allLibraryPdfs(),scored=[];for(const file of files){const name=normalizeDriveName(file.name),matched=tokens.filter(token=>name.includes(token)),score=matched.reduce((sum,token)=>sum+(token.length>=5?1.4:1),0)/tokens.reduce((sum,token)=>sum+(token.length>=5?1.4:1),0);if(score>=0.34)scored.push({...file,score:Number(score.toFixed(3))});}scored.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ar'));return {files:scored.slice(0,Math.max(1,Math.min(20,limit))),total:scored.length,indexedFiles:files.length};
}

// Keep the agreement catalogue scoped to its Drive subtree. This makes treaty
// discovery fast and avoids crawling the complete library on each search.
export async function listAgreementPdfs(query = '', page = 1, limit = 20) {
  if (Date.now() - agreementIndexCache.at >= 15 * 60_000) {
    if (!agreementIndexCache.promise) agreementIndexCache.promise = (async () => {
      const root = await listDriveFolder();
      const rootFolder = root.files.find(item => item.mimeType === 'application/vnd.google-apps.folder' && normalizeDriveName(item.name).includes('اتفاق'));
      if (!rootFolder) throw new Error('لم يُعثر على مجلد الاتفاقيات والمعاهدات في مجلد أصول المكتبة.');
      const files = [], queue = [{ id: rootFolder.id, path: rootFolder.name, depth: 0 }], seen = new Set();
      while (queue.length && files.length < 10000) {
        const folder = queue.shift();
        if (seen.has(folder.id) || folder.depth > 8) continue;
        seen.add(folder.id);
        const listed = await listDriveFolder(folder.id, true);
        for (const item of listed.files) {
          if (item.mimeType === 'application/vnd.google-apps.folder') queue.push({ id: item.id, path: `${folder.path} / ${item.name}`, depth: folder.depth + 1 });
          else if (item.mimeType === 'application/pdf') files.push({ id: item.id, name: item.name, size: item.size, modifiedTime: item.modifiedTime, path: folder.path, webViewLink: item.webViewLink || '', officialUrl: officialSourceFromDescription(item.description) });
        }
      }
      files.sort((a, b) => a.path.localeCompare(b.path, 'ar') || a.name.localeCompare(b.name, 'ar'));
      agreementIndexCache = { at: Date.now(), promise: null, files };
      return files;
    })().catch(error => { agreementIndexCache.promise = null; throw error; });
  }
  const files = agreementIndexCache.at ? agreementIndexCache.files : await agreementIndexCache.promise;
  const needle = normalizeDriveName(query), tokens = needle.split(/\s+/).filter(Boolean);
  const matched = tokens.length ? files.filter(file => tokens.every(token => normalizeDriveName(`${file.name} ${file.path}`).includes(token))) : files;
  const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 20)), safePage = Math.max(1, Number(page) || 1);
  return { files: matched.slice((safePage - 1) * safeLimit, safePage * safeLimit), total: matched.length, page: safePage, limit: safeLimit, indexedFiles: files.length };
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
