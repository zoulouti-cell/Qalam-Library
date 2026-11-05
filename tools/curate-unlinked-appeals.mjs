import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { brotliDecompressSync } from 'node:zlib';

const reportPath='C:/Users/z/Documents/deepseek-harness/default-workspace/adala/reports/appeal-drive-cassation-prechange.json';
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const rows=report.unlinked;
const root=path.resolve(import.meta.dirname,'..');
const db=new DatabaseSync(path.join(root,'data/library.sqlite'),{readOnly:true});
const clean=value=>String(value||'').replace(/[……]+$/u,'').replace(/\s+/gu,' ').replace(/[،؛:,\.\s]+$/u,'').trim();
const bodyFor=id=>{
  const row=db.prepare('SELECT body,text_kind FROM documents WHERE id=?').get(id);
  if(!row||row.text_kind!=='source_summary')return '';
  const lines=brotliDecompressSync(row.body).toString('utf8').split(/\r?\n/u).map(line=>line.trim());
  while(lines.length&&(!lines[0]||/^(?:قرار\s+رقم|ملف\s+رقم)(?:\s|$)/u.test(lines[0])))lines.shift();
  return lines.join('\n').trim();
};
const subject=row=>{
  const lines=bodyFor(row.id).split(/\r?\n/u).map(clean).filter(Boolean);
  let heading=lines[0];
  if(/^(?:طبقا|بمقتضى|عملا|استنادا)(?:\s|$)/u.test(heading||'')&&lines[1])heading=lines[1];
  let text=heading&&heading.length<=120?heading:clean(lines.join(' ')||row.title);
  if(/^(?:طبقا|بمقتضى)\s+(?:للفصل|للمادة)\s*26\s+من\s+قانون\s+المسطرة\s+المدنية/u.test(text))text='صلاحية المحكمة في إصلاح الأخطاء المادية في القرارات';
  else if(/^(?:طبقا|بمقتضى|عملا)\s/u.test(text)){const comma=text.search(/[،]/u);if(comma>=18&&comma<100)text=clean(text.slice(comma+1));}
  if(/^(?:قرار رقم|ملف رقم|المملكة المغربية|دون عنوان|طباعة المستشارة)/u.test(text))text=clean(lines.slice(1).join(' ')||row.title);
  if(/^(?:\d{4}\/|ملف\s+رقم\s*[:：]?\s*\d|المملكة المغربية|دون عنوان|قرار رقم|طباعة المستشارة|\d+\.pdf)/u.test(text))return 'قرار استئنافي — موضوع غير مستخلص من النص';
  text=text.replace(/^(?:حيث|وحيث|بما أن|لما كان|لما كانت|إن المحكمة|المحكمة لما|مما لا شك فيه|المقرر أن|من المقرر أن)\s+/u,'');
  const semicolon=text.search(/[؛؟!]/u),comma=text.search(/[،]/u);
  const stop=semicolon>=36?semicolon:(comma>=36&&comma<=120?comma:-1);
  if(stop>0)text=text.slice(0,stop);
  if(text.length>120){const boundary=text.lastIndexOf(' ',120);text=text.slice(0,boundary>70?boundary:120).replace(/[،؛:—-]+$/u,'');}
  return clean(text)||'قرار استئنافي — موضوع غير مستخلص من النص';
};
const normalize=value=>String(value||'').normalize('NFKC').replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/[ىی]/g,'ي').replace(/[\s\p{P}\p{S}]+/gu,'').toLowerCase();
const counts=new Map();
for(const row of rows)row.curatedTitle=subject(row);
for(const row of rows)counts.set(normalize(row.curatedTitle),(counts.get(normalize(row.curatedTitle))||0)+1);
for(const row of rows)if(counts.get(normalize(row.curatedTitle))>1){const id=row.id.replace(/^jc:/u,'');row.curatedTitle+=row.decision?` — قرار ${row.decision}`:` — ${id}`;}
const mapping=Object.fromEntries(rows.map(row=>[row.id,{category:'قواعد قضائية',title:row.curatedTitle}]));
fs.writeFileSync(path.join(root,'data/judicial-curation.json'),JSON.stringify({version:1,source:'Drive court-folder audit and stored decision summaries',entries:mapping},null,2));
db.close();
console.log(JSON.stringify({curated:rows.length,duplicateSubjects:[...counts.values()].filter(n=>n>1).length,uniqueFinalTitles:new Set(rows.map(x=>normalize(x.curatedTitle))).size,examples:rows.slice(0,8).map(x=>({id:x.id,from:x.title,to:x.curatedTitle}))},null,2));
