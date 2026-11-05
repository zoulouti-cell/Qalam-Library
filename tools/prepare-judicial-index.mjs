import fs from 'node:fs';
import path from 'node:path';
import { brotliCompressSync,constants } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

const root=process.cwd();
const input=process.argv[2];
if(!input)throw new Error('Provide the jc-index.json path.');
const entries=JSON.parse(fs.readFileSync(input,'utf8'));
const db=new DatabaseSync(path.join(root,'data/library.sqlite'),{readOnly:true});
const present=new Set(db.prepare("SELECT id FROM documents WHERE id LIKE 'jc:%'").all().map(row=>row.id));
const acceptedCourts=new Set(['محكمة النقض','المجلس الأعلى','محكمة الاستئناف التجارية بالدار البيضاء','محكمة الاستئناف التجارية بمراكش','محكمة الاستئناف التجارية بفاس','محكمة الاستئناف بتازة']);
const compact=[],missing=[],counts=new Map(),ids=new Set();
for(const row of entries){
  const id=String(row.qalam_id||''),court=String(row['المحكمة']||'');
  if(!/^jc:\d+$/.test(id)||!acceptedCourts.has(court)||ids.has(id))continue;
  ids.add(id);
  const number=id.slice(3),filename=String(row.file_name||'').trim(),relative=String(row.relative_path||'').trim();
  const localFile=!!(relative&&fs.existsSync(path.resolve(path.dirname(input),'..',relative)));
  const courtStat=counts.get(court)||{index:0,local:0,missing:0,new:0};courtStat.index++;
  if(localFile)courtStat.local++;else{courtStat.missing++;missing.push({id,court,title:row['العنوان']||'',expected:relative||'(لم يُذكر مسار محلي)',decisionNumber:row['رقم_القرار']||'',decisionDate:row['تاريخ_القرار']||''});}
  if(!present.has(id))courtStat.new++;counts.set(court,courtStat);
  compact.push([number,court,String(row['العنوان']||'').slice(0,400),String(row['تاريخ_القرار']||row['تاريخ_النشر']||''),String(row['رقم_القرار']||''),String(row['رقم_الملف']||''),filename||`${number}.pdf`,present.has(id)?'':String(row['القاعدة']||'').slice(0,12000),String(row['المصدر']||'')]);
}
const output=path.join(root,'data/judicial-index.json.br');fs.writeFileSync(output,brotliCompressSync(Buffer.from(JSON.stringify({version:1,source:'jc-index.json',rows:compact})),{params:{[constants.BROTLI_PARAM_QUALITY]:9}}));
const reportDir=path.resolve(root,'../adala/reports');fs.mkdirSync(reportDir,{recursive:true});
const header='id,court,title,expected_local_path,decision_number,decision_date\n';
const csv=value=>'"'+String(value??'').replaceAll('"','""').replaceAll(/\r?\n/g,' ')+'"';
fs.writeFileSync(path.join(reportDir,'judicial-missing-local-files.csv'),'\uFEFF'+header+missing.map(row=>[row.id,row.court,row.title,row.expected,row.decisionNumber,row.decisionDate].map(csv).join(',')).join('\n'));
fs.writeFileSync(path.join(reportDir,'judicial-index-summary.json'),JSON.stringify({indexed:compact.length,missingLocal:missing.length,byCourt:Object.fromEntries(counts)},null,2));
console.log(JSON.stringify({indexed:compact.length,missingLocal:missing.length,bytes:fs.statSync(output).size,byCourt:Object.fromEntries(counts)},null,2));
