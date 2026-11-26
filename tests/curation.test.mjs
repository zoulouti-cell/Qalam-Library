/* اختبارات تنقية القاعدة (حذف الحشو والنسخ المتطابقة) وإلحاق النصوص بمؤسساتها وترتيبها. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { brotliCompressSync } from 'node:zlib';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLibraryDb } from './fixtures/make-library-db.mjs';
import { catalogCategory, orderedCategories, FRENCH_SHELVES, DRIVE_SHELVES } from '../src/catalog.mjs';

const tool = fileURLToPath(new URL('../tools/curate-library.mjs', import.meta.url));

test('التنقية تحذف بطاقات «محتوى» الفارغة والنسخ المتطابقة نصاً وعنواناً، وتُبقي المتشابه بنصوص مختلفة', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-curate-'));
  const file = makeLibraryDb(path.join(dir, 'library.sqlite'));
  const db = new DatabaseSync(file);
  const put = db.prepare('INSERT INTO documents(id,title,title_norm,type,category,subcategory,kind,date,text_kind,review_status,issues,law_number,decision_number,case_number,abrogated,sha256,body,chars) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)');
  const long = 'المادة 1\n' + 'نص قانوني طويل '.repeat(40);
  const add = (id, title, type, text, sha) => put.run(id, title, title, type, 'المادة المدنية', '', 'law', '', 'extracted_text', 'x', '[]', '', '', '', sha, brotliCompressSync(Buffer.from(text)), text.length);
  add('jc:1', 'محتوى', 'juriscassation', 'محتوى', 'a'.repeat(64));
  add('jc:2', 'المحتوى', 'juriscassation', 'المحتوى', 'b'.repeat(64));
  add('national:10', 'مرسوم مكرر', 'national', long, 'c'.repeat(64));
  add('national:11', 'مرسوم مكرر', 'national', long, 'c'.repeat(64));
  add('national:12', 'مرسوم آخر بالنص نفسه', 'national', long, 'c'.repeat(64));
  add('national:13', 'مرسوم الطابع', 'national', long + ' 1', 'd'.repeat(64));
  add('national:14', 'مرسوم الطابع', 'national', long + ' 2', 'e'.repeat(64));
  db.close();
  const out = execFileSync(process.execPath, ['--no-warnings', tool, file], { encoding: 'utf8' });
  assert.match(out, /"total":3/);
  const after = new DatabaseSync(file, { readOnly: true });
  const ids = after.prepare('SELECT id FROM documents ORDER BY id').all().map(r => r.id);
  assert.ok(!ids.includes('jc:1') && !ids.includes('jc:2'), 'البطاقتان الفارغتان محذوفتان');
  assert.ok(ids.includes('national:10') && !ids.includes('national:11'), 'يبقى الأقدم من النسختين');
  assert.ok(ids.includes('national:12'), 'عنوان مختلف بالنص نفسه لا يُحذف (خطأ استخراج لا تكرار)');
  assert.ok(ids.includes('national:13') && ids.includes('national:14'), 'عنوان واحد بنصين مختلفين ليسا تكراراً');
  assert.equal(after.prepare('SELECT count(*) n FROM curation_removed').get().n, 3);
  assert.equal(JSON.parse(after.prepare("SELECT value FROM metadata WHERE key='documents'").get().value), after.prepare('SELECT count(*) n FROM documents').get().n);
  after.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('نصوص حقوق الإنسان تلتحق بمؤسساتها ولا تبقى فئة موضوعية مبعثرة', () => {
  const cat = (title, category = 'مادة حماية حقوق الإنسان والنهوض بها') => catalogCategory({ id: 'national:x', type: 'national', title, category });
  assert.equal(cat('76.15 — المجلس الوطني لحقوق الإنسان'), 'المجلس الوطني لحقوق الإنسان');
  assert.equal(cat('ظهير شريف يتعلق بالمجلس الاستشاري لحقوق الإنسان', 'مادة الحقوق والحريات'), 'المجلس الوطني لحقوق الإنسان');
  assert.equal(cat('14.16 — مؤسسة الوسيط'), 'مؤسسة الوسيط');
  assert.equal(cat('نص حقوقي عام'), 'مادة الحقوق والحريات');
  assert.equal(cat('ظهير بإعادة تنظيم الهيأة العليا للاتصال السمعي البصري', 'المادة السمعية البصرية'), 'الهيئة العليا للاتصال السمعي البصري');
});

test('القسم الفرنسي يضم الأرفف الستة ومعرّفاتها في Drive', () => {
  assert.deepEqual([...FRENCH_SHELVES], ['محكمة النقض الفرنسية', 'مجلس الدولة الفرنسي', 'المجلس الدستوري الفرنسي', 'قوانين فرنسية', 'دراسات فرنسية', 'مستجدات فرنسية']);
  for (const name of FRENCH_SHELVES) assert.match(DRIVE_SHELVES[name], /^[\w-]{20,}$/);
  const rows = orderedCategories(FRENCH_SHELVES.map(name => ({ name, count: 0 })));
  assert.deepEqual(rows.map(r => r.group), Array(6).fill('french'));
});

test('ترتيب المجالس والهيئات والوكالات بحسب الأهمية لا بحسب العدد', () => {
  const row = (name, count) => ({ name, count });
  const names = orderedCategories([row('المجلس الاستشاري للشباب والعمل الجمعوي', 9), row('المجلس الأعلى للحسابات', 1), row('الوكالة الوطنية للمياه والغابات', 9), row('الوكالة الوطنية لحماية الطفولة', 1), row('هيئة المناصفة ومكافحة كل أشكال التمييز', 9), row('الهيئة العليا للاتصال السمعي البصري', 1)]).map(r => r.name);
  assert.deepEqual(names, ['المجلس الأعلى للحسابات', 'المجلس الاستشاري للشباب والعمل الجمعوي', 'الهيئة العليا للاتصال السمعي البصري', 'هيئة المناصفة ومكافحة كل أشكال التمييز', 'الوكالة الوطنية لحماية الطفولة', 'الوكالة الوطنية للمياه والغابات']);
});

test('عدد كل فئة يساوي إجمالي قائمتها (لا فرق بين ما يُعرض وما يُفتح)', async () => {
  const { Library } = await import('../src/library.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-consistency-'));
  const library = new Library(makeLibraryDb(path.join(dir, 'library.sqlite')));
  try {
    for (const category of library.categories()) {
      if (category.driveFolderId || category.count === 0) continue;
      assert.equal(library.search({ category: category.name, limit: 1 }).total, category.count, category.name);
    }
  } finally { library.db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('النص المنسوب خطأً إلى وثيقة أخرى يُسحب ويبقى لصاحبه', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qalam-withdraw-'));
  const file = makeLibraryDb(path.join(dir, 'library.sqlite'));
  const db = new DatabaseSync(file);
  const put = db.prepare('INSERT INTO documents(id,title,title_norm,type,category,subcategory,kind,date,text_kind,review_status,issues,law_number,decision_number,case_number,abrogated,sha256,body,chars) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)');
  const idx = db.prepare('INSERT INTO search(rowid,title,body) VALUES(?,?,?)');
  const head = 'قرار محكمة النقض رقم 145 الصادر بتاريخ 6 أبريل 2021 في الملف الشرعي رقم 2019/2/2/691\n' + 'تعليل مفصل للقرار '.repeat(40);
  const decree = 'مرسوم بإحداث كلية الآداب بفاس\nمرسوم رقم 2.74.343 بإحداث كلية الآداب بفاس\n' + 'نص المرسوم '.repeat(60);
  const rows = [
    ['jc:1', 'مبدأ الأول في قرار 145', 'juriscassation', '2021/145', '2019/2/2/691', head],
    ['jc:2', 'مبدأ الثاني في قرار 144', 'juriscassation', '2021/144', '2018/2/2/1047', head],
    ['national:1', 'مرسوم بإحداث كلية الآداب بفاس', 'national', '', '', decree],
    ['national:2', 'مرسوم بإحداث كلية الطب بالرباط', 'national', '', '', decree],
  ];
  rows.forEach(([id, title, type, dec, cs, text], i) => {
    put.run(id, title, title, type, 'محكمة النقض', '', 'x', '', 'extracted_text', 'x', '[]', '', dec, cs, String(i < 2 ? 'a' : 'b').repeat(64), brotliCompressSync(Buffer.from(text)), text.length);
    idx.run(100 + i, title, text);
  });
  db.close();
  const out = execFileSync(process.execPath, ['--no-warnings', tool, file], { encoding: 'utf8' });
  assert.match(out, /"wrongTextWithdrawn":2/);
  const after = new DatabaseSync(file, { readOnly: true });
  const chars = id => after.prepare('SELECT chars FROM documents WHERE id=?').get(id).chars;
  assert.ok(chars('jc:1') > 500 && chars('jc:2') < 200, 'صاحب القرار 145 يحتفظ بالنص');
  assert.ok(chars('national:1') > 500 && chars('national:2') < 200, 'مرسوم الآداب يحتفظ بنصه');
  assert.equal(after.prepare("SELECT owner FROM curation_text_withdrawn WHERE id='jc:2'").get().owner, 'jc:1');
  after.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('قسم السلطة القضائية: نصوص المجلس الأعلى للسلطة القضائية أول ما يظهر', async () => {
  const { compareOriginalDocuments } = await import('../src/catalog.mjs');
  const mk = (title, kind, pos) => ({ title, kind, category: 'السلطة القضائية', type: 'national', abrogated: 0, rowid: pos, source_position: pos });
  const docs = [mk('ظهير شريف بمثابة النظام الأساسي للقضاة', 'dahir', 1), mk('مرسوم يتعلق بالقضاة', 'decree', 2), mk('القانون التنظيمي المتعلق بالمجلس الأعلى للسلطة القضائية', 'organic', 3)];
  assert.equal(docs.sort(compareOriginalDocuments)[0].title.includes('المجلس الأعلى للسلطة القضائية'), true);
  const other = [{ ...mk('المجلس الأعلى للسلطة القضائية', 'law', 2), category: 'مدونة التجارة' }, { ...mk('نص آخر', 'law', 1), category: 'مدونة التجارة' }];
  assert.equal(other.sort(compareOriginalDocuments)[0].title, 'نص آخر', 'القاعدة خاصة بقسم السلطة القضائية وحده');
});
