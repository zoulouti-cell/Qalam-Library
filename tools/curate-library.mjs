/* تنقية قاعدة المكتبة عند البناء: حذف الحشو الصريح والنسخ المتطابقة نصاً، ثم إعادة بناء ترتيب الفهرس.
   الاستعمال: node tools/curate-library.mjs data/library.sqlite [--dry-run]
   لا يُحذف إلا ما هو آتٍ:
   1) بطاقات «محتوى/المحتوى» الفارغة (فشل استخراج بلا أي معلومة سوى رقم القرار).
   2) وثيقتان فأكثر من النوع نفسه بنص متطابق بالبصمة؛ تبقى أقدمها ويُسجَّل الباقي في curation_removed.
   العناوين المتشابهة بنصوص مختلفة (مبادئ قضائية في قضايا متعددة، مراسيم الطوابع...) لا تُعدّ تكراراً. */
import { DatabaseSync } from 'node:sqlite';
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

const byReason = {};
for (const r of removals.values()) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
console.log(JSON.stringify({ file, dryRun, total: removals.size, byReason, sameTextUnderDifferentTitles: sameTextOtherTitle }));
if (dryRun || !removals.size) process.exit(0);

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
  // الصفوف اليتيمة في فهرس FTS لا تظهر: كل الاستعلامات تضمّه إلى documents بالمعرّف الصفّي.
  const count = sql => db.prepare(sql).get().n;
  const meta = db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)');
  meta.run('documents', JSON.stringify(count('SELECT count(*) n FROM documents')));
  meta.run('texts', JSON.stringify(count("SELECT count(*) n FROM documents WHERE text_kind='extracted_text'")));
  meta.run('summaries', JSON.stringify(count("SELECT count(*) n FROM documents WHERE text_kind='source_summary'")));
  meta.run('catalogOnly', JSON.stringify(count("SELECT count(*) n FROM documents WHERE text_kind='image_only'")));
  meta.run('curation', JSON.stringify({ removed: removals.size, byReason, at: new Date().toISOString() }));
  const original = JSON.parse(db.prepare("SELECT value FROM metadata WHERE key='originalCategories'").get()?.value || '{}');
  installCatalogOrder(db, original);
  meta.run('generation', JSON.stringify(Date.now()));
  db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
db.exec('PRAGMA optimize');
console.log('تمت التنقية.');
