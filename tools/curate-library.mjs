/* تنقية قاعدة المكتبة عند البناء: حذف الحشو الصريح والنسخ المتطابقة نصاً، ثم إعادة بناء ترتيب الفهرس.
   الاستعمال: node tools/curate-library.mjs data/library.sqlite [--dry-run]
   لا يُحذف إلا ما هو آتٍ:
   1) بطاقات «محتوى/المحتوى» الفارغة (فشل استخراج بلا أي معلومة سوى رقم القرار).
   2) وثيقتان فأكثر من النوع نفسه بنص متطابق بالبصمة؛ تبقى أقدمها ويُسجَّل الباقي في curation_removed.
   العناوين المتشابهة بنصوص مختلفة (مبادئ قضائية في قضايا متعددة، مراسيم الطوابع...) لا تُعدّ تكراراً. */
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { installCatalogOrder } from '../src/catalog.mjs';

const file = process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || 'data/library.sqlite';
const dryRun = process.argv.includes('--dry-run');
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=DELETE;');

const removals = new Map();
const mark = (row, reason, keeper = '') => { if (!removals.has(row.rowid)) removals.set(row.rowid, { ...row, reason, keeper }); };

for (const row of db.prepare("SELECT rowid,id,type,title,category FROM documents WHERE title IN ('محتوى','المحتوى') AND chars<=10").all()) mark(row, 'placeholder');

/* التكرار = النوع نفسه + بصمة النص نفسها + العنوان نفسه (بعد حذف بادئة «رقم_تاريخ_»).
   نصٌّ واحد تحت عنوانين مختلفين خطأ استخراج لا تكرار: لا يُحذف بل يُذكر في التقرير. */
const stripPrefix = title => String(title || '').replace(/^\d+_\d{4}-\d{2}-\d{2}_/u, '').replace(/\s+/g, ' ').trim();
const groups = db.prepare("SELECT type,sha256 FROM documents WHERE sha256 IS NOT NULL AND sha256<>'' AND chars>=300 GROUP BY type,sha256 HAVING count(*)>1").all();
const members = db.prepare('SELECT rowid,id,type,title,category,abrogated FROM documents WHERE type=? AND sha256=? ORDER BY abrogated,rowid');
let sameTextOtherTitle = 0;
for (const g of groups) {
  const bucket = new Map();
  for (const row of members.all(g.type, g.sha256)) {
    const key = stripPrefix(row.title);
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key).push(row);
  }
  if (bucket.size > 1) sameTextOtherTitle += bucket.size;
  for (const rows of bucket.values()) { const [keeper, ...rest] = rows; for (const row of rest) mark(row, 'duplicate-text', keeper.id); }
}

/* نص واحد تحت وثائق مختلفة: خطأ استخراج (النص لوثيقة واحدة منها فقط). نحدد صاحب النص بقرائن من النص نفسه،
   ونسحب النص الخاطئ من الوثائق الأخرى حتى لا يقرأ المحامي نصاً لغير وثيقته:
   - الاجتهادات: رقم القرار ورقم الملف في ترويسة النص؛ تبقى للبطاقة عنوانها (المبدأ) نصاً موجزاً.
   - النصوص الوطنية: تطابق ألفاظ العنوان مع مطلع النص. ولا يُحكم إن لم تتضح القرينة. */
const fixes = new Map();
const tokensOf = value => new Set(String(value).replace(/[^\u0600-\u06FF0-9. ]/gu, ' ').split(/\s+/).filter(w => w.length > 2 && !/^(ظهير|شريف|مرسوم|قانون|رقم|بتنفيذ|المتعلق|يتعلق|بشأن|صادر|الصادر|قرار|بتاريخ)$/u.test(w)));
const readText = body => brotliDecompressSync(Buffer.from(body)).toString('utf8');
const mismatchRows = db.prepare('SELECT rowid,id,type,title,category,decision_number,case_number,body FROM documents WHERE type=? AND sha256=? ORDER BY rowid');
for (const g of db.prepare("SELECT type,sha256 FROM documents WHERE sha256 IS NOT NULL AND sha256<>'' AND chars>=300 AND type IN ('juriscassation','national') GROUP BY type,sha256 HAVING count(*)>1").all()) {
  const members = mismatchRows.all(g.type, g.sha256).filter(r => !removals.has(r.rowid));
  if (new Set(members.map(r => stripPrefix(r.title))).size < 2) continue;
  const text = readText(members[0].body);
  let owners = [];
  if (g.type === 'juriscassation') {
    const numbers = new Set(text.slice(0, 700).replace(/[\u064B-\u065F]/gu, '').match(/\d{1,5}/g) || []);
    const tail = value => String(value || '').split('/').pop();
    owners = members.filter(r => { const n = tail(r.decision_number), c = tail(r.case_number); return (n && c && numbers.has(n) && numbers.has(c)) || (c.length >= 3 && numbers.has(c)) || (n.length >= 3 && numbers.has(n)); });
  } else {
    const head = tokensOf(text.slice(0, 1500));
    const scored = members.map(r => { const t = tokensOf(stripPrefix(r.title).split(' — ').pop()); let hit = 0; for (const w of t) if (head.has(w)) hit++; return { r, ratio: t.size ? hit / t.size : 0 }; }).sort((a, b) => b.ratio - a.ratio);
    if (scored[0].ratio >= 0.6 && scored[0].ratio - scored[1].ratio >= 0.3) owners = [scored[0].r];
  }
  if (owners.length !== 1) continue;
  for (const r of members) if (r.rowid !== owners[0].rowid) fixes.set(r.rowid, { ...r, owner: owners[0].id });
}

