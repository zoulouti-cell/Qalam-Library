// The original library's navigation and reference priorities, kept separately
// from full-text relevance. Removing unavailable records never renumbers titles.
const MAJOR = ['المادة الدستورية','المادة المدنية','المادة الجنائية','المادة التجارية','المادة الاجتماعية','المادة الإدارية','المادة الأسرية','المادة العقارية','المادة المالية','المادة الانتخابية','المادة البيئية'];
const GROUPS = [['materials','القوانين الوطنية'],['authorities','السلطات'],['councils','المجالس'],['judicial','الاجتهادات القضائية'],['studies','الدراسات'],['org','التنظيم الهيكلي لوزارة العدل']];
const REFERENCES = {
  'المادة الدستورية':['دستور المملكة المغربية لسنة 2011','دستور المملكة'],
  'المادة المدنية':['المسطرة المدنية','الالتزامات والعقود','الحقوق العينية','التحفيظ العقاري'],
  'المادة الجنائية':['المسطرة الجنائية','مجموعة القانون الجنائي','القانون الجنائي'],
  'المادة التجارية':['مدونة التجارة'], 'المادة الأسرية':['مدونة الأسرة','الحالة المدنية'],
  'المادة الاجتماعية':['مدونة الشغل','الضمان الاجتماعي','التغطية الصحية'], 'مادة الشغل':['مدونة الشغل'],
  'مادة المنظومة الصحية والحماية الاجتماعية':['التغطية الصحية','الضمان الاجتماعي'],
  'المادة الإدارية':['03.01','55.19','54.19','54.05','1.75.168','10.03'], 'المادة العقارية':['التحفيظ العقاري','الحقوق العينية'],
  'المادة الانتخابية':['الانتخابات'], 'مادة النقل':['مدونة السير'],
};
export function catalogCategory(row) {
  if (/الأجزاء التابعة.*الملك العمومي|الملك العمومي.*الأجزاء التابعة/i.test(row.title || '')) return 'المادة البيئية';
  if (row.category === 'قوانين وتشريعات وطنية') return 'مادة الفلاحة';
  return row.category;
}
const GENERAL = ['دستور المملكة المغربية لسنة 2011','المسطرة المدنية','المسطرة الجنائية','الالتزامات والعقود','مجموعة القانون الجنائي','القانون الجنائي','مدونة التجارة','مدونة الأسرة','مدونة الشغل','التحفيظ العقاري','الحقوق العينية','مدونة السير','تعليل قراراتها الإدارية','تبسيط المساطر والإجراءات الإدارية','ميثاق المرافق العمومية','التدبير المفوض للمرافق العامة','الدستور'];
function categoryRank(name) {
  const i=MAJOR.indexOf(name); if(i>=0)return i;
  if(/^مادة|^المادة/.test(name))return 100;
  if(name.startsWith('السلطة'))return 110;
  if(name.includes('محكمة')||name.startsWith('اجتهادات قضائية')||name==='المجلس الأعلى')return 120;
  if(name.includes('مجلس'))return 130;
  if(/دراسات|مجلة|أبحاث|ابحاث|بحوث|نشرة/.test(name))return 140;
  if(name.includes('التنظيم الهيكلي'))return 150;
  return 100;
}
function judicialRank(name){return name==='المجلس الأعلى'?0:name.includes('محكمة النقض')?1:name.includes('محكمة الاستئناف')?2:name.includes('المحكمة الإدارية')||name.includes('المحكمة التجارية')?3:name.startsWith('اجتهادات قضائية')?4:5;}
function groupOf(name){return ({110:'authorities',120:'judicial',130:'councils',140:'studies',150:'org'})[categoryRank(name)]||'materials';}
export function orderedCategories(categories, original={}) {
  const sorted=[...categories].sort((a,b)=>categoryRank(a.name)-categoryRank(b.name)||(original[b.name]?.count??b.count)-(original[a.name]?.count??a.count));
  return GROUPS.flatMap(([group,groupLabel])=>{
    const members=sorted.filter(c=>groupOf(c.name)===group);
    if(group==='judicial')members.sort((a,b)=>judicialRank(a.name)-judicialRank(b.name));
    return members.map(c=>({...c,group,groupLabel,tier:group==='judicial'&&c.name.includes('محكمة الاستئناف')?'محاكم الاستئناف':''}));
  });
}
function kindRank(d){const primaryReference=d.type==='national'&&((d.law_number&&referenceRank(d)<99)||d.title.includes('بالمصادقة على مجموعة القانون الجنائي'));const kind=primaryReference&&['other','dahir'].includes(d.kind)?'law':d.kind;return ({law:0,dahir:1,decree:2,order:3,other:4,decision:5,jurisprudence:6,study:7})[kind]??9;}
function referenceRank(d){const n=(REFERENCES[d.category]||[]).findIndex(t=>d.title.includes(t));return n<0?99:n;}
export function compareOriginalDocuments(a,b){
  const ar=referenceRank(a),br=referenceRank(b);
  return a.abrogated-b.abrogated||kindRank(a)-kindRank(b)||(ar<99?0:1)-(br<99?0:1)||(GENERAL.some(t=>a.title.includes(t))?0:1)-(GENERAL.some(t=>b.title.includes(t))?0:1)||ar-br||(a.source_position??a.rowid)-(b.source_position??b.rowid);
}
export function installCatalogOrder(db,original={},originalIds=[]) {
  db.exec('CREATE TABLE IF NOT EXISTS original_sequence(doc_id TEXT PRIMARY KEY,position INTEGER NOT NULL)');
  if(originalIds.length){const put=db.prepare('INSERT OR REPLACE INTO original_sequence VALUES(?,?)');for(const [i,id] of originalIds.entries())put.run(id,i);}
  const rows=db.prepare('SELECT d.rowid,d.id,d.title,d.type,d.category,d.kind,d.law_number,d.abrogated,s.position source_position FROM documents d LEFT JOIN original_sequence s ON s.doc_id=d.id ORDER BY d.rowid').all().map(d=>({...d,category:catalogCategory(d)}));
  const categories=orderedCategories([...new Set(rows.map(d=>d.category))].map(name=>({name,count:rows.filter(d=>d.category===name).length})),original);
  const groups=new Map(categories.map(c=>[c.name,[]]));for(const d of rows)groups.get(d.category).push(d);
  db.exec('CREATE TABLE IF NOT EXISTS catalog_order(doc_rowid INTEGER PRIMARY KEY,position INTEGER NOT NULL);DELETE FROM catalog_order;');
  const put=db.prepare('INSERT INTO catalog_order VALUES(?,?)');let position=0;
  for(const c of categories)for(const d of groups.get(c.name).sort(compareOriginalDocuments))put.run(d.rowid,position++);
  db.exec('CREATE INDEX IF NOT EXISTS catalog_position ON catalog_order(position)');
  db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('originalCategories',JSON.stringify(original));
  db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('catalogOrderVersion',JSON.stringify(2));
  return {categories:categories.length,documents:position};
}
