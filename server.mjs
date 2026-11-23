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
import { DRIVE_SHELVES, FRENCH_SHELVES } from './src/catalog.mjs';
import { bundledAgreementTexts } from './src/agreement-texts.mjs';
import { bundledLegalMonitoringContent } from './src/legal-monitoring-content.mjs';
import { bundledFrenchStudies } from './src/french-studies-content.mjs';
import { answerQuestion,aiCapability,GROQ_CHAT_MODELS,selectedGroqModel } from './src/assistant.mjs';
import { answerFromWeb } from './src/websearch.mjs';
import { geminiApiKey,geminiOcrApiKey,geminiOcrModel,geminiOcrEnabled } from './src/gemini.mjs';
import { deeplApiKey,translateWithDeepL } from './src/deepl.mjs';
import { speechCapabilities,transcribe,synthesize } from './src/speech.mjs';
import { applyLocalCorrection,localCorrectionHistory,localOcrCandidate,revertLocalCorrection } from './src/editorial.mjs';
import { connectAdminStore,sealSecret,openSecret,recordAudit,hashPassword,verifyPassword,Binary } from './src/admin-store.mjs';
import { emailReady,ownerEmail,validEmail,activationToken,tokenDigest,safeToken,activationUrl,sendMail,activationMessage,notifyOwner,registrationConfirmUrl,registrationConfirmMessage,registrationApprovedMessage,registrationRejectedMessage } from './src/account-mail.mjs';
import { googleLoginConfig,beginGoogleLogin,finishGoogleFlow,clearGoogleFlowCookie,exchangeGoogleCode,exchangeGoogleTokens,revokeGoogleToken,DRIVE_WRITE_SCOPE } from './src/google-login.mjs';
import { setAgreementOverrides,countShelfPdfs,warmAgreementIndex,libraryDriveRoot,listDriveFolder,openDrivePdf,openDriveSourceFile,readDrivePdf,searchDrivePdfs,matchDrivePdf,listAgreementPdfs,agreementDriveIdFor,scanLibraryPdfs,scanFolderPdfs,resolveDocumentSourcePdf,resolveJudicialDrivePdf,driveOriginalsStatus,resolveOriginalsFolder,uploadOriginalFile,moveOriginalDriveFile,trashOriginalDriveFile,judicialFolderIdFor,frenchJudicialFolderIdFor,FRENCH_UPDATES_FOLDER_ID,MOROCCAN_UPDATES_FOLDER_ID,setDriveUserWriter,forgetDriveUserToken,probeDriveWriteAccess, isPendingCassationDriveItem, PENDING_CASSATION_FOLDER_ID } from './src/drive.mjs';
import { clientIp } from './src/client-ip.mjs';
import { createPasswordReset } from './src/password-reset.mjs';
import { makeTrashEntry,trashView,restoreTrashEntry } from './src/trash.mjs';
import { auditReport,auditCard,fixCard,decisionKey,isCardKind } from './src/card-audit.mjs';
import { publicationCategory,readinessOf,lawNumberOf, dueReports,renderReport,makeObservation,mergeLegislativeObservation,mayAutoPublish,tickerWindowStart,titleNeedsArabic,canAutoPublishAfterRelease,scheduleAfterRelease,moveLawsToLawSections,lawStagesComplete,publicationRecord,effectiveToday,recentUpdates,tickerItems,isTickerItem,PUBLICATION_DELAY_MS,REPORTS } from './src/legal-monitoring.mjs';
import { KINDS as CONTRIB_KINDS,NOTE_TYPES,STATUSES as CONTRIB_STATUSES,LIMITS as CONTRIB_LIMITS,extractFileText,sniffOriginal,safeFileName,newFileId,ORIGINAL_MIME,originalsSection,originalDriveName,validateAddition,validateNote,draftFromContribution,userView as contributionView,contributionMail,ownerContributionMail,oneLine as contribLine,cleanText as contribClean } from './src/contributions.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url)),PUBLIC=path.join(ROOT,'public');
/* أعداد الأرفف المرتبطة بمجلدات Drive (القسم الفرنسي وغيره): العدّ من Drive لا من القاعدة، ويُجدَّد في الخلفية كل 10 دقائق. */
const shelfCounts=new Map();let shelfRefreshAt=0,shelfRefreshing=false;
function refreshShelfCounts(){if(shelfRefreshing||Date.now()-shelfRefreshAt<10*60_000)return;shelfRefreshing=true;shelfRefreshAt=Date.now();
  (async()=>{for(const [name,id] of Object.entries(DRIVE_SHELVES)){try{const n=await countShelfPdfs(id);if(n!==null)shelfCounts.set(name,n);}catch{}}})().finally(()=>{shelfRefreshing=false;});}
function withShelfCounts(categories){refreshShelfCounts();return categories.map(c=>DRIVE_SHELVES[c.name]&&shelfCounts.has(c.name)?{...c,count:c.count>0?c.count:shelfCounts.get(c.name),driveCount:shelfCounts.get(c.name),driveFolderId:DRIVE_SHELVES[c.name]}:c);}

const PORT=Number(process.env.PORT||4188),HOST=process.env.HOST||'0.0.0.0';
const accessPassword=process.env.LIBRARY_ACCESS_PASSWORD||'',sessionSecret=process.env.LIBRARY_SESSION_SECRET||'';
const adminPassword=process.env.LIBRARY_ADMIN_PASSWORD||'';
/* الدخول بكلمة الإدارة المشتركة (بلا بريد) صار اختياريًا ومعطّلًا ما لم يُضبط LIBRARY_ADMIN_PASSWORD؛ حذف المتغير من Render يُنهيه وتُرفض جلساته فورًا.
   LIBRARY_BOOTSTRAP_ADMIN_EMAIL: بريد مدير الطوارئ؛ يُعاد مديرًا فعّالًا عند كل إقلاع (مسار الاسترجاع بدل الكلمة المشتركة). */
const sharedAdminEnabled=!!adminPassword,bootstrapAdminEmail=String(process.env.LIBRARY_BOOTSTRAP_ADMIN_EMAIL||'').trim().toLowerCase();
const bootstrapLocked=(email,what)=>email&&bootstrapAdminEmail&&email===bootstrapAdminEmail?'هذا حساب الطوارئ المحدد في Render (LIBRARY_BOOTSTRAP_ADMIN_EMAIL) ويُعاد مديرًا فعّالًا عند كل إقلاع؛ أزل المتغير أولًا إن أردت '+what+'.':'';
const registrationLimits=new Map();
function registrationAllowed(req){const key=clientIp(req),now=Date.now(),item=registrationLimits.get(key)||{start:now,count:0};if(now-item.start>3600000){item.start=now;item.count=0;}item.count++;registrationLimits.set(key,item);return item.count<=5;}

/* brute-force throttling for /api/login and /api/admin/login, mirroring the office app's pattern:
   per-IP and per-account counters so neither switching address nor targeting one account bypasses it. */
