import http from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync,gzipSync,constants } from 'node:zlib';
import { createHash,randomBytes,createHmac,timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { PDFDocument } from 'pdf-lib';
import { Library } from './src/library.mjs';
import { answerQuestion,aiCapability } from './src/assistant.mjs';
import { geminiApiKey,geminiModel,geminiOcrApiKey,geminiOcrModel,geminiOcrEnabled } from './src/gemini.mjs';
import { deeplApiKey,translateWithDeepL } from './src/deepl.mjs';
import { speechCapabilities,transcribe,synthesize } from './src/speech.mjs';
import { applyLocalCorrection,localCorrectionHistory,localOcrCandidate,revertLocalCorrection } from './src/editorial.mjs';
import { connectAdminStore,sealSecret,openSecret,recordAudit,hashPassword,verifyPassword } from './src/admin-store.mjs';
import { libraryDriveRoot,listDriveFolder,openDrivePdf,readDrivePdf,searchDrivePdfs,matchDrivePdf,listAgreementPdfs,scanLibraryPdfs } from './src/drive.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)),PUBLIC=path.join(ROOT,'public');
const PORT=Number(process.env.PORT||4188),HOST=process.env.HOST||'0.0.0.0';
const accessPassword=process.env.LIBRARY_ACCESS_PASSWORD||'',sessionSecret=process.env.LIBRARY_SESSION_SECRET||'';
const adminPassword=process.env.LIBRARY_ADMIN_PASSWORD||'';
if(process.env.NODE_ENV==='production'&&(!accessPassword||!adminPassword||!sessionSecret))throw new Error('Set library access, admin, and session secrets before production startup.');
async function generateGeminiPdf(model,apiKey,bytes,prompt){
  const endpoint=`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,body=JSON.stringify({contents:[{parts:[{inlineData:{mimeType:'application/pdf',data:bytes.toString('base64')}},{text:prompt}]}],generationConfig:{temperature:0,maxOutputTokens:24000}});
  for(let attempt=0;attempt<3;attempt++){
    const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':apiKey},body,signal:AbortSignal.timeout(180_000)});
    if(response.status!==503||attempt===2)return response;
    const retryAfter=response.headers.get('retry-after'),retrySeconds=Number(retryAfter),delay=Number.isFinite(retrySeconds)&&retrySeconds>0?Math.min(10_000,retrySeconds*1000):1_500*(attempt+1);
    await response.body?.cancel().catch(()=>{});
    await new Promise(resolve=>setTimeout(resolve,delay));
  }
}
async function extractGeminiPdf(model,apiKey,sourceBytes,prompt){
  let source;
  try{source=await PDFDocument.load(sourceBytes,{updateMetadata:false});}
  catch(error){
    console.warn('PDF page splitting unavailable; trying one-pass cloud OCR:',String(error?.message||'PDF parser error').slice(0,200));
    const response=await generateGeminiPdf(model,apiKey,sourceBytes,prompt),result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(String(result.error?.message||`Gemini لم يقبل ملف PDF (HTTP ${response.status}).`).slice(0,220));
    const candidate=result.candidates?.[0],text=(candidate?.content?.parts||[]).map(part=>part.text||'').join('\n').trim();
    if(candidate?.finishReason==='MAX_TOKENS')throw new Error('تعذر تقسيم بنية ملف PDF، كما تجاوز النص المستخرج حد الإجابة. لم تُنشأ مسودة ناقصة؛ جرّب نسخة PDF قابلة للقراءة أو OCR المتصفح.');
    if(text.length<20)throw new Error('تعذر تحليل بنية PDF ولم يُرجع Gemini نصاً كافياً؛ لم تُنشأ مسودة.');
    if(text.length>500000)throw new Error('تجاوز النص الناتج حد المسودة الواحدة؛ لم تُحفظ مسودة مبتورة.');
    return {text,pageCount:null,chunks:1};
  }
  const pageCount=source.getPageCount();if(!pageCount)throw new Error('ملف PDF لا يحتوي صفحات قابلة للقراءة.');
  const maxPages=12,textParts=[];let chunks=0;
  async function makeRangePdf(first,last){
    if(first===0&&last===pageCount)return sourceBytes;
    const part=await PDFDocument.create(),pages=await part.copyPages(source,Array.from({length:last-first},(_,i)=>first+i));
    for(const page of pages)part.addPage(page);
    return Buffer.from(await part.save({useObjectStreams:true}));
  }
  async function readRange(first,last){
    const bytes=await makeRangePdf(first,last),rangePrompt=`${prompt}\nهذا مقطع الصفحات ${first+1} إلى ${last} من أصل ${pageCount}. استخرج هذا المقطع وحده وبالترتيب، ولا تكرر نصاً من مقاطع أخرى.`;
    const response=await generateGeminiPdf(model,apiKey,bytes,rangePrompt),result=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(String(result.error?.message||`Gemini لم يقبل المقطع (HTTP ${response.status}).`).slice(0,220));
    const candidate=result.candidates?.[0],text=(candidate?.content?.parts||[]).map(part=>part.text||'').join('\n').trim();
    if(candidate?.finishReason==='MAX_TOKENS'){
      if(last-first<=1)throw new Error(`تجاوزت إجابة الصفحة ${first+1} حد الطول حتى بعد التقسيم؛ لم تُنشأ مسودة ناقصة.`);
      const middle=first+Math.floor((last-first)/2);await readRange(first,middle);await readRange(middle,last);return;
    }
    if(text.length<20)throw new Error(`لم يُرجع OCR نصاً كافياً للصفحات ${first+1}–${last}؛ لم تُنشأ مسودة.`);
    textParts.push(text);chunks++;
    if(textParts.reduce((sum,part)=>sum+part.length,0)>500000)throw new Error('تجاوز النص الناتج حد المسودة الواحدة؛ لم تُحفظ مسودة مبتورة.');
  }
  for(let first=0;first<pageCount;first+=maxPages)await readRange(first,Math.min(first+maxPages,pageCount));
  return {text:textParts.join('\n\n').trim(),pageCount,chunks};
}
const file=process.env.QALAM_DB_PATH||path.join(ROOT,'data','library.sqlite');
if(!fs.existsSync(file))throw new Error('قاعدة المكتبة غير موجودة. شغّل node tools/build-library.mjs أولاً.');
const library=new Library(file),limits=new Map();
const adminStore=await connectAdminStore(process.env.MONGODB_URI||'');
if(adminStore){try{library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());}catch{console.error('Library managed-content index unavailable.');}}
let activeAI=0,activeDriveOcr=false;const analysisJobs=new Map();let secondaryOcrChild=null,ingestionChild=null,ingestionLaunchError='',ocrMetricsCache={at:0,value:null};
let driveScanPromise=null;
async function runDriveMetadataScan(actor='system'){
  if(!adminStore)throw new Error('قاعدة إدارة المكتبة غير متاحة؛ تعذر حفظ نتيجة الفحص.');
  if(driveScanPromise)return driveScanPromise;
  driveScanPromise=(async()=>{
    const now=new Date(),previousState=await adminStore.driveMonitorState.findOne({_id:'latest'}),baseline=!previousState?.checkedAt;
    await adminStore.driveMonitorState.updateOne({_id:'latest'},{$set:{status:'running',startedAt:now,error:''}},{upsert:true});
    try{
      const files=await scanLibraryPdfs();
      if(files.length>=30000)throw new Error('تجاوز الفحص حد 30,000 ملف؛ لم تُعتمد نتيجة جزئية.');
      const previous=await adminStore.driveMonitorFiles.find({present:true}).project({_id:1,name:1,folder:1,modifiedTime:1,size:1}).toArray(),old=new Map(previous.map(x=>[x._id,x]));
      const added=[],changed=[],operations=[];
      for(const f of files){const next={name:String(f.name||'').slice(0,500),folder:String(f.path||'').slice(0,1000),modifiedTime:f.modifiedTime||'',size:Number(f.size)||0,present:true,checkedAt:now};const before=old.get(f.id);if(!before&&!baseline)added.push({name:next.name,folder:next.folder,status:'جديد'});else if(before&&(before.name!==next.name||before.folder!==next.folder||before.modifiedTime!==next.modifiedTime||before.size!==next.size))changed.push({name:next.name,folder:next.folder,status:'معدّل'});old.delete(f.id);operations.push({updateOne:{filter:{_id:f.id},update:{$set:next},upsert:true}});}
      const removed=[...old.values()].map(f=>({name:f.name,folder:f.folder,status:'أزيل من Drive'}));
      for(let i=0;i<operations.length;i+=500)await adminStore.driveMonitorFiles.bulkWrite(operations.slice(i,i+500),{ordered:false});
      await adminStore.driveMonitorFiles.updateMany({present:true,checkedAt:{$ne:now}},{$set:{present:false,removedAt:now}});
      const completedAt=new Date(),result={status:'complete',available:true,checkedAt:completedAt.toISOString(),files:files.length,added:added.length,changed:changed.length,removed:removed.length,changes:[...added,...changed,...removed].slice(0,300),baseline};
      await adminStore.driveMonitorState.updateOne({_id:'latest'},{$set:{...result,finishedAt:completedAt,error:''}},{upsert:true});
      await recordAudit(adminStore,actor,'drive_metadata_scan_completed','drive',{files:files.length,added:added.length,changed:changed.length,removed:removed.length});
      return result;
    }catch(error){const message=String(error?.message||'تعذر فحص Drive.').slice(0,500);await adminStore.driveMonitorState.updateOne({_id:'latest'},{$set:{status:'error',finishedAt:new Date(),error:message}},{upsert:true});throw error;}
  })().finally(()=>{driveScanPromise=null;});
  return driveScanPromise;
}
const driveMonitorTimer=setInterval(async()=>{
  if(!adminStore||driveScanPromise)return;
  try{const state=await adminStore.driveMonitorState.findOne({_id:'latest'}),last=state?.finishedAt?new Date(state.finishedAt).getTime():0,due=state?.status==='error'?15*60_000:24*60*60_000;if(!last||Date.now()-last>=due)await runDriveMetadataScan('scheduled');}
  catch(error){console.error('Scheduled Drive metadata scan failed:',error?.message||'unknown error');}
},60*60_000);
driveMonitorTimer.unref();
const headers={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; media-src 'self' blob:; frame-src 'self' blob:; worker-src 'self' blob: https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
  'Permissions-Policy':'microphone=(self), camera=(), geolocation=()',
};
function send(req,res,status,value,type='application/json; charset=utf-8'){
  let body=Buffer.isBuffer(value)?value:Buffer.from(type.startsWith('application/json')?JSON.stringify(value):String(value));
  const out={...headers,'Content-Type':type,'Cache-Control':'no-store'};
  if(body.length>1500&&/json|text|javascript|svg/.test(type)){
    const accept=req.headers['accept-encoding']||'';
    if(accept.includes('br')){body=brotliCompressSync(body,{params:{[constants.BROTLI_PARAM_QUALITY]:3}});out['Content-Encoding']='br';}
    else if(accept.includes('gzip')){body=gzipSync(body);out['Content-Encoding']='gzip';}
    out.Vary='Accept-Encoding';
  }
  out['Content-Length']=body.length;res.writeHead(status,out);res.end(req.method==='HEAD'?undefined:body);
}
const officialPdfHosts=new Set(['adala.justice.gov.ma','justice.gov.ma','www.sgg.gov.ma','sgg.gov.ma','www.mahakim.ma','mahakim.ma',...(process.env.QALAM_ALLOWED_PDF_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)]);
function isAllowedPdfUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&officialPdfHosts.has(u.hostname.toLowerCase())&&!u.username&&!u.password;}catch{return false;}}
async function fetchOfficialPdf(value){let current=new URL(value);for(let hop=0;hop<=3;hop++){if(!isAllowedPdfUrl(current.href))throw new Error('يسمح فقط بروابط HTTPS من مصادر رسمية مضافة إلى قائمة المصادر الموثوقة.');const response=await fetch(current,{redirect:'manual',signal:AbortSignal.timeout(45000),headers:{'Accept':'application/pdf,application/octet-stream;q=0.9'}});if([301,302,303,307,308].includes(response.status)){const location=response.headers.get('location');if(!location||hop===3)throw new Error('تعذر تتبع رابط التحميل الرسمي.');current=new URL(location,current);continue;}if(!response.ok)throw new Error(`تعذر جلب رابط المصدر (HTTP ${response.status}).`);const type=(response.headers.get('content-type')||'').toLowerCase();if(!type.includes('pdf')&&!type.includes('octet-stream'))throw new Error('الرابط لا يعيد ملف PDF مباشراً.');const declared=Number(response.headers.get('content-length')||0);if(declared>20*1024*1024)throw new Error('حجم PDF يتجاوز الحد الآمن البالغ 20 ميغابايت.');const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>20*1024*1024){await response.body.cancel().catch(()=>{});throw new Error('حجم PDF يتجاوز الحد الآمن البالغ 20 ميغابايت.');}chunks.push(Buffer.from(chunk));}const bytes=Buffer.concat(chunks);if(!bytes.length||bytes.subarray(0,5).toString()!=='%PDF-')throw new Error('الملف فارغ أو ليس PDF صالحاً.');return {bytes,url:current.href};}throw new Error('تعذر جلب رابط المصدر.');}
function rate(req,post){const key=(req.socket.remoteAddress||'local')+':'+(post?'write':'read'),now=Date.now();let value=limits.get(key);if(!value||now-value.start>60000)value={start:now,n:0};value.n++;limits.set(key,value);return value.n<=(post?35:400);}
async function read(req,max){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max){const e=new Error('حجم الطلب أكبر من المسموح.');e.status=413;throw e;}chunks.push(c);}return Buffer.concat(chunks);}
async function jsonBody(req,max=40000){try{return JSON.parse((await read(req,max)).toString('utf8'));}catch(e){if(e.status)throw e;const error=new Error('صيغة الطلب غير صالحة.');error.status=400;throw error;}}
function sameOrigin(req){if(!req.headers.origin)return !process.env.NODE_ENV||process.env.NODE_ENV!=='production';try{const u=new URL(req.headers.origin);return u.host===req.headers.host;}catch{return false;}}
function authCookie(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2))['qalam_session']||'';}
function sessionInfo(req){if(!sessionSecret)return !process.env.NODE_ENV||process.env.NODE_ENV!=='production'?{role:'admin',account:'env'}:null;const parts=authCookie(req).split('.'),expiry=parts[0],role=parts[1],account=parts.length===4?parts[2]:'legacy',signature=parts.length===4?parts[3]:parts[2],legacy=!['reader','admin'].includes(role);if(parts.length>4||!/^[0-9]{10,}$/.test(expiry||'')||Number(expiry)<Date.now())return null;const payload=legacy?expiry:parts.length===4?expiry+'.'+role+'.'+account:expiry+'.'+role,signed=legacy?role:signature;if(legacy&&!/^[a-f0-9]{64}$/i.test(signed||''))return null;const expected=createHmac('sha256',sessionSecret).update(payload).digest('hex'),a=Buffer.from(signed||''),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b)?{role:legacy?'reader':role,account:legacy?'legacy':account}:null;}
function sessionRole(req){return sessionInfo(req)?.role||null;}
function auditActor(req){const account=sessionInfo(req)?.account||'admin';if(account==='env'||account==='legacy')return'admin';try{return Buffer.from(account,'base64url').toString('utf8').slice(0,160)||'admin';}catch{return'admin';}}
function validSession(req){return !!sessionInfo(req);}
function issueSession(res,role,account='legacy'){const expiry=String(Date.now()+7*86400000),payload=expiry+'.'+role+'.'+account,signature=createHmac('sha256',sessionSecret).update(payload).digest('hex');res.setHeader('Set-Cookie',`qalam_session=${payload}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);}
function localEditor(req){const remote=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');return ['127.0.0.1','::1'].includes(remote)&&sameOrigin(req);}
function ingestionSnapshot(progress){const age=Date.now()-Date.parse(progress.lastUpdate||'');const stale=progress.running===true&&Number.isFinite(age)&&age>300000;return stale?{...progress,running:false,status:'stalled',stale:true}:progress;}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  try{
    if(!rate(req,req.method==='POST'))return send(req,res,429,{error:'طلبات كثيرة؛ حاول بعد قليل.'});
    const url=new URL(req.url,'http://localhost:'+PORT),p=url.pathname;
    if(req.method==='POST'&&!sameOrigin(req))return send(req,res,403,{error:'هذا الطلب غير مسموح.'});
    if(p.startsWith('/api/')&&!['GET','POST','HEAD'].includes(req.method))return send(req,res,405,{error:'طريقة الطلب غير مدعومة.'});
    if(p==='/api/health')return send(req,res,200,{ok:true});
    if(p==='/api/session'){const session=sessionInfo(req);let mustChangePassword=false,email='';if(session?.account&&session.account!=='legacy'&&session.account!=='env'&&adminStore){const decoded=Buffer.from(session.account,'base64url').toString('utf8'),user=await adminStore.users.findOne({email:decoded},{projection:{email:1,mustChangePassword:1,active:1}});if(!user?.active)return send(req,res,200,{authenticated:false});email=user.email;mustChangePassword=!!user.mustChangePassword;}return send(req,res,200,{authenticated:!!session,role:session?.role||null,canAdmin:session?.role==='admin',mustChangePassword,email});}
    if(p==='/api/login'&&req.method==='POST'){
      if(!accessPassword||!sessionSecret)return send(req,res,503,{error:'تسجيل الدخول غير مهيأ بعد.'});
      const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
      if(email&&!adminStore)return send(req,res,503,{error:'تسجيل الدخول بالحسابات الفردية غير متاح الآن؛ قاعدة MongoDB غير متصلة.'});
      if(email&&adminStore){const user=await adminStore.users.findOne({email});if(user?.active&&verifyPassword(password,user.passwordSalt,user.passwordHash)){issueSession(res,user.role,Buffer.from(user.email).toString('base64url'));return send(req,res,200,{authenticated:true,role:user.role,mustChangePassword:!!user.mustChangePassword});}}
      if(!email){const given=Buffer.from(password),expected=Buffer.from(accessPassword);if(given.length===expected.length&&timingSafeEqual(given,expected)){issueSession(res,'reader');return send(req,res,200,{authenticated:true,role:'reader'});}}
      return send(req,res,401,{error:'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو أن الحساب غير مفعّل.'});
    }
    if(p==='/api/admin/login'&&req.method==='POST'){
      if(!adminPassword||!sessionSecret)return send(req,res,503,{error:'دخول المدير غير مهيأ.'});
      const body=await jsonBody(req),given=Buffer.from(String(body.password||'')),expected=Buffer.from(adminPassword);
      if(given.length!==expected.length||!timingSafeEqual(given,expected))return send(req,res,401,{error:'كلمة مرور الإدارة غير صحيحة.'});
      issueSession(res,'admin','env');return send(req,res,200,{authenticated:true,role:'admin'});
    }
    if(p==='/api/change-password'&&req.method==='POST'){
      const session=sessionInfo(req);if(!session||session.account==='legacy'||session.account==='env'||!adminStore)return send(req,res,403,{error:'تغيير كلمة المرور متاح للحسابات الفردية فقط.'});
      const body=await jsonBody(req),email=Buffer.from(session.account,'base64url').toString('utf8'),password=String(body.password||'');if(password.length<12)return send(req,res,400,{error:'اختر كلمة مرور من 12 حرفاً على الأقل.'});const saved=hashPassword(password),result=await adminStore.users.updateOne({email,active:true},{$set:{passwordSalt:saved.salt,passwordHash:saved.hash,mustChangePassword:false,updatedAt:new Date()}});if(!result.matchedCount)return send(req,res,401,{error:'الحساب غير موجود أو معطل.'});await recordAudit(adminStore,email,'password_changed',email);return send(req,res,200,{ok:true});
    }
    if(p==='/api/logout'&&req.method==='POST'){res.setHeader('Set-Cookie','qalam_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return send(req,res,200,{ok:true});}
    const loginAsset=['/login','/login.html','/login.js','/login.css','/admin-login.html','/admin-login.js','/change-password.html','/change-password.js','/admin.css','/assets/library-login-logo.png','/assets/library-login-hero.jpg','/assets/logo-word-ar.png','/assets/logo-word-ar-dark.webp','/assets/qalam-q-logo.png','/assets/qalam-signature.png','/assets/brand-office-scene.webp','/assets/almarai-regular.ttf','/assets/almarai-bold.ttf','/assets/qaf-favicon.svg'].includes(p);
    const session=sessionInfo(req);if(session&&session.account!=='legacy'&&session.account!=='env'&&adminStore&&!['/api/session','/api/logout','/api/change-password','/change-password','/change-password.html','/change-password.js'].includes(p)){const email=Buffer.from(session.account,'base64url').toString('utf8'),user=await adminStore.users.findOne({email},{projection:{mustChangePassword:1,active:1}});if(!user?.active){res.setHeader('Set-Cookie','qalam_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return send(req,res,401,{error:'الحساب غير مفعّل.'});}if(user.mustChangePassword)return send(req,res,428,{error:'غيّر كلمة المرور المؤقتة أولاً.'});}
    const adminPage=p==='/admin'||p==='/admin.html'||p==='/admin.js';
    if(adminPage&&sessionRole(req)!=='admin')return send(req,res,200,fs.readFileSync(path.join(PUBLIC,'admin-login.html')),'text/html; charset=utf-8');
    if(p.startsWith('/api/admin/')&&sessionRole(req)!=='admin')return send(req,res,403,{error:'هذه الوظيفة مخصصة لمدير المكتبة.'});
    if(p.startsWith('/api/admin/')&&!adminStore&&['/api/admin/settings','/api/admin/content','/api/admin/content/save','/api/admin/content/publish','/api/admin/content/delete'].includes(p))return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة حالياً؛ تحقق من اتصال MongoDB.'});
    if(p==='/api/admin/users'&&req.method==='GET'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});const users=await adminStore.users.find({}).sort({createdAt:-1}).project({email:1,role:1,active:1,mustChangePassword:1,createdAt:1,updatedAt:1}).limit(300).toArray();return send(req,res,200,{users});
    }
    if(p==='/api/admin/users'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),role=String(body.role||'reader');if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return send(req,res,400,{error:'أدخل بريداً إلكترونياً صالحاً.'});if(!['reader','admin'].includes(role))return send(req,res,400,{error:'الحسابات المستقلة تقتصر على القارئ ومدير المكتبة.'});if(await adminStore.users.findOne({email},{projection:{_id:1}}))return send(req,res,409,{error:'يوجد حساب بهذا البريد الإلكتروني.'});const temporaryPassword=randomBytes(12).toString('base64url'),saved=hashPassword(temporaryPassword),user={email,role,active:true,mustChangePassword:true,passwordSalt:saved.salt,passwordHash:saved.hash,createdAt:new Date(),createdBy:'administrator'};await adminStore.users.insertOne(user);await recordAudit(adminStore,'administrator','user_created',email,{role});return send(req,res,201,{ok:true,email,role,temporaryPassword,mustChangePassword:true});
    }
    if(p==='/api/admin/users/reset'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),actor=sessionInfo(req)?.account||'';if(actor!=='env'&&actor!=='legacy'&&Buffer.from(actor,'base64url').toString('utf8')===email)return send(req,res,409,{error:'لا تعِد إصدار كلمة المرور لحسابك من هذه الجلسة؛ استخدم صفحة تغيير كلمة المرور.'});const temporaryPassword=randomBytes(12).toString('base64url'),saved=hashPassword(temporaryPassword),result=await adminStore.users.updateOne({email},{$set:{passwordSalt:saved.salt,passwordHash:saved.hash,mustChangePassword:true,updatedAt:new Date()}});if(!result.matchedCount)return send(req,res,404,{error:'لم يُعثر على الحساب.'});await recordAudit(adminStore,'administrator','user_password_reset',email);return send(req,res,200,{ok:true,email,temporaryPassword,mustChangePassword:true});
    }
    if(p==='/api/admin/users/status'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),active=!!body.active,actor=sessionInfo(req)?.account||'';if(!active&&actor!=='env'&&actor!=='legacy'&&Buffer.from(actor,'base64url').toString('utf8')===email)return send(req,res,409,{error:'لا يمكن تعطيل حساب الإدارة المستخدم حالياً.'});const target=await adminStore.users.findOne({email},{projection:{role:1}});if(!target)return send(req,res,404,{error:'لم يُعثر على الحساب.'});if(!active&&target.role==='admin'&&await adminStore.users.countDocuments({role:'admin',active:true})<=1)return send(req,res,409,{error:'أنشئ مديراً آخر وفعّله قبل تعطيل آخر مدير للمكتبة.'});const result=await adminStore.users.updateOne({email},{$set:{active,updatedAt:new Date()}});await recordAudit(adminStore,'administrator',active?'user_activated':'user_deactivated',email);return send(req,res,200,{ok:true,email,active});
    }
    if(process.env.NODE_ENV==='production'&&!validSession(req)&&!loginAsset){
      if(p.startsWith('/api/'))return send(req,res,401,{error:'سجّل الدخول أولاً.'});
      return send(req,res,200,fs.readFileSync(path.join(PUBLIC,'login.html')),'text/html; charset=utf-8');
    }
    if(p==='/api/admin/overview'&&req.method==='GET'){
      const stats=library.stats(),statuses=library.db.prepare('SELECT review_status status,count(*) count FROM documents GROUP BY review_status ORDER BY count DESC').all();
      const documents=library.db.prepare("SELECT id,title,category,text_kind,review_status,chars FROM documents WHERE review_status IN ('needs_review','automated_review') ORDER BY CASE review_status WHEN 'needs_review' THEN 0 ELSE 1 END, rowid LIMIT 60").all();
      const managed=adminStore?await adminStore.content.find({status:'draft'}).sort({updatedAt:-1}).limit(40).project({documentId:1,title:1,category:1,textKind:1,status:1,submittedBy:1,updatedAt:1}).toArray():[];
      return send(req,res,200,{stats,statuses,reviewQueue:documents,managedDrafts:managed,mongoConnected:!!adminStore});
    }
    if(p==='/api/admin/audit'&&req.method==='GET'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});const entries=await adminStore.audit.find({}).sort({createdAt:-1}).limit(200).toArray();return send(req,res,200,{entries:entries.map(({actor,action,target,details,createdAt})=>({actor,action,target,details,createdAt}))});
    }
    if(p==='/api/admin/drive-monitor'&&req.method==='GET'){
      if(!adminStore)return send(req,res,503,{available:false,status:'error',error:'قاعدة إدارة المكتبة غير متاحة؛ لا يمكن حفظ خط أساس الفحص.'});
      let state=await adminStore.driveMonitorState.findOne({_id:'latest'}),last=state?.finishedAt?new Date(state.finishedAt).getTime():0,due=state?.status==='error'?15*60_000:24*60*60_000;
      if(!driveScanPromise&&(!last||Date.now()-last>=due))runDriveMetadataScan('scheduled').catch(()=>{});
      if(driveScanPromise)return send(req,res,200,{...(state||{}),status:'running',available:true});
      return send(req,res,200,{...(state||{status:'not_run'}),available:true});
    }
    if(p==='/api/admin/drive-monitor/run'&&req.method==='POST'){
      try{return send(req,res,200,await runDriveMetadataScan(auditActor(req)));}
      catch(error){return send(req,res,503,{available:false,status:'error',error:error.message||'تعذر فحص أرشيف Drive.'});}
    }
    if(p==='/api/admin/drive/status'&&req.method==='GET'){
      try{const d=await listDriveFolder();return send(req,res,200,{connected:true,rootId:libraryDriveRoot(),rootName:d.folder.name||'الأصول',topLevelItems:d.files.length,pdfCount:d.files.filter(f=>f.mimeType==='application/pdf').length,folderCount:d.files.filter(f=>f.mimeType==='application/vnd.google-apps.folder').length,readOnly:true});}catch(error){return send(req,res,503,{connected:false,rootId:libraryDriveRoot(),error:error.message||'تعذر الاتصال بأرشيف Drive.'});}
    }
    if(p==='/api/drive/files'&&req.method==='GET'){
      try{return send(req,res,200,await listDriveFolder((url.searchParams.get('folderId')||'').slice(0,200)||undefined));}catch(error){return send(req,res,503,{error:error.message||'تعذر استعراض مجلد Drive.'});}
    }
    if(p==='/api/drive/search'&&req.method==='GET'){
      try{return send(req,res,200,await searchDrivePdfs(url.searchParams.get('q')||'',20));}catch(error){return send(req,res,503,{error:error.message||'تعذر البحث عن أصل الوثيقة في Drive.'});}
    }
    if(p==='/api/drive/match'&&req.method==='GET'){
      try{return send(req,res,200,await matchDrivePdf(url.searchParams.get('q')||'',url.searchParams.get('source')||'',url.searchParams.get('exactName')||'',url.searchParams.get('exactPath')||''));}catch(error){return send(req,res,503,{error:error.message||'تعذر مطابقة الوثيقة مع أصلها في Drive.'});}
    }
    if(p==='/api/drive/agreements'&&req.method==='GET'){
      try{return send(req,res,200,await listAgreementPdfs(url.searchParams.get('q')||'',url.searchParams.get('page')||1,url.searchParams.get('limit')||20));}catch(error){return send(req,res,503,{error:error.message||'تعذر فهرسة ملفات الاتفاقيات والمعاهدات في Drive.'});}
    }
    if(p==='/api/drive/file'&&req.method==='GET'){
      const id=(url.searchParams.get('id')||'').slice(0,200),mode=url.searchParams.get('mode')==='download'?'attachment':'inline';if(!id)return send(req,res,400,{error:'معرف ملف Drive مطلوب.'});
      try{const {item,response}=await openDrivePdf(id);const safeName=encodeURIComponent(String(item.name||'document.pdf').replace(/[\r\n\0]/g,'_')),length=response.headers.get('content-length');res.writeHead(200,{...headers,'Content-Type':'application/pdf','Content-Disposition':`${mode}; filename="document.pdf"; filename*=UTF-8''${safeName}`,'Cache-Control':'private, no-store, max-age=0',...(length?{'Content-Length':length}:{}),'X-Content-Type-Options':'nosniff'});await pipeline(Readable.fromWeb(response.body),res);return;}catch(error){if(res.headersSent){res.destroy();return;}return send(req,res,503,{error:error.message||'تعذر فتح ملف Drive.'});}
    }
    if(p==='/api/admin/drive/ocr'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة؛ لا يمكن حفظ مسودة OCR.'});
      let body;try{body=await jsonBody(req);}catch(error){return send(req,res,error.status||400,{error:error.message});}
      const fileId=String(body.fileId||'').slice(0,200);if(!fileId)return send(req,res,400,{error:'اختر ملف PDF من الأرشيف.'});
      const saved=await adminStore.settings.findOne({_id:'library'}),ocr=saved?.ocr||{},apiKey=geminiOcrApiKey(openSecret(ocr.geminiApiKeyEncrypted));
      if(!geminiOcrEnabled(ocr.engine)||!apiKey)return send(req,res,409,{error:'فعّل Gemini OCR في Render عبر GEMINI_OCR_ENABLED=true، أو اختر Gemini في إعدادات المكتبة، وأضف مفتاح Gemini.'});
      if(activeDriveOcr)return send(req,res,409,{error:'هناك عملية OCR سحابية قيد التنفيذ. انتظر اكتمالها قبل بدء عملية أخرى.'});activeDriveOcr=true;
      try{
        const {item,buffer}=await readDrivePdf(fileId,20*1024*1024);const prompt='استخرج النص الظاهر في هذا المستند كاملاً وبأمانة حرفية، باللغة العربية كما كُتب. حافظ على أرقام المواد والفصول والتواريخ وعلامات الترقيم والنفي، وعلى ترتيب الصفحات والفقرات. لا تلخص ولا تشرح ولا تصحح ولا تضف عناوين من عندك. أزل رقم الصفحة المنفصل فقط إذا كان واضحاً أنه ترويسة أو تذييل وليس جزءاً من النص. أعد النص المستخرج وحده. إذا تعذر قراءة موضع فضع [غير مقروء] بدلاً من التخمين.';
        const model=geminiOcrModel(),{text,pageCount,chunks}=await extractGeminiPdf(model,apiKey,buffer,prompt);        const title=String(item.name||'وثيقة من Drive').replace(/\.pdf$/i,'').slice(0,500),documentId='managed_drive_'+randomBytes(12).toString('hex'),sourceUrl=`https://drive.google.com/file/d/${encodeURIComponent(fileId)}/view`,record={documentId,title,text,type:'national',category:'غير مصنف — مراجعة التصنيف',subcategory:'',date:'',kind:'law',textKind:'extracted_text',sourceUrl,sourceLabel:'نسخة أصلية في Google Drive · OCR Gemini',reason:'مسودة OCR سحابي مجزأة تلقائياً؛ راجع النص كاملاً وقارنه بالوثيقة الأصلية قبل النشر.',status:'draft',createdAt:new Date(),updatedAt:new Date(),updatedBy:'admin',ocr:{engine:model,createdAt:new Date(),pagesRequested:'all',pageCount,chunks,sourceDriveFileId:fileId}};
        await adminStore.content.insertOne(record);await recordAudit(adminStore,'admin','drive_cloud_ocr_draft_created',documentId,{title,sourceDriveFileId:fileId,sourceBytes:buffer.length,engine:model,pageCount,chunks});return send(req,res,201,{ok:true,documentId,title,status:'draft',chars:text.length,pages:pageCount,chunks,engine:model});
      }catch(error){return send(req,res,502,{error:error.message||'تعذر تشغيل OCR السحابي.'});}finally{activeDriveOcr=false;}
    }
    if(p==='/api/admin/source-pdf'&&req.method==='GET'){
      const sourceUrl=url.searchParams.get('url')||'';try{const result=await fetchOfficialPdf(sourceUrl);const source=new URL(result.url);await recordAudit(adminStore,auditActor(req),'official_pdf_previewed',source.hostname+source.pathname,{bytes:result.bytes.length});return send(req,res,200,result.bytes,'application/pdf');}catch(error){return send(req,res,400,{error:error.message||'تعذر جلب PDF من الرابط الرسمي.'});}
    }
    if(p==='/api/admin/url/ocr'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة؛ لا يمكن حفظ مسودة OCR.'});let body;try{body=await jsonBody(req,12000);}catch(error){return send(req,res,error.status||400,{error:error.message});}const sourceUrl=String(body.url||'').trim();if(!isAllowedPdfUrl(sourceUrl))return send(req,res,400,{error:'أدخل رابط PDF مباشر من مصدر HTTPS رسمي مدعوم.'});const saved=await adminStore.settings.findOne({_id:'library'}),ocr=saved?.ocr||{},apiKey=geminiOcrApiKey(openSecret(ocr.geminiApiKeyEncrypted));if(!geminiOcrEnabled(ocr.engine)||!apiKey)return send(req,res,409,{error:'فعّل Gemini OCR في متغير GEMINI_OCR_ENABLED أو إعدادات المكتبة، وأضف مفتاح Gemini.'});if(activeDriveOcr)return send(req,res,409,{error:'هناك عملية OCR سحابية قيد التنفيذ. انتظر اكتمالها قبل بدء أخرى.'});activeDriveOcr=true;
      try{const {bytes,url:finalUrl}=await fetchOfficialPdf(sourceUrl),prompt='استخرج النص الظاهر في هذا المستند كاملاً وبأمانة حرفية، باللغة العربية كما كُتب. حافظ على أرقام المواد والفصول والتواريخ وعلامات الترقيم والنفي، وعلى ترتيب الصفحات والفقرات. لا تلخص ولا تشرح ولا تصحح ولا تضف عناوين من عندك. أزل رقم الصفحة المنفصل فقط إذا كان واضحاً أنه ترويسة أو تذييل وليس جزءاً من النص. أعد النص المستخرج وحده. إذا تعذر قراءة موضع فضع [غير مقروء] بدلاً من التخمين.';const model=geminiOcrModel(),{text,pageCount,chunks}=await extractGeminiPdf(model,apiKey,bytes,prompt);const fileName=decodeURIComponent(new URL(finalUrl).pathname.split('/').filter(Boolean).at(-1)||'وثيقة من الرابط الرسمي').replace(/\.pdf$/i,'').slice(0,500),documentId='managed_url_'+randomBytes(12).toString('hex'),record={documentId,title:String(body.title||fileName).slice(0,500),text,type:'national',category:'غير مصنف — مراجعة التصنيف',subcategory:'',date:'',kind:'law',textKind:'extracted_text',sourceUrl:finalUrl,sourceLabel:'رابط PDF رسمي مباشر · OCR Gemini',reason:'مسودة OCR سحابي مجزأة تلقائياً؛ راجع النص كاملاً وقارنه بالوثيقة الأصلية قبل النشر.',status:'draft',createdAt:new Date(),updatedAt:new Date(),updatedBy:auditActor(req),ocr:{engine:model,createdAt:new Date(),sourceUrl:finalUrl,sourceBytes:bytes.length,pageCount,chunks}};await adminStore.content.insertOne(record);await recordAudit(adminStore,auditActor(req),'official_url_ocr_draft_created',documentId,{title:record.title,sourceHost:new URL(finalUrl).hostname,sourceBytes:bytes.length,engine:model,pageCount,chunks});return send(req,res,201,{ok:true,documentId,title:record.title,status:'draft',chars:text.length,pages:pageCount,chunks,engine:model});}catch(error){return send(req,res,502,{error:error.message||'تعذر OCR السحابي للرابط.'});}finally{activeDriveOcr=false;}    }
    if(p==='/api/admin/settings'&&req.method==='GET'){
      const saved=adminStore?await adminStore.settings.findOne({_id:'library'}):null,drive=saved?.drive||{},ocr=saved?.ocr||{};
      const envEngine=process.env.GEMINI_OCR_ENABLED===undefined?null:(geminiOcrEnabled()?'gemini':'local');
      return send(req,res,200,{mongoConnected:!!adminStore,drive:{account:drive.account||'',folders:drive.folders||{},autoBackup:drive.autoBackup!==false,connection:drive.connection||'reauthorization_required'},ocr:{engine:envEngine||ocr.engine||'local',engineControlledByEnvironment:envEngine!==null,workers:ocr.workers||2,maxPages:ocr.maxPages||0,geminiConfigured:!!geminiOcrApiKey(openSecret(ocr.geminiApiKeyEncrypted)),geminiConfiguredByEnvironment:!!(process.env.GEMINI_OCR_API_KEY||geminiApiKey()),model:geminiOcrModel()},permissions:{reader:'اطلاع فقط',administrator:'إدارة ومراجعة ونشر',sharedReaderPassword:true}});
    }
    if(p==='/api/admin/settings'&&req.method==='POST'){
      let body;try{body=await jsonBody(req);}catch(e){return send(req,res,e.status||400,{error:e.message});}
      const old=await adminStore.settings.findOne({_id:'library'})||{},oldDrive=old.drive||{},oldOcr=old.ocr||{},driveIn=body.drive||{},ocrIn=body.ocr||{};
      const folders={...oldDrive.folders};for(const key of ['assets','results'])if(driveIn.folders?.[key]){const f=driveIn.folders[key];if(String(f.id||'').length>200||String(f.name||'').length>160)return send(req,res,400,{error:'بيانات مجلد Drive أطول من المسموح.'});folders[key]={id:String(f.id||''),name:String(f.name||'').trim()};}
      const engine=['local','gemini'].includes(ocrIn.engine)?ocrIn.engine:(oldOcr.engine||'local');if(engine==='gemini'&&!geminiOcrApiKey(openSecret(ocrIn.geminiApiKey?sealSecret(ocrIn.geminiApiKey):oldOcr.geminiApiKeyEncrypted)))return send(req,res,400,{error:'أضف GEMINI_OCR_API_KEY أو GEMINI_API_KEY في Render، أو أدخل مفتاح Gemini في إعدادات OCR.'});
      const encryptedKey=ocrIn.geminiApiKey?sealSecret(String(ocrIn.geminiApiKey).trim()):oldOcr.geminiApiKeyEncrypted||'';
      const settings={drive:{account:String(driveIn.account??oldDrive.account??'').slice(0,160),folders,autoBackup:driveIn.autoBackup===undefined?oldDrive.autoBackup!==false:!!driveIn.autoBackup,connection:oldDrive.connection||'reauthorization_required'},ocr:{engine,workers:Math.max(1,Math.min(3,Number(ocrIn.workers)||2)),maxPages:Math.max(0,Math.min(10000,Number(ocrIn.maxPages)||0)),geminiApiKeyEncrypted:encryptedKey},permissions:{reader:'read-only',administrator:'full-control'},updatedAt:new Date()};
      await adminStore.settings.updateOne({_id:'library'},{$set:settings,$setOnInsert:{createdAt:new Date()}},{upsert:true});await recordAudit(adminStore,'admin','settings_updated','library',{ocrEngine:engine,foldersUpdated:!!driveIn.folders});
      const envEngine=process.env.GEMINI_OCR_ENABLED===undefined?null:(geminiOcrEnabled()?'gemini':'local');
      return send(req,res,200,{ok:true,mongoConnected:true,settings:{drive:{account:settings.drive.account,folders,autoBackup:settings.drive.autoBackup,connection:settings.drive.connection},ocr:{engine:envEngine||engine,engineControlledByEnvironment:envEngine!==null,workers:settings.ocr.workers,maxPages:settings.ocr.maxPages,geminiConfigured:!!geminiOcrApiKey(openSecret(encryptedKey)),geminiConfiguredByEnvironment:!!(process.env.GEMINI_OCR_API_KEY||geminiApiKey()),model:geminiOcrModel()},permissions:{reader:'اطلاع فقط',administrator:'إدارة كاملة'}}});
    }
    if(p==='/api/admin/content'&&req.method==='GET'){
      const status=['draft','published','superseded'].includes(url.searchParams.get('status'))?url.searchParams.get('status'):'draft';
      const docs=await adminStore.content.find({status}).sort({updatedAt:-1}).limit(100).project({documentId:1,title:1,category:1,type:1,textKind:1,status:1,sourceUrl:1,reason:1,updatedAt:1,createdAt:1}).toArray();return send(req,res,200,{documents:docs});
    }
    if(p==='/api/admin/content/save'&&req.method==='POST'){
      let body;try{body=JSON.parse((await read(req,2200000)).toString('utf8'));}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}
      const title=String(body.title||'').trim().slice(0,500),text=String(body.text||'').trim(),reason=String(body.reason||'').trim().slice(0,2000);if(title.length<3||text.length<40||!reason)return send(req,res,400,{error:'أدخل عنواناً ونصاً كاملاً وسبباً موثقاً للتعديل.'});
      const documentId=String(body.documentId||'managed_'+randomBytes(12).toString('hex')).slice(0,120);let base=null;try{base=library.document(documentId);}catch{}if(!base&&!documentId.startsWith('managed_'))return send(req,res,404,{error:'الوثيقة الأصلية غير موجودة في فهرس المكتبة.'});
      const record={documentId,title,text,type:['national','judicial','juriscassation'].includes(body.type)?body.type:(base?.type||'national'),category:String(body.category||base?.category||'مواد قانونية').trim().slice(0,180),subcategory:String(body.subcategory||base?.subcategory||'').trim().slice(0,180),date:String(body.date||base?.date||'').slice(0,20),kind:String(body.kind||base?.kind||'law'),textKind:'extracted_text',sourceUrl:String(body.sourceUrl||'').trim().slice(0,1200),sourceLabel:String(body.sourceLabel||base?.sourceLabel||'').slice(0,300),reason,status:'draft',createdAt:new Date(),updatedAt:new Date(),updatedBy:'admin'};
      if(!/^https:\/\//i.test(record.sourceUrl))return send(req,res,400,{error:'أدخل رابطاً رسمياً يبدأ بـ https:// قبل حفظ المسودة.'});
      await adminStore.content.updateMany({documentId,status:'draft'},{$set:{status:'superseded',updatedAt:new Date()}});await adminStore.content.insertOne(record);await recordAudit(adminStore,'admin','draft_saved',documentId,{title,sourceUrl:record.sourceUrl});return send(req,res,201,{ok:true,documentId,status:'draft'});
    }
    if(p==='/api/admin/content/publish'&&req.method==='POST'){
      let body;try{body=await jsonBody(req);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}const documentId=String(body.documentId||'').slice(0,120),draft=await adminStore.content.findOne({documentId,status:'draft'},{sort:{updatedAt:-1}});
      if(!draft)return send(req,res,404,{error:'لا توجد مسودة جاهزة لهذا النص.'});if(!body.confirmReviewed||!draft.sourceUrl||!/^https:\/\//i.test(draft.sourceUrl))return send(req,res,400,{error:'يلزم تأكيد المراجعة والتحقق من رابط المصدر الرسمي.'});
      await adminStore.content.updateMany({documentId,status:'published'},{$set:{status:'superseded',updatedAt:new Date()}});await adminStore.content.updateOne({_id:draft._id},{$set:{status:'published',publishedAt:new Date(),publishedBy:'admin',updatedAt:new Date()}});await recordAudit(adminStore,'admin','content_published',documentId,{title:draft.title,sourceUrl:draft.sourceUrl});library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());return send(req,res,200,{ok:true,documentId,status:'published'});
    }
    if(p==='/api/admin/content/delete'&&req.method==='POST'){
      let body;try{body=await jsonBody(req);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}const documentId=String(body.documentId||'').slice(0,120),result=await adminStore.content.deleteMany({documentId,status:'draft'});if(!result.deletedCount)return send(req,res,404,{error:'لا توجد مسودة قابلة للحذف؛ لا يمكن حذف سجل منشور من هنا.'});await recordAudit(adminStore,'admin','draft_deleted',documentId);return send(req,res,200,{ok:true});
    }
    if(p==='/api/admin/search'&&req.method==='GET'){
      const q=(url.searchParams.get('q')||'').trim().slice(0,160);if(q.length<2)return send(req,res,200,{results:[]});
      const result=library.search({q,scope:'all',limit:20});return send(req,res,200,{results:result.results.map(d=>({id:d.id,title:d.title,category:d.category,textKind:d.textKind,reviewStatus:d.reviewStatus,chars:d.chars,sourceLabel:d.sourceLabel}))});
    }
    if(p==='/api/admin/document'&&req.method==='GET'){
      const id=(url.searchParams.get('id')||'').slice(0,120),draft=adminStore?await adminStore.content.findOne({documentId:id,status:'draft'},{sort:{updatedAt:-1}}):null;const doc=draft?{id:draft.documentId,title:draft.title,text:draft.text,category:draft.category,type:draft.type,textKind:draft.textKind,reviewStatus:'draft',sourceUrl:draft.sourceUrl,sourceLabel:draft.sourceLabel,reason:draft.reason,date:draft.date,kind:draft.kind}:library.document(id);if(!doc)return send(req,res,404,{error:'الوثيقة غير موجودة.'});
      return send(req,res,200,{id:doc.id,title:doc.title,category:doc.category,subcategory:doc.subcategory,type:doc.type,kind:doc.kind,date:doc.date,textKind:doc.textKind,reviewStatus:doc.reviewStatus,issues:doc.issues,chars:doc.chars,text:doc.text,sourceUrl:doc.sourceUrl,sourceLabel:doc.sourceLabel,reason:draft?.reason||''});
    }
    if(p.startsWith('/api/editorial/')){
      if(!localEditor(req)&&!(p==='/api/editorial/ocr/worker'&&req.method==='GET'&&sessionRole(req)==='admin'))return send(req,res,403,{error:'أدوات التحرير متاحة محلياً على هذا الجهاز فقط.'});
      if(p==='/api/editorial/search'&&req.method==='GET'){const q=(url.searchParams.get('q')||'').trim().slice(0,160);if(q.length<2)return send(req,res,200,{results:[]});const result=library.search({q,scope:'all',limit:10});return send(req,res,200,{results:result.results.map(d=>({id:d.id,title:d.title,category:d.category,textKind:d.textKind,reviewStatus:d.reviewStatus,chars:d.chars}))});}
      if(p==='/api/editorial/document'&&req.method==='GET'){const doc=library.document((url.searchParams.get('id')||'').slice(0,120));if(!doc)return send(req,res,404,{error:'الوثيقة غير موجودة.'});return send(req,res,200,{id:doc.id,title:doc.title,text:doc.text,sha256:doc.sourceTextSha256,textKind:doc.textKind,reviewStatus:doc.reviewStatus,sourceLabel:doc.sourceLabel,category:doc.category});}
      if(p==='/api/editorial/history'&&req.method==='GET')return send(req,res,200,{history:localCorrectionHistory(file,(url.searchParams.get('id')||'').slice(0,120))});
      if(p==='/api/editorial/ocr'&&req.method==='GET'){try{return send(req,res,200,localOcrCandidate(path.join(ROOT,'work','ocr.sqlite'),(url.searchParams.get('id')||'').slice(0,120)));}catch(error){return send(req,res,503,{error:'تعذر قراءة نتائج OCR المحلية.'});}}
      if(p==='/api/editorial/ocr/secondary/status'&&req.method==='GET'){const statusFile=path.join(ROOT,'work','secondary-ocr-status.json');if(!fs.existsSync(statusFile))return send(req,res,200,{running:false,status:'not_started'});try{const status=JSON.parse(fs.readFileSync(statusFile,'utf8'));const id=(url.searchParams.get('id')||'').slice(0,120);return send(req,res,200,status.documentId===id?status:{running:false,status:'not_started'});}catch{return send(req,res,200,{running:!!secondaryOcrChild,status:'starting'});}}
      if(p==='/api/editorial/ocr/secondary/start'&&req.method==='POST'){
        let body;try{body=JSON.parse((await read(req,10000)).toString('utf8'));}catch{return send(req,res,400,{error:'صيغة الطلب غير صالحة.'});}
        const id=String(body.id||'').slice(0,120);if(!id)return send(req,res,400,{error:'اختر وثيقة أولاً.'});
        if(secondaryOcrChild)return send(req,res,409,{error:'هناك مقارنة OCR ثانية قيد التشغيل.'});
        try{const candidate=localOcrCandidate(path.join(ROOT,'work','ocr.sqlite'),id);if(!candidate.pages)return send(req,res,409,{error:'لا توجد صفحات عولجت بالمحرك الأساسي لهذه الوثيقة بعد.'});
          let runtime={};try{runtime=JSON.parse(fs.readFileSync(path.join(ROOT,'work','secondary-ocr-runtime.json'),'utf8'));}catch{}
          const py=process.env.PADDLE_OCR_PYTHON||runtime.python;if(!py||!fs.existsSync(py))return send(req,res,503,{error:'المحرك الاختياري غير مثبت. شغّل tools/setup-paddle-ocr.ps1 مرة واحدة بعد تجهيز Python.'});
          const statusFile=path.join(ROOT,'work','secondary-ocr-status.json');fs.writeFileSync(statusFile,JSON.stringify({running:true,documentId:id,processed:0,totalPages:candidate.pages,engine:'paddle_ppocrv5_ar'}));
          secondaryOcrChild=spawn(py,[path.join(ROOT,'tools','read-secondary-ocr.py'),'--document-id',id,'--workers','1'],{cwd:ROOT,windowsHide:true,stdio:'ignore',env:{...process.env,PYTHONPATH:[runtime.pythonPath,process.env.PYTHONPATH].filter(Boolean).join(path.delimiter)}});
          secondaryOcrChild.once('error',()=>{secondaryOcrChild=null;fs.writeFileSync(statusFile,JSON.stringify({running:false,documentId:id,error:'تعذر تشغيل محرك OCR المحلي.'}));});
          secondaryOcrChild.once('exit',(code)=>{secondaryOcrChild=null;if(code!==0){let status={running:false,documentId:id,error:'تعذر إكمال المقارنة. تحقق من سجل التشغيل المحلي.'};try{const prior=JSON.parse(fs.readFileSync(statusFile,'utf8'));status={...prior,running:false,error:prior.lastError||status.error};}catch{}fs.writeFileSync(statusFile,JSON.stringify(status));}});
          return send(req,res,202,{running:true,documentId:id,totalPages:candidate.pages});
        }catch(error){return send(req,res,503,{error:error.message||'تعذر بدء المقارنة المحلية.'});}
      }
      if(p==='/api/editorial/ocr/worker'&&req.method==='GET'){
        const work=path.join(ROOT,'work'),statusFile=path.join(work,'ingestion-status.json'),stopFile=path.join(work,'ingestion.stop');let progress={running:false,status:'not_scheduled'};
        try{progress=ingestionSnapshot(JSON.parse(fs.readFileSync(statusFile,'utf8')));}catch{}
        if(Date.now()-ocrMetricsCache.at>30000){let pages=0,words=0,confidenceWeight=0,weighted=0,lowWords=0,reviewRegions=0;const dbFile=path.join(work,'ocr.sqlite');
          if(fs.existsSync(dbFile)){let db;try{db=new DatabaseSync(dbFile,{readOnly:true});db.exec('PRAGMA busy_timeout=2000');for(const row of db.prepare('SELECT assessment,length(text) chars FROM pages').iterate()){pages++;let a={};try{a=JSON.parse(row.assessment||'{}');}catch{}const count=Number(a.words)||Number(row.chars)||0;words+=Number(a.words)||0;confidenceWeight+=count;weighted+=count*(Number(a.weightedConfidence)||0);lowWords+=Number(a.lowWords)||0;reviewRegions+=(a.reviewRegions||[]).length;}}catch{}finally{try{db?.close();}catch{}}}
          ocrMetricsCache={at:Date.now(),value:{ocrPages:pages,words,meanConfidence:confidenceWeight?Math.round(weighted/confidenceWeight*100)/100:null,lowConfidenceWords:lowWords,reviewRegions}};
        }
        return send(req,res,200,{engine:'Tesseract 5.4 C API · ara · tessdata_best',localWorkerAvailable:localEditor(req),dpi:300,workersActive:!!ingestionChild,running:progress.running===true&&!fs.existsSync(stopFile),pauseRequested:fs.existsSync(stopFile),launchError:ingestionLaunchError,progress,...ocrMetricsCache.value});
      }
      if(p==='/api/editorial/ocr/worker'&&req.method==='POST'){
        let body;try{body=JSON.parse((await read(req,10000)).toString('utf8'));}catch{return send(req,res,400,{error:'صيغة الطلب غير صالحة.'});}
        const work=path.join(ROOT,'work'),stopFile=path.join(work,'ingestion.stop');fs.mkdirSync(work,{recursive:true});
        if(body.action==='pause'){fs.writeFileSync(stopFile,'pause requested');return send(req,res,200,{ok:true,paused:true,message:'سيكتمل عدد قليل من الصفحات الجاري معالجتها ثم تتوقف الدفعة.'});}
        if(!['start','resume'].includes(body.action))return send(req,res,400,{error:'اختر البدء أو الإيقاف المؤقت أو الاستئناف.'});
        const workers=Math.max(1,Math.min(3,Number.parseInt(body.workers,10)||2)),maxPages=Math.max(0,Math.min(10000,Number.parseInt(body.maxPages,10)||0));
        try{fs.rmSync(stopFile,{force:true});}catch{}
        let progress={};try{progress=ingestionSnapshot(JSON.parse(fs.readFileSync(path.join(work,'ingestion-status.json'),'utf8')));}catch{}
        if(ingestionChild||progress.running===true)return send(req,res,200,{ok:true,running:true,message:'المعالجة تعمل بالفعل؛ أزيل طلب الإيقاف المؤقت إن وُجد.'});
        const candidates=[process.env.QALAM_OCR_PYTHON,process.env.PYTHON,'C:\\Users\\z\\.cache\\codex-runtimes\\codex-primary-runtime\\dependencies\\python\\python.exe','python'].filter(Boolean),python=candidates.find(x=>!path.isAbsolute(x)||fs.existsSync(x));
        if(!python)return send(req,res,503,{error:'لم أجد Python. عيّن QALAM_OCR_PYTHON إلى مسار python.exe.'});
        ingestionLaunchError='';const args=['-X','utf8',path.join(ROOT,'tools','read-originals.py'),'--workers',String(workers)];if(maxPages)args.push('--max-pages',String(maxPages));
        try{ingestionChild=spawn(python,args,{cwd:ROOT,windowsHide:true,stdio:'ignore'});ingestionChild.once('error',error=>{ingestionLaunchError=error.message;ingestionChild=null;});ingestionChild.once('exit',()=>{ingestionChild=null;});return send(req,res,202,{ok:true,running:true,workers,maxPages});}
        catch(error){ingestionChild=null;ingestionLaunchError=error.message;return send(req,res,503,{error:'تعذر تشغيل OCR المحلي. تحقق من Python وTesseract.'});}
      }
      if(p==='/api/editorial/apply'&&req.method==='POST'){try{return send(req,res,200,applyLocalCorrection(file,JSON.parse((await read(req,650000)).toString('utf8'))));}catch(error){return send(req,res,400,{error:error.message||'تعذر حفظ التصحيح.'});}}
      if(p==='/api/editorial/revert'&&req.method==='POST'){try{const body=JSON.parse((await read(req,10000)).toString('utf8'));return send(req,res,200,revertLocalCorrection(file,body.historyId));}catch(error){return send(req,res,400,{error:error.message||'تعذر استرجاع النسخة.'});}}
      return send(req,res,404,{error:'خدمة التحرير غير موجودة.'});
    }
    if(p==='/api/ingestion'){
      const progress=path.join(ROOT,'work','ingestion-status.json');
      if(!fs.existsSync(progress))return send(req,res,200,{running:false,status:'not_scheduled'});
      try{return send(req,res,200,ingestionSnapshot(JSON.parse(fs.readFileSync(progress,'utf8'))));}catch{return send(req,res,200,{running:true,status:'updating'});}
    }
    if(p==='/api/stats')return send(req,res,200,library.stats());
    if(p==='/api/categories')return send(req,res,200,{categories:library.categories()});
    if(p==='/api/search')return send(req,res,200,library.search(Object.fromEntries(url.searchParams)));
    if(p==='/api/suggest')return send(req,res,200,library.suggest(url.searchParams.get('q')));
    if(p==='/api/document'){
      const d=library.document((url.searchParams.get('id')||'').slice(0,120));return send(req,res,d?200:404,d||{error:'الوثيقة غير موجودة في هذه النسخة.'});
    }
    if(p==='/api/capabilities'){
      const [ai,speech]=await Promise.all([aiCapability(),speechCapabilities()]);return send(req,res,200,{pdfFree:true,ai,translation:{available:!!deeplApiKey(),target:'français',provider:'DeepL'},speech});
    }
    if(p==='/api/translate'){
      if(req.method!=='POST')return send(req,res,405,{error:'أرسل النص عبر POST.'});
      if(!deeplApiKey())return send(req,res,503,{error:'الترجمة غير مهيأة؛ أضف DEEPL_AUTH_KEY إلى متغيرات Render.'});
      let body;try{body=await jsonBody(req,16000);}catch(error){return send(req,res,error.status||400,{error:error.message});}
      const text=String(body?.text||'').trim();if(!text||text.length>6500)return send(req,res,400,{error:'أدخل نصاً بين حرف واحد و6500 حرف.'});
      try{return send(req,res,200,{translation:await translateWithDeepL(text,'FR')});}catch(error){return send(req,res,502,{error:error.message||'تعذرت الترجمة حالياً.'});}
    }
    if(p==='/api/ask'){
      if(req.method!=='POST')return send(req,res,405,{error:'أرسل السؤال عبر POST.'});
      const body=await jsonBody(req),initial=await answerQuestion(library,{...body,retrieveOnly:true});
      const canAnalyze=initial.canAnalyze;delete initial.canAnalyze;
      if(canAnalyze&&activeAI===0&&(await aiCapability()).available){
        for(const[id,job]of analysisJobs)if(job.expires<Date.now())analysisJobs.delete(id);
        const id=randomBytes(16).toString('hex');activeAI++;analysisJobs.set(id,{status:'running',expires:Date.now()+300000});
        answerQuestion(library,body).then(result=>analysisJobs.set(id,{status:'complete',result,expires:Date.now()+300000})).catch(()=>analysisJobs.set(id,{status:'complete',result:{...initial,limitations:[...(initial.limitations||[]),'تعذر إعداد التحليل؛ تبقى المصادر المعروضة متاحة.']},expires:Date.now()+300000})).finally(()=>{activeAI--;});
        initial.jobId=id;initial.analysisPending=true;
      }
      return send(req,res,200,initial);
    }
    if(p==='/api/answer'){
      if(req.method!=='GET')return send(req,res,405,{error:'استعمل GET لقراءة النتيجة.'});
      const id=(url.searchParams.get('id')||'').slice(0,40),job=analysisJobs.get(id);
      if(!job||job.expires<Date.now()){analysisJobs.delete(id);return send(req,res,404,{error:'انتهت صلاحية نتيجة التحليل.'});}
      return send(req,res,200,job.status==='complete'?{status:'complete',result:job.result}:{status:'running'});
    }
    if(p==='/api/stt'){
      if(req.method!=='POST')return send(req,res,405,{error:'التسجيل يتطلب POST.'});
      return send(req,res,200,await transcribe(await read(req,4000000)));
    }
    if(p==='/api/tts'){
      if(req.method!=='POST')return send(req,res,405,{error:'القراءة تتطلب POST.'});const body=await jsonBody(req);
      return send(req,res,200,await synthesize(body.text),'audio/wav');
    }
    if(p.startsWith('/api/'))return send(req,res,404,{error:'الخدمة غير موجودة.'});
    if(!['GET','HEAD'].includes(req.method))return send(req,res,405,'Method not allowed','text/plain');
    const relative=decodeURIComponent(p==='/admin'?'/admin.html':p==='/archive'?'/archive.html':p==='/login'?'/login.html':p==='/change-password'?'/change-password.html':p==='/'?'/index.html':p).replace(/^\/+/,''),target=path.resolve(PUBLIC,relative);
    if(!target.startsWith(PUBLIC+path.sep)||relative.includes('\0'))return send(req,res,403,'Forbidden','text/plain');
    const type=MIME[path.extname(target).toLowerCase()];if(!type||!fs.existsSync(target)||!fs.statSync(target).isFile())return send(req,res,404,'Not found','text/plain');
    const bytes=fs.readFileSync(target),etag='"'+createHash('sha1').update(bytes).digest('hex')+'"';
    if(req.headers['if-none-match']===etag){res.writeHead(304,{...headers,ETag:etag});return res.end();}
    res.setHeader('ETag',etag);return send(req,res,200,bytes,type);
  }catch(e){if(res.headersSent){res.destroy();return;}send(req,res,e.status||503,{error:e.status?e.message:'تعذر إتمام العملية حالياً. حاول مجدداً أو استخدم الخدمة المحلية البديلة.'});}
});
server.requestTimeout=70000;server.headersTimeout=15000;
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'المنفذ مستخدم. أغلق نسخة قلم السابقة أو غيّر PORT.':error.message);process.exit(1);});
server.listen(PORT,HOST,()=>console.log(`Qalam Smart ${library.meta.version}: http://localhost:${PORT} — ${library.meta.documents} records; PDF-independent; PID ${process.pid}`));
function stop(){server.close(()=>{library.close();process.exit(0);});setTimeout(()=>process.exit(0),1500).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);

