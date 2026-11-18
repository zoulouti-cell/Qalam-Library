// The original library's navigation and reference priorities, kept separately
// from full-text relevance. Removing unavailable records never renumbers titles.
const MAJOR = ['المادة الدستورية','المادة المدنية','المادة الجنائية','المادة التجارية','المادة الاجتماعية','المادة الإدارية','المادة الأسرية','المادة العقارية','المادة المالية','المادة الانتخابية','المادة البيئية'];
const GROUPS = [['constitutional','المادة الدستورية'],['materials','القوانين الوطنية'],['authorities','السلطات'],['councils','المجالس'],['bodies','الهيئات والمؤسسات'],['agencies','الوكالات'],['judicial','الاجتهادات القضائية'],['studies','الأبحاث والدراسات'],['org','التنظيم الهيكلي لوزارة العدل'],['french','القانون والقضاء الفرنسيين']];
/* هذه فئات مؤسسات عامة محددة بالاسم. لا نضم إليها الهيئات المهنية أو
   كل عبارة عابرة فيها «مجلس» أو «هيئة»، حتى لا يتكرر العنوان أو يختلط المجال. */
const INSTITUTIONS = [
  ['مجلس الوصاية', 'councils', /مجلس الوصاية/u],
  ['مجلس الجالية المغربية بالخارج', 'councils', /مجلس الجالية المغربية بالخارج/u],
  ['مجلس المنافسة', 'councils', /مجلس المنافسة/u],
  ['المجلس الاقتصادي والاجتماعي والبيئي', 'councils', /المجلس الاقتصادي والاجتماعي(?: والبيئي)?/u],
  ['المجلس الوطني لحقوق الإنسان', 'councils', /المجلس الوطني لحقوق الإنسان/u],
  ['المجلس الأعلى للتربية والتكوين والبحث العلمي', 'councils', /المجلس الأعلى للتربية والتكوين(?: والبحث العلمي)?/u],
  ['المجلس الوطني للصحافة', 'councils', /المجلس الوطني للصحافة/u],
  ['المجلس الوطني للغات والثقافة المغربية', 'councils', /المجلس الوطني للغات والثقافة المغربية/u],
  ['المجلس الاستشاري للأسرة والطفولة', 'councils', /المجلس الاستشاري للأسرة والطفولة/u],
  ['المجلس الاستشاري للشباب والعمل الجمعوي', 'councils', /المجلس الاستشاري للشباب والعمل الجمعوي/u],
  ['المجلس الأعلى للحسابات', 'councils', /المجلس الأعلى للحسابات/u],
  ['المجلس العلمي الأعلى', 'councils', /المجلس العلمي الأعلى/u],
  ['الهيئة الوطنية للنزاهة والوقاية من الرشوة ومحاربتها', 'bodies', /الهيئة الوطنية للنزاهة.*الرشوة/u],
  ['الهيئة العليا للاتصال السمعي البصري', 'bodies', /الهي(?:ئة|أة) العليا للإ?تصال السمعي/u],
  ['هيئة المناصفة ومكافحة كل أشكال التمييز', 'bodies', /هيئة المناصفة ومكافحة كل أشكال التمييز/u],
  ['الهيئة المغربية لسوق الرساميل', 'bodies', /الهيئة المغربية لسوق الرساميل/u],
  ['الهيئة الوطنية لضبط الكهرباء', 'bodies', /الهيئة الوطنية لضبط الكهرباء/u],
  ['الهيئة الوطنية للمعلومات المالية', 'bodies', /الهيئة الوطنية للمعلومات المالية/u],
  ['مؤسسة الوسيط', 'bodies', /مؤسسة (?:«)?الوسيط|ديوان المظالم/u],
  ['الوكالة الوطنية لحماية الطفولة', 'agencies', /الوكالة الوطنية لحماية الطفولة/u],
  ['الوكالة الوطنية للمياه والغابات', 'agencies', /الوكالة الوطنية للمياه والغابات/u],
  ['الوكالة المغربية للأدوية والمنتجات الصحية', 'agencies', /الوكالة المغربية للأدوية والمنتجات الصحية/u],
  ['الوكالة المغربية للدم ومشتقاته', 'agencies', /الوكالة المغربية للدم ومشتقاته/u],
  ['الوكالة الوطنية للدعم الاجتماعي', 'agencies', /الوكالة الوطنية للدعم الاجتماعي/u],
  ['الوكالة الوطنية للسلامة الطرقية', 'agencies', /الوكالة الوطنية للسلامة الطرقية/u],
  ['الوكالة الوطنية للمحافظة العقارية والمسح العقاري والخرائطية', 'agencies', /الوكالة الوطنية للمحافظة العقارية/u],
  ['الوكالة الوطنية للأنشطة المائية', 'agencies', /الوكالة الوطنية لتنمية تربية الأحياء المائية/u],
];
const INSTITUTION_PRIORITY = [
  'مؤسسة الوسيط', 'الهيئة الوطنية للنزاهة والوقاية من الرشوة ومحاربتها',
  'الهيئة العليا للاتصال السمعي البصري', 'الهيئة المغربية لسوق الرساميل',
  'الهيئة الوطنية للمعلومات المالية', 'الهيئة الوطنية لضبط الكهرباء',
  'مجلس الوصاية', 'مجلس المنافسة', 'المجلس الاقتصادي والاجتماعي والبيئي',
  'المجلس الوطني لحقوق الإنسان', 'المجلس الأعلى للحسابات',
  'المجلس الأعلى للتربية والتكوين والبحث العلمي', 'المجلس الوطني للصحافة',
  'المجلس الوطني للغات والثقافة المغربية', 'المجلس العلمي الأعلى',
  'مجلس الجالية المغربية بالخارج', 'المجلس الاستشاري للأسرة والطفولة',
  'المجلس الاستشاري للشباب والعمل الجمعوي', 'هيئة المناصفة ومكافحة كل أشكال التمييز',
];
export const DRIVE_SHELVES = Object.freeze({
  'محكمة النقض الفرنسية': '1X4WYURKX3EjQW5_1HQaTXHu9dpX8A_9t',
  'مجلس الدولة الفرنسي': '1sHZgg4yt6vhZyGxMi5z6XIqy6qlYq14X',
  'المجلس الدستوري الفرنسي': '1k2SiJ0PQ4Z1PNgiNxky_dLPw8XHHihPx',
  'مستجدات فرنسية': '1uC93axFQpHQbPfloOZiU0-tZqRnU87rw',
  'مستجدات': '1H4i3dCvIlhie4cieZ20jnAuw1AEgvsn0',
});
export const FIXED_SHELF_CATEGORIES = Object.freeze(Object.keys(DRIVE_SHELVES));
const REFERENCES = {
  'الدساتير':['دستور المملكة المغربية لسنة 2011','دستور المملكة'],
  'المادة المدنية':['المسطرة المدنية','الالتزامات والعقود','الحقوق العينية','التحفيظ العقاري'],
  'المادة الجنائية':['المسطرة الجنائية','مجموعة القانون الجنائي','القانون الجنائي'],
  'المادة التجارية':['مدونة التجارة'], 'المادة الأسرية':['مدونة الأسرة','الحالة المدنية'],
  'المادة الاجتماعية':['مدونة الشغل','الضمان الاجتماعي','التغطية الصحية'], 'مادة الشغل':['مدونة الشغل'],
  'مادة المنظومة الصحية والحماية الاجتماعية':['التغطية الصحية','الضمان الاجتماعي'],
  'المادة الإدارية':['03.01','55.19','54.19','54.05','1.75.168','10.03'], 'المادة العقارية':['التحفيظ العقاري','الحقوق العينية'],
  'المادة الانتخابية':['الانتخابات'], 'مادة النقل':['مدونة السير'],
};
export function catalogCategory(row) {
  const title = String(row.title || ''), category = String(row.category || '');
  if (/المحكمة الدستورية|المجلس الدستوري/u.test(`${title} ${category}`)) return 'القضاء الدستوري';
  if (row.type === 'national' && /الإضراب/u.test(title)) return 'مادة الحقوق والحريات';
  if (row.type === 'national' && /المجلس الأعلى للسلطة القضائية/u.test(title)) return 'السلطة القضائية';
  if (row.category === 'مادة اختصاصات وتنظيم القطاعات الحكومية والمؤسساتية') return 'مادة القطاعات الحكومية والمؤسساتية';
  if (row.type === 'national') {
    const institution = INSTITUTIONS.find(([, , matcher]) => matcher.test(title));
    if (institution) return institution[0];
  }
  if (row.category === 'المادة الدستورية') return 'الدساتير';
  if (row.category === 'اجتهادات قضائية - الخبرة والخبراء') return 'محكمة النقض - الخبرة';
  if (row.id === 'national:5298') return 'المادة البيئية';
  if (row.id === 'national:5825') return 'مادة الفلاحة';
  if (/الأجزاء التابعة.*الملك العمومي|الملك العمومي.*الأجزاء التابعة/i.test(row.title || '')) return 'المادة البيئية';
  return row.category;
}
const GENERAL = ['دستور المملكة المغربية لسنة 2011','المسطرة المدنية','المسطرة الجنائية','الالتزامات والعقود','مجموعة القانون الجنائي','القانون الجنائي','مدونة التجارة','مدونة الأسرة','مدونة الشغل','التحفيظ العقاري','الحقوق العينية','مدونة السير','تعليل قراراتها الإدارية','تبسيط المساطر والإجراءات الإدارية','ميثاق المرافق العمومية','التدبير المفوض للمرافق العامة','الدستور'];
function categoryRank(name) {
  if(name==='الدساتير')return -2;
  if(name==='القضاء الدستوري')return -1;
  const i=MAJOR.indexOf(name); if(i>=0)return i;
  // «مستجدات» مجلد قائم داخل «الأبحات و الدراسات» في بنية المكتبة وDrive؛
  // لا يُعامل كقسم قوانين مستقل حتى ولو احتوى موجزات لمشاريع أو نصوص قيد الرصد.
  if(name==='مستجدات')return 140;
  if(name==='الاجتهادات القضائية')return 120;
  if(/^مادة|^المادة/.test(name))return 100;
  if(name.startsWith('السلطة'))return 110;
  if(name.includes('محكمة')||name.startsWith('اجتهادات قضائية')||name==='المجلس الأعلى'||name==='قواعد قضائية')return 120;
  const institution = INSTITUTIONS.find(([label]) => label === name);
  if(institution)return institution[1] === 'councils' ? 130 : institution[1] === 'bodies' ? 135 : 136;
  if(name==='محكمة النقض الفرنسية'||name==='مجلس الدولة الفرنسي'||name==='المجلس الدستوري الفرنسي'||name==='مستجدات فرنسية')return 125;
  if(/دراسات|مجلة|أبحاث|ابحاث|بحوث|نشرة/.test(name))return 140;
  if(name.includes('التنظيم الهيكلي'))return 150;
  return 100;
}
function judicialRank(name){return name==='المجلس الأعلى'?0:name==='محكمة النقض'?1:name==='محكمة النقض - الخبرة'?2:name==='قواعد قضائية'?3:name.includes('محكمة الاستئناف')?4:name.includes('المحكمة الإدارية')||name.includes('المحكمة التجارية')?5:name.startsWith('اجتهادات قضائية')?6:7;}
function institutionRank(name){const rank=INSTITUTION_PRIORITY.indexOf(name);return rank<0?99:rank;}
function groupOf(name){if(['محكمة النقض الفرنسية','مجلس الدولة الفرنسي','المجلس الدستوري الفرنسي','مستجدات فرنسية'].includes(name))return 'french';return ({'-2':'constitutional','-1':'constitutional',110:'authorities',120:'judicial',130:'councils',135:'bodies',136:'agencies',140:'studies',150:'org'})[categoryRank(name)]||'materials';}
/**
 * «نصوص عامة»: عنوان محجوز في آخر «القوانين الوطنية» (بعد المواد القانونية كلها) يحيل إليه فهرس المكتب في تطبيق قلم.
 * يظهر ولو كان فارغًا، وتُودَع فيه النصوص التي لا تنتمي إلى مادة بعينها (من لوحة الإدارة بوضع الفئة «نصوص عامة»).
 * ما يُضاف إليه يُثبَّت دائمًا في آخر المجموعة مهما كان عدده.
 */
