import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';
import { createHash } from 'node:crypto';
import { normalizeSearch, headingsOf, kindOf } from './text.mjs';
import { reflowReading } from './reading.mjs';

const digest=text=>createHash('sha256').update(text).digest('hex');
function connect(file){const db=new DatabaseSync(file);db.exec('PRAGMA busy_timeout=8000');db.exec(`CREATE TABLE IF NOT EXISTS editorial_history(id INTEGER PRIMARY KEY AUTOINCREMENT,doc_id TEXT NOT NULL,created_at TEXT NOT NULL,reason TEXT NOT NULL,source_url TEXT NOT NULL,old_title TEXT NOT NULL,old_title_norm TEXT NOT NULL,old_body BLOB NOT NULL,old_sha TEXT NOT NULL,old_kind TEXT NOT NULL,old_text_kind TEXT NOT NULL,old_review_status TEXT NOT NULL,old_issues TEXT NOT NULL,old_source_label TEXT NOT NULL,old_assessment TEXT,new_sha TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'applied')`);return db;}
function updateGeneration(db){const row=db.prepare("SELECT value FROM metadata WHERE key='generation'").get();const value=JSON.parse(row?.value||'0')+1;db.prepare("INSERT OR REPLACE INTO metadata VALUES('generation',?)").run(JSON.stringify(value));}
function updateHeadings(db,rowid,text){db.prepare('DELETE FROM headings WHERE doc_rowid=?').run(rowid);const insert=db.prepare('INSERT INTO headings(doc_rowid,marker,label,number,start,end) VALUES(?,?,?,?,?,?)');for(const h of headingsOf(text))insert.run(rowid,h.marker,h.label,h.number,h.start,h.end);}
function updateStats(db,oldStatus,newStatus){const delta=(newStatus==='needs_review'?1:0)-(oldStatus==='needs_review'?1:0);if(delta){const n=JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='needsReview'").get()?.value||'0');db.prepare("INSERT OR REPLACE INTO metadata VALUES('needsReview',?)").run(JSON.stringify(Math.max(0,n+delta)));}db.prepare("INSERT OR REPLACE INTO metadata VALUES('headings',?)").run(JSON.stringify(db.prepare('SELECT count(*) n FROM headings').get().n));}
function setFts(db,rowid,titleNorm,oldText,newTitleNorm,newText){db.prepare("INSERT INTO search(search,rowid,title,body) VALUES('delete',?,?,?)").run(rowid,titleNorm,normalizeSearch(oldText));db.prepare('INSERT INTO search(rowid,title,body) VALUES(?,?,?)').run(rowid,newTitleNorm,normalizeSearch(newText));}

export function applyLocalCorrection(file,input){
  const id=String(input.id||'').slice(0,120),baseSha=String(input.baseSha||''),title=String(input.title||'').trim().replace(/\s+/g,' '),raw=String(input.text||'').trim(),reason=String(input.reason||'').trim(),sourceUrl=String(input.sourceUrl||'').trim();
  if(!id||!/^([a-f0-9]{64})$/i.test(baseSha))throw new Error('تعذر التحقق من نسخة الوثيقة؛ أعد فتحها قبل الحفظ.');
  if(title.length<3||title.length>500||raw.length<40||raw.length>500000)throw new Error('تحقق من العنوان والنص؛ النص المقبول بين 40 و500000 حرف.');
  if(reason.length<8||reason.length>1000)throw new Error('اكتب سبب التصحيح أو مرجعه، من 8 إلى 1000 حرف.');
  if(sourceUrl&&(!/^https:\/\//i.test(sourceUrl)||sourceUrl.length>1000))throw new Error('أدخل رابط مصدر يبدأ بـ https:// أو اترك الحقل فارغاً.');
  const revised=reflowReading(raw).text;if(revised.length<40)throw new Error('النص بعد تنسيقه أقصر من الحد المقبول.');
  const newSha=digest(revised),titleNorm=normalizeSearch(title),db=connect(file);
  try{
    db.exec('BEGIN IMMEDIATE');const row=db.prepare('SELECT * FROM documents WHERE id=?').get(id);if(!row)throw new Error('الوثيقة غير موجودة.');
    const oldText=brotliDecompressSync(Buffer.from(row.body)).toString('utf8');if(row.sha256!==baseSha)throw new Error('تغيرت نسخة الوثيقة أثناء التحرير؛ أعد تحميلها لمقارنة آخر نسخة.');
    if(row.text_kind==='image_only')throw new Error('هذه الوثيقة بطاقة فهرسة بلا نص قابل للتصحيح.');
    const auditRow=db.prepare('SELECT assessment FROM reading_audit WHERE id=?').get(id),oldAssessment=auditRow?.assessment||'';
    const now=new Date().toISOString(),issues=[...new Set([...JSON.parse(row.issues||'[]'),'local_editorial_correction_needs_review'])];
    const history=db.prepare('INSERT INTO editorial_history(doc_id,created_at,reason,source_url,old_title,old_title_norm,old_body,old_sha,old_kind,old_text_kind,old_review_status,old_issues,old_source_label,old_assessment,new_sha,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,now,reason,sourceUrl,row.title,row.title_norm,row.body,row.sha256,row.kind,row.text_kind,row.review_status,JSON.stringify(JSON.parse(row.issues||'[]')),row.source_label||'',oldAssessment,newSha,'applied');
    setFts(db,row.rowid,row.title_norm,oldText,titleNorm,revised);
    const compressed=brotliCompressSync(Buffer.from(revised),{params:{[constants.BROTLI_PARAM_QUALITY]:5}});
    const revisedKind=kindOf({...row,title});
    db.prepare("UPDATE documents SET title=?,title_norm=?,kind=?,body=?,chars=?,sha256=?,review_status='needs_review',issues=?,source_label=? WHERE id=?").run(title,titleNorm,revisedKind,compressed,revised.length,newSha,JSON.stringify(issues),'تصحيح محلي — يحتاج مراجعة',id);
    const assessment={...(oldAssessment?JSON.parse(oldAssessment):{}),textSha256:newSha,requiresEditorialReview:true,humanVerified:false,localCorrection:{at:now,reason,sourceUrl,historyId:Number(history.lastInsertRowid)}};
    db.prepare('INSERT OR REPLACE INTO reading_audit(id,previous_kind,previous_body,assessment) VALUES(?,?,?,?)').run(id,row.kind,row.body,JSON.stringify(assessment));
    updateHeadings(db,row.rowid,revised);updateStats(db,row.review_status,'needs_review');updateGeneration(db);db.exec('COMMIT');
    return {id,historyId:Number(history.lastInsertRowid),title,sha256:newSha,chars:revised.length,reviewStatus:'needs_review',sourceLabel:'تصحيح محلي — يحتاج مراجعة'};
  }catch(error){try{db.exec('ROLLBACK')}catch{}throw error;}finally{db.close();}
}

export function localCorrectionHistory(file,id){const db=connect(file);try{return db.prepare('SELECT id,doc_id,created_at,reason,source_url,old_title,old_sha,new_sha,status FROM editorial_history WHERE doc_id=? ORDER BY id DESC LIMIT 12').all(String(id||'').slice(0,120));}finally{db.close();}}

export function localOcrCandidate(file,id){
  const db=new DatabaseSync(file,{readOnly:true});
  try{
    const job=db.prepare('SELECT pages,status FROM jobs WHERE id=?').get(String(id||'').slice(0,120));
    if(!job)return {status:'not_queued',pages:0,totalPages:0,complete:false,text:''};
    const rows=db.prepare('SELECT n,text,assessment FROM pages WHERE id=? ORDER BY n').all(String(id||'').slice(0,120));
    const reports=rows.map(r=>JSON.parse(r.assessment||'{}')),words=reports.reduce((n,r)=>n+(r.words||0),0),weighted=reports.reduce((n,r)=>n+(r.words||0)*(r.weightedConfidence||0),0);
    const table=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='ocr_alternates'").get();let alternateRows=[];
    if(table)alternateRows=db.prepare("SELECT n,text,assessment FROM ocr_alternates WHERE id=? AND engine='paddle_ppocrv5_ar' ORDER BY n").all(String(id||'').slice(0,120));
    const alternateReports=alternateRows.map(r=>JSON.parse(r.assessment||'{}'));
    return {status:job.status,pages:rows.length,totalPages:job.pages,complete:job.status==='complete'&&rows.length===job.pages,meanEngineConfidence:Math.round(weighted/Math.max(1,words)*100)/100,lowWords:reports.reduce((n,r)=>n+(r.lowWords||0),0),reviewRegions:reports.reduce((n,r)=>n+(r.reviewRegions?.length||0),0),text:rows.map(r=>String(r.text||'').trim()).filter(Boolean).join('\n\n'),alternateEngine:'paddle_ppocrv5_ar',alternatePages:alternateRows.length,alternateComplete:job.status==='complete'&&alternateRows.length===job.pages,alternateAgreementPercent:alternateReports.length?Math.round(alternateReports.reduce((n,r)=>n+(r.agreementPercent||0),0)/alternateReports.length*100)/100:null,criticalDifferences:alternateReports.reduce((n,r)=>n+(r.criticalTokenDifferences?.length||0),0),alternateText:alternateRows.map(r=>String(r.text||'').trim()).filter(Boolean).join('\n\n')};
  }finally{db.close();}
}

export function revertLocalCorrection(file,historyId){
  const n=Number(historyId);if(!Number.isSafeInteger(n)||n<1)throw new Error('رقم التعديل غير صالح.');const db=connect(file);
  try{db.exec('BEGIN IMMEDIATE');const h=db.prepare("SELECT * FROM editorial_history WHERE id=? AND status='applied'").get(n);if(!h)throw new Error('هذا التعديل غير متاح للاسترجاع.');const row=db.prepare('SELECT * FROM documents WHERE id=?').get(h.doc_id);if(!row||row.sha256!==h.new_sha)throw new Error('توجد تعديلات أحدث؛ استرجع آخر تعديل أولاً.');const current=brotliDecompressSync(Buffer.from(row.body)).toString('utf8'),old=brotliDecompressSync(Buffer.from(h.old_body)).toString('utf8');
    setFts(db,row.rowid,row.title_norm,current,h.old_title_norm,old);db.prepare('UPDATE documents SET title=?,title_norm=?,body=?,chars=?,sha256=?,kind=?,text_kind=?,review_status=?,issues=?,source_label=? WHERE id=?').run(h.old_title,h.old_title_norm,h.old_body,old.length,h.old_sha,h.old_kind,h.old_text_kind,h.old_review_status,h.old_issues,h.old_source_label,h.doc_id);
    if(h.old_assessment)db.prepare('INSERT OR REPLACE INTO reading_audit(id,previous_kind,previous_body,assessment) VALUES(?,?,?,?)').run(h.doc_id,h.old_kind,h.old_body,h.old_assessment);else db.prepare('DELETE FROM reading_audit WHERE id=?').run(h.doc_id);
    updateHeadings(db,row.rowid,old);updateStats(db,row.review_status,h.old_review_status);db.prepare("UPDATE editorial_history SET status='reverted' WHERE id=?").run(n);updateGeneration(db);db.exec('COMMIT');return {id:h.doc_id,title:h.old_title,sha256:h.old_sha,reviewStatus:h.old_review_status};
  }catch(error){try{db.exec('ROLLBACK')}catch{}throw error;}finally{db.close();}
}
