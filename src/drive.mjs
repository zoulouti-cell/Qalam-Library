import { createSign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { brotliDecompressSync } from 'node:zlib';
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
const judicialRows=JSON.parse(brotliDecompressSync(fs.readFileSync(fileURLToPath(new URL('../data/judicial-index.json.br',import.meta.url))))).rows;
const judicialById=new Map(judicialRows.map(row=>['jc:'+row[0],{court:row[1],name:row[6]}]));
const judicialDriveIds=new Map(Object.entries(JSON.parse(brotliDecompressSync(fs.readFileSync(fileURLToPath(new URL('../data/judicial-drive-map.json.br',import.meta.url))))).ids));
const JUDICIAL_FOLDERS=new Map([
  ['محكمة النقض','1Xgq4UR8KjiV8IvU5dRCjLcFi_rLe0Fl4'],['المجلس الأعلى','112NkRnyZLyodxy9V65ugdSfB5ObJJEKs'],
  ['محكمة الاستئناف التجارية بمراكش','1ORjSANaCyyCCGDrc_KpHiWS3y-r_5UAF'],['محكمة الاستئناف التجارية بالدار البيضاء','1i922Pcbht3bmzJ4ta9ha0CPz08G-a-Oh'],
  ['محكمة الاستئناف التجارية بفاس','16VRWsB8sPCSBK9MWDSRc79Wmud96YnNn'],['محكمة الاستئناف بتازة','1P1MNS1LP-SXSabRfmJCAsTlpR9OAM_1B'],
]);
const judicialFileCache=new Map();

const DRIVE_ROOT_FOLDER_ID = process.env.DRIVE_ROOT_FOLDER_ID || '1-Bcn4VPhTjoW-z6ZERbd_mGMEy1KZ1-K';
const LOCAL_ORIGINALS_ROOT = String(process.env.QALAM_LOCAL_ORIGINALS_ROOT || '').trim();
const LOCAL_LIBRARY_FOLDERS = new Set([
  'الأبحاث و الدراسات', 'الأبحات و الدراسات', 'الاتفاقيات و المعاهدات', 'الاجتهادات القضائية',
  'القوانين المنظمة للمؤسسات والهيئات', 'المادة الدستورية', 'المواد القانونية',
]);
let tokenCache = { value: '', expiresAt: 0 };

function localRoot() {
  if (!LOCAL_ORIGINALS_ROOT) return null;
  const root = path.resolve(LOCAL_ORIGINALS_ROOT);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('تعذر العثور على مجلد الأصول المحلي المحدد للمكتبة.');
  return root;
}

function safeLocalPath(relativePath) {
  const root = localRoot();
  if (!root) throw new Error('وضع الأصول المحلية غير مفعّل.');
  const rel = String(relativePath || '').replaceAll('\\', '/').replace(/^\/+/, '');
  const segments = rel.split('/');
  if (!segments.length || segments.some(part => !part || part === '.' || part === '..') || !LOCAL_LIBRARY_FOLDERS.has(segments[0])) throw new Error('مسار ملف غير صالح أو خارج مجلدات المكتبة على USB.');
  const absolute = path.resolve(root, ...segments);
  const within = path.relative(root, absolute);
  if (!within || within.startsWith('..' + path.sep) || within === '..' || path.isAbsolute(within)) throw new Error('مسار الملف خارج مجلد الأصول المسموح.');
  const realRoot = fs.realpathSync(root), realAbsolute = fs.realpathSync(absolute), realRelative = path.relative(realRoot, realAbsolute);
  if (!realRelative || realRelative.startsWith('..' + path.sep) || realRelative === '..' || path.isAbsolute(realRelative)) throw new Error('مسار الملف يتجاوز مجلد الأصول المحلي.');
  const stat = fs.statSync(realAbsolute);
  if (!stat.isFile()) throw new Error('الملف المحلي غير موجود أو غير صالح.');
  return { root, absolute: realAbsolute, relative: segments.join('/'), stat };
}

function localItem(relativePath) {
  const file = safeLocalPath(relativePath), ext = path.extname(file.absolute).toLowerCase();
  const mimeType = ext === '.pdf' ? 'application/pdf' : ext === '.doc' ? 'application/msword' : ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : '';
  if (!mimeType) throw new Error('نوع ملف المصدر المحلي غير مدعوم.');
  return { id: `local:${file.relative}`, name: path.basename(file.absolute), mimeType, size: file.stat.size, modifiedTime: file.stat.mtime.toISOString(), localPath: file.absolute, path: path.dirname(file.relative).split(path.sep).join(' / ') };
}

function localResponse(item) {
  return { headers: new Headers({ 'content-length': String(item.size) }), body: Readable.toWeb(fs.createReadStream(item.localPath)) };
}

function localFolderPath(folderId) {
  if (!String(folderId || '').startsWith('local-folder:')) throw new Error('معرف مجلد محلي غير صالح.');
  const relative = String(folderId).slice('local-folder:'.length).replaceAll('\\', '/').replace(/^\/+|\/+$/g, '');
  if (!relative) return { root: localRoot(), relative: '', absolute: localRoot() };
  const segments = relative.split('/');
  if (segments.some(part => !part || part === '.' || part === '..') || !LOCAL_LIBRARY_FOLDERS.has(segments[0])) throw new Error('المجلد خارج مجلدات المكتبة المحلية.');
  const root = localRoot(), absolute = path.resolve(root, ...segments);
  const within = path.relative(root, absolute);
  if (!within || within.startsWith('..' + path.sep) || within === '..' || path.isAbsolute(within) || !fs.statSync(absolute).isDirectory()) throw new Error('المجلد المحلي غير موجود.');
  return { root, relative: segments.join('/'), absolute };
}

function listLocalFolder(folderId) {
  const folder = localFolderPath(folderId), items = fs.readdirSync(folder.absolute, { withFileTypes: true }).filter(item => !item.isSymbolicLink()).flatMap(item => {
    const relative = [folder.relative, item.name].filter(Boolean).join('/');
    if (item.isDirectory()) return [{ id: `local-folder:${relative}`, name: item.name, mimeType: 'application/vnd.google-apps.folder', size: 0, modifiedTime: '' }];
    if (!item.isFile() || !/\.(?:pdf|docx?)$/i.test(item.name)) return [];
    try { const file = localItem(relative); return [{ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, modifiedTime: file.modifiedTime }]; } catch { return []; }
  });
  if (!folder.relative) {
    const allowed = items.filter(item => item.mimeType === 'application/vnd.google-apps.folder' && LOCAL_LIBRARY_FOLDERS.has(item.name));
    return { folder: { id: 'local-folder:', name: 'أصول المكتبة على USB' }, parentId: '', files: allowed };
  }
  items.sort((a, b) => Number(b.mimeType === 'application/vnd.google-apps.folder') - Number(a.mimeType === 'application/vnd.google-apps.folder') || a.name.localeCompare(b.name, 'ar'));
  return { folder: { id: folderId, name: path.basename(folder.absolute) }, parentId: folder.relative.includes('/') ? `local-folder:${path.dirname(folder.relative).split(path.sep).join('/')}` : 'local-folder:', files: items };
}

function localLibraryPdfs() {
  const root = localRoot(), files = [], queue = [];
  for (const name of LOCAL_LIBRARY_FOLDERS) { const absolute = path.join(root, name); if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) queue.push({ absolute, relative: name, depth: 0 }); }
  while (queue.length && files.length < 60000) {
    const folder = queue.pop();
    if (folder.depth > 12) continue;
    let entries; try { entries = fs.readdirSync(folder.absolute, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(folder.absolute, entry.name), relative = `${folder.relative}/${entry.name}`;
      if (entry.isDirectory()) { queue.push({ absolute, relative, depth: folder.depth + 1 }); continue; }
      if (!entry.isFile() || !/\.pdf$/i.test(entry.name)) continue;
      try { const item = localItem(relative); files.push({ id: item.id, name: item.name, size: item.size, modifiedTime: item.modifiedTime, md5Checksum: '', path: path.dirname(relative).split(path.sep).join(' / '), webViewLink: '', officialUrl: '' }); } catch {}
      if (files.length >= 60000) break;
    }
  }
  return files;
}

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
  if (!id || id.length > (LOCAL_ORIGINALS_ROOT && String(id).startsWith('local:') ? 1200 : 200)) throw new Error('معرف ملف Drive غير صالح.');
  if (LOCAL_ORIGINALS_ROOT && String(id).startsWith('local:')) return localItem(String(id).slice('local:'.length));
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

export async function listDriveFolder(folderId = LOCAL_ORIGINALS_ROOT ? 'local-folder:' : DRIVE_ROOT_FOLDER_ID, includeSourceMetadata = false) {
  if (LOCAL_ORIGINALS_ROOT) return listLocalFolder(folderId || 'local-folder:');
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
  if (item.localPath) return { item, response: localResponse(item) };
  const response = await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`);
  return { item, response };
}

export async function openDriveSourceFile(id) {
  const item = await withinLibrary(id);
  const allowed = new Set(['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
  if (!allowed.has(item.mimeType)) throw new Error('نوع ملف المصدر غير مدعوم للفتح من المكتبة.');
  if (item.localPath) return { item, response: localResponse(item) };
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
    if (LOCAL_ORIGINALS_ROOT) {
      const files = localLibraryPdfs();
      pdfIndexCache={at:Date.now(),promise:null,files};
      return files;
    }
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

export function driveSourceForDocument(id) {
  const judicial=judicialById.get(String(id||''));
  const courtPath=judicial&&/^محكمة الاستئناف/u.test(judicial.court)?'محاكم الاستئناف/'+judicial.court:judicial?.court;
  return judicial?{name:judicial.name,path:'الاجتهادات القضائية/'+courtPath,judicialIndex:true,status:judicialDriveIds.has(String(id))?'verified':'unverified'}:sourceDocumentIndex[String(id||'')]||null;
}

export async function resolveDocumentSourcePdf(documentId) {
  const source = driveSourceForDocument(documentId);
  if (!source?.name) throw new Error('لا يتوفر اسم موثوق لملف الأصل في فهرس المكتبة.');
  let result = await matchDrivePdf('', '', source.name, source.path || '');
  if (LOCAL_ORIGINALS_ROOT && !result.match && !result.candidates?.length) result = await matchDrivePdf('', '', source.name, '');
  if (result.match) return result.match;
  if (result.candidates?.length) throw new Error('وُجدت ملفات متشابهة؛ راجع الاسم والمجلد لتحديد الأصل الصحيح.');
  throw new Error(LOCAL_ORIGINALS_ROOT ? 'لم يُعثر على ملف الأصل في مجلده المحدد على USB.' : 'لم يُعثر على ملف الأصل المطابق في Drive.');
}

export async function resolveJudicialDrivePdf(documentId,court){
  if (LOCAL_ORIGINALS_ROOT) {
    const expected=judicialById.get(documentId)?.name||sourceDocumentIndex[documentId]?.name||'';
    const actualCourt=judicialById.get(documentId)?.court||court;
    if (!expected) throw new Error('لا يتوفر اسم أصل موثوق لهذا القرار في الفهرس المحلي.');
    const files=await allLibraryPdfs(),expectedKey=normalizeDriveName(expected),courtKey=normalizeDriveName(actualCourt);
    const exact=files.filter(file=>normalizeDriveName(file.name)===expectedKey&&normalizeDriveName(file.path).includes(courtKey));
    const matches=exact.length?exact:files.filter(file=>normalizeDriveName(file.name)===expectedKey);
    if(matches.length===1)return localItem(matches[0].id.slice('local:'.length));
    if(matches.length>1)throw new Error('وُجدت أصول محلية متعددة بالاسم نفسه؛ راجع مجلد المحكمة قبل فتح القرار.');
    throw new Error('لم يُعثر على أصل القرار في مجلد المحكمة المحدد على USB.');
  }
  const numeric=String(documentId||'').match(/^jc:(\d+)$/)?.[1],folderId=JUDICIAL_FOLDERS.get(court);
  if(!numeric||!folderId)throw new Error('لم يثبت مجلد أصل هذا القرار في Drive.');
  const cached=judicialFileCache.get(documentId);if(cached&&cached.until>Date.now()&&cached.court===court)return cached.item;
  const expected=judicialById.get(documentId)?.name||sourceDocumentIndex[documentId]?.name||`${numeric}.pdf`;
  const verifiedId=judicialDriveIds.get(documentId);
  if(verifiedId){try{const item=await metadata(verifiedId);if(item.mimeType==='application/pdf'&&item.parents?.includes(folderId)){judicialFileCache.set(documentId,{court,item,until:Date.now()+15*60_000});return item;}}catch{}}
  const names=[...new Set([expected,`${numeric}.pdf`])];
  for(const name of names){
    const query=new URLSearchParams({q:`'${folderId}' in parents and name = '${name.replaceAll("'","\\'")}' and trashed = false`,pageSize:'10',fields:`files(${fields})`,supportsAllDrives:'true',includeItemsFromAllDrives:'true'});
    const result=await (await driveFetch(`https://www.googleapis.com/drive/v3/files?${query}`)).json();
    const matches=(result.files||[]).filter(item=>item.mimeType==='application/pdf'&&item.name===name);
    if(matches.length===1){const item=await withinLibrary(matches[0].id);judicialFileCache.set(documentId,{court,item,until:Date.now()+15*60_000});return item;}
    if(matches.length>1)throw new Error('وجدت أكثر من أصل مطابق لهذا القرار؛ تلزم مراجعة الربط قبل إتاحة التحميل.');
  }
  throw new Error('لم يُعثر على أصل مطابق لهذا القرار في مجلد المحكمة المصدرة.');
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

export function libraryDriveRoot() { return LOCAL_ORIGINALS_ROOT ? 'local-folder:' : DRIVE_ROOT_FOLDER_ID; }