export const GENERAL_TEXTS = 'نصوص عامة';
export function withGeneralTexts(categories) {
  const existing = categories.find(c => c.name === GENERAL_TEXTS) || { name: GENERAL_TEXTS, count: 0, legislationCount: 0, jurisprudenceCount: 0, studiesCount: 0 };
  const rest = categories.filter(c => c.name !== GENERAL_TEXTS);
  let last = -1;
  rest.forEach((c, index) => { if (c.group === 'materials') last = index; });
  rest.splice(last + 1, 0, { ...existing, group: 'materials', groupLabel: 'القوانين الوطنية', tier: '' });
  return rest;
}
export function orderedCategories(categories, original={}) {
  const sorted=[...categories].sort((a,b)=>categoryRank(a.name)-categoryRank(b.name)||(original[b.name]?.count??b.count)-(original[a.name]?.count??a.count));
  return GROUPS.flatMap(([group,groupLabel])=>{
    const members=sorted.filter(c=>groupOf(c.name)===group);
    if(group==='judicial')members.sort((a,b)=>judicialRank(a.name)-judicialRank(b.name));
    if(group==='councils'||group==='bodies'||group==='agencies')members.sort((a,b)=>institutionRank(a.name)-institutionRank(b.name)||b.count-a.count);
    return members.map(c=>({...c,group,groupLabel,tier:group==='judicial'&&c.name.includes('محكمة الاستئناف')?'محاكم الاستئناف':'',driveFolderId:DRIVE_SHELVES[c.name]||''}));
  });
}
export function institutionSearchTerms(name) {
  if (name === 'المجلس الاقتصادي والاجتماعي والبيئي') return ['المجلس الاقتصادي والاجتماعي'];
  if (name === 'الهيئة العليا للاتصال السمعي البصري') return ['الهيئة العليا للاتصال السمعي', 'الهيأة العليا للإتصال السمعي'];
  if (name === 'مؤسسة الوسيط') return ['مؤسسة الوسيط', 'ديوان المظالم'];
  if (name === 'الوكالة الوطنية للأنشطة المائية') return ['الوكالة الوطنية لتنمية تربية الأحياء المائية'];
  const label = INSTITUTIONS.find(([item]) => item === name)?.[0] || '';
  return label ? [label] : [];
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
