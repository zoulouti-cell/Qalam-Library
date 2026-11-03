import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync,gzipSync,constants } from 'node:zlib';
import { createHash,randomBytes,createHmac,timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Library } from './src/library.mjs';
import { answerQuestion,aiCapability } from './src/assistant.mjs';
import { speechCapabilities,transcribe,synthesize } from './src/speech.mjs';
import { applyLocalCorrection,localCorrectionHistory,localOcrCandidate,revertLocalCorrection } from './src/editorial.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)),PUBLIC=path.join(ROOT,'public');
const PORT=Number(process.env.PORT||4188),HOST=process.env.HOST||'0.0.0.0';
const accessPassword=process.env.LIBRARY_ACCESS_PASSWORD||'',sessionSecret=process.env.LIBRARY_SESSION_SECRET||'';
if(process.env.NODE_ENV==='production'&&(!accessPassword||!sessionSecret))throw new Error('Set LIBRARY_ACCESS_PASSWORD and LIBRARY_SESSION_SECRET before production startup.');
const file=process.env.QALAM_DB_PATH||path.join(ROOT,'data','library.sqlite');
if(!fs.existsSync(file))throw new Error('قاعدة المكتبة غير موجودة. شغّل node tools/build-library.mjs أولاً.');
const library=new Library(file),limits=new Map();
let activeAI=0;const analysisJobs=new Map();let secondaryOcrChild=null,ingestionChild=null,ingestionLaunchError='',ocrMetricsCache={at:0,value:null};
const headers={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN',
  'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
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
function rate(req,post){const key=(req.socket.remoteAddress||'local')+':'+(post?'write':'read'),now=Date.now();let value=limits.get(key);if(!value||now-value.start>60000)value={start:now,n:0};value.n++;limits.set(key,value);return value.n<=(post?35:400);}
async function read(req,max){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max){const e=new Error('حجم الطلب أكبر من المسموح.');e.status=413;throw e;}chunks.push(c);}return Buffer.concat(chunks);}
async function jsonBody(req){try{return JSON.parse((await read(req,40000)).toString('utf8'));}catch(e){if(e.status)throw e;const error=new Error('صيغة الطلب غير صالحة.');error.status=400;throw error;}}
function sameOrigin(req){if(!req.headers.origin)return !process.env.NODE_ENV||process.env.NODE_ENV!=='production';try{const u=new URL(req.headers.origin);return u.host===req.headers.host;}catch{return false;}}
function authCookie(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2))['qalam_session']||'';}
function validSession(req){if(!sessionSecret)return !process.env.NODE_ENV||process.env.NODE_ENV!=='production';const [expiry,signature,...rest]=authCookie(req).split('.');if(rest.length||!/^[0-9]{10,}$/.test(expiry||'')||Number(expiry)<Date.now())return false;const expected=createHmac('sha256',sessionSecret).update(expiry).digest('hex');const a=Buffer.from(signature||''),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
function localEditor(req){const remote=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');return ['127.0.0.1','::1'].includes(remote)&&sameOrigin(req);}
function ingestionSnapshot(progress){const age=Date.now()-Date.parse(progress.lastUpdate||'');const stale=progress.running===true&&Number.isFinite(age)&&age>300000;return stale?{...progress,running:false,status:'stalled',stale:true}:progress;}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  try{
    if(!rate(req,req.method==='POST'))return send(req,res,429,{error:'طلبات كثيرة؛ حاول بعد قليل.'});
    const url=new URL(req.url,'http://localhost:'+PORT),p=url.pathname;
    if(req.method==='POST'&&!sameOrigin(req))return send(req,res,403,{error:'هذا الطلب غير مسموح.'});
    if(p.startsWith('/api/')&&!['GET','POST','HEAD'].includes(req.method))return send(req,res,405,{error:'طريقة الطلب غير مدعومة.'});
    if(p==='/api/health')return send(req,res,200,{ok:true});
    if(p==='/api/session')return send(req,res,200,{authenticated:validSession(req)});
    if(p==='/api/login'&&req.method==='POST'){
      if(!accessPassword||!sessionSecret)return send(req,res,503,{error:'تسجيل الدخول غير مهيأ بعد.'});
      const body=await jsonBody(req),given=Buffer.from(String(body.password||'')),expected=Buffer.from(accessPassword);
      if(given.length!==expected.length||!timingSafeEqual(given,expected))return send(req,res,401,{error:'كلمة المرور غير صحيحة.'});
      const expiry=String(Date.now()+7*86400000),signature=createHmac('sha256',sessionSecret).update(expiry).digest('hex');
      res.setHeader('Set-Cookie',`qalam_session=${expiry}.${signature}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
      return send(req,res,200,{authenticated:true});
    }
    if(p==='/api/logout'&&req.method==='POST'){res.setHeader('Set-Cookie','qalam_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return send(req,res,200,{ok:true});}
    const loginAsset=p==='/login.html'||p==='/login.js';
    if(process.env.NODE_ENV==='production'&&!validSession(req)&&!loginAsset){
      if(p.startsWith('/api/'))return send(req,res,401,{error:'سجّل الدخول أولاً.'});
      return send(req,res,200,fs.readFileSync(path.join(PUBLIC,'login.html')),'text/html; charset=utf-8');
    }
    if(p.startsWith('/api/editorial/')){
      if(!localEditor(req))return send(req,res,403,{error:'أدوات التحرير متاحة محلياً على هذا الجهاز فقط.'});
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
        return send(req,res,200,{engine:'Tesseract 5.4 C API · ara · tessdata_best',dpi:300,workersActive:!!ingestionChild,running:progress.running===true&&!fs.existsSync(stopFile),pauseRequested:fs.existsSync(stopFile),launchError:ingestionLaunchError,progress,...ocrMetricsCache.value});
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
      const [ai,speech]=await Promise.all([aiCapability(),speechCapabilities()]);return send(req,res,200,{pdfFree:true,ai,speech});
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
    const relative=decodeURIComponent(p==='/'?'/index.html':p).replace(/^\/+/,''),target=path.resolve(PUBLIC,relative);
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