const loginAttemptsByIp=new Map(),loginAttemptsByAccount=new Map();
function loginThrottled(ip,account=''){
  const byIp=loginAttemptsByIp.get(ip);
  if(byIp&&byIp.until>Date.now()&&byIp.count>=8)return true;
  const byAccount=account?loginAttemptsByAccount.get(account):null;
  return Boolean(byAccount&&byAccount.until>Date.now()&&byAccount.count>=10);
}
function recordLoginFailure(ip,account=''){
  const byIp=loginAttemptsByIp.get(ip);
  if(!byIp||byIp.until<=Date.now())loginAttemptsByIp.set(ip,{count:1,until:Date.now()+10*60_000});
  else byIp.count+=1;
  if(account){
    const byAccount=loginAttemptsByAccount.get(account);
    if(!byAccount||byAccount.until<=Date.now())loginAttemptsByAccount.set(account,{count:1,until:Date.now()+15*60_000});
    else byAccount.count+=1;
  }
}
function clearLoginFailures(ip,account=''){loginAttemptsByIp.delete(ip);if(account)loginAttemptsByAccount.delete(account);}
async function purgeUnconfirmedRegistrations(){if(!adminStore)return;try{await adminStore.users.deleteMany({accountStatus:'unconfirmed',activationExpiresAt:{$lt:new Date()}});}catch(error){console.error('Unconfirmed registration cleanup failed:',error?.message||'unknown error');}}
setInterval(purgeUnconfirmedRegistrations,3600_000).unref();setTimeout(purgeUnconfirmedRegistrations,30_000).unref();
setInterval(()=>{const now=Date.now();for(const table of [loginAttemptsByIp,loginAttemptsByAccount])for(const [key,value] of table)if(value.until<=now)table.delete(key);},10*60_000).unref();
async function inviteUser(email,role,createdBy){
  const token=activationToken(),now=new Date(),user={email,role,active:false,accountStatus:'pending',activationTokenHash:tokenDigest(token),activationExpiresAt:new Date(now.getTime()+24*3600000),createdAt:now,createdBy,loginCount:0};
  await adminStore.users.insertOne(user);
  try{const mail=activationMessage(activationUrl(token));await sendMail(email,mail.subject,mail.text,mail.html);}
  catch(error){await adminStore.users.deleteOne({email,accountStatus:'pending',activationTokenHash:user.activationTokenHash});throw error;}
  await adminStore.users.updateOne({email},{$set:{invitationSentAt:new Date()}});
  await recordAudit(adminStore,createdBy,'user_invited',email,{role});
  return user;
}
if(process.env.NODE_ENV==='production'&&(!accessPassword||!sessionSecret))throw new Error('Set library access and session secrets before production startup.');
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
library.setBundledContent([...bundledAgreementTexts,...bundledLegalMonitoringContent,...bundledFrenchStudies]);
const adminStore=await connectAdminStore(process.env.MONGODB_URI||'');
async function refreshAgreementOverrides(){if(!adminStore?.agreementOverrides)return;try{setAgreementOverrides(await adminStore.agreementOverrides.find({}).toArray());}catch(error){console.error('agreement overrides:',error?.message||error);}}
await refreshAgreementOverrides();
/* سدّ ثغرة السجلات القديمة: تاريخ النفاذ يُنسخ من بطاقة الرصد إلى مادتها المنشورة ليظهر بالأحمر في «نصوص عامة». */
if(adminStore?.legalMonitorItems&&adminStore?.content){try{const rows=await adminStore.legalMonitorItems.find({state:'published',effectiveDate:{$type:'string',$ne:''}}).project({_id:1,effectiveDate:1}).toArray();for(const row of rows)await adminStore.content.updateMany({origin:'legal-monitor',monitorItemId:String(row._id),effectiveDate:{$exists:false}},{$set:{effectiveDate:row.effectiveDate}});}catch(error){console.error('effectiveDate backfill:',error?.message||error);}}
/* استعادة كلمة المرور بالبريد؛ تصفير محاولات الدخول الفاشلة بعد نجاحها لأن صاحب الصندوق أثبت ملكيته. */
const passwordReset=createPasswordReset({store:adminStore,afterReset:(ip,email)=>clearLoginFailures(ip,email)});
async function ensureBootstrapAdmin(){
  if(!adminStore||!bootstrapAdminEmail)return;
  if(!validEmail(bootstrapAdminEmail)){console.error('LIBRARY_BOOTSTRAP_ADMIN_EMAIL is not a valid e-mail address; ignored.');return;}
  try{
    const email=bootstrapAdminEmail,now=new Date(),user=await adminStore.users.findOne({email},{projection:{role:1,active:1,accountStatus:1}});
    if(!user){await adminStore.users.insertOne({email,role:'admin',active:true,accountStatus:'active',mustChangePassword:false,createdAt:now,createdBy:'bootstrap',loginCount:0});await recordAudit(adminStore,'bootstrap','bootstrap_admin_ensured',email,{created:true});return;}
    if(user.role==='admin'&&user.active&&user.accountStatus==='active')return;
    await adminStore.users.updateOne({_id:user._id},{$set:{role:'admin',active:true,accountStatus:'active',updatedAt:now}});
    await recordAudit(adminStore,'bootstrap','bootstrap_admin_ensured',email,{created:false,from:{role:user.role||'',active:!!user.active,accountStatus:user.accountStatus||''}});
  }catch(error){console.error('Bootstrap admin failed:',error?.message||'unknown error');}
}
await ensureBootstrapAdmin();
/* ربط Drive للكتابة: رمز التحديث لحساب المدير مخزَّن مشفّرًا في إعدادات المكتبة، ويقرؤه طبقة Drive عند كل كتابة. */
if(adminStore)setDriveUserWriter(async()=>{const saved=await adminStore.settings.findOne({_id:'library'},{projection:{driveWrite:1}}),link=saved?.driveWrite;const refreshToken=link?openSecret(link.refreshTokenEncrypted):'';return refreshToken?{refreshToken,email:link.email||''}:null;});
async function assistantPolicy(){
  const saved=adminStore?await adminStore.settings.findOne({_id:'library'},{projection:{assistant:1}}):null;
  const config=saved?.assistant||{};
  const configuredModel=selectedGroqModel();
  return {aiEnabled:config.aiEnabled!==false,translationEnabled:config.translationEnabled!==false,webSearchEnabled:config.webSearchEnabled!==false,translationEngine:config.translationEngine==='local'?'local':'deepl',processingLevel:['fast','balanced','deep'].includes(config.processingLevel)?config.processingLevel:'balanced',groqModel:GROQ_CHAT_MODELS.includes(config.groqModel)?config.groqModel:GROQ_CHAT_MODELS.includes(configuredModel)?configuredModel:GROQ_CHAT_MODELS[0]};
}
async function configuredOwnerEmail(){const saved=adminStore?await adminStore.settings.findOne({_id:'library'},{projection:{ownerEmail:1}}):null;return String(saved?.ownerEmail||ownerEmail()).trim().toLowerCase();}
function contributorEmail(req){const current=sessionInfo(req);if(!current?.account||['legacy','env'].includes(current.account))return '';try{return Buffer.from(current.account,'base64url').toString('utf8');}catch{return '';}}
async function mailContributor(c,event){try{if(!emailReady()||!validEmail(c.userEmail))return false;const mail=contributionMail(c,event);if(!mail)return false;await sendMail(c.userEmail,mail.subject,mail.text,mail.html);return true;}catch(error){console.error('Contribution mail failed:',error?.message||'delivery_error');return false;}}
async function mailOwnerAboutContribution(c){try{const owner=await configuredOwnerEmail();if(!emailReady()||!validEmail(owner))return false;const mail=ownerContributionMail(c);await sendMail(owner,mail.subject,mail.text,mail.html);return true;}catch(error){console.error('Owner contribution mail failed:',error?.message||'delivery_error');return false;}}
async function sendOriginalFile(req,res,file,mode){
  const raw=file.data,buffer=raw?.buffer?Buffer.from(raw.buffer.subarray(0,raw.position??raw.buffer.length)):Buffer.from(raw),ext=file.ext,asDownload=mode==='download'||ext==='docx',type=ORIGINAL_MIME[ext]||'application/octet-stream',name=encodeURIComponent(safeFileName(file.name,ext));
  res.writeHead(200,{...headers,'Content-Type':type,'Content-Disposition':`${asDownload?'attachment':'inline'}; filename="original.${ext}"; filename*=UTF-8''${name}`,'Cache-Control':'private, no-store, max-age=0','Content-Length':buffer.length,'X-Content-Type-Options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:buffer);
}
const fileMeta=f=>({id:f.id,name:f.name,ext:f.ext,size:f.size});
/* بعد النشر تُنقل الأصول من الخادم إلى Drive ثم تُحذف منه فلا يبقى على الخادم إلا النص. فشل النقل لا يُسقط النشر: يبقى الأصل محفوظًا هنا ويمكن إعادة المحاولة. */
async function moveOriginalsToDrive(doc,{subfolder=''}={}){
  const all=Array.isArray(doc.originalFiles)?doc.originalFiles:[],pending=all.filter(f=>!f.driveId);
  const result={total:all.length,moved:0,failed:0,error:'',folder:''};if(!pending.length)return result;
  let folder;const section=originalsSection(doc),court=section.id==='jurisprudence'?judicialFolderIdFor(doc.issuer||''):'',frenchCourt=doc.country==='fr'&&['decision','jurisprudence'].includes(doc.kind)?frenchJudicialFolderIdFor(doc.issuer||''):'',fixedFolder=doc.pendingCassation?PENDING_CASSATION_FOLDER_ID:(doc.country==='ma'&&['update','justice_digital'].includes(doc.kind)?MOROCCAN_UPDATES_FOLDER_ID:(doc.country==='fr'&&doc.kind==='update'?FRENCH_UPDATES_FOLDER_ID:frenchCourt)),resolve=folderId=>resolveOriginalsFolder({sectionLabel:section.label,sectionAliases:section.aliases,subfolder,folderId});
  if(doc.country==='fr'&&['decision','jurisprudence'].includes(doc.kind)&&!frenchCourt)return {...result,failed:pending.length,error:'حدد المحكمة أو المجلس الفرنسي بالاسم المعتمد قبل نقل الأصل.'};
  const targetFolder=fixedFolder||court;
  try{folder=await resolve(targetFolder);}catch(first){try{if(!targetFolder)throw first;folder=await resolve('');}catch(error){return {...result,failed:pending.length,error:error.message||'تعذر تحديد مجلد الأصول في Drive.'};}}
  result.folder=folder.path;const updated=all.map(f=>({...f}));
  for(const meta of pending){
    const file=await adminStore.contributionFiles.findOne({id:meta.id});if(!file){result.failed++;result.error='ملف الأصل غير موجود على الخادم.';break;}
    try{
      const raw=file.data,buffer=raw?.buffer?Buffer.from(raw.buffer.subarray(0,raw.position??raw.buffer.length)):Buffer.from(raw),index=all.findIndex(f=>f.id===meta.id);
      const up=await uploadOriginalFile({folderId:folder.id,fileName:originalDriveName(doc,file.ext,index,all.length),ext:file.ext,buffer,description:[doc.sourceLabel,doc.sourceUrl].filter(Boolean).join('\n')});
      Object.assign(updated[index],{name:up.name,size:up.size||meta.size,driveId:up.id,folderPath:folder.path});await adminStore.contributionFiles.deleteOne({id:meta.id});result.moved++;
    }catch(error){result.failed++;result.error=error.message||'تعذر رفع الأصل إلى Drive.';break;}
  }
  if(result.moved){
    await adminStore.content.updateMany({documentId:doc.documentId,status:{$in:['draft','published']}},{$set:{originalFiles:updated}});
    if(doc.contributionId)await adminStore.contributions.updateOne({id:doc.contributionId},{$set:{originalFiles:updated}});
    library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());
  }
  return result;
}
async function publishPendingCassationOriginals(doc){
  const targetId=judicialFolderIdFor(doc.issuer||'');
  if(!targetId)throw new Error('تعذر تحديد مجلد محكمة النقض المعتمد لنقل الأصل بعد الاعتماد.');
  const all=Array.isArray(doc.originalFiles)?doc.originalFiles:[],pending=all.filter(file=>file.driveId);
  let moved=0;for(const file of pending){const result=await moveOriginalDriveFile(file.driveId,targetId);if(result.moved)moved++;}
  return {total:pending.length,moved,targetFolderId:targetId};
}
async function moveContribution(id,status,extra={}){const now=new Date();return adminStore.contributions.findOneAndUpdate({id},{$set:{status,statusChangedAt:now,updatedAt:now,userNotifyPending:true,...extra}},{returnDocument:'after'});}
if(adminStore){setTimeout(()=>refreshSupersessions(),0);try{const done=await moveLawsToLawSections({content:adminStore.content,items:adminStore.legalMonitorItems,settings:adminStore.settings});if(!done.skipped){console.log('Laws moved out of updates:',done.movedMa,'Moroccan,',done.movedFr,'French');await recordAudit(adminStore,'system','laws_moved_out_of_updates','managedContent',{movedMa:done.movedMa,movedFr:done.movedFr});}}catch(error){console.error('Laws category migration skipped:',error?.message||'unknown error');}try{library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());}catch{console.error('Library managed-content index unavailable.');}}
let activeAI=0,activeDriveOcr=false;const analysisJobs=new Map();let secondaryOcrChild=null,ingestionChild=null,ingestionLaunchError='',ocrMetricsCache={at:0,value:null};
/* نطاق المراقبة: الرفوف الفرنسية، «الأبحاث والدراسات» وما تحته، «إضافات النقض»، «قرارات المحكمة الدستورية»، «نصوص التحيين» (أصول النصوص التشريعية المغربية بانتظار اعتماد المدير). ما سواها (الاتفاقيات والقوانين والاجتهادات الأساسية) خارج المراقبة فلا يُحتسب تغييره. */
const MONITOR_SCOPE_VERSION=2;
const MONITORED_FOLDERS=[...FRENCH_SHELVES.map(name=>({id:DRIVE_SHELVES[name],path:name})),{id:'10-Bp3BUlI7OodtfMjlMynB9BY7349CvE',path:'الأبحاث والدراسات'},{id:'19axGmiNPVmCPqgfPIE9urOvM0HEZPDKE',path:'الاجتهادات القضائية / إضافات النقض'},{id:DRIVE_SHELVES['القضاء الدستوري'],path:'المادة الدستورية / قرارات المحكمة الدستورية'},{id:'14fPme5j1TWFO458B9N-8N93X7w2yt-3W',path:'القوانين / نصوص التحيين'}];
let driveScanPromise=null;
async function runDriveMetadataScan(actor='system'){
  if(!adminStore)throw new Error('قاعدة إدارة المكتبة غير متاحة؛ تعذر حفظ نتيجة الفحص.');
  if(driveScanPromise)return driveScanPromise;
  driveScanPromise=(async()=>{
    const now=new Date(),previousState=await adminStore.driveMonitorState.findOne({_id:'latest'}),baseline=!previousState?.checkedAt||previousState.scopeVersion!==MONITOR_SCOPE_VERSION;
    await adminStore.driveMonitorState.updateOne({_id:'latest'},{$set:{status:'running',startedAt:now,error:''}},{upsert:true});
    try{
      const files=await scanFolderPdfs(MONITORED_FOLDERS);
      // scanLibraryPdfs لا تُعيد إلا جرداً مكتمل التصفح؛ لا ترفض المكتبات الكبيرة بسبب حد اعتباطي.
      const previous=await adminStore.driveMonitorFiles.find({present:true}).project({_id:1,name:1,folder:1,modifiedTime:1,size:1}).toArray(),old=new Map(baseline?[]:previous.map(x=>[x._id,x]));
      const added=[],changed=[],operations=[];
      for(const f of files){const next={name:String(f.name||'').slice(0,500),folder:String(f.path||'').slice(0,1000),modifiedTime:f.modifiedTime||'',size:Number(f.size)||0,present:true,checkedAt:now};const before=old.get(f.id);if(!before&&!baseline)added.push({name:next.name,folder:next.folder,status:'جديد'});else if(before&&(before.name!==next.name||before.folder!==next.folder||before.modifiedTime!==next.modifiedTime||before.size!==next.size))changed.push({name:next.name,folder:next.folder,status:'معدّل'});old.delete(f.id);operations.push({updateOne:{filter:{_id:f.id},update:{$set:next},upsert:true}});}
      const removed=[...old.values()].map(f=>({name:f.name,folder:f.folder,status:'أزيل من Drive'}));
      for(let i=0;i<operations.length;i+=500)await adminStore.driveMonitorFiles.bulkWrite(operations.slice(i,i+500),{ordered:false});
      await adminStore.driveMonitorFiles.updateMany({present:true,checkedAt:{$ne:now}},{$set:{present:false,removedAt:now}});
      const completedAt=new Date(),result={status:'complete',available:true,checkedAt:completedAt.toISOString(),scopeVersion:MONITOR_SCOPE_VERSION,files:files.length,added:added.length,changed:changed.length,removed:removed.length,changes:[...added,...changed,...removed].slice(0,300),baseline};
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
let legalReportRun=null;
async function runLegalReports(){
  if(!adminStore||legalReportRun)return;
  legalReportRun=(async()=>{
    const now=new Date();
    for(const slot of dueReports(now)){
      const reportId=`${slot.type}:${slot.localDate}`;
      try{
        const existing=await adminStore.legalMonitorReports.findOne({_id:reportId},{projection:{_id:1}});if(existing)continue;
        const from=new Date(now.getTime()-(REPORTS[slot.type]?.hours||168)*60*60_000);
        const observations=await adminStore.legalMonitorItems.find({receivedAt:{$gte:from},'source.official':true,'source.verified':true}).sort({eventDate:-1}).limit(500).toArray();
        const report={_id:reportId,type:slot.type,localDate:slot.localDate,title:renderReport(slot.type,[],{localDate:slot.localDate}).split('\n')[0],text:renderReport(slot.type,observations,{localDate:slot.localDate,generatedAt:now}),observationIds:observations.map(item=>item.id),status:'generated',generatedAt:now,sourceCount:observations.length};
        const result=await adminStore.legalMonitorReports.updateOne({_id:reportId},{$setOnInsert:report},{upsert:true});
        if(result.upsertedCount)await recordAudit(adminStore,'scheduler','legal_report_generated',reportId,{type:slot.type,sourceCount:observations.length});
        if(REPORTS[slot.type]?.publishesLibrary){const ready=await adminStore.legalMonitorItems.find({state:'ready'}).limit(100).toArray();for(const item of ready){try{if(mayAutoPublish(item))await publishLegalItem({...item,id:item._id},'scheduler');}catch(error){console.error('Saturday legal publication failed:',error?.message||'unknown error');}}}
      }catch(error){console.error('Scheduled legal report failed:',slot.type,error?.message||'unknown error');}
    }
  })().finally(()=>{legalReportRun=null;});
  return legalReportRun;
}
const legalReportTimer=setInterval(()=>runLegalReports().catch(error=>console.error('Legal report scheduler failed:',error?.message||'unknown error')),15_000);
/* نشر المستجدات بعد مهلة الاعتراض (24 ساعة) ما لم يُتحفَّظ عليها؛ ونشر فوري أو حذف بقرار المدير. */
async function refreshSupersessions(){try{const rows=await adminStore.legalMonitorItems.find({state:'published',supersedesId:{$type:'string',$ne:''}}).project({supersedesId:1,documentId:1,title:1}).limit(500).toArray();library.setSupersessions(rows.map(r=>({oldId:r.supersedesId,newId:r.documentId||'',newTitle:r.title||''})));}catch{console.error('Supersession refresh failed.');}}
async function loadDocOverrides(){if(!adminStore)return;try{library.setDocOverrides(await adminStore.docOverrides.find({}).toArray());}catch(error){console.error('Document overrides unavailable:',error?.message||'unknown');}}

/* مزامنة نص المواد المنشورة مع بطاقاتها (العنوان والمصدر والملخص) بعد أي تعديل مباشر على البطاقات. */
async function syncPublishedTexts(now=new Date()){
  let changed=0;const rows=await adminStore.legalMonitorItems.find({state:'published',documentId:{$exists:true}}).toArray();
  for(const full of rows.filter(isCardKind)){const rec=publicationRecord({...full,id:String(full._id)});const r=await adminStore.content.updateOne({documentId:full.documentId,origin:'legal-monitor',status:'published',$or:[{text:{$ne:rec.text}},{title:{$ne:rec.title}},{sourceLabel:{$ne:rec.sourceLabel}}]},{$set:{text:rec.text,title:rec.title,sourceLabel:rec.sourceLabel,updatedAt:now}});changed+=r.modifiedCount||0;}
  return changed;
}
/* الفحص الدوري: تدقيق أسبوعي لبطاقات المستجدات (كل اثنين بعد السابعة بتوقيت المغرب) يُحفظ تقريراً ويُرسل إلى بريد المدير. */
async function runWeeklyCardAudit(now=new Date()){
  if(!adminStore)return;
  const local=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Casablanca',year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(now).reduce((o,p)=>(o[p.type]=p.value,o),{});
  if(local.weekday!=='Mon'||Number(local.hour)<7)return;
  const localDate=`${local.year}-${local.month}-${local.day}`,reportId=`card_audit:${localDate}`;
  if(await adminStore.legalMonitorReports.findOne({_id:reportId},{projection:{_id:1}}))return;
  const synced=await syncPublishedTexts(now);if(synced)library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());
  const r=auditReport(await adminStore.legalMonitorItems.find({state:{$ne:'dismissed'}}).project({fullText:0,history:0}).toArray());
  const lines=[`تدقيق بطاقات المستجدات — ${localDate}`,'',`مفحوصة: ${r.checked} · مخالفة: ${r.faulty} · قابلة للإصلاح التلقائي: ${r.fixable} · مجموعات مكررة: ${r.duplicates.length}`,'',...Object.entries(r.byCategory).map(([c,v])=>`- ${c}: ${v.total} بطاقة، ${v.faulty} مخالفة`),'',...r.cards.slice(0,40).map(c=>`• ${c.title} — ${c.issues.map(i=>i.label).join('؛ ')}`),'','التفاصيل والإصلاح: لوحة الإدارة ← تدقيق البطاقات، أو الشارة على كل بطاقة في الواجهة.'];
  const text=lines.join('\n');
  const ins=await adminStore.legalMonitorReports.updateOne({_id:reportId},{$setOnInsert:{_id:reportId,type:'card_audit',localDate,title:lines[0],text,status:'generated',generatedAt:now,sourceCount:r.checked}},{upsert:true});
  if(!ins.upsertedCount)return;
  await recordAudit(adminStore,'scheduler','card_audit_weekly',reportId,{checked:r.checked,faulty:r.faulty,duplicates:r.duplicates.length});
  try{const owner=await configuredOwnerEmail();if(emailReady()&&validEmail(owner))await sendMail(owner,lines[0],text,'<div dir="rtl" style="font-family:Tahoma,sans-serif;white-space:pre-wrap">'+text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</div>');}catch(error){console.error('Weekly card audit mail failed:',error?.message||'delivery_error');}
}

/* إصلاح آمن لبطاقة واحدة (ترتيب الأقسام، حذف الملاحظات التقنية، تصحيح سطر «الأصل»)، مع تحديث نص مادتها المنشورة. */
async function applyCardFix(item,now=new Date()){
  const summary=fixCard(item);if(!summary)return {fixed:false,republished:0};
  await adminStore.legalMonitorItems.updateOne({_id:item._id},{$set:{summary},$push:{history:{state:item.state,at:now,reason:'card_audit_autofix'}}});
  let republished=0;
  if(item.state==='published'&&item.documentId){const full=await adminStore.legalMonitorItems.findOne({_id:item._id});const record=publicationRecord({...full,id:String(full._id)});const r=await adminStore.content.updateOne({documentId:item.documentId,origin:'legal-monitor',status:'published'},{$set:{text:record.text,updatedAt:now}});republished=r.modifiedCount||0;}
  return {fixed:true,republished};
}
async function publishLegalItem(item,actor){
  if(isTickerItem(item)){
    /* مشاريع القوانين والمقترحات وأخبار المجالس تظهر في شريط الأخبار فقط، دون بطاقة في المكتبة. */
    await adminStore.legalMonitorItems.updateOne({_id:item.id},{$set:{state:'published',publishedAt:new Date(),autoPublishAt:null},$push:{history:{state:'published',at:new Date(),reason:actor==='scheduler'?'auto_after_24h':'manager_publish'}}});
    await recordAudit(adminStore,actor,'legal_monitor_item_published',item.id,{title:item.title,category:'شريط الأخبار'});
    return '';
  }
  const record=publicationRecord(item);
  await adminStore.content.updateOne({documentId:record.documentId},{$set:record},{upsert:true});
  await adminStore.legalMonitorItems.updateOne({_id:item.id},{$set:{state:'published',publishedAt:new Date(),autoPublishAt:null,documentId:record.documentId},$push:{history:{state:'published',at:new Date(),reason:actor==='scheduler'?'auto_after_24h':'manager_publish'}}});
  library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());await refreshSupersessions();
  await recordAudit(adminStore,actor,'legal_monitor_item_published',item.id,{title:item.title,category:record.category});
  return record.documentId;
}
let legalPublishRun=null;
function runLegalPublication(){
  if(!adminStore||legalPublishRun)return legalPublishRun;
  legalPublishRun=(async()=>{
    /* تُجلب دفعة أكبر ثم تُصفّى بـmayAutoPublish: البطاقات الممنوعة (كعنوان فرنسي) تبقى «جاهزة» ولا يجوز أن تحتل خانات الدورة فتحجب السليمة. */
    const due=(await adminStore.legalMonitorItems.find({state:'ready',autoPublishAt:{$lte:new Date()}}).sort({autoPublishAt:1}).limit(500).toArray()).filter(mayAutoPublish).slice(0,20);
    for(const item of due){try{await publishLegalItem({...item,id:item._id},'scheduler');}catch(error){console.error('Scheduled legal publication failed:',error?.message||'unknown error');}}
  })().finally(()=>{legalPublishRun=null;});
  return legalPublishRun;
}
if(adminStore)setTimeout(()=>loadDocOverrides(),0);
const cardAuditTimer=setInterval(()=>runWeeklyCardAudit().catch(error=>console.error('Weekly card audit failed:',error?.message||'unknown error')),60*60_000);cardAuditTimer.unref();
if(adminStore)setTimeout(()=>syncPublishedTexts().then(n=>{if(n){console.log('Published texts synced:',n);return adminStore.content.find({status:'published'}).toArray().then(rows=>library.setManagedContent(rows));}}).catch(()=>{}),15_000).unref?.();
const legalPublishTimer=setInterval(()=>runLegalPublication()?.catch(()=>{}),5*60_000);legalPublishTimer.unref();
legalReportTimer.unref();
const headers={
  'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'SAMEORIGIN',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://*.googleusercontent.com; connect-src 'self' https://cdn.jsdelivr.net https://tessdata.projectnaptha.com; media-src 'self' blob:; frame-src 'self' blob:; worker-src 'self' blob: https://cdn.jsdelivr.net; object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
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
function rate(req,post){const key=(req.socket.remoteAddress||'local')+':'+(post?'write':'read'),now=Date.now();let value=limits.get(key);if(!value||now-value.start>60000)value={start:now,n:0};value.n++;limits.set(key,value);return value.n<=(post?(process.env.NODE_ENV==='test'&&Number(process.env.QALAM_TEST_WRITE_LIMIT)||35):(process.env.NODE_ENV==='test'&&Number(process.env.QALAM_TEST_READ_LIMIT)||400));}
async function read(req,max){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max){const e=new Error('حجم الطلب أكبر من المسموح.');e.status=413;throw e;}chunks.push(c);}return Buffer.concat(chunks);}
async function jsonBody(req,max=40000){try{return JSON.parse((await read(req,max)).toString('utf8'));}catch(e){if(e.status)throw e;const error=new Error('صيغة الطلب غير صالحة.');error.status=400;throw error;}}
function sameOrigin(req){if(!req.headers.origin)return !process.env.NODE_ENV||process.env.NODE_ENV!=='production';try{const u=new URL(req.headers.origin);return u.host===req.headers.host;}catch{return false;}}
function authCookie(req){return Object.fromEntries(String(req.headers.cookie||'').split(';').map(s=>s.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2))['qalam_session']||'';}
function rawSessionInfo(req){if(!sessionSecret)return !process.env.NODE_ENV||process.env.NODE_ENV!=='production'?{role:'admin',account:'env'}:null;const parts=authCookie(req).split('.'),expiry=parts[0],role=parts[1],account=parts.length===4?parts[2]:'legacy',signature=parts.length===4?parts[3]:parts[2],legacy=!['reader','admin'].includes(role);if(parts.length>4||!/^[0-9]{10,}$/.test(expiry||'')||Number(expiry)<Date.now())return null;const payload=legacy?expiry:parts.length===4?expiry+'.'+role+'.'+account:expiry+'.'+role,signed=legacy?role:signature;if(legacy&&!/^[a-f0-9]{64}$/i.test(signed||''))return null;const expected=createHmac('sha256',sessionSecret).update(payload).digest('hex'),a=Buffer.from(signed||''),b=Buffer.from(expected);if(!(a.length===b.length&&timingSafeEqual(a,b)))return null;const info={role:legacy?'reader':role,account:legacy?'legacy':account,issuedAt:Number(expiry)-7*86400000};return info.role==='admin'&&['env','legacy'].includes(info.account)&&!sharedAdminEnabled?null:info;}
/* وضع «عرض كقارئ»: المدير الفعلي يطلب أن تُعامَل جلسته قارئًا مؤقتًا. الوسم مربوط ببصمة الجلسة الحالية، فيسقط تلقائيًا مع أي تسجيل دخول جديد أو خروج،
   وهو يُنقص الصلاحية ولا يزيدها. المسارات الإدارية ترى القارئ فتُرفض كما تُرفض لأي قارئ. */
const viewCookieValue=req=>createHash('sha256').update('qalam-view:'+authCookie(req)).digest('hex').slice(0,24);
const viewAsReaderRequested=req=>{const v=Object.fromEntries(String(req.headers.cookie||'').split(';').map(x=>x.trim().split(/=(.*)/s).slice(0,2)).filter(x=>x.length===2))['qalam_view'];return !!v&&v===viewCookieValue(req);};
function sessionInfo(req){const info=rawSessionInfo(req);return info?.role==='admin'&&viewAsReaderRequested(req)?{...info,role:'reader',viewAsReader:true}:info;}
function sessionRole(req){return sessionInfo(req)?.role||null;}
function auditActor(req){if(!sessionInfo(req)&&collectorAuthorized(req))return'جامع المستجدات';const account=sessionInfo(req)?.account||'admin';if(account==='env'||account==='legacy')return'admin';try{return Buffer.from(account,'base64url').toString('utf8').slice(0,160)||'admin';}catch{return'admin';}}
/* الجلسة تحمل الدور سبعة أيام؛ لذا يُطابَق الحساب الفردي بقاعدة البيانات عند كل طلب إداري كي يسري خفض الدور أو إيقاف الحساب فورًا.
   كلمة الإدارة المشتركة (env/legacy) لا حساب لها في القاعدة فتبقى على حالها، وكذلك الحال إن تعذّر الوصول إلى القاعدة. */
async function adminSessionLive(req){
  const info=sessionInfo(req);if(info?.role!=='admin')return false;
  if(!adminStore||['env','legacy'].includes(info.account))return true;
  let email='';try{email=Buffer.from(info.account,'base64url').toString('utf8');}catch{return false;}
  return !!await adminStore.users.findOne({email,role:'admin',active:true},{projection:{_id:1}});
}
async function realAdminLive(req){
  const info=rawSessionInfo(req);if(info?.role!=='admin')return false;
  if(!adminStore||['env','legacy'].includes(info.account))return true;
  let email='';try{email=Buffer.from(info.account,'base64url').toString('utf8');}catch{return false;}
  return !!await adminStore.users.findOne({email,role:'admin',active:true},{projection:{_id:1}});
}
function validSession(req){return !!sessionInfo(req);}
/* طلب موثّق بالمفتاح السري المشترك مع منصة قلم (خادم إلى خادم، لا جلسة متصفح). منصة قلم تتحقق هي نفسها
   من أن المستخدم مسجّل لديها قبل أي استدعاء بهذا المفتاح؛ هنا نثبت فقط أن الطلب صادر من تلك المنصة. */
function collectorAuthorized(req){const secret=process.env.LEGAL_MONITOR_TOKEN||'';if(secret.length<32)return false;const given=Buffer.from(String(req.headers['x-monitor-token']||'')),expected=Buffer.from(secret);return given.length===expected.length&&timingSafeEqual(given,expected);}
function collectorRoute(req,p){return req.method==='POST'&&p==='/api/admin/legal-monitor/items'&&collectorAuthorized(req);}
function partnerAuthorized(req){const partnerSecret=process.env.QALAM_PARTNER_SECRET||'';if(!partnerSecret)return false;const given=Buffer.from(String(req.headers['x-qalam-partner-secret']||'')),expected=Buffer.from(partnerSecret);return given.length===expected.length&&timingSafeEqual(given,expected);}
function issueSession(res,role,account='legacy'){const expiry=String(Date.now()+7*86400000),payload=expiry+'.'+role+'.'+account,signature=createHmac('sha256',sessionSecret).update(payload).digest('hex');res.setHeader('Set-Cookie',`qalam_session=${payload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`);}
function localEditor(req){const remote=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');return ['127.0.0.1','::1'].includes(remote)&&sameOrigin(req);}
function ingestionSnapshot(progress){const age=Date.now()-Date.parse(progress.lastUpdate||'');const stale=progress.running===true&&Number.isFinite(age)&&age>300000;return stale?{...progress,running:false,status:'stalled',stale:true}:progress;}
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8','.svg':'image/svg+xml','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.ttf':'font/ttf','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.mp4':'video/mp4','.webm':'video/webm'};
/* HSTS: يلزم المتصفح بالاتصال الآمن (HTTPS) بهذا العنوان سنةً. يُرسل في الإنتاج وعلى اتصال HTTPS فقط (Render ينهي TLS ويعلمنا بـ X-Forwarded-Proto)،
   فلا يُرسل في النسخة المكتبية المحلية (http://127.0.0.1) ولا في التطوير. لا includeSubDomains ولا preload: نطاق onrender.com ليس نطاقنا. */
const HSTS='max-age=31536000';
function hstsApplies(req){return process.env.NODE_ENV==='production'&&process.env.QALAM_DESKTOP_MODE!=='1'&&(Boolean(req.socket.encrypted)||String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase()==='https');}
const server=http.createServer(async(req,res)=>{
  try{
    if(hstsApplies(req))res.setHeader('Strict-Transport-Security',HSTS);
    if(!rate(req,req.method==='POST'))return send(req,res,429,{error:'طلبات كثيرة؛ حاول بعد قليل.'});
    const url=new URL(req.url,'http://localhost:'+PORT),p=url.pathname;
    if(req.method==='POST'&&!sameOrigin(req)&&!collectorRoute(req,p))return send(req,res,403,{error:'هذا الطلب غير مسموح.'});
    if(p.startsWith('/api/')&&!['GET','POST','HEAD'].includes(req.method))return send(req,res,405,{error:'طريقة الطلب غير مدعومة.'});
    if(p==='/api/health')return send(req,res,200,{ok:true});
    /* جلسة صدرت قبل آخر تغيير لكلمة المرور (استعادة) تسقط قبل أي مسار: يُنزع كوكيها من الطلب فتعاملها بقية المسارات كطلب بلا جلسة،
       ويُمسح من المتصفح. المستخدم المحمَّل هنا يستعمله الحارس العام أدناه فلا استعلام ثانٍ. */
    let sessionUser=null;
    {const early=sessionInfo(req);
      if(adminStore&&early&&!['legacy','env'].includes(early.account)){
        try{sessionUser=await adminStore.users.findOne({email:Buffer.from(early.account,'base64url').toString('utf8')},{projection:{mustChangePassword:1,active:1,passwordChangedAt:1}});}catch{sessionUser=null;}
        if(sessionUser?.passwordChangedAt&&early.issuedAt<new Date(sessionUser.passwordChangedAt).getTime()){
          req.headers.cookie=String(req.headers.cookie||'').split(';').filter(part=>!part.trim().startsWith('qalam_session=')).join(';');
          res.setHeader('Set-Cookie','qalam_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');sessionUser=null;
        }
      }
    }
    if(p==='/api/partner/account-status'&&req.method==='GET'){
      // نقطة ربط بين منصة قلم والمكتبة الرقمية: تتحقق من وجود حساب فعّال بهذا البريد دون كشف أي بيانات أخرى عنه.
      if(!(process.env.QALAM_PARTNER_SECRET||''))return send(req,res,503,{error:'الربط مع منصة قلم غير مهيأ.'});
      if(!partnerAuthorized(req))return send(req,res,403,{error:'غير مصرح.'});
      if(!adminStore)return send(req,res,200,{linked:false});
      const email=String(url.searchParams.get('email')||'').trim().toLowerCase();
      if(!validEmail(email))return send(req,res,200,{linked:false});
      const user=await adminStore.users.findOne({email,active:true,accountStatus:{$ne:'pending'}},{projection:{_id:1}});
      return send(req,res,200,{linked:!!user});
    }
    if(p==='/api/auth/google/status'&&req.method==='GET')return send(req,res,200,{available:googleLoginConfig().available&&!!adminStore});
    if(p==='/api/auth/google/start'&&req.method==='GET'){
      const config=googleLoginConfig();
      if(!config.available||!adminStore)return send(req,res,503,{error:'دخول Google غير مهيأ للمكتبة بعد.'});
      const flow=beginGoogleLogin(config,url.searchParams.get('destination'));
      res.writeHead(302,{...headers,'Cache-Control':'no-store','Set-Cookie':flow.cookie,Location:flow.url});return res.end();
    }
    if(p==='/api/auth/google/callback'&&req.method==='GET'){
      const config=googleLoginConfig(),flow=finishGoogleFlow(req.headers.cookie,url.searchParams.get('state'),config.sessionSecret);
      res.setHeader('Set-Cookie',clearGoogleFlowCookie);
      const fail=(reason='failed')=>{res.writeHead(302,{...headers,'Cache-Control':'no-store','Set-Cookie':clearGoogleFlowCookie,Location:`/login?google_error=${reason}${flow?.destination==='admin'?'&next=admin':''}`});res.end();};
      if(flow?.purpose==='drive'){
        /* ربط Drive للكتابة: لا يُنشئ جلسة ولا يربط حساب دخول؛ يحفظ رمز التحديث فقط لمدير مسجَّل الدخول. */
        const back=reason=>{res.writeHead(302,{...headers,'Cache-Control':'no-store','Set-Cookie':clearGoogleFlowCookie,Location:`/admin?drive=${reason}`});res.end();};
        if(sessionRole(req)!=='admin')return back('denied');
        if(!config.available||!adminStore||url.searchParams.has('error')||!url.searchParams.get('code'))return back(url.searchParams.get('error')==='access_denied'?'cancelled':'failed');
        try{
          const grant=await exchangeGoogleTokens(url.searchParams.get('code'),flow,config);
          if(!grant.scopes.includes(DRIVE_WRITE_SCOPE)){await revokeGoogleToken(grant.refreshToken||grant.accessToken);return back('scope');}
          if(!grant.refreshToken){await revokeGoogleToken(grant.accessToken);return back('norefresh');}
          const access=await probeDriveWriteAccess(grant.accessToken);
          if(!access.ok){await revokeGoogleToken(grant.refreshToken);return back(access.reason==='probe'?'failed':'folder');}
          await adminStore.settings.updateOne({_id:'library'},{$set:{driveWrite:{refreshTokenEncrypted:sealSecret(grant.refreshToken),email:grant.identity.email,sub:grant.identity.sub,connectedAt:new Date(),connectedBy:auditActor(req)},updatedAt:new Date()},$setOnInsert:{createdAt:new Date()}},{upsert:true});
          forgetDriveUserToken();
          try{await recordAudit(adminStore,auditActor(req),'drive_write_connected',grant.identity.email);}catch(error){console.error('Drive connect audit failed:',error?.message||'unknown error');}
          return back('connected');
        }catch(error){console.error('Drive write connect failed:',error?.message||'unknown error');return back('failed');}
      }
      if(!config.available||!adminStore||!flow||url.searchParams.has('error')||!url.searchParams.get('code'))return fail('failed');
      try{
        const identity=await exchangeGoogleCode(url.searchParams.get('code'),flow,config);
        const user=await adminStore.users.findOne({googleSub:identity.sub})||await adminStore.users.findOne({email:identity.email});
        if(!user||!user.active||user.accountStatus==='permanent'||user.accountStatus==='pending')return fail('account');
        if(user.googleSub&&user.googleSub!==identity.sub)return fail('account');
        if(!user.googleSub){
          const authoritativeEmail=/@(gmail|googlemail)\.com$/i.test(identity.email)||!!identity.hostedDomain;
          if(!authoritativeEmail||user.email!==identity.email)return fail('link');
          await adminStore.users.updateOne({_id:user._id,googleSub:{$exists:false}},{$set:{googleSub:identity.sub,googleLinkedAt:new Date()}});
        }
        if(flow.destination==='admin'&&user.role!=='admin')return fail('admin');
        const now=new Date(),profile={...(identity.name?{googleName:identity.name}:{}),...(identity.picture?{googlePicture:identity.picture}:{})};await adminStore.users.updateOne({_id:user._id},{$set:{lastLoginAt:now,lastSeenAt:now,...profile},$inc:{loginCount:1}});
        try{await recordAudit(adminStore,user.email,'google_login',user.email);}catch(error){console.error('Google login audit failed:',error?.message||'unknown error');}
        issueSession(res,user.role,Buffer.from(user.email).toString('base64url'));
        const sessionCookie=res.getHeader('Set-Cookie');res.setHeader('Set-Cookie',[clearGoogleFlowCookie,sessionCookie]);
        res.writeHead(302,{...headers,'Cache-Control':'no-store','Set-Cookie':[clearGoogleFlowCookie,sessionCookie],Location:user.mustChangePassword?'/change-password':flow.destination==='admin'?'/admin':'/'});return res.end();
      }catch(error){console.error('Google login failed:',error?.message||'unknown error');return fail('failed');}
    }
    if(p==='/api/registration'&&req.method==='GET')return send(req,res,200,{available:!!adminStore&&emailReady()&&validEmail(await configuredOwnerEmail())});
    if(p==='/api/register'&&req.method==='POST'){
      /* تسجيل ذاتي بموافقة المدير: بريد وكلمة مرور ← تأكيد البريد ← «جاري تفعيل حسابكم» ← قرار الإدارة (قارئ/مدير/رفض). */
      const recipient=await configuredOwnerEmail();
      if(!adminStore||!emailReady()||!validEmail(recipient))return send(req,res,503,{error:'إنشاء الحساب بالبريد غير متاح حالياً.'});
      if(!registrationAllowed(req))return send(req,res,429,{error:'بلغت حد طلبات التسجيل. حاول لاحقاً.'});
      const body=await jsonBody(req,4000),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
      if(!validEmail(email)||email.length>254)return send(req,res,400,{error:'أدخل بريداً إلكترونياً صالحاً.'});
      if(password.length<12||password.length>256)return send(req,res,400,{error:'اختر كلمة مرور من 12 إلى 256 حرفاً.'});
      const generic={ok:true,message:'إن كان البريد قابلاً للتسجيل فسيصله رابط تأكيد صالح 24 ساعة. تحقق من بريدك (ومن المزعج).'};
      const existing=await adminStore.users.findOne({email},{projection:{accountStatus:1,rejectedUntil:1,confirmationSentAt:1}});
      if(existing){
        if(existing.accountStatus==='rejected'&&existing.rejectedUntil&&new Date(existing.rejectedUntil)>new Date())return send(req,res,403,{state:'rejected',error:'تعذّر قبول طلبكم. تواصلوا مع إدارة المنصة.'});
        const reusable=existing.accountStatus==='unconfirmed'||existing.accountStatus==='rejected';
        if(!reusable)return send(req,res,200,generic);
        if(existing.accountStatus==='unconfirmed'&&existing.confirmationSentAt&&Date.now()-new Date(existing.confirmationSentAt).getTime()<60000)return send(req,res,200,generic);
      }
      const token=activationToken(),now=new Date(),saved=hashPassword(password),fields={role:'reader',active:false,accountStatus:'unconfirmed',passwordSalt:saved.salt,passwordHash:saved.hash,activationTokenHash:tokenDigest(token),activationExpiresAt:new Date(now.getTime()+24*3600000),confirmationSentAt:now,updatedAt:now,createdBy:'self-registration'};
      try{
        if(existing)await adminStore.users.updateOne({email},{$set:fields,$unset:{rejectedUntil:'',rejectedAt:'',rejectedBy:''}});
        else await adminStore.users.insertOne({email,createdAt:now,loginCount:0,...fields});
      }catch(error){if(error?.code===11000)return send(req,res,200,generic);throw error;}
      try{const mail=registrationConfirmMessage(registrationConfirmUrl(token));await sendMail(email,mail.subject,mail.text,mail.html);}
      catch(error){await adminStore.users.deleteOne({email,accountStatus:'unconfirmed',activationTokenHash:fields.activationTokenHash});throw error;}
      return send(req,res,200,generic);
    }
    if(p==='/api/register/confirm'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'خدمة الحسابات غير متاحة الآن.'});
      const body=await jsonBody(req,4000),token=String(body.token||'');
      if(!safeToken(token))return send(req,res,400,{error:'رابط التأكيد غير صالح.'});
      const now=new Date();
      const user=await adminStore.users.findOneAndUpdate({activationTokenHash:tokenDigest(token),accountStatus:'unconfirmed',activationExpiresAt:{$gt:now}},{$set:{accountStatus:'review',active:false,reviewRequestedAt:now,updatedAt:now},$unset:{activationTokenHash:'',activationExpiresAt:''}},{returnDocument:'after',projection:{email:1}});
      if(!user)return send(req,res,400,{error:'انتهت صلاحية رابط التأكيد أو استُخدم سابقاً. سجّلوا من جديد من صفحة الدخول.'});
      await recordAudit(adminStore,user.email,'registration_email_confirmed',user.email);
      try{await notifyOwner('review',user.email,await configuredOwnerEmail());await adminStore.users.updateOne({email:user.email},{$set:{ownerNotifiedAt:new Date()}});}catch(error){console.error('Owner registration notice failed:',error?.message||'delivery_error');}
      return send(req,res,200,{ok:true,state:'review'});
    }
    if(p==='/api/activate'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'خدمة الحسابات غير متاحة الآن.'});
      const body=await jsonBody(req),token=String(body.token||''),password=String(body.password||'');
      if(!safeToken(token)||password.length<12||password.length>256)return send(req,res,400,{error:'رابط التفعيل أو كلمة المرور غير صالحين؛ اختر كلمة من 12 إلى 256 حرفاً.'});
      const emailTokenHash=tokenDigest(token),now=new Date(),saved=hashPassword(password);
      const user=await adminStore.users.findOneAndUpdate({activationTokenHash:emailTokenHash,accountStatus:'pending',activationExpiresAt:{$gt:now}},{$set:{active:true,accountStatus:'active',activatedAt:now,passwordSalt:saved.salt,passwordHash:saved.hash,mustChangePassword:false,updatedAt:now},$unset:{activationTokenHash:'',activationExpiresAt:''}},{returnDocument:'after',projection:{email:1,role:1}});
      if(!user)return send(req,res,400,{error:'انتهت صلاحية رابط التفعيل أو استُخدم سابقاً. اطلب دعوة جديدة من إدارة المكتبة.'});
      await recordAudit(adminStore,user.email,'user_email_activated',user.email);
      try{await notifyOwner('activated',user.email,await configuredOwnerEmail());await adminStore.users.updateOne({email:user.email},{$set:{activationNoticeSentAt:new Date()}});}catch(error){console.error('Owner activation notice failed:',error?.message||'delivery_error');}
      return send(req,res,200,{ok:true,message:'تم تفعيل الحساب. يمكنك تسجيل الدخول الآن.'});
    }
    if(p==='/api/password-reset/request'&&req.method==='POST'){
      const result=await passwordReset.request(await jsonBody(req,4000),clientIp(req));
      return send(req,res,result.status,result.body);
    }
    if(p==='/api/password-reset/confirm'&&req.method==='POST'){
      const result=await passwordReset.confirm(await jsonBody(req,4000),clientIp(req));
      return send(req,res,result.status,result.body);
    }
    if(p==='/api/session'){const session=sessionInfo(req);let mustChangePassword=false,email='',effectiveRole;if(session?.account&&session.account!=='legacy'&&session.account!=='env'&&adminStore){const decoded=Buffer.from(session.account,'base64url').toString('utf8'),user=await adminStore.users.findOne({email:decoded},{projection:{email:1,mustChangePassword:1,active:1,role:1}});if(!user?.active)return send(req,res,200,{authenticated:false});email=user.email;mustChangePassword=!!user.mustChangePassword;if(session.role==='admin'&&user.role!=='admin')effectiveRole=user.role==='reader'?'reader':null;}const shownRole=effectiveRole===undefined?(session?.role||null):effectiveRole;return send(req,res,200,{authenticated:!!session,role:shownRole,canAdmin:shownRole==='admin',viewAsReader:!!session?.viewAsReader,canToggleReader:!!session&&await realAdminLive(req),mustChangePassword,email});}
    if(p==='/api/view-as'&&req.method==='POST'){if(!await realAdminLive(req))return send(req,res,403,{error:'هذه الميزة للمدير وحده.'});let body;try{body=await jsonBody(req);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}const reader=body.mode==='reader';res.setHeader('Set-Cookie',reader?`qalam_view=${viewCookieValue(req)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`:'qalam_view=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');if(adminStore)await recordAudit(adminStore,auditActor(req),reader?'view_as_reader_on':'view_as_reader_off','session',{});return send(req,res,200,{ok:true,viewAsReader:reader});}
    if(p==='/api/account/profile'&&req.method==='GET'){
      const current=sessionInfo(req);
      if(!current)return send(req,res,401,{error:'سجّل الدخول أولاً.'});
      if(!adminStore||['legacy','env'].includes(current.account))return send(req,res,200,{email:'',role:current.role,individual:false});
      const email=Buffer.from(current.account,'base64url').toString('utf8');
      const user=await adminStore.users.findOne({email,active:true},{projection:{email:1,role:1,createdAt:1,lastLoginAt:1,loginCount:1,googleSub:1,passwordHash:1,googleName:1,googlePicture:1}});
      if(!user)return send(req,res,401,{error:'هذا الحساب غير متاح.'});
      return send(req,res,200,{email:user.email,name:user.googleName||'',picture:user.googlePicture||'',role:current.viewAsReader?'reader':user.role,viewAsReader:current.viewAsReader===true,individual:true,createdAt:user.createdAt,lastLoginAt:user.lastLoginAt,loginCount:user.loginCount||0,googleLinked:!!user.googleSub,canChangePassword:!!user.passwordHash});
    }
    if(p==='/api/account/password'&&req.method==='POST'){
      const current=sessionInfo(req);
      if(!current||!adminStore||['legacy','env'].includes(current.account))return send(req,res,403,{error:'تغيير كلمة المرور متاح للحسابات الفردية فقط.'});
      const body=await jsonBody(req),email=Buffer.from(current.account,'base64url').toString('utf8'),password=String(body.password||''),newPassword=String(body.newPassword||'');
      if(newPassword.length<12||newPassword.length>256)return send(req,res,400,{error:'اختر كلمة مرور جديدة من 12 إلى 256 حرفاً.'});
      const user=await adminStore.users.findOne({email,active:true});
      if(!user?.passwordHash||!verifyPassword(password,user.passwordSalt,user.passwordHash))return send(req,res,403,{error:'كلمة المرور الحالية غير صحيحة.'});
      const saved=hashPassword(newPassword);await adminStore.users.updateOne({_id:user._id},{$set:{passwordSalt:saved.salt,passwordHash:saved.hash,updatedAt:new Date()}});
      await recordAudit(adminStore,email,'password_changed',email);return send(req,res,200,{ok:true});
    }
    if(p==='/api/presence'&&req.method==='POST'){
      const current=sessionInfo(req);
      if(!current||!adminStore||['legacy','env'].includes(current.account))return send(req,res,200,{ok:true});
      const email=Buffer.from(current.account,'base64url').toString('utf8');
      await adminStore.users.updateOne({email,active:true},{$set:{lastSeenAt:new Date()}});
      return send(req,res,200,{ok:true});
    }
    if(p==='/api/login'&&req.method==='POST'){
      if(!accessPassword||!sessionSecret)return send(req,res,503,{error:'تسجيل الدخول غير مهيأ بعد.'});
      const ip=clientIp(req);
      if(loginThrottled(ip))return send(req,res,429,{error:'محاولات كثيرة. أعد المحاولة بعد عشر دقائق.'});
      const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),password=String(body.password||'');
      if(loginThrottled(ip,email))return send(req,res,429,{error:'محاولات كثيرة لهذا الحساب. أعد المحاولة بعد ربع ساعة.'});
      if(email&&!adminStore){recordLoginFailure(ip,email);return send(req,res,503,{error:'تسجيل الدخول بالحسابات الفردية غير متاح الآن؛ قاعدة MongoDB غير متصلة.'});}
      if(email&&adminStore){const user=await adminStore.users.findOne({email});if(user&&['unconfirmed','review','rejected'].includes(user.accountStatus)&&user.passwordHash&&verifyPassword(password,user.passwordSalt,user.passwordHash)){const state=user.accountStatus,texts={unconfirmed:'لم يُؤكَّد بريدكم بعد. افتحوا رابط التأكيد المرسل إلى بريدكم.',review:'جاري تفعيل حسابكم. سنعلمكم بالقرار عبر بريدكم الإلكتروني.',rejected:'تعذّر قبول طلبكم. تواصلوا مع إدارة المنصة.'};clearLoginFailures(ip,email);if(state==='review')await adminStore.users.updateOne({_id:user._id,firstReviewLoginAt:{$exists:false}},{$set:{firstReviewLoginAt:new Date()}});return send(req,res,403,{state,error:texts[state]});}if(user?.active&&verifyPassword(password,user.passwordSalt,user.passwordHash)){const now=new Date();await adminStore.users.updateOne({email},{$set:{lastLoginAt:now,lastSeenAt:now},$inc:{loginCount:1}});clearLoginFailures(ip,email);issueSession(res,user.role,Buffer.from(user.email).toString('base64url'));return send(req,res,200,{authenticated:true,role:user.role,mustChangePassword:!!user.mustChangePassword});}}
      if(!email){const given=Buffer.from(password),expected=Buffer.from(accessPassword);if(given.length===expected.length&&timingSafeEqual(given,expected)){clearLoginFailures(ip);issueSession(res,'reader');return send(req,res,200,{authenticated:true,role:'reader'});}}
      recordLoginFailure(ip,email);
      return send(req,res,401,{error:'البريد الإلكتروني أو كلمة المرور غير صحيحة، أو أن الحساب غير مفعّل.'});
    }
    if(p==='/api/admin/login'&&req.method==='POST'){
      if(!sharedAdminEnabled)return send(req,res,410,{error:'دخول الإدارة بكلمة مرور مشتركة أُلغي؛ ادخل بحساب المدير الفردي (البريد وكلمة المرور، أو Google).'});
      if(!sessionSecret)return send(req,res,503,{error:'دخول المدير غير مهيأ.'});
      const ip=clientIp(req);
      if(loginThrottled(ip,'__admin__'))return send(req,res,429,{error:'محاولات كثيرة. أعد المحاولة بعد عشر دقائق.'});
      const body=await jsonBody(req),given=Buffer.from(String(body.password||'')),expected=Buffer.from(adminPassword);
      if(given.length!==expected.length||!timingSafeEqual(given,expected)){recordLoginFailure(ip,'__admin__');return send(req,res,401,{error:'كلمة مرور الإدارة غير صحيحة.'});}
      clearLoginFailures(ip,'__admin__');
      issueSession(res,'admin','env');return send(req,res,200,{authenticated:true,role:'admin'});
    }
    if(p==='/api/change-password'&&req.method==='POST'){
      const session=sessionInfo(req);if(!session||session.account==='legacy'||session.account==='env'||!adminStore)return send(req,res,403,{error:'تغيير كلمة المرور متاح للحسابات الفردية فقط.'});
      const body=await jsonBody(req),email=Buffer.from(session.account,'base64url').toString('utf8'),password=String(body.password||'');if(password.length<12)return send(req,res,400,{error:'اختر كلمة مرور من 12 حرفاً على الأقل.'});const saved=hashPassword(password),result=await adminStore.users.updateOne({email,active:true},{$set:{passwordSalt:saved.salt,passwordHash:saved.hash,mustChangePassword:false,updatedAt:new Date()}});if(!result.matchedCount)return send(req,res,401,{error:'الحساب غير موجود أو معطل.'});await recordAudit(adminStore,email,'password_changed',email);return send(req,res,200,{ok:true});
    }
    if(p==='/api/logout'&&req.method==='POST'){const current=sessionInfo(req);if(adminStore&&current?.account&&!['legacy','env'].includes(current.account)){const email=Buffer.from(current.account,'base64url').toString('utf8');await adminStore.users.updateOne({email},{$set:{lastSeenAt:null}});}res.setHeader('Set-Cookie',['qalam_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0','qalam_view=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0']);return send(req,res,200,{ok:true});}
    const loginAsset=['/','/home.html','/robots.txt','/sitemap.xml','/login','/login.html','/login.js','/login.css','/tokens.css','/google-login.js','/password-toggle.js','/activate','/activate.html','/activate.js','/confirm-registration','/confirm-registration.html','/confirm-registration.js','/forgot-password','/forgot-password.html','/forgot-password.js','/reset-password','/reset-password.html','/reset-password.js','/admin-login.html','/admin-login.js','/change-password.html','/change-password.js','/admin.css','/assets/library-login-logo.png','/assets/library-login-hero.jpg','/assets/logo-word-ar.png','/assets/logo-word-ar-dark.webp','/assets/qalam-q-logo.png','/assets/qalam-signature.png','/assets/brand-office-scene.webp','/assets/almarai-regular.ttf','/assets/almarai-bold.ttf','/assets/qaf-favicon.svg','/assets/gateway-office-emblem.svg','/assets/gateway-library-emblem.svg','/assets/gateway-pen-animated.mp4','/assets/gateway-pen-hero.jpg','/home.js','/assets/cairo-arabic-800.woff2','/assets/cairo-latin-800.woff2','/assets/ibm-plex-arabic-400.woff2','/assets/ibm-plex-latin-400.woff2','/sw.js','/manifest.webmanifest','/assets/library-icon-192.png','/assets/library-icon-512.png'].includes(p);
    const session=sessionInfo(req);if(session&&session.account!=='legacy'&&session.account!=='env'&&adminStore&&!['/api/session','/api/logout','/api/change-password','/change-password','/change-password.html','/change-password.js'].includes(p)){const email=Buffer.from(session.account,'base64url').toString('utf8'),user=sessionUser||await adminStore.users.findOne({email},{projection:{mustChangePassword:1,active:1}});if(!user?.active){res.setHeader('Set-Cookie','qalam_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return send(req,res,401,{error:'الحساب غير مفعّل.'});}if(user.mustChangePassword){if(req.method==='GET'&&!p.startsWith('/api/')&&String(req.headers.accept||'').includes('text/html')){res.writeHead(302,{Location:'/change-password','Cache-Control':'no-store'});return res.end();}return send(req,res,428,{error:'غيّر كلمة المرور المؤقتة أولاً.'});}}
    const adminPage=p==='/admin'||p==='/admin.html'||p==='/admin.js';
    if(adminPage&&!(await adminSessionLive(req))){res.writeHead(302,{...headers,'Cache-Control':'no-store',Location:'/login?next=admin'});return res.end();}
    if(p.startsWith('/api/admin/')&&!collectorRoute(req,p)&&!(await adminSessionLive(req)))return send(req,res,403,{error:'هذه الوظيفة مخصصة لمدير المكتبة.'});
    if(p.startsWith('/api/admin/')&&!adminStore&&['/api/admin/settings','/api/admin/content','/api/admin/content/save','/api/admin/content/publish','/api/admin/content/delete'].includes(p))return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة حالياً؛ تحقق من اتصال MongoDB.'});
    if(p==='/api/admin/users'&&req.method==='GET'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      const page=Math.max(1,Math.min(10000,Number(url.searchParams.get('page'))||1)),query=String(url.searchParams.get('q')||'').trim().slice(0,100),filter=query?{email:{$regex:query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'}}:{};
      const [users,total,active,pending,permanent,online,allLogins,reviewList]=await Promise.all([
        adminStore.users.find(filter).sort({createdAt:-1}).skip((page-1)*50).limit(50).project({email:1,role:1,active:1,accountStatus:1,mustChangePassword:1,createdAt:1,activatedAt:1,lastLoginAt:1,lastSeenAt:1,loginCount:1,ownerNotifiedAt:1,activationNoticeSentAt:1,invitationSentAt:1,reviewRequestedAt:1,firstReviewLoginAt:1,rejectedAt:1,rejectedUntil:1}).toArray(),
        adminStore.users.countDocuments(filter),adminStore.users.countDocuments({active:true}),adminStore.users.countDocuments({accountStatus:{$in:['pending','review']}}),adminStore.users.countDocuments({accountStatus:'permanent'}),adminStore.users.countDocuments({active:true,lastSeenAt:{$gte:new Date(Date.now()-120000)}}),adminStore.users.aggregate([{$group:{_id:null,total:{$sum:{$ifNull:['$loginCount',0]}}}}]).toArray(),adminStore.users.find({accountStatus:'review'}).sort({reviewRequestedAt:1}).limit(100).project({email:1,reviewRequestedAt:1,firstReviewLoginAt:1,createdAt:1}).toArray()
      ]);
      const current=sessionInfo(req),profileEmail=current?.account&& !['env','legacy'].includes(current.account)?Buffer.from(current.account,'base64url').toString('utf8'):'';
      return send(req,res,200,{users:users.map(u=>({...u,bootstrap:!!bootstrapAdminEmail&&u.email===bootstrapAdminEmail})),sharedAdminEnabled,page,pages:Math.max(1,Math.ceil(total/50)),total,stats:{active,pending,permanent,online,review:reviewList.length,logins:allLogins[0]?.total||0},requests:reviewList,mailConfigured:emailReady(),ownerConfigured:validEmail(await configuredOwnerEmail()),ownerEmail:await configuredOwnerEmail(),profileEmail});
    }
    if(p==='/api/admin/owner-email'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase();
      if(!validEmail(email)||email.length>254)return send(req,res,400,{error:'أدخل بريداً إلكترونياً صالحاً لاستقبال الإشعارات.'});
      const previous=await configuredOwnerEmail();
      await adminStore.settings.updateOne({_id:'library'},{$set:{ownerEmail:email,updatedAt:new Date()},$setOnInsert:{createdAt:new Date()}},{upsert:true});
      await recordAudit(adminStore,auditActor(req),'owner_email_changed','library',{previous,email});
      return send(req,res,200,{ok:true,email});
    }
    if(p==='/api/admin/profile/email'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      const session=sessionInfo(req);
      if(!session?.account||['env','legacy'].includes(session.account))return send(req,res,403,{error:'غيّر بريد حساب المدير الفردي بعد الدخول به، لا بكلمة الإدارة الأولية.'});
      const oldEmail=Buffer.from(session.account,'base64url').toString('utf8'),body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),password=String(body.currentPassword||'');
      if(!validEmail(email)||email.length>254||email===oldEmail)return send(req,res,400,{error:'أدخل بريداً جديداً صالحاً.'});
      const user=await adminStore.users.findOne({email:oldEmail,role:'admin',active:true});
      if(!user||!verifyPassword(password,user.passwordSalt,user.passwordHash))return send(req,res,403,{error:'كلمة المرور الحالية غير صحيحة.'});
      if(await adminStore.users.findOne({email},{projection:{_id:1}}))return send(req,res,409,{error:'يوجد حساب بهذا البريد الإلكتروني.'});
      const previousOwner=await configuredOwnerEmail();
      await adminStore.users.updateOne({_id:user._id,email:oldEmail},{$set:{email,updatedAt:new Date()}});
      if(previousOwner===oldEmail)await adminStore.settings.updateOne({_id:'library'},{$set:{ownerEmail:email,updatedAt:new Date()}},{upsert:true});
      await recordAudit(adminStore,oldEmail,'admin_email_changed',email);
      issueSession(res,'admin',Buffer.from(email).toString('base64url'));
      return send(req,res,200,{ok:true,email,ownerEmail:previousOwner===oldEmail?email:previousOwner});
    }
    if(p==='/api/admin/profile/password'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      const session=sessionInfo(req);
      if(!session?.account||['env','legacy'].includes(session.account))return send(req,res,403,{error:'غيّر كلمة مرور حساب المدير الفردي بعد الدخول به، لا بكلمة الإدارة الأولية.'});
      const email=Buffer.from(session.account,'base64url').toString('utf8'),body=await jsonBody(req),current=String(body.currentPassword||''),password=String(body.password||'');
      if(password.length<12||password.length>256)return send(req,res,400,{error:'اختر كلمة مرور جديدة من 12 إلى 256 حرفاً.'});
      const user=await adminStore.users.findOne({email,role:'admin',active:true});
      if(!user||!verifyPassword(current,user.passwordSalt,user.passwordHash))return send(req,res,403,{error:'كلمة المرور الحالية غير صحيحة.'});
      const saved=hashPassword(password);
      await adminStore.users.updateOne({_id:user._id},{$set:{passwordSalt:saved.salt,passwordHash:saved.hash,mustChangePassword:false,updatedAt:new Date()}});
      await recordAudit(adminStore,email,'admin_password_changed',email);
      return send(req,res,200,{ok:true});
    }
    if(p==='/api/admin/users'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),role=String(body.role||'reader');if(!validEmail(email)||email.length>254)return send(req,res,400,{error:'أدخل بريداً إلكترونياً صالحاً.'});if(!['reader','admin'].includes(role))return send(req,res,400,{error:'الحسابات المستقلة تقتصر على القارئ ومدير المكتبة.'});if(await adminStore.users.findOne({email},{projection:{_id:1}}))return send(req,res,409,{error:'يوجد حساب بهذا البريد الإلكتروني.'});
      if(emailReady()){await inviteUser(email,role,'administrator');return send(req,res,201,{ok:true,email,role,delivery:'email'});}
      const temporaryPassword=randomBytes(12).toString('base64url'),saved=hashPassword(temporaryPassword),user={email,role,active:true,accountStatus:'active',mustChangePassword:true,passwordSalt:saved.salt,passwordHash:saved.hash,createdAt:new Date(),createdBy:'administrator',loginCount:0};await adminStore.users.insertOne(user);await recordAudit(adminStore,'administrator','user_created',email,{role});return send(req,res,201,{ok:true,email,role,temporaryPassword,mustChangePassword:true,delivery:'manual'});
    }
    if(p==='/api/admin/users/invite'&&req.method==='POST'){
      if(!adminStore||!emailReady())return send(req,res,503,{error:'اضبط خدمة Brevo قبل إرسال الدعوات.'});
      const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),user=await adminStore.users.findOne({email});
      if(!user||user.accountStatus!=='pending')return send(req,res,409,{error:'الدعوة متاحة للحسابات التي تنتظر التفعيل فقط.'});
      const token=activationToken(),digest=tokenDigest(token),now=new Date();
      await adminStore.users.updateOne({email,accountStatus:'pending'},{$set:{activationTokenHash:digest,activationExpiresAt:new Date(now.getTime()+24*3600000)}});
      const mail=activationMessage(activationUrl(token));await sendMail(email,mail.subject,mail.text,mail.html);
      await adminStore.users.updateOne({email},{$set:{invitationSentAt:new Date()}});
      await recordAudit(adminStore,'administrator','user_invitation_resent',email);
      return send(req,res,200,{ok:true});
    }
    if(p==='/api/admin/users/notify'&&req.method==='POST'){
      if(!adminStore||!emailReady()||!validEmail(await configuredOwnerEmail()))return send(req,res,503,{error:'إشعارات Brevo غير مهيأة.'});
      const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),user=await adminStore.users.findOne({email},{projection:{activatedAt:1,activationNoticeSentAt:1}});
      if(!user?.activatedAt||user.activationNoticeSentAt)return send(req,res,409,{error:'لا يوجد إشعار تفعيل معلّق لهذا الحساب.'});
      await notifyOwner('activated',email,await configuredOwnerEmail());
      await adminStore.users.updateOne({email},{$set:{activationNoticeSentAt:new Date()}});
      await recordAudit(adminStore,'administrator','user_activation_notice_resent',email);
      return send(req,res,200,{ok:true});
    }
    if(p==='/api/admin/users/decision'&&req.method==='POST'){
      /* قرار الإدارة في طلب تسجيل ذاتي: قبول كقارئ/مدير، رفض، أو رفع منع الرفض. */
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      const body=await jsonBody(req,4000),email=String(body.email||'').trim().toLowerCase(),decision=String(body.decision||'');
      if(!['reader','admin','reject','unblock'].includes(decision))return send(req,res,400,{error:'القرار غير صالح؛ المتاح: قارئ أو مدير أو رفض.'});
      const target=await adminStore.users.findOne({email},{projection:{accountStatus:1,role:1}});
      if(!target)return send(req,res,404,{error:'لم يُعثر على الطلب.'});
      const actor=auditActor(req),now=new Date();
      if(decision==='unblock'){
        if(target.accountStatus!=='rejected')return send(req,res,409,{error:'رفع المنع خاص بالطلبات المرفوضة.'});
        await adminStore.users.deleteOne({_id:target._id,accountStatus:'rejected'});
        await recordAudit(adminStore,actor,'registration_unblocked',email);
        return send(req,res,200,{ok:true,email,decision});
      }
      /* «unconfirmed»: لم يصل بريد التأكيد أو لم يُضغط رابطه؛ يجوز للمدير تفعيله مباشرة أو رفضه. */
      if(!['review','rejected','unconfirmed'].includes(target.accountStatus))return send(req,res,409,{error:'هذا الحساب ليس طلب تسجيل بانتظار القرار.'});
      if(decision==='reject'){
        const done=await adminStore.users.updateOne({_id:target._id,accountStatus:{$in:['review','rejected','unconfirmed']}},{$set:{accountStatus:'rejected',active:false,rejectedAt:now,rejectedBy:actor,rejectedUntil:new Date(now.getTime()+7*86400000),updatedAt:now},$unset:{activationTokenHash:'',activationExpiresAt:''}});
        if(!done.matchedCount)return send(req,res,409,{error:'تغيّرت حالة الطلب؛ حدّث القائمة.'});
        await recordAudit(adminStore,actor,'registration_rejected',email);
        let mailSent=false;
        if(target.accountStatus==='review'&&emailReady()){try{const mail=registrationRejectedMessage();await sendMail(email,mail.subject,mail.text,mail.html);mailSent=true;await adminStore.users.updateOne({_id:target._id},{$set:{decisionMailSentAt:new Date()}});}catch(error){console.error('Rejection mail failed:',error?.message||'delivery_error');}}
        return send(req,res,200,{ok:true,email,decision,mailSent});
      }
      const done=await adminStore.users.updateOne({_id:target._id,accountStatus:{$in:['review','rejected','unconfirmed']}},{$set:{accountStatus:'active',active:true,role:decision,activatedAt:now,approvedAt:now,approvedBy:actor,mustChangePassword:false,updatedAt:now,...(target.accountStatus==='unconfirmed'?{emailConfirmedBy:'admin'}:{})},$unset:{rejectedUntil:'',rejectedAt:'',rejectedBy:'',activationTokenHash:'',activationExpiresAt:''}});
      if(!done.matchedCount)return send(req,res,409,{error:'تغيّرت حالة الطلب؛ حدّث القائمة.'});
      await recordAudit(adminStore,actor,'registration_approved',email,{role:decision});
      let mailSent=false;
      if(emailReady()){try{const mail=registrationApprovedMessage(decision);await sendMail(email,mail.subject,mail.text,mail.html);mailSent=true;await adminStore.users.updateOne({_id:target._id},{$set:{decisionMailSentAt:new Date()}});}catch(error){console.error('Approval mail failed:',error?.message||'delivery_error');}}
      return send(req,res,200,{ok:true,email,decision,role:decision,mailSent});
    }
    if(p==='/api/admin/users/reset'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),actor=sessionInfo(req)?.account||'';if(actor!=='env'&&actor!=='legacy'&&Buffer.from(actor,'base64url').toString('utf8')===email)return send(req,res,409,{error:'لا تعِد إصدار كلمة المرور لحسابك من هذه الجلسة؛ استخدم صفحة تغيير كلمة المرور.'});const target=await adminStore.users.findOne({email},{projection:{accountStatus:1}});if(!target)return send(req,res,404,{error:'لم يُعثر على الحساب.'});if(['pending','permanent'].includes(target.accountStatus))return send(req,res,409,{error:'لا يمكن إعادة إصدار كلمة مرور لحساب ينتظر التفعيل أو موقوف نهائياً.'});const temporaryPassword=randomBytes(12).toString('base64url'),saved=hashPassword(temporaryPassword),result=await adminStore.users.updateOne({email},{$set:{passwordSalt:saved.salt,passwordHash:saved.hash,mustChangePassword:true,updatedAt:new Date()}});await recordAudit(adminStore,'administrator','user_password_reset',email);return send(req,res,200,{ok:true,email,temporaryPassword,mustChangePassword:true});
    }
    if(p==='/api/admin/users/role'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),role=String(body.role||''),account=sessionInfo(req)?.account||'';
      if(!['reader','admin'].includes(role))return send(req,res,400,{error:'الصلاحية غير صالحة؛ المتاح: قارئ أو مدير.'});
      const target=await adminStore.users.findOne({email},{projection:{role:1,accountStatus:1,active:1}});if(!target)return send(req,res,404,{error:'لم يُعثر على الحساب.'});
      if(target.accountStatus==='permanent')return send(req,res,409,{error:'هذا الحساب موقوف نهائياً ولا تُغيَّر صلاحيته من اللوحة.'});
      if(role==='reader'&&bootstrapLocked(email,'خفضه'))return send(req,res,409,{error:bootstrapLocked(email,'خفضه')});
      if(target.role===role)return send(req,res,200,{ok:true,email,role,unchanged:true});
      if(role==='reader'){
        if(!['env','legacy'].includes(account)&&Buffer.from(account,'base64url').toString('utf8')===email)return send(req,res,409,{error:'لا يمكنك خفض صلاحية الحساب الذي تستعمله؛ اطلب ذلك من مدير آخر.'});
        if(target.active&&await adminStore.users.countDocuments({role:'admin',active:true})<=1)return send(req,res,409,{error:'أنشئ مديراً آخر وفعّله قبل خفض آخر مدير للمكتبة.'});
      }
      const changed=await adminStore.users.updateOne({email,role:target.role},{$set:{role,roleChangedAt:new Date(),updatedAt:new Date()}});
      if(!changed.modifiedCount)return send(req,res,409,{error:'تغيّر الحساب أثناء الطلب؛ أعد تحميل القائمة وحاول مجددًا.'});
      await recordAudit(adminStore,auditActor(req),'user_role_changed',email,{from:target.role,to:role});
      return send(req,res,200,{ok:true,email,role,from:target.role});
    }
    if(p==='/api/admin/users/status'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),action=String(body.action||((body.active===true)?'resume':'suspend')),actor=sessionInfo(req)?.account||'';
      if(!['resume','suspend','permanent'].includes(action))return send(req,res,400,{error:'حالة الحساب غير صالحة.'});
      if(action!=='resume'&&actor!=='env'&&actor!=='legacy'&&Buffer.from(actor,'base64url').toString('utf8')===email)return send(req,res,409,{error:'لا يمكن تعطيل حساب الإدارة المستخدم حالياً.'});
      const target=await adminStore.users.findOne({email},{projection:{role:1,accountStatus:1,active:1}});if(!target)return send(req,res,404,{error:'لم يُعثر على الحساب.'});
      if(target.accountStatus==='permanent')return send(req,res,409,{error:'هذا الحساب موقوف نهائياً ولا يمكن إعادة تفعيله من اللوحة.'});
      if(action!=='resume'&&bootstrapLocked(email,'إيقافه'))return send(req,res,409,{error:bootstrapLocked(email,'إيقافه')});
      if(action==='resume'&&target.accountStatus==='pending')return send(req,res,409,{error:'يجب تفعيل البريد الإلكتروني أولاً.'});
      if(action!=='resume'&&target.role==='admin'&&target.active&&await adminStore.users.countDocuments({role:'admin',active:true})<=1)return send(req,res,409,{error:'أنشئ مديراً آخر وفعّله قبل تعطيل آخر مدير للمكتبة.'});
      const active=action==='resume',accountStatus=action==='resume'?'active':action==='permanent'?'permanent':'suspended';
      await adminStore.users.updateOne({email},{$set:{active,accountStatus,lastSeenAt:null,updatedAt:new Date()},...(action==='permanent'?{$unset:{activationTokenHash:'',activationExpiresAt:''}}:{})});
      await recordAudit(adminStore,'administrator',action==='resume'?'user_resumed':action==='permanent'?'user_permanently_suspended':'user_suspended',email);
      return send(req,res,200,{ok:true,email,active,accountStatus});
    }
    /* حذف حساب فردي نهائيًا. الحساب وملفاته الشخصية غير المرتبطة بإضافة يُمحيان؛ الإضافات المبتوت فيها تبقى سجلًا للمكتبة بلا بريد صاحبها؛
       والإضافات المفتوحة (قيد المراجعة) لا تُحذف إلا بموافقة صريحة (discardOpen). سجل التدقيق يحتفظ بأن الحذف تمّ ومَن نفّذه. */
    if(p==='/api/admin/users/delete'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      const body=await jsonBody(req),email=String(body.email||'').trim().toLowerCase(),confirmEmail=String(body.confirmEmail||'').trim().toLowerCase(),account=sessionInfo(req)?.account||'';
      if(!email||confirmEmail!==email)return send(req,res,400,{error:'اكتب بريد الحساب كما هو لتأكيد الحذف النهائي.'});
      const target=await adminStore.users.findOne({email},{projection:{role:1,accountStatus:1,active:1}});if(!target)return send(req,res,404,{error:'لم يُعثر على الحساب.'});
      if(!['env','legacy'].includes(account)&&Buffer.from(account,'base64url').toString('utf8')===email)return send(req,res,409,{error:'لا يمكنك حذف الحساب الذي تستعمله؛ اطلب ذلك من مدير آخر.'});
      if(bootstrapLocked(email,'حذفه'))return send(req,res,409,{error:bootstrapLocked(email,'حذفه')});
      if(target.role==='admin'&&target.active&&await adminStore.users.countDocuments({role:'admin',active:true})<=1)return send(req,res,409,{error:'أنشئ مديراً آخر وفعّله قبل حذف آخر مدير للمكتبة.'});
      const open=await adminStore.contributions.find({userEmail:email,status:{$in:['pending','reviewing']}}).project({id:1,draftDocumentId:1}).toArray();
      if(open.length&&body.discardOpen!==true)return send(req,res,409,{error:'لهذا الحساب '+open.length+' إضافة قيد المراجعة؛ ستُحذف معه إن أكدتَ ذلك، أو ابتّ فيها أولًا.',needsDiscard:true,openContributions:open.length});
      const removed=await adminStore.users.deleteOne({_id:target._id,role:target.role,active:target.active,accountStatus:target.accountStatus});
      if(!removed.deletedCount)return send(req,res,409,{error:'تغيّر الحساب أثناء الطلب؛ أعد تحميل القائمة وحاول مجددًا.'});
      /* الحساب غاب فتسقط جلساته عند أول طلب؛ ثم تُنظَّف بياناته (كل خطوة مستقلة وقابلة للتكرار). */
      const result={discardedContributions:0,anonymizedContributions:0,removedFiles:0};let cleanupFailed=false;
      try{
        if(open.length){
          const ids=open.map(c=>c.id),drafts=open.map(c=>c.draftDocumentId).filter(Boolean);
          if(drafts.length)await adminStore.content.deleteMany({documentId:{$in:drafts},status:'draft'});
          result.removedFiles+=(await adminStore.contributionFiles.deleteMany({contributionId:{$in:ids}})).deletedCount;
          result.discardedContributions=(await adminStore.contributions.deleteMany({id:{$in:ids}})).deletedCount;
        }
        result.removedFiles+=(await adminStore.contributionFiles.deleteMany({ownerEmail:email,contributionId:{$exists:false}})).deletedCount;
        await adminStore.contributionFiles.updateMany({ownerEmail:email},{$set:{ownerEmail:''}});
        result.anonymizedContributions=(await adminStore.contributions.updateMany({userEmail:email},{$set:{userEmail:'',userDeleted:true,userDeletedAt:new Date(),userNotifyPending:false}})).modifiedCount;
      }catch(error){cleanupFailed=true;console.error('User data cleanup failed:',error?.message||'unknown error');}
      await recordAudit(adminStore,auditActor(req),'user_deleted',email,{role:target.role,accountStatus:target.accountStatus||(target.active?'active':'suspended'),...result,...(cleanupFailed?{cleanupFailed:true}:{})});
      return send(req,res,200,{ok:true,email,...result,...(cleanupFailed?{warning:'حُذف الحساب لكن تعذّر إكمال تنظيف بعض بياناته؛ راجع السجل.'}:{})});
    }
    if(process.env.NODE_ENV==='production'&&process.env.QALAM_DESKTOP_MODE!=='1'&&!validSession(req)&&!loginAsset){
      /* استثناء ضيّق: بحث ووثيقة (قراءة فقط) لمنصّة قلم عبر المفتاح السري المشترك، بلا جلسة شخصية —
         منصّة قلم تتحقق هي نفسها من أن المحامي مسجّل ومرتبط بالمكتبة الرقمية قبل أي استدعاء بهذا المفتاح. */
      const partnerReadRoute=req.method==='GET'&&(p==='/api/search'||p==='/api/document');
      if(!(partnerReadRoute&&partnerAuthorized(req))&&!collectorRoute(req,p)){
        if(p.startsWith('/api/'))return send(req,res,401,{error:'سجّل الدخول أولاً.'});
        return send(req,res,200,fs.readFileSync(path.join(PUBLIC,'login.html')),'text/html; charset=utf-8');
      }
    }
    if(p==='/api/original'&&(req.method==='GET'||req.method==='HEAD')){
      if(!adminStore)return send(req,res,503,{error:'خدمة الأصول غير متاحة حالياً.'});
      const docId=String(url.searchParams.get('doc')||'').slice(0,120),fileId=String(url.searchParams.get('file')||'').slice(0,40),pub=await adminStore.content.findOne({documentId:docId,status:'published'},{projection:{originalFiles:1}});
      if(!pub||!(pub.originalFiles||[]).some(f=>f.id===fileId))return send(req,res,404,{error:'الأصل غير متاح لهذه الوثيقة.'});
      const file=await adminStore.contributionFiles.findOne({id:fileId});if(!file)return send(req,res,404,{error:'ملف الأصل غير موجود.'});
      return sendOriginalFile(req,res,file,url.searchParams.get('mode'));
    }
    if(p.startsWith('/api/contributions')){
      if(!adminStore)return send(req,res,503,{error:'خدمة الإضافات غير متاحة حالياً؛ قاعدة البيانات غير متصلة.'});
      const email=contributorEmail(req);
      if(p==='/api/contributions/config'&&req.method==='GET')return send(req,res,200,{canSubmit:!!email,reason:email?'':'الإضافات والملاحظات متاحة للحسابات الفردية؛ سجّلوا الدخول ببريدكم الإلكتروني.',kinds:Object.entries(CONTRIB_KINDS).map(([id,k])=>({id,label:k.label,hint:k.hint})),noteTypes:Object.entries(NOTE_TYPES).map(([id,label])=>({id,label})),limits:{textChars:CONTRIB_LIMITS.textChars,fileBytes:CONTRIB_LIMITS.fileBytes,originalBytes:CONTRIB_LIMITS.originalBytes,originalsPerItem:CONTRIB_LIMITS.originalsPerItem,originalsTotalBytes:CONTRIB_LIMITS.originalsTotalBytes},mailNotices:emailReady()});
      if(!email)return send(req,res,403,{error:'الإضافات والملاحظات متاحة للحسابات الفردية؛ سجّلوا الدخول ببريدكم الإلكتروني.'});
      if(p==='/api/contributions/mine'&&req.method==='GET'){
        const rows=await adminStore.contributions.find({userEmail:email}).sort({createdAt:-1}).limit(100).project({text:0,message:0,excerpt:0,note:0}).toArray();
        return send(req,res,200,{items:rows.map(contributionView),unread:rows.filter(r=>r.userNotifyPending).length});
      }
      if(p==='/api/contributions/unread'&&req.method==='GET')return send(req,res,200,{unread:await adminStore.contributions.countDocuments({userEmail:email,userNotifyPending:true})});
      if(p==='/api/contributions/seen'&&req.method==='POST'){await adminStore.contributions.updateMany({userEmail:email,userNotifyPending:true},{$set:{userNotifyPending:false}});return send(req,res,200,{ok:true});}
      if(p==='/api/contributions/extract'&&req.method==='POST'){
        let raw;try{raw=await read(req,CONTRIB_LIMITS.fileBytes);}catch(error){return send(req,res,error.status||400,{error:error.status===413?'الملف أكبر من 7 ميغابايت.':error.message});}
        let name='';try{name=decodeURIComponent(String(req.headers['x-file-name']||'')).slice(0,200);}catch{}
        try{return send(req,res,200,{...extractFileText(raw,name),name});}catch(error){return send(req,res,error.status||422,{error:error.message||'تعذر استخراج النص من الملف.'});}
      }
      if(p==='/api/contributions/file'&&req.method==='POST'){
        let raw;try{raw=await read(req,CONTRIB_LIMITS.originalBytes);}catch(error){return send(req,res,error.status||400,{error:error.status===413?'الأصل أكبر من 8 ميغابايت؛ اختاروا ملفًا أصغر أو قلّلوا جودة الصور.':error.message});}
        if(!raw.length)return send(req,res,400,{error:'الملف فارغ.'});
        let name='';try{name=decodeURIComponent(String(req.headers['x-file-name']||'')).slice(0,200);}catch{}
        const ext=sniffOriginal(raw,name);if(!ext)return send(req,res,415,{error:'نوع الملف غير مقبول؛ المسموح: PDF أو صورة (JPG/PNG/WebP) أو Word (docx) أو نص (txt).'});
        if(await adminStore.contributionFiles.countDocuments({ownerEmail:email,contributionId:{$exists:false}})>=CONTRIB_LIMITS.orphanFilesPerUser)return send(req,res,429,{error:'عدد الملفات المرفوعة دون إرسال كبير؛ أرسلوا الإضافة أو أزيلوا بعض الملفات.'});
        const used=await adminStore.contributionFiles.aggregate([{$group:{_id:null,n:{$sum:'$size'}}}]).toArray();if((used[0]?.n||0)+raw.length>CONTRIB_LIMITS.storeCapBytes)return send(req,res,507,{error:'مساحة حفظ الأصول ممتلئة حاليًا؛ سيُبلَّغ المدير. حاولوا لاحقًا.'});
        const now=new Date(),doc={id:newFileId(),ownerEmail:email,name:safeFileName(name,ext),ext,mime:ORIGINAL_MIME[ext],size:raw.length,sha256:createHash('sha256').update(raw).digest('hex'),data:new Binary(raw),createdAt:now,orphanAt:new Date(now.getTime()+86400000)};
        await adminStore.contributionFiles.insertOne(doc);return send(req,res,201,fileMeta(doc));
      }
      if(p==='/api/contributions/file/delete'&&req.method==='POST'){
        let body;try{body=await jsonBody(req);}catch(error){return send(req,res,error.status||400,{error:error.message});}
        const r=await adminStore.contributionFiles.deleteOne({id:String(body.id||'').slice(0,40),ownerEmail:email,contributionId:{$exists:false}});return send(req,res,200,{ok:true,deleted:r.deletedCount});
      }
      if(p==='/api/contributions/file'&&(req.method==='GET'||req.method==='HEAD')){
        const file=await adminStore.contributionFiles.findOne({id:String(url.searchParams.get('id')||'').slice(0,40),ownerEmail:email});if(!file)return send(req,res,404,{error:'الملف غير موجود.'});
        return sendOriginalFile(req,res,file,url.searchParams.get('mode'));
      }
      if(p==='/api/contributions/addition'&&req.method==='POST'){
        let body;try{body=await jsonBody(req,2_200_000);}catch(error){return send(req,res,error.status||400,{error:error.message});}
        const checked=validateAddition(body,email);if(checked.error)return send(req,res,400,{error:checked.error});const record=checked.record;
        if(!record.fileIds.length)return send(req,res,400,{error:'أرفقوا النسخة الأصلية للوثيقة (PDF أو صورة أو Word) مع النص؛ الأصل شرط لقبول الإضافة.'});
        const attached=await adminStore.contributionFiles.find({id:{$in:record.fileIds},ownerEmail:email,contributionId:{$exists:false}}).project({data:0}).toArray();
        if(attached.length!==record.fileIds.length)return send(req,res,400,{error:'تعذر العثور على أحد الأصول المرفقة أو انتهت مهلته؛ أعيدوا رفعه ثم أرسلوا الإضافة.'});
        if(attached.reduce((n,f)=>n+f.size,0)>CONTRIB_LIMITS.originalsTotalBytes)return send(req,res,413,{error:'مجموع الأصول المرفقة يتجاوز 16 ميغابايت.'});
        const since=new Date(Date.now()-86400000);
        if(await adminStore.contributions.countDocuments({userEmail:email,type:'addition',createdAt:{$gte:since}})>=CONTRIB_LIMITS.additionsPerDay)return send(req,res,429,{error:'بلغتم الحد اليومي لعدد الإضافات؛ أعيدوا المحاولة غدًا.'});
        if(await adminStore.contributions.countDocuments({userEmail:email,type:'addition',status:{$in:['pending','reviewing']}})>=CONTRIB_LIMITS.openAdditions)return send(req,res,429,{error:'لديكم إضافات كثيرة قيد الدرس؛ انتظروا البتّ فيها قبل إرسال المزيد.'});
        if(await adminStore.contributions.findOne({userEmail:email,contentHash:record.contentHash,status:{$in:['pending','reviewing']}},{projection:{_id:1}}))return send(req,res,409,{error:'سبق أن أرسلتم هذا النص وهو قيد الدرس.'});
        const now=new Date();Object.assign(record,{createdAt:now,updatedAt:now,statusChangedAt:now,userNotifyPending:false,originalFiles:attached.map(fileMeta)});delete record.fileIds;await adminStore.contributions.insertOne(record);
        await adminStore.contributionFiles.updateMany({id:{$in:attached.map(f=>f.id)}},{$set:{contributionId:record.id},$unset:{orphanAt:''}});
        await recordAudit(adminStore,email,'contribution_added',record.id,{kind:record.kind,title:record.title});
        void mailContributor(record,'received');void mailOwnerAboutContribution(record);
        return send(req,res,201,{ok:true,id:record.id,status:record.status,statusLabel:CONTRIB_STATUSES.pending});
      }
      if(p==='/api/contributions/note'&&req.method==='POST'){
        let body;try{body=await jsonBody(req,60000);}catch(error){return send(req,res,error.status||400,{error:error.message});}
        const title=library.titleOf(contribLine(body.documentId,120));if(!title)return send(req,res,404,{error:'الوثيقة المعنية غير موجودة في المكتبة.'});
        const checked=validateNote(body,email,{title});if(checked.error)return send(req,res,400,{error:checked.error});const record=checked.record;
        const since=new Date(Date.now()-86400000);
        if(await adminStore.contributions.countDocuments({userEmail:email,type:'note',createdAt:{$gte:since}})>=CONTRIB_LIMITS.notesPerDay)return send(req,res,429,{error:'بلغتم الحد اليومي لعدد الملاحظات؛ أعيدوا المحاولة غدًا.'});
        if(await adminStore.contributions.findOne({userEmail:email,contentHash:record.contentHash,status:'pending'},{projection:{_id:1}}))return send(req,res,409,{error:'سبق أن أرسلتم هذه الملاحظة وهي قيد الدرس.'});
        const now=new Date();Object.assign(record,{createdAt:now,updatedAt:now,statusChangedAt:now,userNotifyPending:false});await adminStore.contributions.insertOne(record);
        await recordAudit(adminStore,email,'contribution_note',record.id,{documentId:record.documentId});
        void mailOwnerAboutContribution(record);
        return send(req,res,201,{ok:true,id:record.id,status:record.status,statusLabel:CONTRIB_STATUSES.pending});
      }
      return send(req,res,404,{error:'الخدمة غير موجودة.'});
    }
    if(p==='/api/admin/legal-monitor/reports'&&req.method==='GET'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      const rows=await adminStore.legalMonitorReports.find({}).sort({generatedAt:-1}).limit(30).toArray();
      return send(req,res,200,{timeZone:'Africa/Casablanca',reports:rows.map(({_id,type,localDate,title,text,status,generatedAt,sourceCount})=>({id:_id,type,localDate,title,text,status,generatedAt,sourceCount}))});
    }
    if(p==='/api/admin/legal-monitor/items'&&(req.method==='GET'||req.method==='POST')){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      if(req.method==='GET'){
        const state=['held','ready','published'].includes(url.searchParams.get('state'))?url.searchParams.get('state'):'';
        const rows=await adminStore.legalMonitorItems.find(state?{state}:{state:{$ne:'dismissed'}}).sort({receivedAt:-1}).limit(100).toArray();
        return send(req,res,200,{items:rows.map(row=>{const {_id,id,country,kind,title,eventDate,state,holdReason,source,sourceCount,readyForAutomaticPublication,original,receivedAt,autoPublishAt,effectiveDate,currentStage,publishCategory,supersedesId,supersedesTitle}=row;let readiness=null;if(state!=='published'){let candidate=null;if(['legislation','bill'].includes(row.kind)&&!row.supersedesId){const number=lawNumberOf(title);if(number){try{const found=(library.search({q:number,limit:6}).results||[]).find(d=>d.origin!=='legal-monitor'&&String(d.title||'').includes(number)&&d.id!==`monitor-${String(id).slice(0,20)}`);if(found)candidate={id:found.id,title:found.title};}catch{}}}readiness=readinessOf(row,candidate);}return {id,country,kind,title,eventDate,state,holdReason,source,sourceCount,readyForAutomaticPublication,original,receivedAt,autoPublishAt,effectiveDate,currentStage,publishCategory,supersedesId,supersedesTitle,originalTitle:row.originalTitle||'',titleNeedsArabic:titleNeedsArabic(row),autoPublishable:canAutoPublishAfterRelease(row),readiness};})});
      }
      let body;try{body=await jsonBody(req,500000);}catch(error){return send(req,res,error.status||400,{error:error.message});}
      const checked=makeObservation(body);if(checked.error)return send(req,res,400,{error:checked.error});
      const item=checked.record;
      try{
        /* منع التكرار عند الاستقبال: القرار أو النص نفسه (البلد والنوع والرقم) يحدّث بطاقته القائمة ولا يُنشئ بطاقة ثانية؛
           وما حذفه المدير برقمه لا يُستورد ثانية ولو تغيّر معرّفه. */
        const key=decisionKey(item);
        if(key.length>=3&&item.kind==='case_law'){
          const kin=(await adminStore.legalMonitorItems.find({_id:{$ne:item.id},country:item.country,kind:item.kind,$or:[{caseNumber:{$exists:true}},{officialNumber:{$exists:true}}]}).project({_id:1,state:1,caseNumber:1,officialNumber:1,dismissedBy:1}).toArray()).filter(r=>decisionKey(r)===key);
          const live=kin.find(r=>r.state!=='dismissed');
          if(live)item.id=live._id;
          else if(kin.some(r=>r.state==='dismissed'&&!/^review-dedupe|collector-correction$/.test(String(r.dismissedBy||''))))return send(req,res,200,{ok:true,id:item.id,dismissed:true,skipped:true,note:'حذف المدير هذا القرار برقمه؛ لا تعد استيراده.'});
        }
        const previous=await adminStore.legalMonitorItems.findOne({_id:item.id});
        if(previous?.state==='dismissed')return send(req,res,200,{ok:true,id:item.id,dismissed:true,skipped:true,note:'حذفه المدير؛ لا تعد استيراده ولا تُنشئ له ملفاً في Drive.'});
        let stored=(item.kind==='bill'||item.kind==='legislation')?mergeLegislativeObservation(previous,item):item;if(previous?.holdReason==='تحفظ المدير على النشر.')stored={...stored,state:'held',holdReason:previous.holdReason,autoPublishAt:null,readyForAutomaticPublication:false};
        /* تصحيح قرار قضائي: إن وصل قرار بالمصدر والمحكمة والتاريخ نفسها ومعرّف مختلف (رقم أو عنوان مصحَّح) فالبطاقة القديمة هي الخاطئة، فتُسحب تلقائياً ويبقى لها شاهد حذف. */
        if(item.kind==='case_law'&&item.source?.url&&item.court){
          const stale=await adminStore.legalMonitorItems.find({_id:{$ne:item.id},kind:'case_law',country:item.country,court:item.court,eventDate:item.eventDate,'source.url':item.source.url,state:{$ne:'dismissed'}}).toArray();
          for(const old of stale){
            const docId=old.documentId||`monitor-${String(old._id).slice(0,20)}`;
            await adminStore.content.deleteMany({documentId:docId,origin:'legal-monitor'});
            await adminStore.legalMonitorItems.replaceOne({_id:old._id},{_id:old._id,id:old._id,state:'dismissed',kind:old.kind,country:old.country,title:old.title,dismissedAt:new Date(),dismissedBy:'collector-correction'});
            await recordAudit(adminStore,auditActor(req),'legal_monitor_item_superseded_by_correction',old._id,{title:old.title,replacedBy:item.id,caseNumber:item.caseNumber});
          }
          if(stale.length)library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());
        }
        await adminStore.legalMonitorItems.replaceOne({_id:item.id},{...stored,...(previous?.publishCategory?{publishCategory:previous.publishCategory}:{}),...(previous?.titleEdited?{title:previous.title,titleEdited:true}:{}),...(previous?.supersedesId?{supersedesId:previous.supersedesId,supersedesTitle:previous.supersedesTitle||''}:{}),_id:item.id,receivedBy:previous?.receivedBy||auditActor(req)},{upsert:true});
        if(!previous)await recordAudit(adminStore,auditActor(req),'legal_monitor_item_recorded',item.id,{country:item.country,kind:item.kind,title:item.title,state:item.state});
        else if(item.kind==='bill'||item.kind==='legislation')await recordAudit(adminStore,auditActor(req),'legal_monitor_item_updated',item.id,{country:item.country,stage:stored.currentStage,title:stored.title});
        return send(req,res,previous?200:201,{ok:true,id:item.id,updated:!!previous,state:stored.state,stage:stored.currentStage,holdReason:stored.holdReason});
      }catch(error){return send(req,res,503,{error:'تعذر حفظ سجل الرصد بأمان؛ لم يتم نشر أي محتوى.'});}
    }
    if(p==='/api/admin/legal-monitor/items/action'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      let body;try{body=await jsonBody(req,4000);}catch(error){return send(req,res,error.status||400,{error:error.message});}
      const id=String(body.id||'').slice(0,80),action=String(body.action||''),item=id?await adminStore.legalMonitorItems.findOne({_id:id}):null;
      if(!item)return send(req,res,404,{error:'السجل غير موجود.'});
      const actor=auditActor(req),now=new Date();
      try{
        if(action==='title'){const t=String(body.title||'').replace(/\s+/g,' ').trim().slice(0,500);if(t.length<3)return send(req,res,400,{error:'العنوان قصير جداً.'});const patch={title:t,titleEdited:true};if(item.state==='held'&&String(item.holdReason||'').startsWith('العنوان غير معرَّب')&&!titleNeedsArabic({...item,title:t}))patch.holdReason='';await adminStore.legalMonitorItems.updateOne({_id:id},{$set:patch,$push:{history:{state:item.state,at:now,reason:'manager_title_edit'}}});}
        else if(action==='supersedes'){const oid=String(body.oldId||'').trim().slice(0,160),otitle=String(body.oldTitle||'').trim().slice(0,300);await adminStore.legalMonitorItems.updateOne({_id:id},oid?{$set:{supersedesId:oid,supersedesTitle:otitle}}:{$unset:{supersedesId:'',supersedesTitle:''}});if(item.state==='published')await refreshSupersessions();}
        else if(action==='prepare'){
          if(item.state==='published')return send(req,res,409,{error:'السجل منشور أصلاً.'});
          const pdfUrl=String(item.source?.url||'');if(!/\.pdf(\?|$)/i.test(pdfUrl))return send(req,res,409,{error:'مصدر هذا السجل ليس رابط PDF مباشراً؛ أضف الأصل يدوياً.'});
          const savedSettings=await adminStore.settings.findOne({_id:'library'}),ocrSettings=savedSettings?.ocr||{},prepKey=geminiOcrApiKey(openSecret(ocrSettings.geminiApiKeyEncrypted));
          if(!geminiOcrEnabled(ocrSettings.engine)||!prepKey)return send(req,res,409,{error:'لم يُضبط مفتاح Gemini في المكتبة؛ أضفه من الإدارة ← القراءة الآلية ثم أعد المحاولة.',code:'no_key'});
          if(activeDriveOcr)return send(req,res,409,{error:'هناك عملية استخراج قيد التنفيذ؛ انتظر اكتمالها.'});activeDriveOcr=true;
          try{
            const {bytes}=await fetchOfficialPdf(pdfUrl),prompt='استخرج النص الظاهر في هذا المستند كاملاً وبأمانة حرفية، باللغة العربية كما كُتب. حافظ على أرقام المواد والفصول والتواريخ وعلى ترتيب الصفحات والفقرات. لا تلخص ولا تشرح ولا تضف عناوين من عندك. أعد النص المستخرج وحده. إذا تعذر قراءة موضع فضع [غير مقروء].';
            const {text}=await extractGeminiPdf(geminiOcrModel(),prepKey,bytes,prompt),clean=String(text||'').trim();
            if(clean.length<200)return send(req,res,422,{error:'لم يُستخرج نص كافٍ من الملف؛ لم يُحفظ شيء.'});
            await adminStore.legalMonitorItems.updateOne({_id:id},{$set:{fullText:clean.slice(0,150000)},$push:{history:{state:item.state,at:now,reason:'prepared_text_extracted'}}});
          }finally{activeDriveOcr=false;}
        }
        else if(action==='category'){const cat=String(body.category||'').trim().slice(0,80);await adminStore.legalMonitorItems.updateOne({_id:id},cat?{$set:{publishCategory:cat}}:{$unset:{publishCategory:''}});}
        else if(action==='hold'){await adminStore.legalMonitorItems.updateOne({_id:id},{$set:{state:'held',holdReason:'تحفظ المدير على النشر.',autoPublishAt:null},$push:{history:{state:'held',at:now,reason:'manager_reservation'}}});}
        else if(action==='release'){if(item.state!=='held')return send(req,res,409,{error:'السجل ليس محجوزاً.'});await adminStore.legalMonitorItems.updateOne({_id:id},{$set:{state:'ready',holdReason:'',readyForAutomaticPublication:true,autoPublishAt:scheduleAfterRelease(item,now)},$push:{history:{state:'ready',at:now,reason:'manager_release'}}});}
        else if(action==='publish'||action==='approve'){if(!['ready','held'].includes(item.state))return send(req,res,409,{error:'السجل منشور أصلاً.'});if(!lawStagesComplete(item))return send(req,res,409,{error:'لم يستوفِ النص التشريعي مراحله بعد؛ لا يُعتمد قبل نشره في الجريدة الرسمية أو نفاذه.'});const category=String(body.category||'').trim().slice(0,80);if(category)await adminStore.legalMonitorItems.updateOne({_id:id},{$set:{publishCategory:category}});await publishLegalItem({...item,id,...(category?{publishCategory:category}:{})},actor);}
        else if(action==='move'){
          const cat=String(body.category||'').trim().slice(0,80);if(!cat)return send(req,res,400,{error:'اسم القسم مطلوب.'});
          await adminStore.legalMonitorItems.updateOne({_id:id},{$set:{publishCategory:cat}});
          const docId=item.documentId||`monitor-${String(id).slice(0,20)}`;
          await adminStore.content.updateMany({documentId:docId,origin:'legal-monitor'},{$set:{category:cat,updatedAt:now}});
          library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());
          await recordAudit(adminStore,actor,'legal_monitor_item_moved',id,{title:item.title,category:cat});
        }
        else if(action==='delete'){
          const docId=item.documentId||`monitor-${String(id).slice(0,20)}`;
          /* لقطة في سلة المحذوفات قبل الحذف: البطاقة كاملة ومحتواها المنشور، تُستعاد بزر واحد خلال 30 يوماً. */
          const gone=await adminStore.content.find({documentId:docId,origin:'legal-monitor'}).toArray();
          await adminStore.trash.insertOne(makeTrashEntry({kind:'monitor',label:item.title,actor,item,contents:gone},now));
          await adminStore.content.deleteMany({documentId:docId,origin:'legal-monitor'});
          /* شاهد حذف: يبقى المعرّف بحالة dismissed حتى لا يعيد الجامع استيراده ولا يظهر في أي قائمة. */
          await adminStore.legalMonitorItems.replaceOne({_id:id},{_id:id,id,state:'dismissed',kind:item.kind,country:item.country,title:item.title,dismissedAt:now,dismissedBy:actor});
          library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());
        }else return send(req,res,400,{error:'إجراء غير معروف.'});
        await recordAudit(adminStore,actor,'legal_monitor_item_'+action,id,{title:item.title});
        return send(req,res,200,{ok:true,action});
      }catch(error){return send(req,res,503,{error:'تعذر تنفيذ الإجراء؛ لم يتغير شيء.'});}
    }
    if(p==='/api/admin/overview'&&req.method==='GET'){
      const stats=library.stats(),statuses=library.db.prepare('SELECT review_status status,count(*) count FROM documents GROUP BY review_status ORDER BY count DESC').all();
      const documents=library.db.prepare("SELECT id,title,category,text_kind,review_status,chars FROM documents WHERE review_status IN ('needs_review','automated_review') ORDER BY CASE review_status WHEN 'needs_review' THEN 0 ELSE 1 END, rowid LIMIT 60").all();
      const managed=adminStore?await adminStore.content.find({status:'draft'}).sort({updatedAt:-1}).limit(40).project({documentId:1,title:1,category:1,textKind:1,status:1,submittedBy:1,updatedAt:1,origin:1}).toArray():[];
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
      try{const folderId=(url.searchParams.get('folderId')||'').slice(0,200)||undefined;if(folderId&&await isPendingCassationDriveItem(folderId)&&!await adminSessionLive(req))return send(req,res,403,{error:'هذا المجلد قيد المراجعة الإدارية.'});const listing=await listDriveFolder(folderId);if(!await adminSessionLive(req))listing.files=listing.files.filter(file=>file.id!==PENDING_CASSATION_FOLDER_ID);return send(req,res,200,listing);}catch(error){return send(req,res,503,{error:error.message||'تعذر استعراض مجلد Drive.'});}
    }
    if(p==='/api/drive/search'&&req.method==='GET'){
      try{const result=await searchDrivePdfs(url.searchParams.get('q')||'',20);if(!await adminSessionLive(req))result.files=result.files.filter(file=>!String(file.path||'').includes('إضافات النقض'));return send(req,res,200,result);}catch(error){return send(req,res,503,{error:error.message||'تعذر البحث عن أصل الوثيقة في Drive.'});}
    }
    if(p==='/api/drive/match'&&req.method==='GET'){
      try{return send(req,res,200,await matchDrivePdf(url.searchParams.get('q')||'',url.searchParams.get('source')||'',url.searchParams.get('exactName')||'',url.searchParams.get('exactPath')||''));}catch(error){return send(req,res,503,{error:error.message||'تعذر مطابقة الوثيقة مع أصلها في Drive.'});}
    }
    if(p==='/api/admin/agreements/item'&&req.method==='POST'){
      if(!adminStore?.agreementOverrides)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة.'});
      let body;try{body=await jsonBody(req);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}
      const treatyId=String(body.treatyId||'').trim(),action=String(body.action||'');
      if(!/^\d{1,10}$/.test(treatyId)||!['move','hide','restore'].includes(action))return send(req,res,400,{error:'طلب غير صالح.'});
      const groupOfFile=f=>String(f.agreementSubcategory||'').trim()||String(f.path||'').split(' / ').filter(Boolean).at(-1)||'';
      try{
        const actor=auditActor(req),now=new Date();
        if(action==='restore'){const gone=await adminStore.agreementOverrides.deleteOne({treatyId});await refreshAgreementOverrides();await recordAudit(adminStore,actor,'agreement_restored',treatyId,{});return send(req,res,200,{ok:true,restored:gone.deletedCount>0});}
        const listing=(await listAgreementPdfs('',1,2000)).files,current=listing.find(f=>String(f.treatyId||'')===treatyId);
        if(!current)return send(req,res,404,{error:'الاتفاقية غير موجودة في الفهرس.'});
        if(action==='hide'){await adminStore.agreementOverrides.updateOne({treatyId},{$set:{treatyId,hidden:true,updatedAt:now,updatedBy:actor}},{upsert:true});await refreshAgreementOverrides();await recordAudit(adminStore,actor,'agreement_hidden',treatyId,{title:String(current.title||current.name||'').slice(0,200)});return send(req,res,200,{ok:true});}
        const kind=String(body.kind||''),group=String(body.group||'').trim().slice(0,120);
        if(!['ثنائية','متعددة'].includes(kind)||!group)return send(req,res,400,{error:'اختر الفرع والمجلد.'});
        if(!listing.some(f=>f.agreementKind===kind&&groupOfFile(f)===group))return send(req,res,400,{error:'المجلد المطلوب غير موجود في هذا الفرع.'});
        await adminStore.agreementOverrides.updateOne({treatyId},{$set:{treatyId,kind,group,hidden:false,updatedAt:now,updatedBy:actor}},{upsert:true});
        await refreshAgreementOverrides();
        await recordAudit(adminStore,actor,'agreement_moved',treatyId,{from:{kind:current.agreementKind||'',group:groupOfFile(current)},to:{kind,group}});
        return send(req,res,200,{ok:true,kind,group});
      }catch(error){return send(req,res,503,{error:error.message||'تعذر تنفيذ الإجراء.'});}
    }
    if(p==='/api/drive/agreements'&&req.method==='GET'){
      try{return send(req,res,200,await listAgreementPdfs(url.searchParams.get('q')||'',url.searchParams.get('page')||1,url.searchParams.get('limit')||20));}catch(error){return send(req,res,503,{error:error.message||'تعذر فهرسة ملفات الاتفاقيات والمعاهدات في Drive.'});}
    }
    if(p==='/api/drive/document'&&req.method==='GET'){
      const documentId=(url.searchParams.get('id')||'').slice(0,80),document=library.document(documentId);
      if(!document||document.type!=='juriscassation')return send(req,res,404,{error:'القرار غير موجود في الفهرس القضائي.'});
      try{const match=await resolveJudicialDrivePdf(documentId,document.category);if(await isPendingCassationDriveItem(match.id)&&!await adminSessionLive(req))return send(req,res,403,{error:'القرار قيد المراجعة الإدارية.'});const {item,response}=await openDrivePdf(match.id),mode=url.searchParams.get('mode')==='download'?'attachment':'inline',safeName=encodeURIComponent(String(item.name||'decision.pdf').replace(/[\r\n\0]/g,'_')),length=response.headers.get('content-length');res.writeHead(200,{...headers,'Content-Type':'application/pdf','Content-Disposition':`${mode}; filename="decision.pdf"; filename*=UTF-8''${safeName}`,'Cache-Control':'private, no-store, max-age=0',...(length?{'Content-Length':length}:{}),'X-Content-Type-Options':'nosniff'});await pipeline(Readable.fromWeb(response.body),res);return;}catch(error){if(res.headersSent){res.destroy();return;}return send(req,res,404,{error:error.message||'لم يُعثر على أصل القرار في Drive.'});}
    }
    if(p==='/api/drive/document-source'&&req.method==='GET'){
      const documentId=(url.searchParams.get('id')||'').slice(0,160);if(!documentId)return send(req,res,400,{error:'معرف الوثيقة مطلوب.'});
      try{const match=await resolveDocumentSourcePdf(documentId);if(await isPendingCassationDriveItem(match.id)&&!await adminSessionLive(req))return send(req,res,403,{error:'الوثيقة قيد المراجعة الإدارية.'});const {item,response}=await openDriveSourceFile(match.id),mode=url.searchParams.get('mode')==='download'?'attachment':'inline',safeName=encodeURIComponent(String(item.name||'document.pdf').replace(/[\r\n\0]/g,'_')),length=response.headers.get('content-length');res.writeHead(200,{...headers,'Content-Type':item.mimeType||'application/pdf','Content-Disposition':`${mode}; filename="document"; filename*=UTF-8''${safeName}`,'Cache-Control':'private, no-store, max-age=0',...(length?{'Content-Length':length}:{}),'X-Content-Type-Options':'nosniff'});await pipeline(Readable.fromWeb(response.body),res);return;}catch(error){if(res.headersSent){res.destroy();return;}return send(req,res,404,{error:error.message||'لم يُعثر على أصل الوثيقة.'});}
    }
    if(p==='/api/drive/file'&&req.method==='GET'){
      let id=(url.searchParams.get('id')||'').slice(0,200);const mode=url.searchParams.get('mode')==='download'?'attachment':'inline';if(!id)return send(req,res,400,{error:'معرف ملف Drive مطلوب.'});
      if(/^agr-\d{1,8}$/.test(id)){id=await agreementDriveIdFor(id.slice(4));if(!id)return send(req,res,503,{error:'يجري ربط أصل هذه الاتفاقية بملفه في Drive؛ أعد المحاولة بعد لحظات.'});}
      try{if(await isPendingCassationDriveItem(id)&&!await adminSessionLive(req))return send(req,res,403,{error:'الوثيقة قيد المراجعة الإدارية.'});const {item,response}=await openDriveSourceFile(id);const safeName=encodeURIComponent(String(item.name||'document').replace(/[\r\n\0]/g,'_')),length=response.headers.get('content-length'),isHtml=item.mimeType==='text/html',isMd=item.mimeType==='text/markdown';res.writeHead(200,{...headers,...(isHtml?{'Content-Security-Policy':"sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:"}:{}),'Content-Type':isHtml?'text/html; charset=utf-8':isMd?'text/plain; charset=utf-8':(item.mimeType||'application/octet-stream'),'Content-Disposition':`${mode}; filename="document"; filename*=UTF-8''${safeName}`,'Cache-Control':'private, no-store, max-age=0',...(length?{'Content-Length':length}:{}),'X-Content-Type-Options':'nosniff'});await pipeline(Readable.fromWeb(response.body),res);return;}catch(error){if(res.headersSent){res.destroy();return;}return send(req,res,503,{error:error.message||'تعذر فتح ملف Drive.'});}
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
    if(p==='/api/admin/assistant-settings'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إعدادات المكتبة غير متاحة.'});
      if(req.method==='GET')return send(req,res,200,{...await assistantPolicy(),groqConfigured:!!process.env.GROQ_API_KEY,deeplConfigured:!!deeplApiKey(),models:GROQ_CHAT_MODELS});
      if(req.method!=='POST')return send(req,res,405,{error:'طريقة الطلب غير مدعومة.'});
      let body;try{body=await jsonBody(req,2000);}catch(error){return send(req,res,error.status||400,{error:error.message});}
      if(!GROQ_CHAT_MODELS.includes(body.groqModel)||!['local','deepl'].includes(body.translationEngine)||!['fast','balanced','deep'].includes(body.processingLevel)||typeof body.aiEnabled!=='boolean'||typeof body.translationEnabled!=='boolean'||typeof body.webSearchEnabled!=='boolean')return send(req,res,400,{error:'إعدادات المساعد غير صالحة.'});
      const assistant={aiEnabled:body.aiEnabled,translationEnabled:body.translationEnabled,webSearchEnabled:body.webSearchEnabled,translationEngine:body.translationEngine,processingLevel:body.processingLevel,groqModel:body.groqModel};
      await adminStore.settings.updateOne({_id:'library'},{$set:{assistant,updatedAt:new Date()},$setOnInsert:{createdAt:new Date()}},{upsert:true});
      await recordAudit(adminStore,auditActor(req),'assistant_settings_updated','library',{aiEnabled:assistant.aiEnabled,translationEnabled:assistant.translationEnabled,webSearchEnabled:assistant.webSearchEnabled,translationEngine:assistant.translationEngine,processingLevel:assistant.processingLevel,groqModel:assistant.groqModel});
      return send(req,res,200,{ok:true,...assistant,groqConfigured:!!process.env.GROQ_API_KEY,deeplConfigured:!!deeplApiKey(),models:GROQ_CHAT_MODELS});
    }
    if(p==='/api/admin/content'&&req.method==='GET'){
      const status=['draft','published','superseded'].includes(url.searchParams.get('status'))?url.searchParams.get('status'):'draft';
      const docs=await adminStore.content.find({status}).sort({updatedAt:-1}).limit(100).project({documentId:1,title:1,category:1,type:1,textKind:1,status:1,pendingCassation:1,sourceUrl:1,reason:1,origin:1,contributionId:1,updatedAt:1,createdAt:1}).toArray();return send(req,res,200,{documents:docs});
    }
    if(p==='/api/admin/content/save'&&req.method==='POST'){
      let body;try{body=JSON.parse((await read(req,2200000)).toString('utf8'));}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}
      const title=String(body.title||'').trim().slice(0,500),text=String(body.text||'').trim(),reason=String(body.reason||'').trim().slice(0,2000);if(title.length<3||text.length<40||!reason)return send(req,res,400,{error:'أدخل عنواناً ونصاً كاملاً وسبباً موثقاً للتعديل.'});
      const documentId=String(body.documentId||'managed_'+randomBytes(12).toString('hex')).slice(0,120);const prevDraft=await adminStore.content.findOne({documentId,status:'draft'},{sort:{updatedAt:-1}}),prevPublished=prevDraft?null:await adminStore.content.findOne({documentId,status:'published'},{projection:{origin:1,originalFiles:1,issuer:1}}),carried=prevDraft||prevPublished;let base=null;try{base=library.document(documentId);}catch{}if(!base&&!documentId.startsWith('managed_'))return send(req,res,404,{error:'الوثيقة الأصلية غير موجودة في فهرس المكتبة.'});
      const sourceLanguage=body.sourceLanguage==='fr'?'fr':'ar',originalTitle=String(body.originalTitle||'').trim().slice(0,500),professionalArabicReviewed=body.professionalArabicReviewed===true;
      if(sourceLanguage==='fr'&&(!originalTitle||!professionalArabicReviewed))return send(req,res,400,{error:'للأصل الفرنسي، أدخل العنوان الرسمي بالفرنسية وأكد مراجعة الصياغة العربية القانونية قبل حفظ المسودة.'});
      const sourceLabel=String(body.sourceLabel||prevDraft?.sourceLabel||base?.sourceLabel||'').slice(0,300),translationLabel=sourceLanguage==='fr'?[sourceLabel,'الأصل بالفرنسية — البطاقة ونافذة الاطلاع بالعربية القانونية المهنية'].filter(Boolean).join(' — ').slice(0,300):sourceLabel;
      const country=body.country==='fr'?'fr':'ma',issuer=String(body.issuer||carried?.issuer||prevDraft?.issuer||'').trim().slice(0,200),pendingCassation=country==='ma'&&body.type==='juriscassation';
      const record={documentId,title,text,type:['national','judicial','juriscassation'].includes(body.type)?body.type:(prevDraft?.type||base?.type||'national'),category:String(body.category||prevDraft?.category||base?.category||'مواد قانونية').trim().slice(0,180),subcategory:String(body.subcategory||prevDraft?.subcategory||base?.subcategory||'').trim().slice(0,180),date:String(body.date||prevDraft?.date||base?.date||'').slice(0,20),kind:String(body.kind||prevDraft?.kind||base?.kind||'law'),textKind:'extracted_text',sourceUrl:String(body.sourceUrl||'').trim().slice(0,1200),sourceLabel:translationLabel,sourceLanguage,originalTitle,professionalArabicReviewed,country,issuer,pendingCassation,reason,status:'draft',createdAt:new Date(),updatedAt:new Date(),updatedBy:'admin',...(carried?.origin==='contribution'?{origin:'contribution',issuer,originalFiles:carried.originalFiles||[],...(prevDraft?.contributionId?{contributionId:prevDraft.contributionId}:{})}:{})};
      if(record.origin!=='contribution'&&!/^https:\/\//i.test(record.sourceUrl))return send(req,res,400,{error:'أدخل رابط المصدر الرسمي أو رابط أصل Drive بصيغة https:// قبل حفظ المسودة.'});
      await adminStore.content.updateMany({documentId,status:'draft'},{$set:{status:'superseded',updatedAt:new Date()}});await adminStore.content.insertOne(record);
      let pendingOriginals={total:0,moved:0,failed:0};if(record.pendingCassation&&record.originalFiles?.length){try{pendingOriginals=await moveOriginalsToDrive(record);}catch(error){pendingOriginals={total:record.originalFiles.length,moved:0,failed:record.originalFiles.length,error:error.message||'تعذر نقل أصل قرار النقض إلى إضافات النقض.'};}}
      await recordAudit(adminStore,auditActor(req),'draft_saved',documentId,{title,sourceUrl:record.sourceUrl,pendingCassation:record.pendingCassation,originalsMoved:pendingOriginals.moved,originalsError:pendingOriginals.error||''});return send(req,res,201,{ok:true,documentId,status:'draft',originals:pendingOriginals});
    }
    if(p==='/api/admin/content/publish'&&req.method==='POST'){
      let body;try{body=await jsonBody(req);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}const documentId=String(body.documentId||'').slice(0,120),draft=await adminStore.content.findOne({documentId,status:'draft'},{sort:{updatedAt:-1}});
      if(!draft)return send(req,res,404,{error:'لا توجد مسودة جاهزة لهذا النص.'});if(!body.confirmReviewed||(draft.origin!=='contribution'&&(!draft.sourceUrl||!/^https:\/\//i.test(draft.sourceUrl))))return send(req,res,400,{error:'يلزم تأكيد المراجعة والتحقق من رابط المصدر.'});if(draft.sourceLanguage==='fr'&&(!draft.originalTitle||!draft.professionalArabicReviewed))return send(req,res,400,{error:'لا يمكن نشر أصل فرنسي قبل توثيق عنوانه ومراجعة صياغته العربية القانونية.'});
      let cassationTransfer={total:0,moved:0};if(draft.pendingCassation){try{cassationTransfer=await publishPendingCassationOriginals(draft);}catch(error){return send(req,res,409,{error:error.message||'تعذر نقل أصل قرار النقض من إضافات النقض؛ لم يُنشر القرار.'});}}
      const approvedDoc={...draft,pendingCassation:false};
      await adminStore.content.updateMany({documentId,status:'published'},{$set:{status:'superseded',updatedAt:new Date()}});await adminStore.content.updateOne({_id:draft._id},{$set:{status:'published',pendingCassation:false,publishedAt:new Date(),publishedBy:auditActor(req),approvedAt:new Date(),updatedAt:new Date()}});await recordAudit(adminStore,auditActor(req),draft.pendingCassation?'cassation_decision_approved_and_published':'content_published',documentId,{title:draft.title,sourceUrl:draft.sourceUrl});library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());if(draft.contributionId){const done=await moveContribution(draft.contributionId,'published',{publishedDocumentId:documentId,publishedAt:new Date()});if(done)void mailContributor(done,'published');}
      let originals={total:0,moved:0,failed:0};if(draft.originalFiles?.length){try{originals=await moveOriginalsToDrive(approvedDoc,{subfolder:String(body.driveSubfolder||'')});}catch(error){originals={total:draft.originalFiles.length,moved:0,failed:draft.originalFiles.length,error:error.message||'تعذر نقل الأصول إلى Drive.'};}await recordAudit(adminStore,auditActor(req),'originals_to_drive',documentId,{moved:originals.moved,failed:originals.failed,folder:originals.folder||'',error:originals.error||''});}
      return send(req,res,200,{ok:true,documentId,status:'published',originals,cassationTransfer});
    }
    /* أدوات المدير على كل البطاقات (لا بطاقات المستجدات وحدها): وثائق القاعدة الأساسية تُخفى أو تُنقل بقرار يُحفظ دون مسّ القاعدة،
       وملفات رفوف Drive تُحذف إلى سلة Drive أو تُنقل إلى رفّ آخر. كل حذف يمرّ بسلة المحذوفات ويُستعاد منها. */
    if(p==='/api/admin/document-action'&&req.method==='POST'){
      let body;try{body=await jsonBody(req,4000);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}
      const id=String(body.id||'').slice(0,160),action=String(body.action||''),doc=id?library.document(id):null;
      if(!doc)return send(req,res,404,{error:'الوثيقة غير موجودة.'});
      if(action==='hide'){await adminStore.docOverrides.updateOne({_id:id},{$set:{hidden:true,title:doc.title,at:new Date()}},{upsert:true});await adminStore.trash.insertOne(makeTrashEntry({kind:'document',label:doc.title,actor:'admin',ref:{docId:id,category:doc.category}}));}
      else if(action==='move'){const category=String(body.category||'').trim().slice(0,120);if(!category)return send(req,res,400,{error:'اختر القسم.'});await adminStore.docOverrides.updateOne({_id:id},{$set:{category,title:doc.title,at:new Date()}},{upsert:true});}
      else return send(req,res,400,{error:'إجراء غير معروف.'});
      await loadDocOverrides();await recordAudit(adminStore,'admin','document_'+action,id,{title:doc.title,category:body.category||''});
      return send(req,res,200,{ok:true});
    }
    if(p==='/api/admin/drive-targets'&&req.method==='GET'){
      const seen=new Set(),targets=[...Object.entries(DRIVE_SHELVES).map(([name,id])=>({name,id})),...MONITORED_FOLDERS.map(f=>({name:f.path.split(' / ').pop(),id:f.id}))].filter(t=>t.id&&!seen.has(t.id)&&seen.add(t.id));
      return send(req,res,200,{targets});
    }
    if(p==='/api/admin/drive-action'&&req.method==='POST'){
      let body;try{body=await jsonBody(req,4000);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}
      const id=String(body.id||'').slice(0,200),action=String(body.action||'');
      try{
        if(action==='trash'){const r=await trashOriginalDriveFile(id,true);await adminStore.trash.insertOne(makeTrashEntry({kind:'drive',label:String(body.name||r.name||id).slice(0,300),actor:'admin',ref:{driveId:id,folder:String(body.folder||'').slice(0,120)}}));}
        else if(action==='move'){const target=String(body.target||'').slice(0,200);if(!target)return send(req,res,400,{error:'اختر الرفّ.'});await moveOriginalDriveFile(id,target);}
        else return send(req,res,400,{error:'إجراء غير معروف.'});
      }catch(error){return send(req,res,502,{error:error.message||'تعذر تنفيذ العملية في Drive.'});}
      await recordAudit(adminStore,'admin','drive_'+action,id,{name:body.name||'',target:body.target||''});
      return send(req,res,200,{ok:true});
    }
    /* سلة المحذوفات: قائمة، واستعادة، وحذف نهائي بأمر المدير (وإلا تُمحى تلقائياً بعد 30 يوماً). */
    if(p==='/api/admin/trash'&&req.method==='GET'){
      const rows=await adminStore.trash.find({}).sort({deletedAt:-1}).limit(300).toArray();return send(req,res,200,{items:rows.map(trashView)});
    }
    if(p==='/api/admin/trash'&&req.method==='POST'){
      let body;try{body=await jsonBody(req);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}
      const id=String(body.id||'').slice(0,60),action=String(body.action||''),entry=await adminStore.trash.findOne({_id:id});
      if(!entry)return send(req,res,404,{error:'العنصر غير موجود في السلة.'});
      if(action==='restore'){const r=await restoreTrashEntry(adminStore,entry,{untrashDrive:id=>trashOriginalDriveFile(id,false)});await loadDocOverrides();library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());await recordAudit(adminStore,'admin','trash_restored',id,{label:entry.label,kind:entry.kind});return send(req,res,200,{ok:true,...r});}
      if(action==='purge'){await adminStore.trash.deleteOne({_id:id});await recordAudit(adminStore,'admin','trash_purged',id,{label:entry.label,kind:entry.kind});return send(req,res,200,{ok:true});}
      return send(req,res,400,{error:'إجراء غير معروف.'});
    }
    /* التدقيق في الواجهة نفسها (للمدير وحده): حالة كل بطاقة معروضة دفعة واحدة، وإصلاح آمن لبطاقة واحدة. */
    if(p==='/api/admin/card-audit/items'&&req.method==='POST'){
      let body;try{body=await jsonBody(req,20000);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}
      const ids=(Array.isArray(body.ids)?body.ids:[]).map(x=>String(x).slice(0,80)).filter(Boolean).slice(0,200);
      const rows=ids.length?await adminStore.legalMonitorItems.find({_id:{$in:ids}}).project({fullText:0,history:0}).toArray():[];
      const all=rows.length?await adminStore.legalMonitorItems.find({state:{$ne:'dismissed'}}).project({country:1,kind:1,caseNumber:1,officialNumber:1,state:1,title:1}).toArray():[];
      const dupOf=new Map();for(const g of auditReport(all).duplicates)for(const x of g)dupOf.set(String(x.id),g.filter(y=>String(y.id)!==String(x.id)).map(y=>y.title));
      const result={};for(const r of rows){const issues=auditCard(r);const d=dupOf.get(String(r._id));if(d?.length)issues.push({code:'duplicate',label:'مكررة مع: '+d.join(' / '),fixable:false});result[r._id]={issues,fixable:!!fixCard(r)};}
      return send(req,res,200,{items:result});
    }
    if(p==='/api/admin/card-audit/fix'&&req.method==='POST'){
      let body;try{body=await jsonBody(req,4000);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}
      const item=await adminStore.legalMonitorItems.findOne({_id:String(body.id||'').slice(0,80)});if(!item)return send(req,res,404,{error:'البطاقة غير موجودة.'});
      const r=await applyCardFix(item,new Date());if(r.republished)library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());
      if(r.fixed)await recordAudit(adminStore,'admin','card_audit_fix_one',String(item._id),{title:item.title});
      return send(req,res,200,{ok:true,...r,issues:auditCard(await adminStore.legalMonitorItems.findOne({_id:item._id}))});
    }
    /* تدقيق البطاقة الموحّدة لكل بطاقات المستجدات: تقرير، وإصلاح آمن لا يكتب محتوى (ترتيب الأقسام، حذف الملاحظات التقنية، تصحيح سطر «الأصل»). */
    if(p==='/api/admin/card-audit'&&req.method==='GET'){
      const items=await adminStore.legalMonitorItems.find({state:{$ne:'dismissed'}}).project({fullText:0,history:0}).toArray();return send(req,res,200,auditReport(items));
    }
    if(p==='/api/admin/card-audit'&&req.method==='POST'){
      const items=await adminStore.legalMonitorItems.find({state:{$ne:'dismissed'}}).project({fullText:0}).toArray(),now=new Date();let fixed=0,republished=0;
      for(const item of items){const r=await applyCardFix(item,now);if(r.fixed){fixed++;republished+=r.republished;}}
      republished+=await syncPublishedTexts(now);
      library.setManagedContent(await adminStore.content.find({status:'published'}).toArray());
      await recordAudit(adminStore,'admin','card_audit_autofix','legalMonitorItems',{fixed,republished});
      return send(req,res,200,{ok:true,fixed,republished});
    }
    /* ربط ملفات «نصوص التحيين» في Drive ببطاقاتها في الراصد: يعرض للمدير حالة كل نص والقسم المقترح لنقله إليه. */
    if(p==='/api/admin/updates-texts/links'&&req.method==='GET'){
      const ids=String(url.searchParams.get('ids')||'').split(',').map(x=>x.trim()).filter(Boolean).slice(0,200);
      if(!ids.length)return send(req,res,200,{links:{}});
      const rows=await adminStore.legalMonitorItems.find({$or:[{'original.driveId':{$in:ids}},{'originals.driveId':{$in:ids}}],state:{$ne:'dismissed'}}).project({title:1,state:1,kind:1,country:1,court:1,publishCategory:1,original:1,originals:1,currentStage:1}).toArray();
      const links={};for(const r of rows){const linked=[r.original,...(r.originals||[])].filter(o=>o?.driveId&&ids.includes(o.driveId));for(const o of linked)links[o.driveId]={id:r._id,title:r.title,state:r.state,category:publicationCategory(r),chosen:!!r.publishCategory,stagesComplete:lawStagesComplete(r)};}
      return send(req,res,200,{links});
    }
    if(p==='/api/admin/content/delete'&&req.method==='POST'){
      let body;try{body=await jsonBody(req);}catch{return send(req,res,400,{error:'صيغة البيانات غير صالحة.'});}const documentId=String(body.documentId||'').slice(0,120),doomed=await adminStore.content.findOne({documentId,status:'draft',contributionId:{$exists:true}}),result=await adminStore.content.deleteMany({documentId,status:'draft'});if(doomed?.contributionId)await adminStore.contributions.updateOne({id:doomed.contributionId,status:'reviewing'},{$set:{status:'pending',statusChangedAt:new Date(),updatedAt:new Date()},$unset:{draftDocumentId:''}});if(!result.deletedCount)return send(req,res,404,{error:'لا توجد مسودة قابلة للحذف؛ لا يمكن حذف سجل منشور من هنا.'});await recordAudit(adminStore,'admin','draft_deleted',documentId);return send(req,res,200,{ok:true});
    }
    if(p==='/api/admin/drive/connect'&&req.method==='GET'){
      const config=googleLoginConfig(),goBack=reason=>{res.writeHead(302,{...headers,'Cache-Control':'no-store',Location:`/admin?drive=${reason}`});res.end();};
      if(!config.available||!adminStore)return goBack('unavailable');
      const flow=beginGoogleLogin(config,'admin',{purpose:'drive'});
      res.writeHead(302,{...headers,'Cache-Control':'no-store','Set-Cookie':flow.cookie,Location:flow.url});return res.end();
    }
    if(p==='/api/admin/drive/disconnect'&&req.method==='POST'){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة حالياً.'});
      const saved=await adminStore.settings.findOne({_id:'library'},{projection:{driveWrite:1}}),link=saved?.driveWrite;
      if(!link)return send(req,res,200,{ok:true,connected:false});
      const revoked=await revokeGoogleToken(openSecret(link.refreshTokenEncrypted));
      await adminStore.settings.updateOne({_id:'library'},{$unset:{driveWrite:''},$set:{updatedAt:new Date()}});forgetDriveUserToken();
      await recordAudit(adminStore,auditActor(req),'drive_write_disconnected',link.email||'',{revoked});
      return send(req,res,200,{ok:true,connected:false,revoked});
    }
    if(p.startsWith('/api/admin/originals')){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة حالياً.'});
      if(p==='/api/admin/originals/drive'&&req.method==='GET'){
        const [status,saved]=await Promise.all([driveOriginalsStatus(),adminStore.settings.findOne({_id:'library'},{projection:{driveWrite:1}})]),link=saved?.driveWrite;
        return send(req,res,200,{...status,connectable:googleLoginConfig().available,connection:link?{email:link.email||'',connectedAt:link.connectedAt||null}:null});
      }
      if(p==='/api/admin/originals/section'&&req.method==='GET'){const q=k=>String(url.searchParams.get(k)||'').slice(0,300),doc={kind:q('kind'),type:q('type'),category:q('category'),title:q('title'),country:q('country')},section=originalsSection(doc),court=section.id==='jurisprudence'&&!!judicialFolderIdFor(q('issuer'));return send(req,res,200,{id:section.id,label:section.label,court});}
      if(p==='/api/admin/originals/transfer'&&req.method==='POST'){
        let body;try{body=await jsonBody(req);}catch(error){return send(req,res,error.status||400,{error:error.message});}
        const doc=await adminStore.content.findOne({documentId:String(body.documentId||'').slice(0,120),status:'published'});if(!doc)return send(req,res,404,{error:'الوثيقة المنشورة غير موجودة.'});
        const originals=await moveOriginalsToDrive(doc,{subfolder:String(body.driveSubfolder||'')});await recordAudit(adminStore,'admin','originals_to_drive',doc.documentId,{moved:originals.moved,failed:originals.failed,folder:originals.folder||'',error:originals.error||''});return send(req,res,200,{ok:!originals.failed,originals});
      }
      return send(req,res,404,{error:'الخدمة غير موجودة.'});
    }
    if(p.startsWith('/api/admin/contributions')){
      if(!adminStore)return send(req,res,503,{error:'قاعدة إدارة المكتبة غير متاحة حالياً؛ تحقق من اتصال MongoDB.'});
      if(p==='/api/admin/contributions'&&req.method==='GET'){
        const type=['addition','note'].includes(url.searchParams.get('type'))?url.searchParams.get('type'):'',status=Object.keys(CONTRIB_STATUSES).includes(url.searchParams.get('status'))?url.searchParams.get('status'):'',query=String(url.searchParams.get('q')||'').trim().slice(0,100),page=Math.max(1,Math.min(1000,Number(url.searchParams.get('page'))||1));
        const filter={...(type?{type}:{}),...(status?{status}:{}),...(query?{$or:['title','documentTitle','userEmail'].map(k=>({[k]:{$regex:query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),$options:'i'}}))}:{})};
        const [rows,total,grouped]=await Promise.all([
          adminStore.contributions.find(filter).sort({updatedAt:-1}).skip((page-1)*30).limit(30).project({text:0,message:0,excerpt:0,note:0}).toArray(),
          adminStore.contributions.countDocuments(filter),
          adminStore.contributions.aggregate([{$group:{_id:{type:'$type',status:'$status'},n:{$sum:1}}}]).toArray()
        ]);
        const counts={additions:{},notes:{}};for(const g of grouped)(g._id.type==='note'?counts.notes:counts.additions)[g._id.status]=g.n;
        return send(req,res,200,{items:rows.map(r=>({id:r.id,type:r.type,kind:r.kind||'',kindLabel:r.kind?CONTRIB_KINDS[r.kind]?.label||'':NOTE_TYPES[r.noteType]||'',title:r.type==='note'?(r.documentTitle||r.documentId):r.title,documentId:r.documentId||'',issuedAt:r.issuedAt||'',userEmail:r.userEmail,userDeleted:!!r.userDeleted,status:r.status,statusLabel:CONTRIB_STATUSES[r.status]||r.status,chars:r.chars||0,draftDocumentId:r.draftDocumentId||'',publishedDocumentId:r.publishedDocumentId||'',createdAt:r.createdAt,updatedAt:r.updatedAt})),total,page,pages:Math.max(1,Math.ceil(total/30)),counts,statuses:CONTRIB_STATUSES});
      }
      if(p==='/api/admin/contributions/file'&&(req.method==='GET'||req.method==='HEAD')){
        const file=await adminStore.contributionFiles.findOne({id:String(url.searchParams.get('id')||'').slice(0,40)});if(!file)return send(req,res,404,{error:'الملف غير موجود (ربما حُذف بعد رفض الإضافة).'});
        return sendOriginalFile(req,res,file,url.searchParams.get('mode'));
      }
      if(p==='/api/admin/contributions/item'&&req.method==='GET'){
        const c=await adminStore.contributions.findOne({id:String(url.searchParams.get('id')||'').slice(0,60)},{projection:{_id:0}});if(!c)return send(req,res,404,{error:'الإضافة غير موجودة.'});
        return send(req,res,200,{...c,kindLabel:c.kind?CONTRIB_KINDS[c.kind]?.label||'':'',noteTypeLabel:NOTE_TYPES[c.noteType]||'',statusLabel:CONTRIB_STATUSES[c.status]||c.status});
      }
      if(p==='/api/admin/contributions/draft'&&req.method==='POST'){
        let body;try{body=await jsonBody(req);}catch(error){return send(req,res,error.status||400,{error:error.message});}
        const c=await adminStore.contributions.findOne({id:String(body.id||'').slice(0,60)});if(!c||c.type!=='addition')return send(req,res,404,{error:'لا توجد إضافة بهذا المعرّف.'});
        if(['published','declined'].includes(c.status))return send(req,res,409,{error:'سبق البتّ في هذه الإضافة.'});
        if(c.draftDocumentId&&await adminStore.content.findOne({documentId:c.draftDocumentId,status:'draft'},{projection:{_id:1}}))return send(req,res,200,{ok:true,documentId:c.draftDocumentId,existing:true});
        const documentId='managed_'+randomBytes(12).toString('hex'),now=new Date();await adminStore.content.insertOne({...draftFromContribution(c,documentId),status:'draft',createdAt:now,updatedAt:now,updatedBy:'admin'});
        await moveContribution(c.id,'reviewing',{draftDocumentId:documentId});await recordAudit(adminStore,'admin','contribution_drafted',c.id,{documentId,title:c.title});
        return send(req,res,201,{ok:true,documentId});
      }
      if(p==='/api/admin/contributions/resolve'&&req.method==='POST'){
        let body;try{body=await jsonBody(req);}catch(error){return send(req,res,error.status||400,{error:error.message});}
        const c=await adminStore.contributions.findOne({id:String(body.id||'').slice(0,60)});if(!c)return send(req,res,404,{error:'الإضافة غير موجودة.'});
        const status=String(body.status||''),reply=contribClean(body.reply,CONTRIB_LIMITS.reply);
        if(!(c.type==='note'?['accepted','declined']:['declined']).includes(status))return send(req,res,400,{error:'حالة غير مسموحة لهذا النوع.'});
        if(['published','declined','accepted'].includes(c.status))return send(req,res,409,{error:'سبق البتّ في هذه الإضافة.'});
        if(status==='declined'&&!reply)return send(req,res,400,{error:'اكتبوا سبب عدم الاعتماد ليصل إلى صاحبها.'});
        const done=await moveContribution(c.id,status,{adminReply:reply,resolvedAt:new Date(),...(status==='declined'&&c.originalFiles?.length?{originalFiles:[],originalsPurged:c.originalFiles.length}:{})});
        if(status==='declined')await adminStore.contributionFiles.deleteMany({contributionId:c.id});
        if(c.draftDocumentId)await adminStore.content.deleteMany({documentId:c.draftDocumentId,status:'draft'});
        await recordAudit(adminStore,'admin','contribution_'+status,c.id,{type:c.type});void mailContributor(done,status);
        return send(req,res,200,{ok:true,status});
      }
      return send(req,res,404,{error:'الخدمة غير موجودة.'});
    }
    if(p==='/api/admin/search'&&req.method==='GET'){
      const q=(url.searchParams.get('q')||'').trim().slice(0,160);if(q.length<2)return send(req,res,200,{results:[]});
      const result=library.search({q,scope:'all',limit:20});return send(req,res,200,{results:result.results.map(d=>({id:d.id,title:d.title,category:d.category,textKind:d.textKind,reviewStatus:d.reviewStatus,chars:d.chars,sourceLabel:d.sourceLabel}))});
    }
    if(p==='/api/admin/document'&&req.method==='GET'){
      const id=(url.searchParams.get('id')||'').slice(0,120),draft=adminStore?await adminStore.content.findOne({documentId:id,status:'draft'},{sort:{updatedAt:-1}}):null;const doc=draft?{id:draft.documentId,title:draft.title,text:draft.text,category:draft.category,type:draft.type,textKind:draft.textKind,reviewStatus:'draft',sourceUrl:draft.sourceUrl,sourceLabel:draft.sourceLabel,sourceLanguage:draft.sourceLanguage||'ar',originalTitle:draft.originalTitle||'',professionalArabicReviewed:!!draft.professionalArabicReviewed,country:draft.country||'ma',issuer:draft.issuer||'',pendingCassation:!!draft.pendingCassation,reason:draft.reason,date:draft.date,kind:draft.kind,origin:draft.origin||'',originalFiles:draft.originalFiles||[]}:library.document(id);if(!doc)return send(req,res,404,{error:'الوثيقة غير موجودة.'});
      return send(req,res,200,{id:doc.id,title:doc.title,category:doc.category,subcategory:doc.subcategory,type:doc.type,kind:doc.kind,date:doc.date,textKind:doc.textKind,reviewStatus:doc.reviewStatus,issues:doc.issues,chars:doc.chars,text:doc.text,sourceUrl:doc.sourceUrl,sourceLabel:doc.sourceLabel,sourceLanguage:doc.sourceLanguage||'ar',originalTitle:doc.originalTitle||'',professionalArabicReviewed:!!doc.professionalArabicReviewed,country:doc.country||'ma',pendingCassation:!!doc.pendingCassation,reason:draft?.reason||'',origin:draft?.origin||'',issuer:doc.issuer||draft?.issuer||'',contributionId:draft?.contributionId||'',originalFiles:draft?.originalFiles||doc.originalFiles||[]});
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
    if(p==='/api/legal-monitor/recent'&&req.method==='GET'){
      if(!adminStore)return send(req,res,200,{updates:[]});
      const rows=await adminStore.legalMonitorItems.find({state:'published',publishedAt:{$gte:new Date(Date.now()-7*86400000)}}).sort({publishedAt:-1}).limit(30).toArray();
      return send(req,res,200,{updates:recentUpdates(rows.map(r=>({...r,id:r._id})))});
    }
    if(p==='/api/legal-monitor/ticker'&&req.method==='GET'){
      if(!adminStore)return send(req,res,200,{items:[]});
      const windowStart=tickerWindowStart(new Date());
      const rows=await adminStore.legalMonitorItems.find({state:'published',publishedAt:{$gte:windowStart}}).sort({publishedAt:-1}).limit(120).toArray();
      const items=tickerItems(rows.map(r=>({...r,id:r._id})),new Date(),0,windowStart.getTime());
      /* لكل المستخدمين: ما رصده الجامع ولم يُعتمد بعد يظهر في الشريط موسوماً «بانتظار الاعتماد»، بروابطه الرسمية فقط؛ والتشخيص للمدير وحده. */
      const pend=await adminStore.legalMonitorItems.find({kind:{$in:['bill','legislation','justice_digital']},state:{$in:['held','ready']},receivedAt:{$gte:windowStart}}).sort({receivedAt:-1}).limit(80).toArray();
      let noUrl=0;
      for(const r of pend){const url=r.source?.url||'';if(/^https?:\/\//i.test(url))items.push({id:String(r._id),title:r.title,country:r.country,kind:r.kind,url,eventDate:r.eventDate,pending:true});else noUrl++;}
      let diag;
      if(await adminSessionLive(req))diag={admin:true,published:items.filter(i=>!i.pending).length,pending:items.filter(i=>i.pending).length,pendingWithoutUrl:noUrl};
      return send(req,res,200,{items,...(diag?{diag}:{})});
    }
    if(p==='/api/legal-monitor/alerts'&&req.method==='GET'){
      if(!adminStore)return send(req,res,200,{alerts:[]});
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Casablanca'}).format(new Date());
      const rows=await adminStore.legalMonitorItems.find({state:'published',effectiveDate:today}).limit(10).toArray();
      return send(req,res,200,{today,alerts:effectiveToday(rows.map(r=>({...r,id:r._id})),today)});
    }
    if(p==='/api/categories')return send(req,res,200,{categories:withShelfCounts(library.categories())});
    if(p==='/api/search')return send(req,res,200,library.search(Object.fromEntries(url.searchParams)));
    if(p==='/api/suggest')return send(req,res,200,library.suggest(url.searchParams.get('q')));
    if(p==='/api/document'){
      const d=library.document((url.searchParams.get('id')||'').slice(0,120));return send(req,res,d?200:404,d||{error:'الوثيقة غير موجودة في هذه النسخة.'});
    }
    if(p==='/api/capabilities'){
      const [ai,speech,policy]=await Promise.all([aiCapability(),speechCapabilities(),assistantPolicy()]);return send(req,res,200,{pdfFree:true,ai:{...ai,available:policy.aiEnabled&&ai.available,mode:policy.aiEnabled?ai.mode:'extractive',model:policy.groqModel,enabled:policy.aiEnabled},translation:{available:policy.translationEnabled&&(policy.translationEngine==='local'||!!deeplApiKey()),enabled:policy.translationEnabled,engine:policy.translationEngine,target:'français',provider:policy.translationEngine==='local'?'محلي':'DeepL'},webSearch:{available:policy.webSearchEnabled,enabled:policy.webSearchEnabled},speech});
    }
    if(p==='/api/translate'){
      if(req.method!=='POST')return send(req,res,405,{error:'أرسل النص عبر POST.'});
      const policy=await assistantPolicy();if(!policy.translationEnabled||policy.translationEngine!=='deepl')return send(req,res,403,{error:'الترجمة عبر DeepL غير متاحة وفق إعدادات المكتبة.'});
      if(!deeplApiKey())return send(req,res,503,{error:'الترجمة غير مهيأة؛ أضف DEEPL_AUTH_KEY إلى متغيرات Render.'});
      let body;try{body=await jsonBody(req,16000);}catch(error){return send(req,res,error.status||400,{error:error.message});}
      const text=String(body?.text||'').trim();if(!text||text.length>6500)return send(req,res,400,{error:'أدخل نصاً بين حرف واحد و6500 حرف.'});
      try{return send(req,res,200,{translation:await translateWithDeepL(text,'FR')});}catch(error){return send(req,res,502,{error:error.message||'تعذرت الترجمة حالياً.'});}
    }
    if(p==='/api/ask'){
      if(req.method!=='POST')return send(req,res,405,{error:'أرسل السؤال عبر POST.'});
      const body=await jsonBody(req),policy=await assistantPolicy();
      if(body.analysisMode==='web'&&policy.webSearchEnabled)return send(req,res,200,await answerFromWeb(body.question));
      body.analysisMode=policy.aiEnabled&&body.analysisMode==='groq'?'groq':'sources';body.groqModel=policy.groqModel;body.processingLevel=policy.processingLevel;
      const initial=await answerQuestion(library,{...body,retrieveOnly:true});
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
    if(process.env.QALAM_DESKTOP_MODE==='1'&&['/login','/login.html','/home.html','/account','/account.html','/forgot-password','/forgot-password.html','/reset-password','/reset-password.html'].includes(p)){res.writeHead(302,{...headers,'Cache-Control':'no-store',Location:'/'});return res.end();}
    const relative=decodeURIComponent(p==='/admin'?'/admin.html':p==='/account'?'/account.html':p==='/archive'?'/archive.html':p==='/login'?'/login.html':p==='/activate'?'/activate.html':p==='/confirm-registration'?'/confirm-registration.html':p==='/forgot-password'?'/forgot-password.html':p==='/reset-password'?'/reset-password.html':p==='/change-password'?'/change-password.html':p==='/'?(process.env.QALAM_DESKTOP_MODE==='1'||validSession(req)?'/index.html':'/home.html'):p).replace(/^\/+/,''),target=path.resolve(PUBLIC,relative);
    if(!target.startsWith(PUBLIC+path.sep)||relative.includes('\0'))return send(req,res,403,'Forbidden','text/plain');
    const type=MIME[path.extname(target).toLowerCase()];if(!type||!fs.existsSync(target)||!fs.statSync(target).isFile())return send(req,res,404,'Not found','text/plain');
    let bytes=fs.readFileSync(target);if(process.env.QALAM_DESKTOP_MODE==='1'&&relative==='index.html')bytes=Buffer.from(bytes.toString('utf8').replace('<html lang="ar" dir="rtl">','<html lang="ar" dir="rtl" data-qalam-desktop="true">'));const etag='"'+createHash('sha1').update(bytes).digest('hex')+'"';
    if(req.headers['if-none-match']===etag){res.writeHead(304,{...headers,ETag:etag});return res.end();}
    res.setHeader('ETag',etag);return send(req,res,200,bytes,type);
  }catch(e){if(res.headersSent){res.destroy();return;}send(req,res,e.status||503,{error:e.status?e.message:'تعذر إتمام العملية حالياً. حاول مجدداً أو استخدم الخدمة المحلية البديلة.'});}
});
server.requestTimeout=70000;server.headersTimeout=15000;
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'المنفذ مستخدم. أغلق نسخة قلم السابقة أو غيّر PORT.':error.message);process.exit(1);});
server.listen(PORT,HOST,()=>{console.log(`Qalam Smart ${library.meta.version}: http://localhost:${PORT} — ${library.meta.documents} records; PDF-independent; PID ${process.pid}`);if(process.env.NODE_ENV!=='test')setTimeout(()=>{warmAgreementIndex();refreshShelfCounts();},3000).unref?.();});
function stop(){server.close(()=>{library.close();process.exit(0);});setTimeout(()=>process.exit(0),1500).unref();}
process.on('SIGINT',stop);process.on('SIGTERM',stop);

export { server, library };