const byReason = {};
for (const r of removals.values()) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
console.log(JSON.stringify({ file, dryRun, total: removals.size, byReason, sameTextUnderDifferentTitles: sameTextOtherTitle, wrongTextWithdrawn: fixes.size }));
if (dryRun || (!removals.size && !fixes.size)) process.exit(0);

db.exec('BEGIN');
try {
  db.exec('CREATE TABLE IF NOT EXISTS curation_removed(id TEXT PRIMARY KEY,type TEXT,title TEXT,category TEXT,reason TEXT,keeper TEXT)');
  const log = db.prepare('INSERT OR REPLACE INTO curation_removed VALUES(?,?,?,?,?,?)');
  const hasTable = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const del = [
    ...(hasTable('headings') ? [db.prepare('DELETE FROM headings WHERE doc_rowid=?')] : []),
    db.prepare('DELETE FROM catalog_order WHERE doc_rowid=?'),
    db.prepare('DELETE FROM documents WHERE rowid=?'),
  ];
  const byId = [
    ['original_sequence', 'doc_id'], ['law_titles', 'id'], ['reading_audit', 'id'],
  ].filter(([table]) => hasTable(table)).map(([table, column]) => db.prepare(`DELETE FROM ${table} WHERE ${column}=?`));
  for (const r of removals.values()) {
    log.run(r.id, r.type, r.title, r.category ?? '', r.reason, r.keeper);
    for (const stmt of del) stmt.run(r.rowid);
    for (const stmt of byId) stmt.run(r.id);
  }
  /* سحب النص الخاطئ: يُستبدل بنص موجز (المبدأ للاجتهادات، تنبيه للنصوص الوطنية) ويُحدَّث فهرس البحث. */
  db.exec('CREATE TABLE IF NOT EXISTS curation_text_withdrawn(id TEXT PRIMARY KEY,owner TEXT,old_sha TEXT,old_chars INTEGER)');
  const logFix = db.prepare('INSERT OR REPLACE INTO curation_text_withdrawn VALUES(?,?,?,?)');
  const updateBody = db.prepare('UPDATE documents SET body=?,sha256=?,chars=?,text_kind=? WHERE rowid=?');
  const ftsDelete = db.prepare("INSERT INTO search(search,rowid,title,body) VALUES('delete',?,?,?)");
  const ftsInsert = db.prepare('INSERT INTO search(rowid,title,body) VALUES(?,?,?)');
  for (const r of fixes.values()) {
    const old = readText(r.body);
    const text = r.type === 'juriscassation' ? stripPrefix(r.title).replace(/…$/u, '') : 'تعذّر اعتماد النص المستخرج لهذه الوثيقة لأنه يطابق نص وثيقة أخرى؛ يُرجع إلى الأصل في Drive.';
    const kind = r.type === 'juriscassation' ? 'source_summary' : 'image_only';
    logFix.run(r.id, r.owner, createHash('sha256').update(old).digest('hex'), old.length);
    try { ftsDelete.run(r.rowid, r.title, old); } catch {}
    updateBody.run(brotliCompressSync(Buffer.from(text, 'utf8')), createHash('sha256').update(text).digest('hex'), text.length, kind, r.rowid);
    ftsInsert.run(r.rowid, r.title, text);
    if (hasTable('headings')) db.prepare('DELETE FROM headings WHERE doc_rowid=?').run(r.rowid);
  }
  // الصفوف اليتيمة في فهرس FTS لا تظهر: كل الاستعلامات تضمّه إلى documents بالمعرّف الصفّي.
  const count = sql => db.prepare(sql).get().n;
  const meta = db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)');
  meta.run('documents', JSON.stringify(count('SELECT count(*) n FROM documents')));
  meta.run('texts', JSON.stringify(count("SELECT count(*) n FROM documents WHERE text_kind='extracted_text'")));
  meta.run('summaries', JSON.stringify(count("SELECT count(*) n FROM documents WHERE text_kind='source_summary'")));
  meta.run('catalogOnly', JSON.stringify(count("SELECT count(*) n FROM documents WHERE text_kind='image_only'")));
  meta.run('curation', JSON.stringify({ removed: removals.size, byReason, wrongTextWithdrawn: fixes.size, at: new Date().toISOString() }));
  const original = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='originalCategories'").get()?.value || '{}');
  installCatalogOrder(db, original);
  meta.run('generation', JSON.stringify(Date.now()));
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
db.exec('PRAGMA optimize');
console.log('تمت التنقية.');
