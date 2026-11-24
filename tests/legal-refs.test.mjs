import test from 'node:test';
import assert from 'node:assert/strict';
import { brotliCompressSync } from 'node:zlib';
import { parseRefs, lawKeyOf } from '../src/legal-refs.mjs';
import { RefIndex, articleText } from '../src/ref-index.mjs';

test('الإحالات: الاختصارات والأسماء والأرقام، والفصل في المسطرة المدنية للظهير القديم والمادة للقانون 58.25', () => {
  const r = parseRefs('طبقاً للفصل 230 من ق.ل.ع والمادة 204 من القانون رقم 58.25 وخرقاً للفصلين 38 و39 من قانون المسطرة المدنية والمادة 94 من مدونة الأسرة');
  assert.deepEqual(r.map(x => [x.lawKey, x.articles]), [['qlo', ['230']], ['cpc', ['204']], ['cpc1974', ['38', '39']], ['family', ['94']]]);
  assert.deepEqual(parseRefs('الفصل 12 من الظهير المذكور'), []);
});

test('مفتاح القانون من عنوان الوثيقة ورقمها', () => {
  assert.equal(lawKeyOf('الالتزامات والعقود'), 'qlo');
  assert.equal(lawKeyOf('القانون رقم 58.25 المتعلق بالمسطرة المدنية', '58.25'), 'cpc');
  assert.equal(lawKeyOf('قانون المسطرة المدنية'), 'cpc1974');
  assert.equal(lawKeyOf('مدونة الأسرة'), 'family');
  assert.equal(lawKeyOf('مرسوم بتطبيق مدونة الأسرة'), '');
});

test('نص فصل واحد حتى الفصل الموالي', () => {
  const text = 'تمهيد\nالفصل 229\nنص سابق\nالفصل 230\nالالتزامات التعاقدية المنشأة على وجه صحيح تقوم مقام القانون.\nالفصل 231\nكل تعهد يجب تنفيذه بحسن نية.';
  assert.equal(articleText(text, 230), 'الفصل 230\nالالتزامات التعاقدية المنشأة على وجه صحيح تقوم مقام القانون.');
  assert.equal(articleText(text, 23), '');
});

test('النص المذيَّل: القرارات تُفهرس بفصول القانون الذي أحالت عليه', async () => {
  const body = s => brotliCompressSync(Buffer.from(s));
  const rows = {
    national: [{ id: 'law1', title: 'الالتزامات والعقود', law_number: '' }],
    decisions: [
      { id: 'd1', title: 'قرار 1', type: 'juriscassation', category: '', date: '2024-01-01', body: body('خرق الفصل 230 من ق.ل.ع') },
      { id: 'd2', title: 'قرار 2', type: 'juriscassation', category: '', date: '2025-01-01', body: body('الفصلين 230 و231 من قانون الالتزامات والعقود') },
    ],
  };
  const library = { managedDocs: new Map(), db: { prepare: sql => ({ all: () => (/type='national'/.test(sql) ? rows.national : rows.decisions) }) } };
  const index = new RefIndex(library);
  assert.equal(index.resolve('الفصل 230 من ق.ل.ع').id, 'law1');
  assert.equal(index.resolve('الفصل 230 من ق.ل.ع').needle, 'الفصل 230');
  const first = await index.annotationsFor({ title: 'الالتزامات والعقود' });
  assert.equal(first.building, true);
  await index.build();
  const ready = await index.annotationsFor({ title: 'الالتزامات والعقود' });
  assert.deepEqual(ready.articles['230'].map(d => d.id), ['d2', 'd1']);
  assert.deepEqual(ready.articles['231'].map(d => d.id), ['d2']);
});

test('بناء الفهرس في خيط مستقل من قاعدة على القرص', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'refs-')), 'lib.sqlite');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE documents (id TEXT, title TEXT, type TEXT, category TEXT, date TEXT, law_number TEXT, body BLOB)');
  const insert = db.prepare('INSERT INTO documents VALUES (?,?,?,?,?,?,?)');
  insert.run('national:1', 'القانون رقم 70.03 بمثابة مدونة الأسرة', 'national', '', '', '70.03', brotliCompressSync(Buffer.from('نص')));
  insert.run('d1', 'قرار نفقة', 'juriscassation', '', '2025-02-01', '', brotliCompressSync(Buffer.from('خرق المادة 94 من مدونة الأسرة')));
  db.close();
  const library = { file, managedDocs: new Map(), db: new DatabaseSync(file, { readOnly: true }) };
  const index = new RefIndex(library);
  await index.build();
  const ann = await index.annotationsFor({ title: 'القانون رقم 70.03 بمثابة مدونة الأسرة', lawNumber: '70.03' });
  assert.deepEqual(ann.articles['94'].map(d => d.id), ['d1']);
  assert.equal(index.resolve('المادة 94 من مدونة الأسرة').id, 'national:1');
});

test('ظهير 1974 الملغى يُعرف برقمه رغم ذكر 58.25 في عنوانه، ويحمل بيان النسخ', async () => {
  const { lawKeyOf, REPEALED } = await import('../src/legal-refs.mjs');
  const title = 'تم نسخ مقتضيات الظهير الشريف بمثابة قانون رقم 1.74.447 بتاريخ 11 من رمضان 1394 (28 شتنبر 1974) بالمصادقة على نص قانون المسطرة المدنية، كما تم تغييره وتتميمه بمقتضى المادة 644 من الظهير الشريف رقم 1.26.07 بتنفيذ القانون رقم 58.25 المتعلق بالمسطرة المدنية';
  assert.equal(lawKeyOf(title), 'cpc1974');
  assert.equal(lawKeyOf('58.25 — المسطرة المدنية', '58.25'), 'cpc');
  assert.equal(REPEALED.cpc1974.by, 'cpc');
});
