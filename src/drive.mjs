import { createSign } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const treatyTitleIndex = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../data/treaty-titles.json', import.meta.url)), 'utf8')).documents || {};
const treatyTitleByDriveTimestamp = Object.fromEntries(Object.values(treatyTitleIndex).flatMap(entry => {
  try {
    const name = decodeURIComponent(new URL(entry.sourceUrl).pathname.split('/').pop() || '');
    const timestamp = name.match(/(\d{10,})(?:\.pdf)?$/i)?.[1];
    return timestamp ? [[timestamp, entry]] : [];
  } catch { return []; }
}));
const sourceDocumentIndex = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../data/drive-source-map.json', import.meta.url)), 'utf8')).files || {};

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

async function allLibraryPdfs(force=false) {
  if (!force && pdfIndexCache.files.length && Date.now()-pdfIndexCache.at < 15*60_000) return pdfIndexCache.files;
  if (pdfIndexCache.promise) return pdfIndexCache.promise;
  pdfIndexCache.promise=(async()=>{
    const files=[],queue=[{id:DRIVE_ROOT_FOLDER_ID,depth:0,path:''}],seen=new Set();
    async function children(folder){const found=[];let token='';do{const query=new URLSearchParams({q:`'${folder.id}' in parents and trashed = false`,pageSize:'1000',fields:`nextPageToken,files(${fields})`,supportsAllDrives:'true',includeItemsFromAllDrives:'true'});if(token)query.set('pageToken',token);const response=await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`),data=await response.json();found.push(...(data.files||[]));token=data.nextPageToken||'';}while(token);return found;}
    while(queue.length&&files.length<60000){const batch=queue.splice(0,4).filter(folder=>!seen.has(folder.id)&&folder.depth<=8);if(!batch.length)continue;batch.forEach(folder=>seen.add(folder.id));const pages=await Promise.all(batch.map(async folder=>({folder,items:await children(folder)})));for(const {folder,items} of pages)for(const item of items){if(item.mimeType==='application/pdf')files.push({id:item.id,name:item.name||'',size:Number(item.size)||0,md5Checksum:item.md5Checksum||'',modifiedTime:item.modifiedTime||'',path:folder.path||'',webViewLink:item.webViewLink||'',officialUrl:officialSourceFromDescription(item.description)});else if(item.mimeType==='application/vnd.google-apps.folder')queue.push({id:item.id,depth:folder.depth+1,path:[folder.path,item.name||''].filter(Boolean).join(' / ')});}}    pdfIndexCache={at:Date.now(),promise:null,files};return files;
  })().catch(error=>{pdfIndexCache.promise=null;throw error;});
  return pdfIndexCache.promise;
}

export async function scanLibraryPdfs() { return allLibraryPdfs(true); }

export async function searchDrivePdfs(query,limit=12) {
  const original=String(query||'').trim().slice(0,240),normalized=normalizeDriveName(original),tokens=normalized.split(/\s+/).filter(token=>token.length>1);if(!tokens.length)return {files:[],total:0};const files=await allLibraryPdfs(),scored=[];for(const file of files){const name=normalizeDriveName(file.name),matched=tokens.filter(token=>name.includes(token)),score=matched.reduce((sum,token)=>sum+(token.length>=5?1.4:1),0)/tokens.reduce((sum,token)=>sum+(token.length>=5?1.4:1),0);if(score>=0.34)scored.push({...file,score:Number(score.toFixed(3))});}scored.sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ar'));return {files:scored.slice(0,Math.max(1,Math.min(20,limit))),total:scored.length,indexedFiles:files.length};
}

export async function matchDrivePdf(query = '', sourceUrl = '', exactName = '', exactPath = '') {
  const title = String(query || '').trim().slice(0, 500);
  const source = String(sourceUrl || '').trim().slice(0, 2000);
  const files = await allLibraryPdfs();
  if (exactName) {
    const exactKey = normalizeDriveName(exactName), pathKey = normalizeDriveName(exactPath);
    const exactMatches = files.filter(file => normalizeDriveName(file.name) === exactKey && (!pathKey || normalizeDriveName(file.path) === pathKey));
    if (exactMatches.length === 1) return { match: { ...exactMatches[0], score: 1, sourceExact: true, titleExact: true }, candidates: [], indexedFiles: files.length, exact: true };
    if (exactMatches.length > 1 && exactMatches.every(file => file.md5Checksum && file.md5Checksum === exactMatches[0].md5Checksum && file.size === exactMatches[0].size)) return { match: { ...exactMatches[0], score: 1, sourceExact: true, titleExact: true, equivalentCopies: exactMatches.length }, candidates: [], indexedFiles: files.length, exact: true };
    if (exactMatches.length > 1) return { match: null, candidates: exactMatches.slice(0, 8).map(file => ({ ...file, score: 1, sourceExact: true, titleExact: true })), indexedFiles: files.length, exact: true };
    return { match: null, candidates: [], indexedFiles: files.length, exact: true };
  }
  let sourceName = '';
  try { sourceName = decodeURIComponent(new URL(source).pathname.split('/').filter(Boolean).at(-1) || '').replace(/\.pdf$/i, ''); } catch {}
  const sourceKey = normalizeDriveName(sourceName), titleKey = normalizeDriveName(title);
  const tokens = titleKey.split(/\s+/).filter(token => token.length > 2 && !/^(المملكة|المغربية|بالمصادقة|الصادر|الصادرة|بتنفيذ|المتعلق|المتعلقة|بشأن|ظهير|شريف)$/u.test(token));
  const weighted = token => token.length >= 6 || /\d/.test(token) ? 1.5 : 1;
  const scored = files.map(file => {
    const key = normalizeDriveName(file.name);
    const sameOfficialSource = source && file.officialUrl && String(file.officialUrl).replace(/\/+$/, '') === source.replace(/\/+$/, '');
    const sourceExact = sameOfficialSource || (sourceKey && (key === sourceKey || key.includes(sourceKey) || sourceKey.includes(key)));
    const titleExact = titleKey && (key === titleKey || key.includes(titleKey));
    const matches = tokens.filter(token => key.split(/\s+/).some(part => part === token || part.startsWith(token) || token.startsWith(part)));
    const totalWeight = tokens.reduce((sum, token) => sum + weighted(token), 0) || 1;
    let score = matches.reduce((sum, token) => sum + weighted(token), 0) / totalWeight;
    if (titleExact) score = Math.max(score, key === titleKey ? 1 : 0.98);
    if (sourceExact) score = 1;
    return { ...file, score: Number(score.toFixed(3)), sourceExact: !!sourceExact, titleExact: !!titleExact };
  }).filter(file => file.score >= 0.35).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ar'));
  const best = scored[0], runnerUp = scored[1];
  const confident = !!best && (best.sourceExact || best.titleExact || (best.score >= 0.82 && (!runnerUp || best.score - runnerUp.score >= 0.12)));
  return { match: confident ? best : null, candidates: scored.slice(0, 8), indexedFiles: files.length };
}

// Keep the agreement catalogue scoped to its Drive subtree. This makes treaty
// discovery fast and avoids crawling the complete library on each search.
export async function listAgreementPdfs(query = '', page = 1, limit = 20) {
  if (Date.now() - agreementIndexCache.at >= 15 * 60_000) {
    if (!agreementIndexCache.promise) agreementIndexCache.promise = (async () => {
      // Discover the treaty branch wherever it sits in the user's folder tree;
      // do not assume that it is a direct child of the Drive root.
      const libraryFiles = await allLibraryPdfs();
      const marker = value => /(?:اتفاق|معاهد|معاهدات|معاهدة)/u.test(normalizeDriveName(value));
      let files = libraryFiles.filter(file => file.path.split(' / ').some(marker));
      if (!files.length) files = libraryFiles.filter(file => marker(file.name));
      files = files.map(file => {
        const id = String(file.name || '').match(/^(\d+)[_-]/)?.[1] || '';
        const timestamp = String(file.name || '').match(/(\d{10,})/)?.[1] || '';
        const title = treatyTitleIndex[id] || treatyTitleByDriveTimestamp[timestamp];
        const officialUrl = title?.sourceUrl ? title.sourceUrl.replace(/^http:\/\//i, 'https://') : '';
        const path = normalizeDriveName(file.path);
        const country = normalizeDriveName(title?.country || '');
        const genericCountry = /(?:اتفاقيات|دولية|اقليمية|جنيف|لاهاي|منظمة العمل)/u.test(country);
        const agreementKind = /متعددة/u.test(path) || genericCountry ? 'متعددة' : /ثنائية/u.test(path) || title?.country ? 'ثنائية' : '';
        return { ...file, ...(title ? { title: title.title, fullTitle: title.fullTitle, treatyId: id, country: title.country } : {}), ...(agreementKind ? { agreementKind } : {}), webViewLink: file.webViewLink || '', officialUrl: file.officialUrl || officialUrl };
      });
      files.sort((a, b) => a.path.localeCompare(b.path, 'ar') || a.name.localeCompare(b.name, 'ar'));
      agreementIndexCache = { at: Date.now(), promise: null, files };
      return files;
    })().catch(error => { agreementIndexCache.promise = null; throw error; });
  }
  const files = agreementIndexCache.at ? agreementIndexCache.files : await agreementIndexCache.promise;
  const needle = normalizeDriveName(query), tokens = needle.split(/\s+/).filter(Boolean);
  const matched = tokens.length ? files.filter(file => tokens.every(token => normalizeDriveName(`${file.name} ${file.path}`).includes(token))) : files;
  const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 20)), safePage = Math.max(1, Number(page) || 1);
  const isBilateral = file => file.agreementKind === 'ثنائية';
  const isMultilateral = file => file.agreementKind === 'متعددة';
  return {
    files: matched.slice((safePage - 1) * safeLimit, safePage * safeLimit),
    total: matched.length,
    page: safePage,
    limit: safeLimit,
    indexedFiles: files.length,
    branches: {
      bilateral: matched.filter(isBilateral).length,
      multilateral: matched.filter(isMultilateral).length
    }
  };
}

export function driveSourceForDocument(id) { return sourceDocumentIndex[String(id || '')] || null; }

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
