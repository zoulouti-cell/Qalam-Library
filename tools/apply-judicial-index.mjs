import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync,brotliDecompressSync } from 'node:zlib';
import { normalizeSearch } from '../src/text.mjs';
import { installCatalogOrder } from '../src/catalog.mjs';

const file=process.argv[2]||'data/library.sqlite';
const indexBytes=fs.readFileSync(new URL('../data/judicial-index.json.br',import.meta.url));
const curationBytes=fs.readFileSync(new URL('../data/judicial-curation.json',import.meta.url));
const curation=JSON.parse(curationBytes).entries||{};
const referenceBytes=fs.readFileSync(new URL('../data/appeal-reference-overrides.json',import.meta.url));
const referenceOverrides=JSON.parse(referenceBytes).entries||{};
const nationalCurationBytes=fs.readFileSync(new URL('../data/national-curation.json',import.meta.url));
const nationalCuration=JSON.parse(nationalCurationBytes);
const fingerprint=createHash('sha256').update(indexBytes).update(curationBytes).update(referenceBytes).update(nationalCurationBytes).digest('hex');
const rows=JSON.parse(brotliDecompressSync(indexBytes)).rows;
const indexedIds=new Set(rows.map(row=>'jc:'+row[0]));
const db=new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=10000;PRAGMA journal_mode=DELETE;');
if(JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='judicialIndexSha256'").get()?.value||'null')===fingerprint){console.log('Judicial index already applied.');db.close();process.exit(0);}
const existing=db.prepare("SELECT rowid,id,category,title,body,text_kind FROM documents WHERE id LIKE 'jc:%'").all();
const byId=new Map(existing.map(row=>[row.id,row]));
const remove=db.prepare('DELETE FROM documents WHERE rowid=?');
const removeOrder=db.prepare('DELETE FROM catalog_order WHERE doc_rowid=?');
const removeAudit=db.prepare('DELETE FROM reading_audit WHERE id=?');
const deleteFts=db.prepare("INSERT INTO search(search,rowid,title,body) VALUES('delete',?,?,?)");
const update=db.prepare('UPDATE documents SET category=?,decision_number=CASE WHEN ?<>\'\' THEN ? ELSE COALESCE(NULLIF(decision_number,\'\'),?) END,case_number=CASE WHEN ?<>\'\' THEN ? ELSE COALESCE(NULLIF(case_number,\'\'),?) END,date=COALESCE(NULLIF(date,\'\'),?) WHERE rowid=?');
const updateTitleCategory=db.prepare('UPDATE documents SET category=?,title=?,title_norm=? WHERE rowid=?');
const insert=db.prepare('INSERT INTO documents(id,type,title,title_norm,category,subcategory,date,kind,law_number,decision_number,case_number,text_kind,review_status,issues,chars,body,sha256,abrogated,source_label) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
const insertFts=db.prepare('INSERT INTO search(rowid,title,body) VALUES(?,?,?)');
const meta=db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)');
let removed=0,updated=0,added=0;
let removedNational=0,reclassifiedNational=0;
db.exec('BEGIN');
try{
  for(const row of existing){
    if(!/^المحكمة (?:الإدارية|التجارية|الابتدائية)/u.test(row.category||''))continue;
    deleteFts.run(row.rowid,row.title,brotliDecompressSync(row.body).toString('utf8'));
    removeOrder.run(row.rowid);removeAudit.run(row.id);remove.run(row.rowid);byId.delete(row.id);removed++;
  }
  for(const row of db.prepare("SELECT rowid,id,title,category,body FROM documents WHERE id LIKE 'jc:%'").all()){
    const curated=curation[row.id];if(indexedIds.has(row.id)||!curated||row.title===curated.title&&row.category===curated.category)continue;
    deleteFts.run(row.rowid,row.title,brotliDecompressSync(row.body).toString('utf8'));
    updateTitleCategory.run(curated.category,curated.title,normalizeSearch(curated.title),row.rowid);
    insertFts.run(row.rowid,normalizeSearch(curated.title),normalizeSearch(brotliDecompressSync(row.body).toString('utf8')));
    updated++;
  }
  for(const [number,court,title,date,indexDecisionNumber,indexCaseNumber,,summary] of rows){
    const decisionNumber=String(referenceOverrides[`jc:${number}`]?.decisionNumber||indexDecisionNumber||''),caseNumber=String(referenceOverrides[`jc:${number}`]?.caseNumber||indexCaseNumber||'');
    const id='jc:'+number,old=byId.get(id),curated=curation[id],category=curated?.category||court,displayTitle=curated?.title||title||`قرار رقم ${decisionNumber||number}`;
    if(old){if(old.category!==category||old.title!==displayTitle){const bodyText=brotliDecompressSync(old.body).toString('utf8');deleteFts.run(old.rowid,old.title,bodyText);updateTitleCategory.run(category,displayTitle,normalizeSearch(displayTitle),old.rowid);insertFts.run(old.rowid,normalizeSearch(displayTitle),normalizeSearch(bodyText));updated++;}const ref=referenceOverrides[id]||{};update.run(category,ref.decisionNumber||'',decisionNumber,decisionNumber,ref.caseNumber||'',caseNumber,caseNumber,date,old.rowid);continue;}
    const body=summary||'',kind=body?'source_summary':'image_only';
    const result=insert.run(id,'juriscassation',displayTitle,normalizeSearch(displayTitle),category,'',date,'decision','',decisionNumber,caseNumber,kind,'automated_review',JSON.stringify(body?['قاعدة فهرسة غير مطابقة بعد للأصل الكامل']:['بطاقة دون متن القرار']),body.length,brotliCompressSync(Buffer.from(body)),createHash('sha256').update(body).digest('hex'),0,'فهرس الاجتهادات القضائية');
    insertFts.run(Number(result.lastInsertRowid),normalizeSearch(displayTitle),normalizeSearch(body));added++;
  }
  for(const [id,ref] of Object.entries(referenceOverrides)){
    if(indexedIds.has(id))continue;
    const old=byId.get(id);if(!old)continue;
    update.run(old.category,ref.decisionNumber||'',ref.decisionNumber||'',old.decision_number,ref.caseNumber||'',ref.caseNumber||'',old.case_number,'',old.rowid);
  }
  for(const item of nationalCuration.remove||[]){
    const old=db.prepare('SELECT rowid,id,title,body FROM documents WHERE id=?').get(item.id);if(!old)continue;
    deleteFts.run(old.rowid,old.title,brotliDecompressSync(old.body).toString('utf8'));
    removeOrder.run(old.rowid);removeAudit.run(old.id);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='headings'").get())db.prepare('DELETE FROM headings WHERE doc_rowid=?').run(old.rowid);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='original_sequence'").get())db.prepare('DELETE FROM original_sequence WHERE doc_id=?').run(old.id);
    if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='editorial_history'").get())db.prepare('DELETE FROM editorial_history WHERE doc_id=?').run(old.id);
    remove.run(old.rowid);removedNational++;
  }
  const reclassify=db.prepare('UPDATE documents SET category=? WHERE id=?');
  for(const [id,category] of Object.entries(nationalCuration.categories||{}))reclassifiedNational+=Number(reclassify.run(category,id).changes||0);
  installCatalogOrder(db);
  const stats=db.prepare("SELECT count(*) documents,sum(text_kind='extracted_text') texts,sum(text_kind='source_summary') summaries,sum(text_kind='image_only') catalogOnly,sum(review_status<>'human_verified') needsReview FROM documents").get();
  for(const [key,value] of Object.entries(stats))meta.run(key,JSON.stringify(value));
  meta.run('judicialIndexSha256',JSON.stringify(fingerprint));
  meta.run('generation',JSON.stringify(Date.now()));
  const driveMapPath=new URL('../data/judicial-drive-map.json.br',import.meta.url);
  const driveMap=JSON.parse(brotliDecompressSync(fs.readFileSync(driveMapPath)));
  driveMap.ids={...(driveMap.ids||{}),...Object.fromEntries(Object.entries(referenceOverrides).filter(([,value])=>value.driveId).map(([id,value])=>[id,value.driveId]))};
  fs.writeFileSync(driveMapPath,brotliCompressSync(Buffer.from(JSON.stringify(driveMap))));
  db.exec('COMMIT');
  console.log(JSON.stringify({removedFirstInstance:removed,reclassified:updated,removedNational,reclassifiedNational,added,documents:stats.documents}));
}catch(error){db.exec('ROLLBACK');throw error;}finally{db.close();}
